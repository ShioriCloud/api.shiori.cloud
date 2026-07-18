#!/usr/bin/env bash
# Run ON the production server (SSH). Host "postgres" only works inside Docker.
#
# Usage:
#   DATABASE_PASSWORD='...' ./scripts/dump-prod-db.sh
#   POSTGRES_CONTAINER=other-name DATABASE_PASSWORD='...' ./scripts/dump-prod-db.sh ./shiori-prod.dump
set -euo pipefail

OUT="${1:-./shiori-prod.dump}"
CONTAINER="${POSTGRES_CONTAINER:-shiori-postgres}"
PGUSER="${DATABASE_USER:-dawn}"
PGDATABASE="${DATABASE_NAME:-shiori-cloud}"

if [[ -z "${DATABASE_PASSWORD:-}" ]]; then
  echo "Set DATABASE_PASSWORD first."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container '$CONTAINER' not found. Available:"
  docker ps --format '{{.Names}}\t{{.Image}}' | grep -i postgres || true
  echo "Re-run with: POSTGRES_CONTAINER=<name> DATABASE_PASSWORD=... $0 $OUT"
  exit 1
fi

echo "Dumping $PGDATABASE from $CONTAINER ..."
docker exec -e PGPASSWORD="$DATABASE_PASSWORD" "$CONTAINER" \
  pg_dump -U "$PGUSER" -d "$PGDATABASE" -Fc -f /tmp/shiori-prod.dump

docker cp "$CONTAINER:/tmp/shiori-prod.dump" "$OUT"
docker exec "$CONTAINER" rm -f /tmp/shiori-prod.dump

ls -lh "$OUT"
echo "Copy to local, then say restore."
