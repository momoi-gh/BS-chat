#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${1:-latest}"
OWNER="${GHCR_OWNER:-momoi-gh}"
REPO="${GHCR_REPO:-bs-chat}"
API_IMAGE="${API_IMAGE:-ghcr.io/${OWNER}/${REPO}/api:${TAG}}"
PG_IMAGE="${PG_IMAGE:-ghcr.io/${OWNER}/${REPO}/postgres:18-alpine}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100/readyz}"

if [[ ! -f .env.prod ]]; then
  echo "缺少 .env.prod，请先参考 deploy/api.env.example 创建" >&2
  exit 1
fi

set -a
. ./.env.prod
set +a

echo "[1/6] 拉取镜像"
if [[ "${SKIP_PULL:-0}" == "1" ]]; then
  echo "已设置 SKIP_PULL=1，跳过拉取"
else
  podman pull "$API_IMAGE"
  podman pull "$PG_IMAGE"
fi

echo "[2/6] 准备数据卷"
podman volume exists bs_pgdata || podman volume create bs_pgdata

echo "[3/6] 启动/更新 PostgreSQL"
POSTGRES_IMAGE="$PG_IMAGE" podman compose \
  -f deploy/compose.prod.yaml \
  -p bs \
  --env-file .env.prod \
  up -d postgres

echo "[4/6] 等待数据库就绪"
for _ in $(seq 1 30); do
  if podman exec bs-postgres pg_isready \
    -U "${POSTGRES_USER:-bs}" \
    -d "${POSTGRES_DB:-bs_chat}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[5/6] 执行数据库迁移"
podman run --rm \
  --network bs_default \
  --env-file .env.prod \
  -e MIGRATIONS_DIR=/app/migrations \
  "$API_IMAGE" node dist/db/migrate.js

echo "[6/6] 更新 API 并重启"
if podman image exists localhost/bs-chat-api:latest; then
  podman tag localhost/bs-chat-api:latest localhost/bs-chat-api:previous
fi

podman tag "$API_IMAGE" localhost/bs-chat-api:latest
systemctl --user restart bs-chat-api

for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "部署成功：$API_IMAGE"
    exit 0
  fi
  sleep 1
done

echo "健康检查失败，准备回滚" >&2
podman logs --tail 80 bs-chat-api >&2 || true

if podman image exists localhost/bs-chat-api:previous; then
  podman tag localhost/bs-chat-api:previous localhost/bs-chat-api:latest
  systemctl --user restart bs-chat-api
  echo "已回滚到上一个镜像（数据库迁移不会自动回滚）" >&2
fi

exit 1
