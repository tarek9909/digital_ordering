# 0004 — Customer app: small router and native dialog

**Context.** TR-FE-05 limits the customer app's initial-route JavaScript to 120 KB gzipped. The first build, with React Router 7, the Radix dialog and socket.io in the entry chunk, was 182 KB.

**Decision.** For the customer app only:
- A 60-line history router replaces React Router. The app has four routes.
- A native `<dialog>` sheet replaces the Radix dialog.
- socket.io is loaded after first render from `@dop/client-sdk/socket`.
- `SeqTracker` moves out of the socket module.
- The secondary pages are lazy.

The other apps keep React Router and Radix.

**Consequences.** The initial chunk is 110.8 KB gzipped. `frontend/tools/check-budgets.mjs` enforces the budget in CI.
