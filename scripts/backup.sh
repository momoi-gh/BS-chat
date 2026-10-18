#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
. ./.env
set +a

CONTAINER="${CONTAINER:-bs-postgres}"
DB="${POSTGRES_DB:-bs_chat}"
USER="${POSTGRES_USER:-bs}"
DIR="${BACKUP_DIR:-./backups}"

mkdir -p "$DIR"
FILE="$DIR/${DB}-$(date +%Y%m%d-%H%M%S).dump"

podman exec "$CONTAINER" pg_dump -U "$USER" -d "$DB" -Fc > "$FILE"

echo "备份完成：$FILE"
