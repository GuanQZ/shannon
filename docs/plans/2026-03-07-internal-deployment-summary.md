# Shannon 内网部署讨论纪要

> 更新时间：2026-03-08
> 讨论背景：确认内网部署方案的核心架构

---

## 一、核心理解

### 1.1 Shannon 项目的本质

Shannon 项目由两部分组成：

| 部分 | 职责 |
|------|------|
| **工作流 + Agent** | Temporal 调度、Activity 执行、Prompt 加载 |
| **MCP 服务器** | 提供工具能力（浏览器、文件读写、TOTP） |

**关键发现：每个 Agent 在执行过程中，Shannon 代码只调用一次 `runClaudePrompt()`，然后阻塞等待结果。中间的多轮对话、工具调用全部由 SDK 内部处理。**

### 1.2 Agent 等待的结果是什么

每个 Agent 返回给 Shannon 的是：
- `result` — 总结性文本（"已完成 XSS 分析..."）
- 实际产物存储在 `deliverables/` 目录的文件中

Agent 通过 `save_deliverable` MCP 工具主动写入文件。

### 1.3 SDK 的消息流机制

Claude SDK 内部维护一个消息流：

```
query() 返回 AsyncIterator
    │
    ├── message: assistant (LLM 输出)
    ├── message: tool_use (LLM 调用工具)
    ├── message: tool_result (工具结果)
    ├── message: assistant (LLM 继续)
    ├── message: tool_use
    ├── message: tool_result
    ... (可能几百条)
    └── message: result (最终结果)
```

- SDK 自动检测 `tool_use`，自动执行 MCP 工具
- 工具结果自动给 LLM，继续对话
- 每条消息都会记录到审计日志

---

## 二、内网部署架构

### 2.1 最终方案：适配层 + 环境变量配置

```
┌─────────────────────────────────────────────────────────────────┐
│                    最终架构                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Shannon 项目                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  SDK (ANTHROPIC_BASE_URL 指向适配层)                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                         │                                       │
│                         ▼ (Claude 格式请求)                    │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  适配层 (新增)                                          │   │
│   │  - 请求格式转换                                         │   │
│   │  - 解析 SSE 流                                         │   │
│   │  - 消息格式转换 (LangChain → Claude)                   │   │
│   │  - sessionId 管理                                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                         │                                       │
│                         ▼ (内网 Agent 格式)                     │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  内网 Agent 平台                                        │   │
│   │  - 内部有 SDK + MCP 配置                               │   │
│   │  - SSE 流式返回                                        │   │
│   │  - LangChain 消息格式                                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 配置方式

```bash
# .env
ANTHROPIC_BASE_URL=http://localhost:8080  # 指向适配层
```

**本项目代码 0 改动！只需要配置环境变量。**

### 2.3 不需要改动的部分

- ❌ Temporal 工作流代码
- ❌ Activity 函数
- ❌ Prompt 加载逻辑
- ❌ 阶段调度顺序
- ❌ 审计日志逻辑

---

## 三、需要确认的问题（已确认）

### 3.1 内网 Agent 特性 ✅

| 问题 | 答案 |
|------|------|
| 支持流式传输 | ✅ SSE (Server-Sent Events) |
| 内部有 SDK | ✅ 有自己的 SDK |
| 可配置 MCP | ✅ 支持配置 MCP 服务器 |
| sessionId | ✅ 用于维护对话上下文 |

### 3.2 SSE 消息格式 ✅

返回格式为两行为一组：

```
event: chat_started     → session_id
event: chunk           → 流式输出的文本块
event: message         → 完整消息（之前所有 chunk 的总和）
event: done            → 会话结束
```

### 3.3 消息内容格式 ✅

内网 Agent 使用 **LangChain 格式**：

```json
{
  "type": "ai",
  "content": "文字内容",
  "tool_calls": [
    {
      "name": "browser",
      "args": { "url": "..." }
    }
  ],
  "usage_metadata": {...}
}
```

**需要转换为 Claude SDK 格式：**

```json
{
  "type": "tool_use",
  "tool": "browser",
  "input": { "url": "..." }
}
```

### 3.4 工具调用处理

两种方案：

| 方案 | 说明 |
|------|------|
| **方案 A** | 内网 Agent 内部执行 MCP → 返回 tool_result（推荐） |
| 方案 B | 适配层检测 tool_calls → 调用本地 HTTP Bridge |

---

## 四、适配层需要实现的功能

### 4.1 请求转换

```
Claude SDK 格式 → 内网 Agent 格式
```

### 4.2 SSE 流解析

```
event: chunk → data: {...}
event: message → data: {...}
event: done
```

### 4.3 消息格式转换

| LangChain 字段 | Claude SDK 字段 |
|---------------|----------------|
| `type: "ai"` | `type: "assistant"` |
| `tool_calls` | `tool_use` |
| `content` | `content` |

### 4.4 sessionId 管理

- 第一次调用：创建 session
- 后续调用：复用 session

---

## 五、文件存储

### 5.1 存储位置

所有文件存储在 **Shannon Worker 容器内**：

| 数据 | 存储位置 |
|------|---------|
| 目标源码 | `/app/repos/<repo>/` |
| 截图 | `/app/repos/<repo>/screenshots/` |
| 中间交付物 | `/app/repos/<repo>/deliverables/*.md` |
| 最终报告 | `/app/repos/<repo>/deliverables/comprehensive_*.md` |

### 5.2 存储流程

1. AI/LLM 推理过程中决定要保存文件
2. 调用 `save_deliverable` 工具
3. HTTP Bridge 执行 `fs.writeFile()` 写入容器
4. 后续 Agent 可以通过 `file_read` 读取

---

## 六、审计日志

审计日志由 Shannon 代码通过 SDK 回调机制写入：

- Agent 开始/结束
- LLM 输出
- 工具调用开始/结束

**由于使用 SDK，流式消息完整保留，审计日志完全不变。**

---

## 七、实施计划

### 阶段一：开发适配层

| 任务 | 说明 |
|------|------|
| 创建适配层服务 | Express + SSE 处理 |
| 请求格式转换 | Claude → 内网 Agent |
| SSE 流解析 | event/message 解析 |
| 消息格式转换 | LangChain → Claude |
| sessionId 管理 | 创建/复用 |

### 阶段二：配置

| 任务 | 说明 |
|------|------|
| 配置环境变量 | ANTHROPIC_BASE_URL |
| 测试连通性 | 验证适配层 ↔ 内网 Agent |

### 阶段三：测试

| 任务 | 说明 |
|------|------|
| 单 Agent 测试 | 验证流式返回 |
| 完整流程测试 | 验证工作流执行 |
| 审计日志验证 | 确认记录完整 |

---

## 八、总结

内网部署的核心方案：

1. **不做代码改动** — 只需配置 `ANTHROPIC_BASE_URL`
2. **开发适配层** — 负责格式转换和 SSE 流处理
3. **利用 SDK 能力** — 工具自动执行、审计日志保留
4. **sessionId 管理** — 适配层自动处理

该方案改动最小化，风险可控，推荐实施。
