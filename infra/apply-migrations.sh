#!/usr/bin/env bash
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATABASE_URL="${DATABASE_URL:-postgresql://perseus:perseus@localhost:5432/perseus}"

for migration in "$INFRA_DIR"/migrations/*.sql; do
  echo "Applying ${migration}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
