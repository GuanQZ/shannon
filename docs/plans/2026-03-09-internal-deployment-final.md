# Lumin 内网部署方案

> 更新时间：2026-03-09
> 版本：v4.0（最终版）

---

## 一、背景

Lumin 项目需要在内网环境下部署，依赖内网 Agent 平台提供的大模型能力。

---

## 二、核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Lumin 项目                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Temporal Workflow (不变)                          │   │
│  │  Activity (调用方式改变)                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  内网 Agent HTTP API                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                    │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │    内网 Agent 平台     │
              │  (配置自定义 MCP)      │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │    大模型              │
              └───────────────────────┘
```

### 关键变化

| 组件 | 现状 | 内网部署后 |
|------|------|-----------|
| Temporal Workflow | 不变 | 不变 |
| Activity | 调用 SDK | 调用内网 Agent HTTP API |
| MCP Server | 进程内 | **独立部署，供内网 Agent 调用** |
| SDK | 使用 | **不使用** |

---

## 三、内网 Agent 接口

### 3.1 接口列表

| 接口 | 方法 | 用途 |
|------|------|------|
| `chatabc/init_session` | POST | 创建会话 |
| `chatabc/upload_file` | POST | 上传文件 |
| `chatabc/download_file` | POST | 下载文件 |
| `chatabc/chat` | POST | 流式对话 |
| `chatabc/fetch_history` | POST | 查询历史 |

### 3.2 SSE 返回格式

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
- 只有当 `event == done` 时才表示本次对话结束

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

event: done
data: {}
```

---

## 四、不使用 SDK 的决策

### 4.1 原因

1. **SDK 多轮逻辑复杂**：SDK 内部会自动处理工具调用 → 执行工具 → 继续下一轮，但工具闭环在内网 Agent 中，SDK 无法感知工具调用
2. **SSE 格式转换困难**：需要将内网 Agent 的 SSE 格式转换为 Anthropic 官方格式，包括 chunk、message、message_delta 等事件
3. **无需使用 SDK**：工具不通过 SDK 执行，SDK 的核心价值（自动工具执行）无法利用

### 4.2 解决方案

**直接调用内网 Agent HTTP API**，不依赖 SDK：

```typescript
// 直接调用内网 Agent
async function callInternalAgent(prompt: string, sessionId?: string) {
  if (!sessionId) {
    sessionId = await initSession();
  }

  const response = await fetch(`${baseUrl}/chatabc/chat`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, message: prompt })
  });

  // 解析 SSE 流
  let result = '';
  for await (const event of parseSSE(response)) {
    if (event.event === 'message') {
      result = event.data.content;
    }
    if (event.event === 'done') {
      break;
    }
  }

  return result;
}
```

### 4.3 优点

- 简单直接，不依赖复杂 SDK
- 易于理解和维护
- 不需要处理 SSE 格式转换

---

## 五、MCP 服务器（复用）

### 5.1 架构

**MCP 完全独立于 SDK**，可以复用现有工具能力：

```
当前：
  SDK → MCP Server (进程内)

内网部署：
  内网 Agent → MCP Server (HTTP SSE) ← 完全独立
                    │
                    └── 工具能力复用
```

### 5.2 需要开发

需要开发一个**独立的 MCP SSE 服务器**，使用 `@modelcontextprotocol/sdk`：

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const server = new Server({ name: 'lumin-helper', version: '1.0.0' }, {
  capabilities: { tools: {} },
});

// 注册现有工具
server.registerTool('browser', {...});
server.registerTool('file_read', {...});
server.registerTool('save_deliverable', {...});
server.registerTool('generate_totp', {...});

