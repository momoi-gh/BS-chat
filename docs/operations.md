# 部署与运维

## 1. 数据库迁移

开发：

```bash
make up
npm run db:generate   # 修改 schema 后生成
npm run db:migrate
```

生产（从宿主机执行，连接容器映射的 127.0.0.1:5432）：

```bash
DATABASE_URL='postgres://bs:***@127.0.0.1:5432/bs_chat' npx drizzle-kit migrate
```

> 迁移前先 `make backup`。

## 2. 构建生产镜像

```bash
make image
podman images | grep bs-chat-api
```

镜像为多阶段构建：build 阶段编译 TS，runtime 阶段只装生产依赖、非 root 用户运行。

手动运行（加入 compose 网络，数据库用服务名访问）：

```bash
podman run -d --name bs-chat-api \
  --network bs_default \
  --env-file .env.prod \
  -e HOST=0.0.0.0 \
  -p 127.0.0.1:3100:3000 \
  localhost/bs-chat-api:latest
```

验证：

```bash
curl -s localhost:3100/healthz
curl -s localhost:3100/readyz
```

## 3. Quadlet（开机自启）

文件：`deploy/bs-chat-api.container`。

```bash
cp deploy/api.env.example .env.prod
# 编辑 .env.prod，替换 DATABASE_URL / JWT 密钥 / CORS

mkdir -p ~/.config/containers/systemd
cp deploy/bs-chat-api.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start bs-chat-api
systemctl --user status bs-chat-api
```

启用 lingering（未登录也启动）：

```bash
loginctl enable-linger "$USER"
```

> Quadlet 里的 `Network=bs_default` 需要 compose 已创建该网络；`DATABASE_URL` 用 `bs-postgres:5432`。
> 修改 `.env.prod` 后：`systemctl --user restart bs-chat-api`。

## 4. Caddy 反向代理 + TLS

`deploy/Caddyfile`：

```caddyfile
{$BS_DOMAIN:localhost} {
    encode gzip
    reverse_proxy 127.0.0.1:3100
}
```

Caddy 默认支持 WebSocket 升级，不需要额外配置。生产用真实域名即可自动申请证书。

## 5. 备份与恢复

```bash
make backup                       # 生成 backups/bs_chat-YYYYmmdd-HHMMSS.dump
make restore FILE=backups/xxx.dump
```

手动恢复到临时库验证：

```bash
podman exec bs-postgres createdb -U bs bs_chat_restore
podman exec -i bs-postgres pg_restore -U bs -d bs_chat_restore < backups/xxx.dump
podman exec bs-postgres psql -U bs -d bs_chat_restore -tAc 'select count(*) from users;'
podman exec bs-postgres dropdb -U bs bs_chat_restore
```

## 6. 优雅关闭

`SIGTERM` / `SIGINT` 会：

1. 停止接收新请求
2. 关闭 Socket.IO 连接
3. 关闭 PostgreSQL 连接池
4. 以 0 退出

手动验证：

```bash
node dist/server.js &
kill -TERM $!
```

日志应出现 `收到退出信号，开始优雅关闭` / `已优雅关闭`。

## 7. 安全清单

- [x] Argon2id 密码哈希
- [x] access 15m / refresh 30d，刷新轮换，只存 hash
- [x] 所有 SQL 参数化，标识符白名单
- [x] zod 入参校验，消息 4000 字符上限
- [x] 请求体 1MB 限制
- [x] helmet 安全响应头
- [x] CORS 白名单
- [x] 全局 300/min、认证 10/min、发消息 60/min、WS 30 条/10s
- [x] 容器非 root 运行
- [x] 错误日志脱敏（不打印 SQL 参数）

## 8. 监控

- `GET /healthz`：存活探针
- `GET /readyz`：就绪探针（DB ping）
- `GET /metrics`：uptime、内存、连接池
- 慢请求（>500ms）会打 `warn` 日志
- 每个请求带 `x-request-id`，日志用 `reqId` 关联
