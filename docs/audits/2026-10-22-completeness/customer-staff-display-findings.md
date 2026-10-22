# Customer, staff and display completeness audit

Audit date: 22 October 2026. Application source was not modified. This audit read the BRD/TRD customer, alert, staff, QR, display and realtime requirements, traced the current three applications and their API/socket handlers, and reviewed the earlier audit and repair table. Repaired A07/A18–A29 and W11–W17 are not being repeated.

**Current-source recheck:** after concurrent changes to ReadyScreen, TicketPage, BoardView and shared/display styles, all nine defect probes still reproduce their failures. All six Chromium geometry scenarios were rerun and their JSON/screenshots refreshed. The layout script waits for fonts and the new 600ms Ready animation to settle. No finding below was resolved by those changes; portrait capacities improved to 5/24 Ready-only and 3/24 with Preparing, while landscape remains 15/24 and 9/24.

## Executed verification

- Existing customer/staff/display/client-sdk tests: **114 passed in 21 files**. Command from `frontend/`: `npx vitest run apps/web-customer apps/web-staff apps/web-display packages/client-sdk`.
- New deterministic probes: **9 passed in 4 files**. These intentionally assert the newly discovered failures; passing means the defect was reproduced. Command from `frontend/`: `npx vitest run --config ../docs/audits/2026-10-22-completeness/customer-staff-display.config.mts`.
- Actual Chromium display rendering: six layouts, using actual Vite components/CSS with a controlled board API response. Script: `node docs/audits/2026-10-22-completeness/customer-staff-display-layout.mjs`. Results: `customer-staff-display-layout-results.json`; screenshots: `display-layout-*.png`. Inspected the 1920×1080 Preparing+Ready screenshot visually.
- Node/Vitest used the installed dependencies, Vitest 3.2.7; Chromium came from the installed Playwright. These checks do not establish real Web Push, physical TV audio, or iOS acceptance.

## Findings

### CSD01 — P1 — Push registration errors are converted into successful alert activation

**Source:** `frontend/apps/web-customer/src/components/ActivationSheet.tsx:54`, `:60`, `:69`, `:153`; the caller at `frontend/apps/web-customer/src/pages/TicketPage.tsx:443` sets `alertsOn` when the sheet reports true.

**Trigger:** notification permission is granted, but `enablePush()` throws because fetching the VAPID key, registering/subscribing the worker, or PUT `/tickets/:token/push-subscription` fails (including an ordinary temporary 500). The catch converts the exception to `unsupported`; `unsupported` goes to `done`. Closing that state invokes `onClose(true)`.

**Impact:** the customer sees the green “You're all set” confirmation and then “Alerts are on” although this ticket has no working background subscription. This is a separate failure branch from repaired A07: A07 now correctly reports a failed *existing* subscription link, but the explicit activation flow still conceals failure. A race with the initial follower registration can reach the same branch.

**Evidence:** `customer-staff-display-activation.test.tsx` injects a rejected push-subscription operation, clicks Allow, observes the success text, and asserts `onClose(true)`.

**Repair:** represent activation delivery capability separately (live-only, push linked, blocked, failed). Only report push enabled after successful persistence, retain a retry control on operational failure, and do not record successful activation after a failed setup. Requirements FR-ALR-01/03/05.

### CSD02 — P2 — Owner/manager/support staff search constructs an invalid URL

**Source:** `frontend/apps/web-staff/src/board/TicketList.tsx:82`; `frontend/apps/web-staff/src/lib/api.ts:25`; `frontend/packages/client-sdk/src/http.ts:49` and `:69`. The server requires both `q` and a valid `venueId` in `backend/apps/api/src/routes/staff.ts:154`.

**Trigger:** open the board from admin with `?venueId=<uuid>` and search by number or receipt. `vq('/tickets/search')` already contains `?venueId=...`, then `get(..., {q})` appends a second `?`.

**Observed URI:** `/api/staff/v1/tickets/search?venueId=123e4567-e89b-12d3-a456-426614174000?q=receipt123`. Standard URL parsing produces no `q` and a `venueId` ending in `?q=receipt123`; the route schema rejects that request. Device-cookie boards without a venue query do not hit this branch.

