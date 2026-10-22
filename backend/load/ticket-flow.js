// k6 load test (TRD §23.2, §26; TR-NFR-04, TR-NFR-09; Implementation Plan Phase 5 smoke and Phase 7 capacity).
//
//   k6 run -e BASE=https://burger-house.staging.tanbeeh.app -e STAFF_KEY=... -e PIN=4821 -e PROFILE=smoke load/ticket-flow.js
//   PROFILE=smoke     5× pilot scale (Phase 5 gate)
//   PROFILE=capacity  design capacity for 1 hour: 50 creations/s, 250 writes/s (Phase 7 gate)
//   PROFILE=soak      70% of capacity for 8 hours (Phase 7 gate)
//
// Each virtual staff device signs in once, then loops: create → ready → collected. Thresholds encode the TRD
// targets so the run fails when they are missed. Socket and push load are driven by load/sockets.js.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE;
const PROFILE = __ENV.PROFILE || 'smoke';
const transition = new Trend('transition_ms', true);

const PROFILES = {
  smoke: { executor: 'constant-arrival-rate', rate: 5, timeUnit: '1s', duration: '10m', preAllocatedVUs: 20, maxVUs: 50 },
  capacity: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '1h', preAllocatedVUs: 200, maxVUs: 600 },
  soak: { executor: 'constant-arrival-rate', rate: 35, timeUnit: '1s', duration: '8h', preAllocatedVUs: 150, maxVUs: 400 },
};

export const options = {
  scenarios: { tickets: PROFILES[PROFILE] },
  thresholds: {
    // TR-NFR-04: staff API p95 ≤ 300 ms, p99 ≤ 500 ms.
    'http_req_duration{group:::staff}': ['p(95)<300', 'p(99)<500'],
    transition_ms: ['p(95)<300'],
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
  },
};

let cookies = null;
let csrf = null;

function signIn() {
  const r = http.post(`${BASE}/api/staff/v1/sessions`, JSON.stringify({ staffKey: __ENV.STAFF_KEY, pin: __ENV.PIN, deviceName: `k6-${__VU}` }), { headers: { 'Content-Type': 'application/json' } });
  check(r, { 'signed in': (x) => x.status === 201 });
  const board = http.get(`${BASE}/api/staff/v1/board`);
  csrf = board.json('csrfToken');
  cookies = true;
}

export default function () {
  if (!cookies) signIn();
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
  const tags = { group: '::staff' };
  const created = http.post(`${BASE}/api/staff/v1/tickets`, '{}', { headers, tags });
  if (!check(created, { created: (x) => x.status === 201 })) return;
  const t = created.json('ticket');
  const ready = http.post(`${BASE}/api/staff/v1/tickets/${t.id}/transitions`, JSON.stringify({ to: 'ready', version: t.version }), { headers, tags });
  transition.add(ready.timings.duration);
  check(ready, { ready: (x) => x.status === 200 });
  sleep(Math.random() * 2);
  const collected = http.post(`${BASE}/api/staff/v1/tickets/${t.id}/transitions`, JSON.stringify({ to: 'collected', version: t.version + 1 }), { headers, tags });
  transition.add(collected.timings.duration);
  check(collected, { collected: (x) => x.status === 200 });
}
