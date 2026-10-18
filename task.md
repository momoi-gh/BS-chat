# BS 聊天服务器后端 — 实施任务清单

> 项目目录：`/home/momo/Projects/shcool/BS`
> 更新时间：2026-10-18
> 当前状态：P0–T6.4 已完成；下一步 T7 测试
> 执行方式：Plan 模式只读 → 切 Act 模式后按检查点 A / B 推进

---

## 1. 目标与范围

### 1.1 目标
用 podman + PostgreSQL + Node.js 实现一个可独立部署的聊天服务后端：
- REST 负责账号、会话、历史消息
- WebSocket 负责实时收发、输入状态、已读同步、在线状态
- 单机即可跑通，架构上预留多实例扩展点

### 1.2 MVP 范围（必须完成）
- [x] 用户注册 / 登录 / 刷新令牌 / 登出 / 当前用户
- [x] 1v1 私聊（同一对用户不重复建会话）
- [x] 群聊创建、加人、移除、退群
- [x] 消息发送（`client_msg_id` 幂等）、软删除
- [x] 历史消息游标分页（不重不漏）
- [x] 已读回执 + 未读数
- [x] WS 握手鉴权、房间广播、typing、在线状态、断线重连补拉
- [x] 健康检查、结构化日志、统一错误码、限流、优雅关闭

### 1.3 非目标（本版不做）
- 音视频通话、端到端加密
- 附件/图片上传（仅预留字段，接对象存储是后续里程碑）
- 短信/邮件验证、推送通知
- 消息编辑、reaction、@提及、全文搜索
- 管理后台、计费

---

## 2. 技术栈（已确认）

| 层 | 选型 |
|---|---|
| 语言/运行时 | TypeScript + Node.js 24.20.0 |
| HTTP 框架 | Fastify 5 |
| 实时层 | Socket.IO 4 |
| ORM / 迁移 | Drizzle ORM + drizzle-kit |
| 数据库 | PostgreSQL 18（`postgres:18-alpine`，拉不到回退 17） |
| 参数校验 | zod |
| 密码哈希 | Argon2id（`argon2`） |
| 鉴权 | JWT access 15m + refresh 30d 轮换（DB 只存 hash） |
| 日志 | pino + request-id |
| 测试 | Vitest + `fastify.inject` + `socket.io-client` |
| 开发编排 | podman-compose |
| 生产编排 | Containerfile + Quadlet/systemd |
| 包管理 | npm（零额外安装） |
| 反向代理/TLS | Caddy（阶段 9） |

---

## 3. 环境现状（2026-10-18 实测）

| 项目 | 状态 |
|---|---|
| OS | Arch Linux，kernel 7.2.7-zen1-1-zen，cgroup v2 |
| Node / npm | v24.20.0（fnm）/ 11.19.0 ✅ |
| git / curl / jq / make / gcc | 已安装 ✅ |
| podman | ❌ 未安装（仓库 `extra/podman 6.1.2-1`） |
| podman-compose | ❌ 未安装（仓库 `extra/podman-compose 1.6.0-1`） |
| psql 客户端 | ❌ 未安装（可用容器内 psql 替代） |
| rootless 前置 | ✅ subuid/subgid `momo:100000:65536` |
| 网络 | `passt` 已装；Docker Hub 直连超时（需验证/配代理） |
| 磁盘 | `/home` 剩余 1.4T ✅ |
| 项目目录 | 空目录，未初始化 git |

---

## 4. P0 前置条件（负责人：你，需要 sudo）

- [ ] **P0-1 安装容器工具链**
  ```bash
  sudo pacman -S --needed podman podman-compose buildah skopeo \
    fuse-overlayfs slirp4netns netavark aardvark-dns
  ```
  注意：不要安装 `docker`，避免与 podman socket/iptables 冲突。

- [x] **P0-2 验证 rootless**
  ```bash
  podman info
  ```
  通过标准：输出 `host.security.rootless: true`，`graphDriverName` 正常。
  - ✅ 结果（2026-10-18）：`podman 6.1.2`、`podman-compose 1.6.0`、`rootless=true`、`graphDriver=overlay`、cgroup v2 / systemd、`crun`、`netavark`。

