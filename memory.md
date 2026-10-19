# memory.md — 项目记忆 / 速查

> 最后更新：2026-10-19
> 用途：记录版本、约定、踩过的坑，避免重复排查。**不要在这里写密钥。**
> 详细任务清单见 `task.md`。

## 1. 项目状态

- 名称：`bs-chat`（聊天服务器后端）
- 目录：`/home/momo/Projects/shcool/BS`
- 当前进度：P0–T10.3 完成（含测试、加固、镜像、Quadlet、备份、文档）
- 下一步：上线前人工验收（真实域名 + Caddy TLS）
- git：`main` 分支，已配置 `origin`（GitHub `momoi-gh/BS-chat`）；当前有未提交改动

## 2. 宿主机环境

| 项目 | 值 |
|---|---|
| OS | Arch Linux，kernel 7.2.7-zen1-1-zen |
| 容器 | podman 6.1.2（rootless）+ podman-compose 1.6.0 |
| Node | v24.20.0（fnm 管理） |
| npm | 11.19.0 |
| 数据库 | PostgreSQL 18.6（容器内） |
| 磁盘 | `/home` 剩余约 1.4T |
| 注意 | fnm 提供 node，非交互 shell 需正确的 PATH |

## 3. 版本矩阵

### 运行时依赖
| 包 | 版本 |
|---|---|
| fastify | 5.12.7 |
| pg | 8.23.1 |
| pino | 10.4.0 |
| zod | 4.6.7 |
| drizzle-orm | 0.45.4 |
| drizzle-kit | 0.31.11（dev） |
| argon2 | 0.45.1 |
| jsonwebtoken | 9.0.3 |
| socket.io | 4.8.4 |
| socket.io-client | 4.8.4（dev） |
| @fastify/cors | 11.3.1 |
| @fastify/rate-limit | 11.2.1 |
| @fastify/helmet | 13.2.0 |
| @vitest/coverage-v8 | 5.0.5（dev） |

### 开发依赖
| 包 | 版本 |
|---|---|
| typescript | 5.9.3（**不用 7.x**，生态兼容性未确认） |
| tsx | 4.23.15 |
| @types/node | 24.19.2（跟随 Node 24，不用 26.x） |
| @types/pg | 8.23.1 |
| eslint | 10.13.0 |
| @eslint/js | 10.0.1 |
| typescript-eslint | 8.71.2（要求 TS < 6.1） |
| globals | 17.13.0 |
| prettier | 3.9.10 |
| eslint-config-prettier | 10.1.8 |
| vitest | 5.0.5 |
| pino-pretty | 13.2.0（仅开发环境） |

### 基础设施
| 组件 | 版本/镜像 |
|---|---|
| PostgreSQL | 18.6，`docker.io/library/postgres:18-alpine` |
| 镜像大小 | 约 307 MB |
| Compose | `compose.yaml`（`podman compose up -d` 自动识别） |

## 4. 关键约定

### 4.1 模块与构建
- ESM：`package.json` 有 `"type": "module"`；TS `module/moduleResolution = NodeNext`
- **源码 import 必须带 `.js` 后缀**（如 `./app.js`），即使源文件是 `.ts`
- `npm run dev` = `tsx watch src/server.ts`（直接跑源码，不产出 dist）
- `npm run build` = `tsc -p tsconfig.build.json`（排除 `*.test.ts`）
- `npm start` = `node dist/server.js`（生产，不经过 tsx）
- **不要手改 `dist/`**，它被 git 忽略
- 测试文件放 `src/**/*.test.ts`；构建时排除，typecheck 会检查

### 4.2 环境变量
- 不装 dotenv：用 Node 内置 `process.loadEnvFile()`
- 加载逻辑在 `src/config/env.ts`：先 `existsSync(.env)`，存在才加载
- `process.loadEnvFile` **不覆盖已有环境变量**，所以 `PORT=4000 npm run dev` 优先于 `.env`
- `env` 是启动时的校验快照，改 `.env` 必须重启
- zod 必填：`DATABASE_URL`、`JWT_SECRET`、`JWT_REFRESH_SECRET`
- 默认值：`NODE_ENV=development`、`HOST=127.0.0.1`、`PORT=3000`、`CORS_ORIGIN=http://localhost:5173`、`LOG_LEVEL=info`
- `PORT` 限制 1024–65535（rootless 不能绑 <1024）
- 校验失败：打印中文错误列表并 `exit(1)`，不带堆栈

### 4.3 日志与错误
- pino 实例在 `src/lib/logger.ts`
- 开发环境（`NODE_ENV=development`）用 `pino-pretty`；生产输出 JSON
- 脱敏：`authorization`、`cookie` → `[REDACTED]`
- request id：服务端生成 UUID，**不信任客户端 header**，响应头 `x-request-id`
- 统一错误响应：`{ "error": { "code": "NOT_FOUND", "message": "...", "requestId": "..." } }`
- 5xx 对外只返回“服务器内部错误”，堆栈只进日志
- 启动失败：`logger.error` → `logger.flush()` → `exit(1)`