const transport = new SSEServerTransport('/mcp');
await transport.start();
```

### 5.3 工具列表

| 工具 | 用途 |
|------|------|
| browser | Playwright 浏览器自动化 |
| file_read | 读取文件 |
| file_write | 写入文件 |
| save_deliverable | 保存交付物 |
| generate_totp | 生成 TOTP |

---

## 六、审计日志

### 6.1 可保留的日志

| 日志类型 | 内网部署后 | 说明 |
|----------|-----------|------|
| agent_start | ✅ | 从调用上下文获取 |
| agent_end | ✅ | 从调用上下文获取 |
| llm_response | ✅ | LLM 回复内容 |

### 6.2 无法保留的日志

| 日志类型 | 说明 |
|----------|------|
| tool_start | 工具闭环在内网 Agent |
| tool_end | 工具闭环在内网 Agent |

### 6.3 结论

阶段标识（agentName）可以保留，因为是从 Activity 调用上下文传入的，不依赖 SDK 返回。

---

## 七、实施计划

### 7.1 阶段一：开发 MCP SSE 服务器

| 任务 | 文件 |
|------|------|
| 创建 MCP SSE 服务器 | `mcp-server/src/http-server.ts` |
| 注册现有工具 | `mcp-server/src/tools/*` |
| 配置内网 Agent | 配置 MCP 指向本服务 |

### 7.2 阶段二：改造 Activity 调用

| 任务 | 文件 |
|------|------|
| 创建内网 Agent 调用模块 | `src/ai/providers/internal-agent.ts` |
| 修改 Activity 调用方式 | `src/temporal/activities.ts` |
| 添加配置项 | `src/config-parser.ts` |

### 7.3 阶段三：测试验证

| 任务 |
|------|
| MCP 工具测试 |
| 内网 Agent 调用测试 |
| 端到端渗透测试 |

---

## 八、文件改动清单

| 文件 | 改动 |
|------|------|
| `mcp-server/src/http-server.ts` | 新增 - MCP SSE 服务器 |
| `src/ai/providers/internal-agent.ts` | 新增 - 内网 Agent 调用模块 |
| `src/ai/claude-executor.ts` | 改造 - 支持 Provider 切换 |
| `src/temporal/activities.ts` | 改造 - 调用内网 Agent |
| `src/config-parser.ts` | 改造 - 添加内网配置 |

---

## 九、网络拓扑

### 9.1 部署要求

| 组件 | 网络要求 |
|------|---------|
| Lumin Temporal | 内网可达 |
| MCP SSE 服务器 | 内网 Agent 能访问 |
| 内网 Agent | 能访问 MCP 服务器 |

### 9.2 端口规划

| 端口 | 服务 |
|------|------|
| 7233 | Temporal |
| 8080 | MCP SSE 服务器 |

---

## 十、去掉 SDK 的影响评估

### 10.1 SDK 提供的能力

| 能力 | 去 SDK 后的处理 |
|------|----------------|
| 工具执行 | MCP 闭环在内网 Agent，不需要 SDK 执行 |
| 多轮循环 | 不需要，工具闭环在内网 Agent |
| SSE 流解析 | 需要自己实现 |
| 结果格式化 | 需要自己实现 |
| 审计日志 | 需要自己记录 |
| 成本计算 | 需要从内网 Agent 获取或估算 |
| 流式输出 | 需要自己处理 SSE |

### 10.2 需要自己实现的功能

| 功能 | 说明 |
|------|------|
| SSE 流解析 | 解析内网 Agent 的 SSE 响应 |
| 结果格式化 | 解析 message 事件中的 content |
| 错误处理 | 请求失败、网络异常等 |
| 日志记录 | 记录请求/响应（见上文） |
| 会话管理 | 每次新建 sessionId |

### 10.3 可以复用的功能

| 功能 | 说明 |
|------|------|
| Temporal Workflow | 完全不变 |
| Activity 逻辑 | 基本不变，调用方式改变 |
| MCP 工具 | 完全复用 |
| Prompt 模板 | 完全复用 |
| 审计日志框架 | 基本不变 |

---

## 十一、配置方式

### 11.1 K8s ConfigMap 配置

支持通过 ConfigMap 配置：

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: lumin-config
data:
  INTERNAL_AGENT_BASE_URL: "http://internal-agent:8080"
  INTERNAL_AGENT_API_KEY: "your-api-key"
  MCP_SERVER_URL: "http://lumin-mcp:8080"
  LOG_LEVEL: "debug"
```

### 11.2 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `INTERNAL_AGENT_BASE_URL` | 内网 Agent 地址 | - |
| `INTERNAL_AGENT_API_KEY` | 内网 Agent API Key | - |
| `MCP_SERVER_URL` | MCP 服务器地址 | `http://localhost:8080` |
| `LOG_LEVEL` | 日志级别 | `info` |

---

## 十二、会话策略

### 12.1 设计原则

**每个 Agent 每次调用新建 session**：

```
Agent(pre-recon): init_session → chat → end
Agent(recon):     init_session → chat → end
Agent(vuln-xss): init_session → chat → end
```

### 12.2 原因

- 每次 Activity 调用是独立的
- 工具调用闭环在内网 Agent
- 简化会话管理

---

## 十三、重试机制

### 13.1 保持不变

复用现有的重试机制：

- Activity 层的重试逻辑不变
- 网络异常重试（3 次）
- 超时处理

### 13.2 新增错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| 网络错误 | 重试 3 次 |
| session 无效 | 重新 init_session |
| 内网 Agent 异常 | 返回错误，Activity 层处理 |

---

## 十四、调试日志

由于无法直接访问内网，调试成本较高，需要在代码中增加详细日志：

### 14.1 日志内容

| 类别 | 日志内容 |
|------|---------|
| 调用内网 Agent | 请求参数、请求体 |
| 内网 Agent 响应 | SSE 事件、解析结果 |
| MCP 请求 | 工具名称、参数 |
| MCP 响应 | 执行结果 |

### 14.2 日志示例

```typescript
// 调用内网 Agent
console.log('[InternalAgent] >>> Request:', { session_id, message: prompt.substring(100) });
for await (const event of response) {
  console.log('[InternalAgent] <<< SSE Event:', event.event, event.data);
}

// MCP
console.log('[MCP] >>> Tool Call:', { tool: name, input });
console.log('[MCP] <<< Tool Result:', result);
```

### 14.3 日志级别

- `INFO`：正常流程
- `DEBUG`：详细请求/响应
- `ERROR`：异常信息

---

## 十五、总结

1. **不使用 SDK**：直接调用内网 Agent HTTP API，简化架构
2. **MCP 独立部署**：工具能力通过 MCP SSE 供内网 Agent 调用
3. **最小改动**：Temporal、Activity 逻辑基本不变，只需修改调用层
4. **调试友好**：增加详细日志，方便内网调试
5. **K8s 友好**：支持 ConfigMap 配置
6. **会话简单**：每次新建 session

该方案改动最小化，风险可控，推荐实施。
