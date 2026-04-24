# syntax=docker/dockerfile:1.7

# ── builder ──────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter backend build

# ── runtime ──────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
 && addgroup --system app && adduser --system --ingroup app app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY backend/package.json backend/
RUN pnpm install --filter backend --frozen-lockfile --prod

COPY --from=builder /app/backend/dist backend/dist
COPY backend/config.yaml backend/
COPY backend/prompts backend/prompts

# Pre-create writable dirs (SQLite db + JSONL traces) and hand the whole
# backend tree to the non-root `app` user. Without this, runtime mkdir of
# backend/traces fails with EACCES on container boot.
RUN mkdir -p backend/data backend/traces \
 && chown -R app:app /app/backend

USER app
WORKDIR /app/backend
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "dist/main.js"]