### 4.4 数据库访问
- 连接池：`src/db/pool.ts`（`max=10`、连接超时 5s、`application_name=bs-chat`）
- 操作封装：`src/db/dbfunc.ts`
- 简单等值查询用 `findById/findOne/findMany`；JOIN/聚合/IN/OR/IS NULL 用 `query` 写原生 SQL
- 所有值用 `$1/$2` 参数化；表名/字段名走白名单正则 + 双引号
- `update`/`remove`/`findOne`/`exists` **必须传 where**，空 where 抛错
- `findMany` 的 `limit/offset` 必须是非负整数
- **事务内必须用 `client.query`**；调用 `dbfunc.*` 会用池里另一条连接，不在事务中
- `where` 只支持等值 + AND；`null` 不能作为 where 值（用 `IS NULL` 原生 SQL）
- bigint（如 `seq`）pg 返回**字符串**；不要自己 Number 后拼 SQL
- 测试/脚本用完连接池要 `pool.end()`，否则进程不退出

### 4.5 安全
- `.env` 权限 600，已被 `.gitignore` 忽略；`.env.example` 可提交
- 密钥只放 `.env`，不写进代码/文档/日志
- 生产 JWT 密钥用 `openssl rand -hex 32` 生成

## 5. 目录结构（当前）

```text
BS/
├── compose.yaml
├── Makefile
├── .env / .env.example
├── package.json / tsconfig.json / tsconfig.build.json
├── eslint.config.js / .prettierrc.json / .prettierignore
├── vitest.config.js
├── src/
│   ├── app.ts            # Fastify 装配、CORS/限流、错误处理、健康检查
│   ├── server.ts         # 启动：校验 DB → 挂 Socket.IO → listen
│   ├── config/env.ts     # .env 加载 + zod 校验
│   ├── db/pool.ts        # pg 连接池
│   ├── db/client.ts      # Drizzle 实例
│   ├── db/schema.ts      # 6 张表
│   ├── db/migrations/    # drizzle-kit 生成
│   ├── db/seed.ts        # 种子数据
│   ├── db/dbfunc.ts      # 原生 SQL 工具
│   ├── lib/              # errors/tokens/password/validate/logger
│   ├── modules/auth|conversations|messages/  # routes + service
│   ├── realtime/         # Socket.IO 网关 + 广播总线
│   ├── plugins/auth.ts   # requireAuth（callback hook）
│   └── types/fastify.d.ts
├── task.md
└── memory.md
```

## 6. 常用命令

```bash
npm run dev            # 开发启动（tsx watch）
npm run build          # 编译到 dist
npm start              # 生产启动（先 build）
npm run typecheck
npm run lint / lint:fix
npm run format / format:check
npm test               # vitest run（当前无测试文件，exit 0）

npm run db:generate    # 生成迁移
npm run db:migrate     # 应用迁移
npm run db:seed        # 种子数据
npm run test:coverage  # 覆盖率（阈值 70%，当前 90%+）

make image             # 构建生产镜像
make backup            # 备份到 backups/
make restore FILE=...  # 恢复备份

podman compose up -d
podman compose ps
podman compose logs -f postgres
podman compose down    # 外部卷 bs_pgdata 不会被删除
podman exec -it bs-postgres psql -U bs -d bs_chat

make help              # 查看所有目标
make up / down / restart
make ps / logs
make psql
make test
make reset CONFIRM=yes # 危险：删除容器和数据卷后重建
```

## 7. 数据库与容器（当前事实）

| 项 | 值 |
|---|---|
| 容器名 | `bs-postgres` |
| 镜像 | `docker.io/library/postgres:18-alpine` |
| 端口 | `127.0.0.1:5432:5432` |
| 卷 | `bs_pgdata`（external，挂载到 `/var/lib/postgresql`） |
| 数据目录 | `/var/lib/postgresql/18/docker`（**PG18 改了布局**） |
| 用户/库 | `bs` / `bs_chat` |
| 密码 | 见 `.env` 的 `POSTGRES_PASSWORD` 与 `DATABASE_URL`（两处必须一致） |
| 连接串 | `postgres://bs:<password>@127.0.0.1:5432/bs_chat` |
| 健康检查 | `pg_isready -U bs -d bs_chat`，10s 间隔 |
| 业务表 | users / refresh_tokens / conversations / conversation_members / messages / direct_conversations |

## 8. compose 约定

