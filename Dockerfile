# Athena backend (API, worker or keeper — one image, chosen by ATHENA_PROCESS). Build context: the repo root.
#   ATHENA_PROCESS=api     -> REST/SSE/x402 API (binds Railway's $PORT)
#   ATHENA_PROCESS=worker  -> indexer + cycle scheduler (holds the operator key)
#   ATHENA_PROCESS=keeper  -> overdue-reveal keeper
#   ATHENA_PROCESS=all     -> worker + API in one container (Render free tier has no background-worker type)
FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

# dependency layer (cached unless a manifest or the lockfile changes)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter "@athena/backend..."

# source (TypeScript runs directly through tsx; @athena/shared exports .ts)
COPY packages/shared packages/shared
COPY apps/backend/tsconfig.json apps/backend/
COPY apps/backend/src apps/backend/src
COPY apps/backend/scripts apps/backend/scripts
COPY apps/backend/docker-start.sh apps/backend/

ENV NODE_ENV=production
WORKDIR /app/apps/backend
CMD ["sh", "docker-start.sh"]
