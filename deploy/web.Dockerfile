# Front door image: Caddy with the six built front-end apps baked in.
# Build context: repository root.  docker build -f deploy/web.Dockerfile -t tanbeeh/web .
FROM node:22-bookworm-slim AS build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/packages ./packages
COPY frontend/apps ./apps
COPY frontend/tsconfig.base.json frontend/vite.shared.ts ./
COPY frontend/tools ./tools
RUN npm ci --no-audit --no-fund && npm run build && node tools/check-budgets.mjs
# L-21: never ship source maps (builds emit none by default; this also covers DOP_SOURCEMAP=hidden builds whose
# maps were meant for an error tracker). The Caddyfile 404s *.map as a second line of defence.
RUN find apps/*/dist -name '*.map' -type f -delete \
 && if find apps/*/dist -name '*.map' | grep -q .; then echo 'source maps left in dist' >&2; exit 1; fi

FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/frontend/apps/web-customer/dist /srv/web-customer
COPY --from=build /src/frontend/apps/web-staff/dist /srv/web-staff
COPY --from=build /src/frontend/apps/web-display/dist /srv/web-display
COPY --from=build /src/frontend/apps/web-admin/dist /srv/web-admin
COPY --from=build /src/frontend/apps/web-console/dist /srv/web-console
COPY --from=build /src/frontend/apps/web-site/dist /srv/web-site