- `x-podman.in_pod: false`（单库不需要 pod，避免多出 infra 容器）
- 外部卷必须写 `external: true` + `name: bs_pgdata`，否则会被重命名为 `bs_bs_pgdata`
- `container_name: bs-postgres` 保持与手启时一致
- 目前只有 postgres 服务；api 服务等到 T9.1 的 Containerfile
- `podman compose` 会调用外部 provider `/usr/bin/podman-compose`，并打印提示，属正常

## 9. 已知坑

| 问题 | 结论/处理 |
|---|---|
| Docker Hub 直连失败 | 本机 DNS 被污染（`registry-1.docker.io` → Facebook 段 / Traefik 自签证书）。已配置镜像源 `docker.1ms.run`，`podman pull` 走镜像 |
| `docker.1ms.run` 归属 | 中国安徽合肥木雷坞信息技术有限公司（毫秒镜像），第三方商业镜像，生产要锁 digest |
| npm 源 | `registry.npmjs.org` 正常；之前出现过两个 `npm install` 抢锁导致安装卡住，确保只跑一个 |
| fnm | 非交互 shell 里 node 路径来自 fnm；脚本/CI 需要正确初始化 |
| PG18 卷路径 | 必须挂 `/var/lib/postgresql`，不是 `/var/lib/postgresql/data` |
| rootless 重启恢复 | `restart: unless-stopped` 开机不生效，T9.2 用 Quadlet/systemd |
| Fastify 类型 | `buildApp()` 不要显式写 `: FastifyInstance`，会擦掉 pino 泛型；`setErrorHandler` 参数要显式 `FastifyError` |
| pino + 启动失败 | `process.exit` 前要 `logger.flush()`，否则异步 transport 可能丢日志 |
| `count(*)` | 用 `::text` + `Number()`，避免 bigint 字符串问题 |
| `where: { col: null }` | 生成 `= NULL` 永远不匹配，改用 `IS NULL` |

## 10. 运行时/验证清单

```bash
# 服务
npm run typecheck && npm run lint && npm run build
npm run dev
curl -s localhost:3000/healthz
curl -s localhost:3000/readyz

# 数据库
podman compose ps
podman exec bs-postgres psql -U bs -d bs_chat -c '\l'
podman exec bs-postgres psql -U bs -d bs_chat -tAc 'select version();'
```

## 11. 待办（截至 2026-10-19）

- [x] T2.2 Makefile（up/down/logs/ps/psql/reset/migrate/seed/test）
- [x] T2.3 持久化验证（down/up 后数据仍在，persistence_check 已删除）
- [x] T3.1 schema / T3.2 迁移 / T3.3 seed
- [x] T4.x 认证（注册/登录/刷新轮换/登出/me）
- [x] T5.x 会话与消息（私聊/群聊/成员/幂等/分页/已读/未读/软删）
- [x] T6.x WebSocket（鉴权/广播/typing/已读/在线/补拉/越权）
- [x] T7 测试与覆盖率（50 tests，行 90.87% / 函数 96.8%）
- [x] T8 加固（helmet、1MB、限流、慢请求、/metrics、优雅关闭）
- [x] T9 生产化（镜像 215MB、Quadlet、Caddy 配置、备份/恢复）
- [x] T10 文档（README + docs/api|ws|errors|schema|operations）
- [ ] 真实域名 + Caddy TLS 未实测（本机无域名/Caddy）
- [ ] git 提交（当前全部改动未提交）

## 15. 部署与测试现状

| 项 | 值 |
|---|---|
| 生产镜像 | `localhost/bs-chat-api:latest`，215 MB，非 root |
| Quadlet | `~/.config/containers/systemd/bs-chat-api.container`，服务名 `bs-chat-api`，端口 3100 |
| 生产 env | `.env.prod`（git 忽略，Quadlet 依赖） |
| 备份 | `backups/bs_chat-*.dump`（已加入 .gitignore） |
| 测试库 | `bs_chat_test`（setup 自动创建 + 迁移） |
| 测试结果 | 50 passed / 7 files |
| 覆盖率 | 语句 90.84% / 分支 74.9% / 函数 96.8% / 行 90.87% |
| 演练 | 全新库迁移 + seed + 编译产物 health/ready/login 通过 |
| 备份恢复 | 恢复到临时库后 users=3 / messages=3 |
| 前端交接 | `前端交接.md`（Web + Flutter 接入说明） |

## 16. T7–T10 新增约定

- 测试文件统一放 `tests/`；`tsconfig.json` include tests，`tsconfig.build.json` 只编译 `src`
- 测试 setup 用 `DATABASE_URL` 覆盖为 `bs_chat_test`，`NODE_ENV=test` 时**禁用限流插件**
- 覆盖率排除：`server.ts`、`config/env.ts`、`db/schema.ts`、`db/migrations`、`db/seed.ts`、`types`
- 生产镜像不包含 `tsx`/`pino-pretty`/测试依赖
- `.env.prod` 与 `.env` 分离；Quadlet 用 `.env.prod`，DATABASE_URL 指向 `bs-postgres:5432`
- Caddy 反代 3100，WebSocket 自动升级；rootless 不能直接绑 443
- 备份脚本从 `.env` 读取 `POSTGRES_USER/DB`，使用 `pg_dump -Fc`

