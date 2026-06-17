#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load .env (ignore comments)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Z_]+=' .env | sed 's/\r$//')
  set +a
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-olscbzxwcddwumxispst}"
SUPABASE_HOST="${SUPABASE_DB_HOST:-aws-1-eu-west-1.pooler.supabase.com}"
SUPABASE_USER="${SUPABASE_DB_USER:-postgres.${PROJECT_REF}}"
SUPABASE_PORT="${SUPABASE_DB_PORT:-5432}"
SUPABASE_DB="${SUPABASE_DB_NAME:-postgres}"

LOCAL_URL="${LOCAL_DATABASE_URL:-postgresql://shiori:shiori@localhost:5433/shiori}"
DUMP_FILE="${ROOT}/.tmp/shiori_backup.dump"

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "ERROR: SUPABASE_DB_PASSWORD is not set."
  echo ""
  echo "Add your Supabase database password to .env:"
  echo "  SUPABASE_DB_PASSWORD=your-database-password"
  echo ""
  echo "Find it in: Supabase Dashboard → Project Settings → Database → Database password"
  echo "(This is NOT the anon key — it's the postgres password you set when creating the project.)"
  exit 1
fi

mkdir -p "${ROOT}/.tmp"

echo "==> Dumping from Supabase (${PROJECT_REF})..."
MSYS_NO_PATHCONV=1 docker run --rm \
  -e PGPASSWORD="${SUPABASE_DB_PASSWORD}" \
  -v "${ROOT}/.tmp:/backup" \
  postgres:17-alpine \
  pg_dump \
  -h "${SUPABASE_HOST}" \
  -U "${SUPABASE_USER}" \
  -d "${SUPABASE_DB}" \
  -p "${SUPABASE_PORT}" \
  --no-owner --no-acl -F c \
  -f /backup/shiori_backup.dump

echo "==> Restoring to local Postgres (${LOCAL_URL})..."
MSYS_NO_PATHCONV=1 docker run --rm \
  -e PGPASSWORD=shiori \
  -v "${ROOT}/.tmp:/backup" \
  postgres:17-alpine \
  pg_restore \
  -h host.docker.internal \
  -p 5433 \
  -U shiori \
  -d shiori \
  --no-owner --no-acl --clean --if-exists \
  /backup/shiori_backup.dump || true

echo ""
echo "==> Done. Verify with:"
echo "  curl http://localhost:4001/api/v1/anime-catalog/featured"
echo ""
echo "Dump saved at: ${DUMP_FILE}"
