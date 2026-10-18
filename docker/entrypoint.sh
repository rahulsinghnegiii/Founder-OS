#!/bin/sh
# Container entrypoint: wait for Postgres, apply the schema, make sure the
# system structure (departments, agents) exists, then start the server.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

echo "[founderos] waiting for database..."
attempt=0
until (cd /app/lib/db && node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
"); do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "[founderos] database not reachable after 2 minutes" >&2
    exit 1
  fi
  sleep 2
done

echo "[founderos] applying schema..."
pnpm --filter @workspace/db run push-force

seed_args="--keep-data"
if [ "${SEED_DEMO:-0}" = "1" ]; then
  seed_args="$seed_args --demo"
fi
echo "[founderos] ensuring system structure ($seed_args)..."
pnpm --filter @workspace/scripts run seed -- $seed_args

echo "[founderos] starting on port ${PORT:-5000}"
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