- [ ] 当前未提交改动：`compose.yaml`、`src/db/`、`src/lib/`、`tsconfig.build.json`、`vitest.config.js`、`src/app.ts`、`src/server.ts`、`package*.json`、`.env.example`

## 12. 决策记录

| # | 决策 |
|---|---|
| D1 | Fastify + Socket.IO + Drizzle + JWT |
| D2 | 开发 podman-compose，生产 Quadlet |
| D3 | npm（不用 pnpm） |
| D4 | WS 主发送路径，REST 保留同能力 |
| D5 | 未读用 `last_read_seq` 计算 |
| D6 | PG18，失败回退 17 |
| D7 | TypeScript 5.9.3（不用 7.x） |
| D8 | 不引入 dotenv，用 Node 内置 loadEnvFile |

## 13. 已实现接口（T3–T6）

### REST

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/auth/register` | 否 | 注册，返回 access + refresh |
| POST | `/auth/login` | 否 | 登录 |
| POST | `/auth/refresh` | refresh | 轮换刷新令牌 |
| POST | `/auth/logout` | 否 | 吊销 refresh |
| GET | `/users/me` | access | 当前用户 |
| GET/POST | `/conversations` | access | 列表 / 创建（direct/group） |
| GET/POST | `/conversations/:id/members` | access | 成员列表 / 加人（仅群聊，owner/admin） |
| DELETE | `/conversations/:id/members/:userId` | access | 移除/退群（私聊禁止） |
| GET/POST | `/conversations/:id/messages` | access | 历史游标 / 发送 |
| POST | `/conversations/:id/read` | access | 已读上报 |
| DELETE | `/messages/:id` | access | 软删除 |

鉴权头：`Authorization: Bearer <accessToken>`；错误统一 `{ error: { code, message, requestId } }`。

### WebSocket（Socket.IO，path `/socket.io`）

- 握手：`auth.token` = accessToken；无/错 token → `connect_error: UNAUTHORIZED`
- 服务端 join `conversation:<id>`，随后发 `ready { conversationIds }`
- C→S：`message.send`（ack）、`message.read`（ack）、`typing.start/stop`、`sync.request`（ack）
- S→C：`message.created`、`message.read`、`typing`、`presence.update`、`error`
- WS 与 REST 共用同一 service；`message.created` 广播给房间内所有人

### 数据与种子

- 6 张表由 `src/db/migrations/0000_*.sql` 创建
- 种子用户：`alice@example.com` / `bob@example.com` / `carol@example.com`，密码见 `src/db/seed.ts`（开发用）
- 种子私聊 + `Seed Group`；seed 可重复执行，不重复建会话/消息

## 14. T3–T6 踩坑记录

| 问题 | 结论 |
|---|---|
| Fastify 同步 2 参数 hook | 会被当成 callback 风格，**必须调用 `done()`**，否则请求永久挂起；`requireAuth` 已改为 `(request, reply, done)` |
| Socket.IO 事件注册时机 | `connection` 回调里先同步注册事件，再 `await` 查询/join；客户端等 `ready` 再发事件，否则 ack 可能丢失 |
| Drizzle 错误码 | pg 错误被包在 `DrizzleQueryError.cause`，`isUniqueViolation` 需递归读 `cause.code` |
| Drizzle 错误日志 | `error.message` 含 SQL 参数（密码哈希、消息正文）；日志统一走 `toLoggableError()` 只取 cause 的 message |
| 每会话 seq | 用 `conversations.last_seq` 行锁自增，事务内插入消息；不要用全局 `max(seq)` |
| 发送幂等 | 唯一索引 `(sender_id, client_msg_id)`；冲突时回滚事务并返回已存在消息 |
| 私聊完整性 | 私聊禁止加人/退群（400 `INVALID_OPERATION`） |
| 未读数 | `messages.seq > last_read_seq AND sender_id <> 自己` 实时计算 |
| 刷新令牌 | 只存 SHA-256 hash；刷新时原子吊销旧 token，再发新 token；重复使用返回 401 |
| 限流 | 全局 300/min；`/auth/*` 10/min（按 IP + 路由） |
| 迁移文件 | `drizzle.config.ts` 加入 ESLint ignores；迁移 SQL/JSON 加入 Prettier ignore |
| 新环境迁移 | `drizzle.config.ts` 用 `process.loadEnvFile('.env')`；外部 `DATABASE_URL` 优先，可指向空库重放 |