- [ ] **P0-3 验证镜像拉取**
  ```bash
  podman run --rm docker.io/library/hello-world
  ```
  失败处理：记录报错 → 配置代理或 `/etc/containers/registries.conf` 镜像源后再继续。
  - ❌ 直连失败（2026-10-18）：DNS 被劫持，`registry-1.docker.io` 解析为 `173.244.217.42` / `2a03:2880:...`；报错 `x509: certificate is valid for ...traefik.default, not registry-1.docker.io`。
  - ✅ 镜像源验证通过：`podman run --rm docker.1ms.run/library/hello-world:latest` 成功输出 `Hello from Docker!`。
  - ⏭ 待办（需 sudo）：把 `docker.1ms.run` 写入 `/etc/containers/registries.conf`（`unqualified-search-registries` + `[[registry.mirror]]`），再重跑上面的直连命令。

- [x] **P0-4 验证新终端可用 Node**
  ```bash
  bash -lc 'node -v && npm -v'
  ```
  失败处理：在 shell rc 中加入 `fnm env` 初始化。
  - ✅ 结果（2026-10-18）：`node v24.20.0`、`npm 11.19.0`，非交互登录 shell 下可用。

- [ ] **P0-5（可选）安装 psql 客户端**
  ```bash
  sudo pacman -S --needed postgresql   # 仅为宿主机 psql/pg_dump
  ```
  - ⏸ 未执行（可选，2026-10-18）：`psql` 仍缺失，`sudo` 非交互需要密码。替代方案：统一用 `podman exec -it bs-postgres psql`，不装宿主机客户端。

> **阻塞规则**：P0-1 ~ P0-3 未通过，T1.x 及之后一律不开始。

---

## 5. 里程碑与检查点

| 里程碑 | 内容 | 预计工时 | 出口条件 |
|---|---|---|---|
| M0 | 环境就绪 | 0.5h | P0 全部勾选 |
| M1 | 骨架可启动 | 0.5d | `GET /healthz` 200，typecheck/lint 通过 |
| M2 | 数据库可迁移 | 0.5d | 迁移+seed 成功，表结构符合第 7 节 |
| **检查点 A** | M0–M2 | — | 你验收后进入 B |
| M3 | 认证可用 | 1d | 注册/登录/刷新/登出全流程通过 |
| M4 | 会话消息可用 | 1d | 权限、幂等、分页测试通过 |
| M5 | 实时可用 | 1d | 双客户端互发、重连补拉通过 |
| M6 | 质量达标 | 1d | `npm test` 全绿，覆盖率 ≥80% |
| M7 | 可上线 | 1d | 镜像构建、systemd 自启、备份恢复成功 |
| M8 | 文档交付 | 0.5d | 新机器按 README 从零跑通 |

---

## 6. 任务明细

### 检查点 A：地基（M0–M2）

#### T1.1 仓库初始化
- 负责人：Cline
- 依赖：P0
- 产出：`git init`、`.gitignore`（node_modules/.env/dist/coverage）、`.editorconfig`
- 验收：`git status` 干净；`.env` 被忽略

#### T1.2 工程骨架
- 负责人：Cline
- 产出：`package.json`（scripts: dev/build/start/typecheck/lint/test/db:*）、`tsconfig.json`、`src/server.ts`、`src/app.ts`
- 验收：`npm run typecheck` 无错误

#### T1.3 代码规范
- 负责人：Cline
- 产出：ESLint + Prettier 配置、`npm run lint` / `npm run format`
- 验收：lint 0 error

#### T1.4 配置与密钥
- 负责人：Cline
- 产出：`src/config/`（zod 校验环境变量）、`.env.example`、`.env`（本地，不提交）
- 变量清单：`NODE_ENV`、`PORT`、`DATABASE_URL`、`JWT_SECRET`、`JWT_REFRESH_SECRET`、`CORS_ORIGIN`、`LOG_LEVEL`
- 验收：缺变量时启动直接报清晰错误

