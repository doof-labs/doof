#!/usr/bin/env bash
# Start the local doof stack for real-session testing: Postgres in Docker + the server on :3005.
set -euo pipefail
cd "$(dirname "$0")/.."
docker start doof-pg >/dev/null 2>&1 || docker run -d --name doof-pg -p 5439:5432 -e POSTGRES_PASSWORD=doof -e POSTGRES_DB=doof postgres:16-alpine >/dev/null
for i in $(seq 1 30); do docker exec doof-pg pg_isready -U postgres -d doof >/dev/null 2>&1 && break; sleep 1; done
export DATABASE_URL=postgres://postgres:doof@localhost:5439/doof
# Set DOOF_SIGNING_KEY before running this script if you need records to remain
# verifiable across restarts. An unset key is deliberately disposable.
npx tsx src/db/migrate.ts
echo "Starting doof at http://localhost:3005. Press Ctrl-C to stop it."
exec env STORE=postgres DOOF_SIGNING_KEY="${DOOF_SIGNING_KEY:-}" PORT=3005 PUBLIC_URL=http://localhost:3005 ALLOWED_HOSTS=localhost,127.0.0.1 MAX_CONFESSIONS_PER_DAY=100000 \
  npx tsx src/index.ts