**Evidence:** `customer-staff-display-search.test.tsx` exercises the actual `vq` and actual SDK HTTP wrapper, captures the outgoing fetch URL and asserts both malformed values. The malformed URI was not sent to an authenticated HTTP server by this sub-audit.

**Repair:** build query parameters through one URL/URLSearchParams path, or pass `venueId` and `q` together as structured query arguments. Requirement FR-STF-09/17.

### CSD03 — P1 — Ready numbers are clipped silently at ordinary TV sizes

**Source:** `frontend/apps/web-display/src/components/BoardView.tsx:14`, `:19`, `:141`, `:147`; `frontend/apps/web-display/src/lib/board.ts:7` and `:26`.

**Trigger:** a display has enough Ready tickets to exceed the grid's visible rows. `readyView` always counts the first 24 as shown, but tile dimensions are fixed in viewport units and the list uses `overflow-hidden`; there is no rotation or viewport-sized cap.

**Actual Chromium result with 24 Ready tickets:**

| Viewport | Ready only: fully visible | With Preparing: fully visible | More indicator |
| --- | ---: | ---: | --- |
| 1920×1080 | 15/24 | 9/24 | None |
| 1280×720 | 15/24 | 9/24 | None |
| 1080×1920 | 5/24 | 3/24 | None |

Further cards are partially or entirely outside the clipped grid. On 1920×1080 with Preparing, the grid is 659.23px tall but scrollHeight is 1468px. The screenshot visibly cuts through 109–111 and hides the remaining older Ready orders. A count below 24 can already clip; 24 is the reproducible test case. The new column heading shows total count 24, but no rotation, pagination, or omitted-order count makes the clipped numbers accessible.

**Impact:** customers cannot see their Ready number despite it existing in the board data, and there is no indication that older Ready orders are omitted.

**Evidence:** `customer-staff-display-layout-results.json` records each card rectangle; `display-layout-1920x1080-with-preparing.png` is the visual reproduction. This uses the real app and real generated Tailwind styles, with controlled REST data.

**Repair:** derive capacity from actual available width/height and selected columns, then use an explicit overflow indicator or a tested rotation/pagination policy. Ensure every displayed tile fits; test landscape, portrait and promo settings. Requirements FR-DSP-02/03/07.

### CSD04 — P1 — A temporary display snapshot failure can leave a connected display stale indefinitely

**Source:** `frontend/apps/web-display/src/useDisplayBoard.ts:116`–`:130` and `:177`; `frontend/apps/web-display/src/components/BoardView.tsx:32`.

**Trigger:** a connected display receives `resync.required` (or encounters an event sequence gap/settings event), but the snapshot GET fails twice. `reload` catches the error and finishes without scheduling another attempt. No polling or stale-state retry exists, and ordinary subsequent incremental updates cannot reconstruct unrelated missed tickets.

**Observed:** after a failed `resync.required` and 120 seconds of simulated time, only the original two HTTP calls occurred. Making the API healthy did not trigger another call. The store remained `connected:true,resyncing:false`, so the display looked current.

**Impact:** a previously Ready order can remain on screen after collection, or a Ready order can remain missing, until another event happens to force a successful reload, the socket reconnects, or the daily reload occurs.

**Evidence:** `customer-staff-display-connection.test.tsx`, first test. Actual hook/React Query logic with controlled API/socket/timers.

**Repair:** retain a stale flag until a snapshot succeeds; retry with bounded backoff while online, and keep the reconnecting indicator visible. Requirements TR-RT-04/05, FR-DSP-08/09.

### CSD05 — P2 — Counter-filtered displays lose Ready announcements during snapshot reload

**Source:** `frontend/apps/web-display/src/useDisplayBoard.ts:165`–`:173`.

**Trigger:** while a snapshot is in flight, a newly Ready ticket's `ticket.updated` event is queued by `whenFresh`, but its `ticket.alert` is processed immediately against the old `ready` array. With a counter filter, the alert is discarded because the new ticket is absent from that stale array. The later snapshot successfully shows it.

**Observed:** the new ticket appeared in the final Ready data, with zero chime and zero speech calls after the merge window.