#### T1.5 日志 / 错误 / 健康检查
- 负责人：Cline
- 产出：pino 日志、request-id、统一错误响应结构 `{ error: { code, message, requestId } }`、`GET /healthz`、`GET /readyz`（含 DB ping）
- 验收：`curl -s localhost:3000/healthz` 返回 200

#### T2.1 容器编排
- 负责人：Cline
- 产出：`compose.yaml`（postgres + api）、named volume、healthcheck、`.env` 注入
- 约束：只用 podman-compose 兼容字段；端口 ≥1024；不用 host 网络
- 验收：`podman compose up -d` 后 `podman compose ps` 全部 healthy

#### T2.2 常用命令封装
- 负责人：Cline
- 产出：`Makefile`：`up` / `down` / `logs` / `ps` / `psql` / `reset` / `migrate` / `seed` / `test`
- 验收：`make psql` 能进入数据库

#### T2.3 持久化验证
- 负责人：Cline + 你确认
- 验收：`down` 后 `up`，之前写入的数据仍在

#### T3.1 数据模型
- 负责人：Cline
- 产出：`src/db/schema.ts`
- 验收：字段、约束、索引与第 7 节一致

#### T3.2 迁移
- 负责人：Cline
- 产出：首个迁移文件、`drizzle.config.ts`、`npm run db:migrate`
- 验收：空库可迁移；重复执行不报错

#### T3.3 种子数据
- 负责人：Cline
- 产出：`src/db/seed.ts`：2 个用户、1 个私聊、1 个群聊、若干消息
- 验收：`make seed` 后可用 psql 查到数据

### 检查点 B：业务与交付（M3–M8）

> 状态：T4.1–T6.4 已完成（2026-10-19），T7 待开始。

#### T4.1 认证基础工具
- 产出：Argon2id 哈希封装、JWT 签发/验证、refresh token hash 存储
- 验收：单测覆盖过期、篡改、错误密钥

#### T4.2 注册 / 登录
- 产出：`POST /auth/register`、`POST /auth/login`
- 约束：邮箱规范化、用户名唯一、密码强度、登录限流
- 验收：重复邮箱 409；错误密码 401

#### T4.3 刷新 / 登出 / 当前用户
- 产出：`POST /auth/refresh`（轮换 + 旧 token 失效）、`POST /auth/logout`、`GET /users/me`
- 验收：旧 refresh 复用返回 401

#### T4.4 认证测试
- 验收：集成测试覆盖全部正/负路径

#### T5.1 会话
- 产出：`POST /conversations`（1v1 去重，`direct` 唯一约束）、`GET /conversations`
- 验收：同一对用户重复创建返回同一会话

#### T5.2 成员管理
- 产出：`GET/POST/DELETE /conversations/:id/members`
- 约束：仅成员可读；仅 owner/admin 可改；退群写 `left_at`
- 验收：非成员 403；重复加人幂等

#### T5.3 消息发送
- 产出：`POST /conversations/:id/messages` + WS `message.send`，共用 service 层
- 约束：`client_msg_id` 幂等、正文长度上限、发送限流、软删除
- 验收：重复 `client_msg_id` 只产生一条；非成员 403

#### T5.4 历史分页
- 产出：`GET /conversations/:id/messages?before=<seq>&limit=30`
- 验收：连续翻页不重不漏；软删消息不返回正文

#### T5.5 已读与未读
- 产出：`POST /conversations/:id/read`、会话列表带 `unreadCount`
- 验收：已读后未读归零；只统计 `left_at IS NULL` 成员

#### T6.1 WS 握手鉴权
- 产出：JWT 握手校验，失败直接断开并返回错误码
- 验收：无 token 连接失败；过期 token 失败

#### T6.2 房间与广播
- 产出：连接后加入所有会话房间；`message.created` 广播；不跨会话泄漏
- 验收：非成员收不到；成员实时收到

#### T6.3 typing / presence
- 产出：`typing.start/stop`、`presence.update`
- 约束：事件节流；断线后状态清理
- 验收：3 秒内无重复刷屏；离线后状态正确

#### T6.4 重连补拉
- 产出：客户端携带 `lastSeq` 重连，服务端补发或提示拉 REST
- 验收：断网 30 秒再连上，消息不丢

