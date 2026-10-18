# REST API

Base URL：`http://localhost:3000`

鉴权：`Authorization: Bearer <accessToken>`
错误响应：`{ "error": { "code": "...", "message": "...", "requestId": "..." } }`

## Auth

### POST /auth/register

```json
{
  "email": "alice@example.com",
  "username": "alice",
  "password": "password123",
  "displayName": "Alice"
}
```

`201`：

```json
{
  "user": {
    "id": "uuid",
    "email": "alice@example.com",
    "username": "alice",
    "displayName": "Alice",
    "avatarUrl": null,
    "createdAt": "..."
  },
  "accessToken": "jwt",
  "refreshToken": "jwt",
  "expiresIn": 900
}
```

错误：`409 USER_EXISTS`、`400 VALIDATION_ERROR`。

### POST /auth/login

```json
{ "email": "alice@example.com", "password": "password123" }
```

`200` 返回结构同注册；`401 INVALID_CREDENTIALS`。

### POST /auth/refresh

```json
{ "refreshToken": "jwt" }
```

`200` 返回新的 access + refresh；旧 refresh 立即失效。重复使用返回 `401 INVALID_REFRESH_TOKEN`。

### POST /auth/logout

```json
{ "refreshToken": "jwt" }
```

`204`，幂等。

### GET /users/me

需要 access token。

```json
{
  "user": {
    "id": "uuid",
    "email": "...",
    "username": "...",
    "displayName": "...",
    "avatarUrl": null,
    "createdAt": "..."
  }
}
```

## Conversations

### GET /conversations

返回当前用户所有未退出的会话，按最近消息排序：

```json
{
  "conversations": [
    {
      "id": "uuid",
      "type": "direct",
      "title": null,
      "createdBy": "uuid",
      "lastSeq": 12,
      "lastReadSeq": 10,
      "unreadCount": 2,
      "lastMessage": {
        "id": "uuid",
        "body": "hi",
        "seq": 12,
        "senderId": "uuid",
        "createdAt": "..."
      }
    }
  ]
}
```

### POST /conversations

私聊（幂等，同一对用户返回同一会话）：

```json
{ "type": "direct", "memberIds": ["<other-user-id>"] }
```

群聊：

```json
{ "type": "group", "title": "项目群", "memberIds": ["uuid", "uuid"] }
```

`201`（新建）或 `200`（已存在）：

```json
{ "conversationId": "uuid", "created": true }
```

### GET /conversations/:id/members

仅成员可见，返回未退出成员：

```json
{
  "members": [
    {
      "userId": "uuid",
      "role": "owner",
      "username": "alice",
      "displayName": "Alice",
      "email": "...",
      "joinedAt": "...",
      "lastReadSeq": 0
    }
  ]
}
```

### POST /conversations/:id/members

群主/管理员操作，仅群聊：

```json
{ "userIds": ["uuid"] }
```

`201` 返回最新成员列表。私聊返回 `400 INVALID_OPERATION`。

### DELETE /conversations/:id/members/:userId

群主/管理员可移除他人，本人可退群；私聊禁止。`204`。

## Messages

### GET /conversations/:id/messages

查询参数：`before`（seq，可选）、`limit`（1–100，默认 30）。

```json
{
  "messages": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "senderId": "uuid",
      "seq": 12,
      "clientMsgId": "c-1",
      "type": "text",
      "body": "hi",
      "replyToId": null,
      "editedAt": null,
      "deletedAt": null,
      "createdAt": "..."
    }
  ],
  "nextBefore": 10
}
```

按 `seq` 倒序；`nextBefore` 为空表示没有更早的消息。

### POST /conversations/:id/messages

```json
{ "body": "hello", "clientMsgId": "c-1", "replyToId": "uuid?" }
```

`201`：

```json
{
  "message": {
    "id": "uuid",
    "seq": 13,
    "body": "hello",
    "clientMsgId": "c-1",
    "senderId": "uuid",
    "createdAt": "..."
  }
}
```

- 相同 `clientMsgId` 重复提交返回同一条消息（幂等）
- 同一个 `clientMsgId` 用在其他会话返回 `409 CLIENT_MSG_ID_CONFLICT`
- 路由限流：60 次/分钟

### POST /conversations/:id/read

```json
{ "seq": 13 }
```

`200`：`{ "lastReadSeq": 13 }`，只会前进不会后退。

### DELETE /messages/:id

仅发送者可软删除，`204`；已删除时再次调用仍返回 `204`。

## 健康检查

| 路径           | 说明                         |
| -------------- | ---------------------------- |
| `GET /healthz` | 进程存活，不访问数据库       |
| `GET /readyz`  | 数据库可用返回 200，否则 503 |
| `GET /metrics` | uptime、内存、连接池计数     |
