# Lumin 内网部署方案 - 讨论纪要

> 更新时间：2026-03-09
> 状态：待确认

---

## 一、核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Lumin 项目                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  MCP 服务器 (SSE 模式) ← 新增开发                    │  │
│  │  - browser (Playwright)                             │  │
│  │  - file_read / file_write                           │  │
│  │  - save_deliverable                                 │  │
│  │  - generate_totp                                    │  │
│  └─────────────────────────────────────────────────────┘  │
│                         ▲                                    │
│                         │ MCP over SSE                       │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │    内网 Agent          │
              │  (配置自定义 MCP)      │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │    大模型              │
              └───────────────────────┘
```

---

## 二、确认的问题

### 2.1 工具调用

- ✅ 工具调用由内网 Agent **闭环处理**
- ✅ 需要部署 MCP SSE 服务器供内网 Agent 调用
- ❓ MCP SSE 服务器需新增开发

### 2.2 审计日志

| 日志类型 | 内网部署后 |
|----------|-----------|
| agent_start / agent_end | ✅ 保留（从调用上下文获取） |
| llm_response | ✅ 保留（LLM 回复内容） |
| tool_start / tool_end | ❌ 缺失（工具闭环） |

### 2.3 适配层

- **不需要**：因为工具调用已闭环
- **可能需要**：如果内网 Agent 的 SSE 格式与 Anthropic 不同，需要转换

---

## 三、待确认问题

### 3.1 内网 Agent 接口

| 问题 | 状态 |
|------|------|
| chat 接口返回格式 | 待确认 |
| SSE 事件格式 | 待确认 |
| 是否支持直接输出 Anthropic 格式 | 待确认 |

### 3.2 内网 Agent SSE 返回格式

**格式**：返回结果，两行为一组（event + data）

| event | 说明 | data 内容 |
|-------|------|----------|
| `chat_started` | 会话启动 | 本轮对话 ID |
| `chunk` | 流式输出中 | `content` 字段为增量内容 |
| `message` | 本轮输出完成 | `content` 为完整结果（所有 chunk 的总和） |
| `failed` | 会话异常 | 异常报错信息 |
| `done` | 本次对话结束 | - |

**注意**：
- 当调用工具时，模型可能会有**多轮输出**
- 只有当 `event == done` 时才表示本次对话（query）结束

**示例**：
```
event: chat_started
data: {"session_id": "abc123"}

event: chunk
data: {"content": "我开始"}

event: chunk
data: {"content": "分析代码"}

event: message
data: {"content": "我开始分析代码结构..."}

event: chunk
data: {"content": "发现"}

event: message
data: {"content": "发现一个 SQL 注入漏洞..."}

event: done
data: {}
```

---

## 四、SDK 期望的 SSE 格式

### Anthropic SDK 接收格式

SDK 内部处理的是 **Anthropic 官方 SSE 格式**：

| event | 说明 |
|-------|------|
| `message_start` | 消息开始 |
| `content_block_start` | 内容块开始 |
| `content_block_delta` | 内容增量（text_delta, thinking_delta） |
| `content_block_stop` | 内容块结束 |
| `message_delta` | 消息元数据（stop_reason, usage） |
| `message_stop` | 单轮结束 |

### result 消息

- `result` 不是 SSE 事件，是 SDK 内部构造的消息
- 当 `message_delta` 的 `stop_reason` 不是 `"tool_use"` 时，表示本轮是最后一轮
- SDK 会自动构造 `result` 消息返回给上层

---

## 五、后续任务

### 4.1 MCP SSE 服务器

需要开发新的 MCP 服务器，支持 SSE 模式：
- 使用 `@modelcontextprotocol/sdk`
- 注册现有工具：browser, file_*, save_deliverable, generate_totp
- 暴露 `/mcp` SSE 端点

### 4.2 适配层（如需要）

如果内网 Agent SSE 格式与 Anthropic 不同，需要开发适配层进行格式转换。

### 4.3 下一步

1. 确认内网 Agent chat 接口的 SSE 返回格式
2. 根据格式决定是否需要适配层
3. 开发 MCP SSE 服务器
4. 测试验证

---

## 五、关键文件

- 当前 MCP 服务器：`mcp-server/src/index.ts`
- Claude 执行器：`src/ai/claude-executor.ts`
- 设计文档：`docs/plans/2026-03-05-internal-deployment-design.md`
