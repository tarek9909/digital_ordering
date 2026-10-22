# One image for every back-end service (TRD §3.2): SERVICE_ROLE selects api, realtime or worker.
# Build: docker build -t dop-backend backend/
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
COPY tsconfig.json ./
RUN npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev

# Distroless runtime: no shell, runs as non-root (TR-SEC-11 scans this image with Trivy).
# Debian 13: the debian12 variant still shipped OpenSSL 3.0.18 with fixed CRITICAL/HIGH CVEs, which fail that scan.
FROM gcr.io/distroless/nodejs22-debian13:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/entry.mjs ./entry.mjs
EXPOSE 4000
CMD ["entry.mjs"]
