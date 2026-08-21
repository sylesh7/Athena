# backend/Dockerfile
#
# Build context MUST be the repo root, not backend/ — lib/config.ts resolves
# REPO_ROOT two levels above backend/lib (join(__dirname, "../..")) and reads
# shared/addresses.json + shared/abis/*.json from there, so shared/ has to
# land as a sibling of backend/ inside the image.
#
#   docker build -f backend/Dockerfile -t athena-backend .
#
# Runs all 5 backend processes (3 provider agents, the entrypoint, and the
# Python MCP quality monitor) in one container via start.sh — see that file
# for why they can't be split across separate services without code changes.

FROM node:22-slim

# Python for mcp-monitor/monitor.py (FastMCP, streamable-http transport).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps — copy manifest first so this layer caches across source changes.
# Full `npm ci` (not --omit=dev): tsx/typescript are devDependencies but this
# image runs the TypeScript sources directly via tsx, no build step.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci

# Python deps
COPY backend/mcp-monitor/requirements.txt ./backend/mcp-monitor/requirements.txt
RUN pip install --break-system-packages --no-cache-dir -r backend/mcp-monitor/requirements.txt

# App code + the shared/ dir it reads contract addresses and ABIs from.
COPY backend ./backend
COPY shared ./shared

RUN chmod +x ./backend/start.sh

ENV NODE_ENV=production
# Informational only — the actual bind port is $PORT at runtime (see
# stream/entrypoint.ts), which hosts like Railway/Render inject themselves.
EXPOSE 3100

WORKDIR /app/backend
CMD ["./start.sh"]
