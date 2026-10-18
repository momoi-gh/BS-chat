# 错误码

统一响应：

```json
{
  "error": {
    "code": "NOT_A_MEMBER",
    "message": "你不是该会话成员",
    "requestId": "uuid"
  }
}
```

5xx 不返回内部细节，堆栈与 SQL 参数不会进入日志（见 `toLoggableError`）。

| HTTP | code                     | 触发场景                                |
| ---- | ------------------------ | --------------------------------------- |
| 400  | `VALIDATION_ERROR`       | zod 校验失败                            |
| 400  | `INVALID_MEMBERS`        | 成员列表为空/含无效用户/私聊人数不为 1  |
| 400  | `TITLE_REQUIRED`         | 群聊缺少标题                            |
| 400  | `INVALID_OPERATION`      | 私聊加人/退群                           |
| 400  | `INVALID_REPLY`          | replyToId 不属于当前会话                |
| 401  | `UNAUTHORIZED`           | 缺少/无效/过期 access token             |
| 401  | `INVALID_CREDENTIALS`    | 邮箱或密码错误                          |
| 401  | `INVALID_REFRESH_TOKEN`  | refresh 无效、过期、已使用              |
| 403  | `NOT_A_MEMBER`           | 非会话成员访问                          |
| 403  | `FORBIDDEN`              | 权限不足（非群主/管理员、删除他人消息） |
| 404  | `NOT_FOUND`              | 路由不存在                              |
| 404  | `USER_NOT_FOUND`         | 用户不存在                              |
| 404  | `MEMBER_NOT_FOUND`       | 成员不存在                              |
| 404  | `MESSAGE_NOT_FOUND`      | 消息不存在                              |
| 409  | `USER_EXISTS`            | 邮箱或用户名已注册                      |
| 409  | `CLIENT_MSG_ID_CONFLICT` | clientMsgId 已被其他会话使用            |
| 429  | `TOO_MANY_REQUESTS`      | 触发 REST/WS 限流                       |
| 500  | `INTERNAL_ERROR`         | 未处理异常                              |
