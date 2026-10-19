# BS Chat API

基于 **Node.js 24 + Fastify 5 + PostgreSQL 18 + Socket.IO** 的聊天服务器后端。

- REST：账号、会话、成员、消息、已读
- WebSocket：实时消息、typing、已读同步、在线状态、断线补拉
- 数据库：Drizzle ORM + PostgreSQL 18（compose 管理）
- 工程：TypeScript、pino、zod、Vitest、ESLint 10、Prettier

## 快速开始

### 1. 环境要求

- Linux，Node.js 24（推荐用 fnm 管理）
- podman 6+ 与 podman-compose
- PostgreSQL 由容器提供，无需本机安装

```bash
sudo pacman -S --needed podman podman-compose buildah skopeo \
  fuse-overlayfs slirp4netns netavark aardvark-dns
```

> Docker Hub 不可直连时，先配置 `docker.1ms.run` 镜像源（见 `memory.md`）。

### 2. 配置

```bash
cp .env.example .env
# 修改 DATABASE_URL / POSTGRES_PASSWORD / JWT_SECRET / JWT_REFRESH_SECRET
```

JWT 密钥生成：

```bash
openssl rand -hex 32
```

### 3. 启动数据库与迁移

```bash
make up            # podman compose up -d
npm ci
npm run db:migrate
npm run db:seed    # 可选：alice / bob / carol + 示例会话
```

### 4. 开发启动

```bash
npm run dev
curl -s localhost:3000/healthz
curl -s localhost:3000/readyz
```

### 5. 测试

```bash
npm test                 # 集成测试
npm run test:coverage    # 覆盖率（阈值 70%）
```

测试会自动创建 `bs_chat_test` 数据库并执行迁移，不会污染开发库。

## 常用命令

| 命令                     | 说明                                 |
| ------------------------ | ------------------------------------ |
| `make up` / `down`       | 启动 / 停止 PostgreSQL（保留数据卷） |
| `make ps` / `logs`       | 查看容器状态 / 日志                  |
| `make psql`              | 进入 psql                            |
| `make migrate` / `seed`  | 迁移 / 种子数据                      |
| `make test`              | 运行测试                             |
| `make image`             | 构建生产镜像                         |
| `make backup`            | 备份数据库到 `backups/`              |
| `make restore FILE=...`  | 恢复备份                             |
| `make reset CONFIRM=yes` | **危险**：删除容器和数据卷后重建     |

## 环境变量

| 变量                                                  | 必填    | 默认                  | 说明                                     |
| ----------------------------------------------------- | ------- | --------------------- | ---------------------------------------- |
| `NODE_ENV`                                            | 否      | development           | development / test / production          |
| `HOST`                                                | 否      | 127.0.0.1             | 监听地址                                 |
| `PORT`                                                | 否      | 3000                  | 监听端口（≥1024）                        |
| `DATABASE_URL`                                        | 是      | —                     | `postgres://user:pass@host:5432/db`      |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | —                     | 容器初始化参数，与 DATABASE_URL 保持一致 |
| `JWT_SECRET`                                          | 是      | —                     | access token 密钥，≥32 字符              |
| `JWT_REFRESH_SECRET`                                  | 是      | —                     | refresh token 密钥，≥32 字符             |
| `CORS_ORIGIN`                                         | 否      | http://localhost:5173 | 多个用逗号分隔                           |
| `LOG_LEVEL`                                           | 否      | info                  | pino 日志级别                            |

## 接口

- REST 详情：[docs/api.md](docs/api.md)
- WebSocket 协议：[docs/ws.md](docs/ws.md)
- 错误码：[docs/errors.md](docs/errors.md)
- 数据模型：[docs/schema.md](docs/schema.md)
- 部署与运维：[docs/operations.md](docs/operations.md)

快速验证：

```bash
curl -s -X POST localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"password123"}'
```

WebSocket：

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', { auth: { token: accessToken } });
socket.on('ready', ({ conversationIds }) => console.log(conversationIds));
socket.emit('message.send', { conversationId, body: 'hello', clientMsgId: 'c-1' }, console.log);
```

## 生产部署

```bash
make image
podman run -d --name bs-chat-api \
  --network bs_default \
  --env-file .env.prod \
  -e HOST=0.0.0.0 \
  -p 127.0.0.1:3100:3000 \
  localhost/bs-chat-api:latest
```

- Quadlet 单元：`deploy/bs-chat-api.container`
- Caddy 反向代理 + TLS：`deploy/Caddyfile`
- 生产环境变量模板：`deploy/api.env.example`
- 详细步骤见 [docs/operations.md](docs/operations.md)

## 目录结构

```text
src/
├── app.ts / server.ts
├── config/env.ts
├── db/            pool / client / schema / migrations / seed / dbfunc
├── lib/           errors / tokens / password / validate / logger
├── modules/       auth / conversations / messages
├── realtime/      Socket.IO 网关
├── plugins/       requireAuth
└── types/         Fastify 类型扩展
tests/             Vitest 集成测试
deploy/            Quadlet / Caddy / 生产 env 模板
scripts/           backup / restore
```

## 故障排查

| 现象                                    | 处理                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| `podman pull` 超时/证书错误             | Docker Hub 被 DNS 污染，配置 `docker.1ms.run` 镜像源                 |
| `podman compose` 提示 external provider | 正常提示，可忽略                                                     |
| 迁移后数据目录为空                      | PG18 必须挂载 `/var/lib/postgresql`，不是 `/var/lib/postgresql/data` |
| 绑定 80/443 失败                        | rootless 只能绑定 ≥1024，用 Caddy 反代                               |
| 重启后容器不自启                        | rootless 需 Quadlet 或 `podman-restart.service`                      |
| `node: command not found`               | fnm 未在 shell 初始化                                                |

## 更多文档

- [前端交接.md](前端交接.md)：Web / Flutter 前端接入、认证、Socket.IO、缺口说明
- [docs/api.md](docs/api.md)：REST 接口
- [docs/ws.md](docs/ws.md)：WebSocket 协议
- [docs/errors.md](docs/errors.md)：错误码
- [docs/schema.md](docs/schema.md)：数据模型
- [docs/operations.md](docs/operations.md)：部署与运维
- [memory.md](memory.md)：版本、约定、踩坑记录