#### T7.1 测试基建
- 产出：独立测试库、迁移/清库脚本、测试工厂函数
- 验收：`npm test` 不依赖开发库数据

#### T7.2 集成测试
- 产出：HTTP 全流程、WS 双客户端、权限负例、幂等、分页
- 验收：全绿

#### T7.3 覆盖率
- 验收：核心 service 层 ≥80%；CI 命令 `npm run test:coverage`

#### T8.1 安全加固
- 产出：CORS 白名单、安全响应头、body 大小限制、登录/发消息限流、SQL 全参数化
- 验收：超限返回 429；恶意输入被 zod 拒绝

#### T8.2 优雅关闭
- 产出：`SIGTERM`/`SIGINT` 处理：停止接收新连接 → 关闭 WS → 关闭连接池
- 验收：无 "connection terminated" 未捕获错误

#### T8.3 可观测性
- 产出：慢查询日志、错误日志带 request-id、`/metrics`（可选）
- 验收：一次请求的日志可用 request-id 串起来

#### T9.1 生产镜像
- 产出：多阶段 `Containerfile`，非 root 用户，仅生产依赖
- 验收：`podman build` 成功；镜像内无 devDependencies

#### T9.2 开机自启
- 产出：Quadlet unit（`~/.config/containers/systemd/`）或 systemd unit
- 验收：`systemctl --user daemon-reload` 后开机自启、崩溃重启

#### T9.3 反向代理与 TLS
- 产出：Caddy 配置（域名 + 自动证书 + WS 升级）
- 验收：`wss://` 可连接

#### T9.4 备份与恢复
- 产出：`scripts/backup.sh`（pg_dump + 保留策略）、恢复步骤文档
- 验收：备份文件在空库恢复成功

#### T10.1 README
- 产出：一键启动/停止/重置、环境变量说明、常见故障排查

#### T10.2 协议文档
- 产出：REST 接口表、WS 事件表、错误码表、数据模型图

#### T10.3 从零演练
- 验收：新目录 + 按 README 操作，30 分钟内跑通注册→建会话→互发消息

---

## 7. 数据模型

| 表 | 关键字段 | 约束 / 索引 |
|---|---|---|
| `users` | id uuid, email citext, username, password_hash, display_name, avatar_url, created_at, deleted_at | email / username 唯一 |
| `refresh_tokens` | id, user_id, token_hash, expires_at, revoked_at, user_agent, ip | `(user_id)`；只存 hash |
| `conversations` | id, type(`direct`/`group`), title, created_by, created_at | — |
| `conversation_members` | conversation_id, user_id, role, joined_at, last_read_seq, muted_until, left_at | PK(conversation_id,user_id)；`(user_id)` |
| `messages` | id uuid, conversation_id, sender_id, seq bigint, client_msg_id, type, body, reply_to_id, edited_at, deleted_at, created_at | 唯一 `(conversation_id,seq)`、`(sender_id,client_msg_id)`；`(conversation_id, seq DESC)` |
| `direct_conversations` | user_a_id, user_b_id, conversation_id | 唯一 `(user_a_id,user_b_id)`，规范化小 id 在前 |

约定：
- 时间统一 UTC，删除用软删
- 分页用 seq 游标，禁止 offset
- 未读数由 `last_read_seq` 计算，不建计数表
- 需要扩展：`pgcrypto`（`gen_random_uuid`）、`citext`

---

## 8. REST 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/auth/register` | 否 | 注册 |
| POST | `/auth/login` | 否 | 登录 |
| POST | `/auth/refresh` | refresh | 轮换令牌 |
| POST | `/auth/logout` | 是 | 吊销 refresh |
| GET | `/users/me` | 是 | 当前用户 |
| GET | `/conversations` | 是 | 会话列表 + 未读数 |
| POST | `/conversations` | 是 | 创建私聊/群聊 |
| GET | `/conversations/:id/members` | 成员 | 成员列表 |
| POST | `/conversations/:id/members` | admin | 加人 |
| DELETE | `/conversations/:id/members/:uid` | admin/本人 | 移除/退群 |
| GET | `/conversations/:id/messages` | 成员 | 游标分页 |
| POST | `/conversations/:id/messages` | 成员 | 发送（幂等） |
| POST | `/conversations/:id/read` | 成员 | 上报已读 |
| DELETE | `/messages/:id` | 发送者 | 软删除 |
| GET | `/healthz` `/readyz` | 否 | 健康检查 |

