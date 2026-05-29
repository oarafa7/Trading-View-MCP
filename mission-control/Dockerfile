# AI Mission Control — single-origin container (web UI + API on one port).
# Build context is the mission-control/ directory.
FROM node:22-slim AS app
WORKDIR /app

# pnpm via corepack
RUN corepack enable

# Build tools so better-sqlite3 can compile if no prebuilt binary is available for the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (leverage layer caching on the lockfile + manifests).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY turbo.json tsconfig.base.json ./
RUN pnpm install --frozen-lockfile

# Build workspace packages, then export the web UI as same-origin static files.
RUN pnpm -r build
RUN NEXT_PUBLIC_GATEWAY_URL="" pnpm --filter @mc/web build

ENV NODE_ENV=production
ENV WEB_DIR=/app/apps/web/out
# SQLite location. Mount a persistent volume here for durable data; ephemeral otherwise.
ENV DB_PATH=/app/data/mc.db
RUN mkdir -p /app/data

# The platform (Render/Railway/Fly/Cloud Run) injects PORT; the gateway reads it (default 4000).
EXPOSE 4000
CMD ["pnpm", "--filter", "@mc/gateway", "start"]
