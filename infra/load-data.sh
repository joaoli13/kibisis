#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP_PATH="${1:-$ROOT_DIR/tmp/kibisis-data.sql}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}}"

if [[ -z "$TARGET_DATABASE_URL" ]]; then
  echo "Set TARGET_DATABASE_URL or DATABASE_URL_UNPOOLED before loading data." >&2
  exit 1
fi

if [[ ! -f "$DUMP_PATH" ]]; then
  echo "Dump file not found: $DUMP_PATH" >&2
  exit 1
fi

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  ALTER TABLE semantic_nodes
  DROP CONSTRAINT IF EXISTS semantic_nodes_parent_id_fkey;
"

if [[ "${RESET_DATA:-false}" == "true" ]]; then
  psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    TRUNCATE
      licenses_audit,
      dataset_metadata,
      semantic_nodes,
      passages,
      clusters,
      editions,
      works,
      authors
    RESTART IDENTITY CASCADE;
  "
fi

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DUMP_PATH"

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  ALTER TABLE semantic_nodes
  ADD CONSTRAINT semantic_nodes_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES semantic_nodes(id) ON DELETE CASCADE;
"

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  SELECT 'authors' AS table_name, count(*) FROM authors
  UNION ALL SELECT 'works', count(*) FROM works
  UNION ALL SELECT 'passages', count(*) FROM passages
  UNION ALL SELECT 'embedded_nodes', count(*) FROM semantic_nodes WHERE embedding IS NOT NULL
  ORDER BY table_name;
"
