#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP_PATH="${1:-$ROOT_DIR/tmp/kibisis-data.sql}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}}"

if [[ -z "$TARGET_DATABASE_URL" ]]; then
  echo "Set TARGET_DATABASE_URL or DATABASE_URL_UNPOOLED before bootstrapping Neon." >&2
  exit 1
fi

DATABASE_URL="$TARGET_DATABASE_URL" "$ROOT_DIR/infra/apply-migrations.sh"
"$ROOT_DIR/infra/load-data.sh" "$DUMP_PATH"