**Impact:** the display misses the first announcement for exactly the ticket entering Ready during reconnect/resync. Future repeats may announce it later if the customer has not acknowledged it.

**Evidence:** `customer-staff-display-connection.test.tsx`, second test. This differs from repaired A27's Undo cancellation: it concerns a valid new Ready ticket during snapshot reconstruction.

**Repair:** queue alerts together with ticket events while reloading and evaluate counter eligibility against fresh state. Requirements FR-DSP-04/05/07 and TR-RT-05.

### CSD06 — P2 — Staff/display never recover a server-refused socket handshake

**Source:** `frontend/apps/web-staff/src/board/boardData.ts:106`, `:146`; `frontend/apps/web-display/src/useDisplayBoard.ts:161`; shared connection wrapper `frontend/packages/client-sdk/src/socket.ts:17`. Real server refusal paths: `backend/apps/realtime/src/server.ts:71` (rate limit) and `:125`–`:127` (dependency exception becomes middleware rejection).

**Trigger:** a temporary database/KV failure or handshake rate limit makes Socket.IO middleware refuse a valid client's handshake. In this case Socket.IO sets `active=false` and requires an explicit `connect()` to retry. Staff/display only set their offline state. Staff's retry interval additionally requires `socketUp`, which is false. There is no explicit reconnect timer as there now is in the repaired customer page.

**Observed:** 120 seconds after a refused staff handshake, the board was still `socketUp:false,needsReload:true`, with zero reconnect attempts and zero HTTP reloads. The display has the same missing recovery branch by source inspection.

**Impact:** the valid staff board stays offline with actions disabled, or the display stops updating, until manual page reload. Transport outages that leave Socket.IO active do reconnect; this finding is specifically middleware refusal.

**Evidence:** `customer-staff-display-connection.test.tsx`, third test, actual staff hook with an inactive socket. The transient real server dependency outage itself was not injected by this sub-audit.

**Repair:** distinguish transient from terminal auth failures; manually retry inactive sockets with backoff and revalidate the session over HTTP. Requirements TR-RT-03/05 and FR-STF-14.

### CSD07 — P2 — Fresh/reloaded staff boards cannot restore the overdue call-out state

**Source:** `frontend/apps/web-staff/src/lib/ticketState.ts:117`; `frontend/apps/web-staff/src/lib/store.ts:49`; `frontend/apps/web-staff/src/board/boardData.ts:127`; `backend/packages/services/src/projections.ts:83`; `backend/packages/services/src/alerts.ts:187`.

**Trigger:** open/reload a board after an unacknowledged Ready ticket's final automatic alert plus 60 seconds. `cardFlags.callOut` requires the ephemeral `ticket.overdue` event's round in Zustand; a fresh store has none. The board projection includes ready time/counts but no persisted overdue flag, and fetchBoard does not reconstruct the map.

**Observed:** a ticket Ready for an hour with three automatic alerts is not call-out red without a prior event; supplying the current round makes the same ticket red. Source confirms there is no snapshot hydration. The worker reconciliation may enqueue the deterministic overdue job again, but completed BullMQ jobs are retained and deduplicate that same ID; the snapshot remains insufficient regardless.

**Impact:** staff opening another device or reloading lose the “Not collected — call out” warning for orders needing intervention.

**Evidence:** `customer-staff-display-search.test.tsx`, second test, actual `cardFlags`. Worker replay timing was not executed in this sub-audit.

**Repair:** project an authoritative overdue/deadline value in StaffTicket and calculate the state from snapshot data/server time, retaining the live event as acceleration. Requirement FR-STF-08.

### CSD08 — P2 — Ticket-list API failures are presented as genuine empty lists

**Source:** `frontend/apps/web-customer/src/pages/MyTicketsPage.tsx:20` and `:42`; `frontend/apps/web-customer/src/pages/VenuePage.tsx:40` and `:46`.

**Trigger:** GETs for saved tickets fail, or POST `/venues/:venueCode/my-tickets` returns a 500/network error. My Tickets discards every unsuccessful result and shows its empty message; VenuePage substitutes an empty array and tells the customer to ask staff. Neither exposes an error or retry. The venue metadata GET also maps every error to not-found at `VenuePage.tsx:38`.