---

## 9. WS 事件

信封：`{ event: string, requestId: string, data: object }`

| 方向 | 事件 | 说明 |
|---|---|---|
| C→S | `message.send` | 带 `clientMsgId`，ack 返回 `seq` |
| C→S | `message.read` | 上报 `lastReadSeq` |
| C→S | `typing.start` / `typing.stop` | 输入状态 |
| S→C | `message.created` | 新消息 |
| S→C | `message.read` | 已读同步 |
| S→C | `typing` | 对方输入中 |
| S→C | `presence.update` | 上下线 |
| S→C | `error` | 统一错误结构 |

规则：每个事件独立校验成员身份；事件级限流；禁止仅凭"连接已建立"就信任。

---

## 10. 目录结构

```
BS/
├── compose.yaml
├── Containerfile
├── Makefile
├── .env.example
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── server.ts
│   ├── app.ts
│   ├── config/
│   ├── plugins/
│   ├── modules/{auth,users,conversations,messages}/
│   ├── realtime/
│   ├── db/{schema.ts,migrations/,seed.ts}
│   └── lib/
├── tests/
├── scripts/
└── docs/
```

---

## 11. 风险登记

| 风险 | 影响 | 应对 |
|---|---|---|
| Docker Hub 直连超时 | 无法拉镜像，全部阻塞 | P0-3 先验证；配代理或 `registries.conf` 镜像源 |
| podman-compose 1.6 兼容性 | compose 字段不生效 | 只用兼容子集；必要时改 `podman compose` + docker-compose |
| fnm 未在非交互 shell 初始化 | 脚本/CI 找不到 node | 文档写明，脚本显式加载 fnm 环境 |
| argon2 原生编译失败 | 认证不可用 | 本机已装 gcc；生产用预编译镜像或切换到 `@node-rs/argon2` |
| 迁移自动执行 | 多实例并发迁移出错 | 生产改为独立 migrate 步骤 |
| 单机无 Redis | 无法水平扩展 | MVP 单实例；`realtime` 层留 pub/sub 接口 |
| 群聊成员多导致广播放大 | 延迟上升 | 首版限制群成员上限，后续做分片/Redis |
| 未读数计算成本 | 会话列表变慢 | `last_read_seq` + 覆盖索引；后续可加计数表 |

---

## 12. 完成定义（DoD）

- [ ] P0 全部通过，`podman compose up -d` 一条命令起服务
- [ ] `npm run typecheck`、`npm run lint`、`npm test` 全绿
- [ ] 双客户端端到端演示：注册 → 建群 → 互发 → 已读 → 断线重连不丢消息
- [ ] 权限负例全部有测试：非成员、过期 token、重复 `client_msg_id`、超限
- [ ] 镜像非 root 运行，systemd 开机自启
- [ ] 备份可恢复
- [ ] README 从零跑通 ≤30 分钟

---

## 13. 决策记录

| # | 决策 | 理由 | 日期 |
|---|---|---|---|
| D1 | Fastify + Socket.IO + Drizzle + JWT | 轻量、类型友好、实时功能开箱即用 | 2026-10-18 |
| D2 | 开发用 podman-compose，生产用 Quadlet | 开发快，生产可托管给 systemd | 2026-10-18 |
| D3 | 包管理用 npm | 已安装，零额外依赖 | 2026-10-18 |
| D4 | WS 为主发送路径，REST 保留同能力 | WS 低延迟；REST 便于测试/降级；共用 service | 2026-10-18 |
| D5 | 未读用 `last_read_seq` 计算 | 避免计数表并发热点 | 2026-10-18 |
| D6 | PostgreSQL 18，失败回退 17 | 用当前稳定版，保留退路 | 2026-10-18 |
