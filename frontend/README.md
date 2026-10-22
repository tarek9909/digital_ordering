# Front end

npm workspace with six React 19 and Vite 6 apps and four shared packages (Implementation Plan §18).

| App | Host (production) | Local dev |
| --- | --- | --- |
| `web-customer` | `t.{domain}` | http://t.dop.localhost:5173 |
| `web-staff` | `{slug}.{domain}/staff` | http://{slug}.dop.localhost:5174/staff |
| `web-display` | `{slug}.{domain}/display` | http://{slug}.dop.localhost:5175/display |
| `web-admin` | `{slug}.{domain}/admin` | http://{slug}.dop.localhost:5176/admin |
| `web-console` | `admin.{domain}` | http://admin.dop.localhost:5177 |
| `web-site` | `www.{domain}` | http://www.dop.localhost:5178 |

Every app calls the API same-origin under `/api` and `/rt`. In development, Vite proxies these to `:4000` (API) and `:4001` (real-time) and keeps the Host header, so the API resolves the tenant just as it does in production (`vite.shared.ts`).

| Package | Contents |
| --- | --- |
| `contracts` | Copy of `backend/packages/contracts`. Do not edit: run `npm run sync:contracts` in `backend/`. |
| `client-sdk` | Fetch wrapper (CSRF, request IDs, problem+json), socket client, sequence tracking, brand contrast, locale helpers |
| `ui` | Tailwind 4 tokens and accessible base components |
| `i18n` | i18next setup; Arabic and English messages per app in `locales/{ar,en}/{app}.json` |

## Commands

`npm run typecheck`, `npm test`, `npm run build`, and `node tools/check-budgets.mjs`. The last one checks the initial-route JavaScript budgets in TR-FE-05: customer ≤ 120 KB, staff ≤ 200 KB, display ≤ 150 KB, admin and console ≤ 350 KB, all gzipped.
