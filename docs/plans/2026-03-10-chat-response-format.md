# 内网 Agent Chat 接口响应格式

> 更新时间：2026-03-10
> 来源：实际接口截图

---

## 一、架构说明

### 1.1 完整流程

```
┌─────────────┐  init_session  ┌─────────────┐
│    Lumin    │ ─────────────► │  模拟服务    │ ──────► 获取 session_id
│             │                └─────────────┘
│             │
│             │     /chat      ┌─────────────┐     MCP      ┌─────────────┐
│             │ ─────────────► │  模拟服务    │ ──────────► │ MCP 服务器  │
│             │ ◄───────────── │ (Mock Server)│ ◄────────── │ (工具执行)  │
└─────────────┘    最终响应     └─────────────┘   工具结果    └─────────────┘
```

### 1.2 接口调用顺序

```
1. init_session → 获取 session_id
2. chat (带 session_id) → 获取响应
3. ...
4. 结束
```

---

## 二、init_session 接口

### 2.1 请求格式

**URL**: `POST /chatabc/init_session`

**Headers**:
```json
{
  "Content-Type": "application/json"
}
```

**Body**:
```json
{
  "appId": "string",
  "trCode": "string",
  "trVersion": "string",
  "timestamp": 1,
  "agent_id": "string",
  "requestId": "string"
}
```

**字段说明**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `appId` | string | 是 | 应用 ID |
| `trCode` | string | 是 | 交易代码 |
| `trVersion` | string | 是 | 交易版本号 |
| `timestamp` | number | 是 | 时间戳 |
| `agent_id` | string | 是 | Agent ID |
| `requestId` | string | 是 | 请求唯一 ID |

### 2.2 响应格式

```json
{
  "resCode": "FAIAG0000",
  "resMessage": "SUCCESS",
  "responseId": "3d31e15b-eeef-4cb4-87b3-1f5b1aa7e213",
  "timestamp": 1773139153706,
  "data": {
    "session_id": "ebb0262f-d94b-4333-8284-624dc0e55e85"
  }
}
```

**提取 session_id**:
```typescript
const response = await fetch('/chatabc/init_session', options);
const data = await response.json();
const sessionId = data.data.session_id;
```

### 2.3 配置文件

这些参数应该在配置文件中设置，方便部署时修改：

```yaml
# config.yaml 或环境变量
internal_agent:
  init_session:
    appId: "your-app-id"
    trCode: "your-tr-code"
    trVersion: "1.0"
    agent_id: "your-agent-id"
```

---

## 三、chat 接口

### 3.1 请求格式

**URL**: `POST /chatabc/chat`

**Headers**:
```json
{
  "Content-Type": "application/json"
}
```

**Body**:
```json
{
  "appId": "string",
  "trCode": "string",
  "trVersion": "string",
  "timestamp": 1,
  "requestId": "string",
  "data": {
    "session_id": "string",
    "txt": "string",
    "stream": true,
    "files": []
  }
}
```

**字段说明**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `appId` | string | 是 | 应用 ID |
| `trCode` | string | 是 | 交易代码 |
| `trVersion` | string | 是 | 交易版本号 |
| `timestamp` | number | 是 | 时间戳 |
| `requestId` | string | 是 | 请求唯一 ID |
| `data.session_id` | string | 是 | 从 init_session 获取 |
| `data.txt` | string | 是 | 用户输入（提示词） |
| `data.stream` | boolean | 是 | 流式输出（默认 true） |
| `data.files` | array | 否 | 文件列表（可选） |

### 3.2 配置文件

```yaml
# config.yaml 或环境变量
internal_agent:
  chat:
    appId: "your-app-id"
    trCode: "your-tr-code"
    trVersion: "1.0"
    stream: true
```

---

## 四、chat 响应格式（SSE）

### 4.1 事件类型

| event | 说明 |
|-------|------|
| `chat_started` | 会话启动，包含 chat_id |
| `message` | 消息内容（文本、工具调用、工具结果） |
| `done` | 完成，包含状态码 |

### 4.2 chat_started 事件

```json
event: chat_started
data: {"chat_id": "abc123"}
```

### 4.3 message 事件 - AI 消息（工具调用）

```json
event: message
data: {
  "type": "AIMessageChunk",
  "content": "",
  "metadata": {},
  "tool_calls": [
    {
      "name": "calculate",
      "args": "{\"expression\": \"15*85\"}",
      "id": "call_xxx",
      "type": "tool_call"
    }
  ]
}
```

### 4.4 message 事件 - 文本回复

```json
event: message
data: {
  "type": "AIMessageChunk",
  "content": "这是一个文本回复...",
  "metadata": {},
  "tool_calls": []
}
```

### 4.5 message 事件 - 工具执行结果

```json
event: message
data: {
  "type": "function",
  "content": "1275",
  "name": "calculate",
  "metadata": {}
}
```

### 4.6 done 事件

```json
event: done
data: {"code": "FAIAG0000", "success": true}
```

---

## 五、模拟服务实现

### 5.1 工具调用处理流程

```
1. 收到 user message + session_id

2. 调用 LLM

3. LLM 返回 message (type: AIMessageChunk, tool_calls 有内容)
   → 提取 tool_calls[].name, args, id

4. 调用 MCP 服务器执行工具
   POST /tools/call { name, arguments }

5. 将工具结果添加到消息历史

6. 继续调用 LLM

7. 重复步骤 3-6，直到 LLM 返回文本

8. 返回最终响应给 Lumin
```

---

## 六、Lumin 端实现

### 6.1 Lumin 收到的内容

Lumin 从 `/chat` 接口收到的响应可能是：
1. **纯文本** - 直接使用
2. **包含工具调用的消息** - 记录日志

### 6.2 日志适配

Lumin 只需要解析收到的 SSE 事件，记录到现有 auditlog：

```typescript
async parseResponse(response: Response): Promise<string> {
  let result = '';
  let toolCalls = [];

  for await (const event of this.parseSSE(response)) {
    if (event.event === 'message') {
      const data = event.data;

      // 记录所有消息到 auditlog
      this.logToAudit(data);

      // 提取文本内容
      if (data.type === 'AIMessageChunk') {
        if (data.tool_calls && data.tool_calls.length > 0) {
          toolCalls.push(...data.tool_calls);
        } else if (data.content) {
          result = data.content;
        }
      }
    }

    if (event.event === 'done') {
      break;
    }
  }

  if (!result && toolCalls.length > 0) {
    result = `[Tool calls executed: ${toolCalls.map(t => t.name).join(', ')}]`;
  }

  return result;
}
```

---

## 七、注意事项

### 模拟服务
1. **每次对话前先调用 init_session**：获取 session_id
2. **需要真正执行工具**：调用 MCP 服务器
3. **工具调用循环**：执行工具后需要把结果传回给 LLM

### Lumin 端
1. **只需记录日志**：收到的响应记录到 auditlog
2. **适配现有格式**：与现有 auditlog 格式兼容

### 响应格式
1. **只通过 `type` 字段判断**
2. **args 是 JSON 字符串**：`tool_calls[].args` 需要 `JSON.parse()`
3. **metadata 字段**：始终是空对象 `{}`，可忽略
