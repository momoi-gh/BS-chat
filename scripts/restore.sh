#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
. ./.env
set +a

FILE="${1:-}"
CONTAINER="${CONTAINER:-bs-postgres}"
DB="${POSTGRES_DB:-bs_chat}"
USER="${POSTGRES_USER:-bs}"

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "用法：scripts/restore.sh <backup.dump>" >&2
  exit 1
fi

podman exec -i "$CONTAINER" pg_restore -U "$USER" -d "$DB" --clean --if-exists < "$FILE"

echo "恢复完成：$FILE"
