# Tanbeeh — Digital Order Pager

Restaurants give customers a digital ticket instead of a buzzer. The customer scans a QR code, and their phone alerts them when the order is ready. Alerts come through Web Push, a live page alarm and a TV display announcement.

| Document | What it is |
| --- | --- |
| [Digital-Order-Pager-Concept.md](Digital-Order-Pager-Concept.md) | Product concept |
| [Business-Requirements-Document.md](Business-Requirements-Document.md) | What to build (BRD) |
| [Technical-Requirements-Document.md](Technical-Requirements-Document.md) | How to build it (TRD) |
| [Implementation-Plan.md](Implementation-Plan.md) | Phases, gates and the code layout (§18) |
| [docs/adr](docs/adr) | Decisions made during the build |
| [docs/runbooks](docs/runbooks) | Operations runbooks |
| [docs/privacy/data-inventory.md](docs/privacy/data-inventory.md) | Personal data inventory |
| [docs/openapi/v1.json](docs/openapi/v1.json) | Integration API (OpenAPI 3.1) |

## Code

- [backend/](backend/README.md) — the API, real-time and worker services, and shared packages (Node.js 22, Express 5, MySQL 8.4, Redis, BullMQ, Socket.IO).
- [deploy/](deploy/README.md) — production on your own VPS with Docker Compose: Caddy, MySQL, Redis, MinIO and off-site backups ([ADR 0007](docs/adr/0007-self-hosted-vps.md)).
- [frontend/](frontend/README.md) — six React 19 and Vite 6 apps (customer, staff, display, tenant admin, super admin console, sign-up site) and shared packages.

## Quick start (local)

```bash
# 1. Infrastructure: MySQL 8.4, Redis 7, Mailpit, MinIO
cd backend && docker compose up -d
#    No Docker? `node tools/dev-mysql.mjs 3307` starts a throwaway MySQL 8.4. Jobs then need Redis 7 for the worker.

# 2. Back end
cp .env.example .env          # adjust DATABASE_URL if needed
npm install
npm run db:migrate && npm run db:seed    # prints the seeded accounts, staff links and PIN
npm run dev:api                          # :4000
PORT=4001 npm run dev:realtime           # :4001
npm run dev:worker                       # needs Redis ≥ 5

# 3. Front end (one terminal per app)
cd ../frontend && npm install
npm run dev:customer   # http://t.dop.localhost:5173
npm run dev:staff      # http://burger-house.dop.localhost:5174/staff/<key from seed>
npm run dev:display    # http://burger-house.dop.localhost:5175/display
npm run dev:admin      # http://burger-house.dop.localhost:5176/admin
npm run dev:console    # http://admin.dop.localhost:5177
npm run dev:site       # http://www.dop.localhost:5178
```

`*.localhost` resolves to your machine in modern browsers. Sessions are per host, as in production.