**Impact:** customers who followed orders are told they have no tickets when the service is temporarily unavailable; My Tickets can also silently omit only the failing cards while showing others. This is separate from repaired A28, which fixed the individual ticket page only.

**Evidence:** two actual-component tests in `customer-staff-display-list-errors.test.tsx` assert a failed query state alongside the empty/ask-staff message and no alert/retry control.

**Repair:** model loading, empty, partial failure and unavailable independently; retain recoverable ticket entries and provide retries. Requirements FR-QR-05/08 and TR-FE-21.

### CSD09 — P2 — Ready collection instructions ignore the selected language

**Source:** `frontend/apps/web-customer/src/components/ReadyScreen.tsx:22`.

**Trigger:** venue locales are Arabic then English; the customer chooses English and both localized collection instructions exist. ReadyScreen always uses `venue.locales[0]`, whereas the waiting body/footer read the selected i18n language with a fallback.

**Observed:** English UI displays the Arabic collection instruction; the provided English instruction is absent.

**Impact:** the most important pickup instruction can become unreadable to the customer just when the ticket becomes Ready. Choosing a language survives updates after A25's repair, but this text does not honor that choice.

**Evidence:** `customer-staff-display-activation.test.tsx`, second test with actual ReadyScreen and English i18n.

**Repair:** resolve the message in the active selected locale first, then the venue default. Requirements FR-CUS-02/09 and TR-L10N-02.

### CSD10 — P1 — Approved support sessions cannot authenticate the staff realtime connection (runtime-confirmed)

**Source:** `backend/apps/api/src/http/middleware.ts:100` accepts `sup` for staff APIs; `backend/apps/api/src/routes/staff.ts:34`/`:46` accepts support actors; `backend/apps/realtime/src/server.ts:93`–`:113` accepts only `dev` or `sid` for staff sockets. The support cookie is created by `backend/apps/api/src/routes/auth-r11.ts:73`.

**Trigger:** a platform support agent enters an approved tenant support session and opens its staff board, as FR-STF-17 requires. With only their proper support cookie, the REST board succeeds but realtime falls through to `UNAUTHENTICATED`. A platform session on the console host is not a tenant owner `sid` cookie.

**Impact:** the board reports offline and disables all ticket actions; no live support board is available. CSD06 prevents even retrying, but a retry alone cannot fix this authentication mismatch.

**Evidence level:** independently confirmed by the backend audit using the actual request → approval → handoff → exchange lifecycle, real HTTP and a real Socket.IO server/client. The approved support actor gets board HTTP 200 but socket `UNAUTHENTICATED`; an owner control gets HTTP 200, connects and receives a real ticket update. See [results](support-realtime-results.json) and [probe](support-realtime-probe.mts). The unauthenticated control is rejected on both boundaries. Count this once as CSD10.

**Repair:** resolve the approved support actor in the staff handshake with the same host, tenant, expiry and permission checks as HTTP; revoke the socket when support access ends. Requirement FR-STF-17 and TR-AUTH-12.

## Coverage matrix

“Reviewed” means traced frontend calls and matching backend handler/service/contracts. It is not an assertion that every path passed a live end-to-end test. Backend suite and root browser-crawl results are reported separately by the parent audit.

