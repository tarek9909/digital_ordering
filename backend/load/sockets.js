// k6 socket load (TRD §23.2: 250,000 concurrent sockets at design capacity; TR-NFR-01 ≤ 1 s p95 delivery).
//
//   k6 run -e RT=wss://t.staging.tanbeeh.app/rt/ -e TOKENS=tok1,tok2,... -e VUS=5000 load/sockets.js
//
// Each VU is one customer page: Socket.IO handshake over a raw WebSocket (Engine.IO v4 protocol), joins its
// ticket rooms through the auth payload and heartbeats every 20 s (TR-ALG-12). Delivery latency is measured by
// the synthetic journey, which timestamps transitions; this script loads the realtime tier.
import ws from 'k6/ws';
import { check } from 'k6';

const TOKENS = (__ENV.TOKENS || '').split(',').filter(Boolean);

export const options = {
  scenarios: { pages: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '10m', target: Number(__ENV.VUS || 1000) }, { duration: '30m', target: Number(__ENV.VUS || 1000) }, { duration: '5m', target: 0 }] } },
  thresholds: { ws_connecting: ['p(95)<1000'], checks: ['rate>0.99'] },
};

const clientId = () => Array.from({ length: 22 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

export default function () {
  const token = TOKENS[__VU % Math.max(1, TOKENS.length)];
  const url = `${__ENV.RT}?EIO=4&transport=websocket`;
  const res = ws.connect(url, null, (socket) => {
    socket.on('open', () => {});
    socket.on('message', (m) => {
      if (m.startsWith('0')) socket.send(`40${JSON.stringify({ clientId: clientId(), tickets: token ? [token] : [] })}`); // CONNECT with auth
      if (m === '2') socket.send('3'); // ping → pong
      if (m.startsWith('40')) {
        socket.setInterval(() => socket.send(`42${JSON.stringify(['presence.heartbeat', { tokens: token ? [token] : [], visible: true }])}`), 20_000);
      }
    });
    socket.setTimeout(() => socket.close(), 30 * 60_000);
  });
  check(res, { upgraded: (r) => r && r.status === 101 });
}
