# WebSocket 协议

使用 Socket.IO，路径 `/socket.io`。

## 连接与鉴权

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: accessToken },
  transports: ['websocket'],
});
```

- token 必须是有效的 access token
- 无 token / 无效 token → `connect_error`，消息为 `UNAUTHORIZED`

## 就绪事件

服务端连接后会查询会话并 join 房间。**客户端必须等 `ready` 再发事件**，否则 ack 可能丢失：

```js
socket.on('ready', ({ conversationIds }) => {
  console.log('joined', conversationIds);
});
```

## 客户端 → 服务端

### message.send

```js
socket.emit(
  'message.send',
  { conversationId, body: 'hello', clientMsgId: 'c-1', replyToId: null },
  (ack) => {
    if (ack.ok) console.log(ack.message);
    else console.error(ack.error);
  },
);
```

ack 成功：`{ ok: true, message }`；失败：`{ ok: false, error: { code, message } }`。
每个连接限制 30 条/10 秒，超限返回 `TOO_MANY_REQUESTS`。

### message.read

```js
socket.emit('message.read', { conversationId, seq: 13 }, (ack) => {});
```

ack：`{ ok: true, lastReadSeq }`。

### typing.start / typing.stop

```js
socket.emit('typing.start', { conversationId });
socket.emit('typing.stop', { conversationId });
```

无 ack。

### sync.request（断线补拉）

```js
socket.emit('sync.request', { conversationId, afterSeq: 10, limit: 100 }, (ack) => {
  if (ack.ok) console.log(ack.messages);
});
```

返回 `{ ok: true, conversationId, messages }`，按 seq 升序，最多 100 条。

## 服务端 → 客户端

| 事件              | 载荷                                 | 说明                     |
| ----------------- | ------------------------------------ | ------------------------ |
| `ready`           | `{ conversationIds }`                | 已加入房间，可以开始收发 |
| `message.created` | `{ message }`                        | 新消息（发送者也会收到） |
| `message.read`    | `{ conversationId, userId, seq }`    | 某成员已读到 seq         |
| `typing`          | `{ conversationId, userId, typing }` | 对方正在输入             |
| `presence.update` | `{ conversationId, userId, online }` | 上下线                   |
| `error`           | `{ code, message }`                  | 事件处理失败             |

## 房间规则

- 每个会话一个房间：`conversation:<id>`
- 只有当前有效成员（`left_at IS NULL`）会在连接时加入
- 被移出群聊后，已连接的 socket 仍保留旧房间，直到重连；消息发送仍会做数据库鉴权

## 错误码

与 REST 共用，见 [errors.md](errors.md)。
