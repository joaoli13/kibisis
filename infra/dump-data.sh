#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-postgresql://perseus:perseus@localhost:5432/perseus}"
OUTPUT_PATH="${1:-$ROOT_DIR/tmp/kibisis-data.sql}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

TABLES=(
  authors
  works
  editions
  clusters
  passages
  semantic_nodes
  licenses_audit
  dataset_metadata
)

table_args=()
for table in "${TABLES[@]}"; do
  table_args+=(--table "public.$table")
done

pg_dump "$SOURCE_DATABASE_URL" \
  --format=plain \
  --data-only \
  --no-owner \
  --no-privileges \
  "${table_args[@]}" |
  sed '/^SET transaction_timeout = 0;$/d' > "$OUTPUT_PATH"

echo "Wrote data dump to $OUTPUT_PATH"