| App / feature | Frontend + backend wiring reviewed | Executed evidence here | Result / remaining limits |
| --- | --- | --- | --- |
| Customer token route; not-found/error/retry; status views | GET `/public/v1/tickets/:token`, minimal router, projection | Existing TicketPage regressions | Repaired individual-page error state works; route boundary fuzzing not exhaustive |
| Customer follow, per-ticket identity/storage, existing push linking | POST follow, PUT push-subscription, storage | Existing A07/A18/A26 regressions | Existing repairs pass; new activation failure CSD01 remains |
| Customer new push permission, Home Screen/iOS/in-app flow | config, SW registration, subscription, alerts-enabled | New activation error test; audio/icon tests | CSD01; real Android/iOS push and permission prompts unverified |
| Customer live events, gap resync, reconnect/polling, Undo | ticket.updated/alert, resync.required, heartbeat | Existing A19/A21/A24 regressions | Existing repairs pass; real latency/100-change SLA not measured |
| Customer audio/vibration/wake lock + chime | audio loop and SDK chimes | Audio/chime unit tests, unmount regressions | Real devices and autoplay/wake-lock policy unverified |
| Customer acknowledge/check code | POST acknowledge; socket fallback; ReadyScreen | Source trace and existing main journey context | Live HTTP/socket failure combination not executed here |
| Customer wait estimate | server projection and local aging | Wait/TicketPage tests | Existing repair passes |
| Customer venue list and My Tickets | venue metadata, POST my-tickets, parallel ticket GETs | New error tests; storage/MyTickets tests | CSD08 |
| Customer code/staff-approved claims | POST venue claims, GET claim status; backend claim decision | Source trace, staff claim reducer tests | Full customer→staff approval HTTP/browser flow not executed here |
| Customer rating/review and privacy/legal | POST rating, GET customer_privacy | Existing rating and privacy tests | Existing repairs pass; real published legal acceptance outside scope |
| Customer brand/language/manifest/footer | selected language, branding, per-ticket manifest, link | Existing language/manifest tests; new Ready instruction test | CSD09; native home-screen installation unverified |
| Staff sign-in/shared device/member PIN + expiry/lock | POST sessions, members/unlock, member header | Existing SignIn/MemberPin/member-session/pin-lock tests | Existing repairs pass; session revocation backend tests owned by other audit |
| Staff board snapshot/live cache/reconnect | GET board, sequence tracker, update queue | BoardData tests; new handshake test | CSD06/CSD07; support mismatch CSD10 |
| Staff ticket create/QR/counters/ref conflict | POST tickets, local QR generation, followed event | Source trace; existing pure ticket-state tests | Form-level HTTP submission not newly executed here |
| Staff transitions/Undo/collect/check code/reopen/cancel | transitions; version conflicts; fresh ticket lookup | Source trace, ticket-state/shortcut tests; root owns browser journey | No missing endpoint found; new overdue hydration gap CSD07 |
| Staff note/ref/wait editing; manual alerts | PATCH ticket; POST alerts | Source trace | Live HTTP mutation fault matrix not executed here |
| Staff search/recent/counts | GET search, board recent/collectedToday | Actual SDK malformed URL probe; existing date/count tests | CSD02; recent/count repair tests pass |
| Staff claims | claims snapshot/request/decision events, POST decision | Claim reducer tests + source trace | Full approval browser flow remains root/runtime work |
| Staff kitchen, keyboard, mobile columns, sound | kitchen mode, device PATCH, shortcuts, POS new-ticket sound | Shortcut/state tests + source trace | Physical audio/mobile manual input not tested |
| Staff device name/mode/signout | PATCH device, DELETE sessions/current | Source trace | Device page has no dedicated component mutation test |
| Display pair/revoke/session/heartbeat | POST pair, GET board, heartbeat, device.revoked | Source trace; real board rendering with controlled API | Pair/unpair authenticated runtime fixture owned by parent |
| Display board ordering/highlight/counter filter/overflow | snapshot + events + grid/promo | Six actual Chromium layouts; hook tests | CSD03/CSD04/CSD05 |
| Display chime/speech/quiet hours/second language/voice map | Announcer, sound, settings, board entitlement | Existing Announcer/sound/hook tests | Existing A27/A14 fixes pass; real TV engine unavailable |
| Display promo/QR/logo/message | layout planner + real board | Existing promo tests, six board screenshots | Overflow CSD03 remains even without promo |
| Display daily reload/burn-in/update-required | time helpers, interval, app.version | Source trace | Overnight physical-device run not performed |

## Acceptance limits

This sub-audit does not provide a “100% complete” sign-off. It executed targeted existing suites, fault-injected component/hook probes, and Chromium geometry, while tracing the remaining workflows. External delivery (VAPID/Web Push, physical phones/TVs, speech voices), Firefox/WebKit, assistive technology, sustained load, and full live-provider acceptance remain unverified. It does not claim every reviewed mutation ran against a database or that every possible status/network sequence was tested.

New files in this report's namespace are audit-only. The display Vite server used port 5275 with API/realtime proxies to the isolated 4400/4401 stack; no existing live 4000/4001 or 5173/5174/5176 process was changed.

