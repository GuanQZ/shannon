# Internal Agent 模式审计日志缺失问题

## 问题描述

在 Internal Agent 模式下，工具调用（如 Bash、Write、Glob、Read 等）没有记录到 audit 日志文件中，但这些工具确实被成功调用了（可在 worker 日志中看到）。

## 问题现象

### 1. Worker 日志中有工具调用记录
```
[InternalAgent] Tool call: Glob
[InternalAgent] Tool call: Read
[InternalAgent] Tool call: Bash
[InternalAgent] Tool call: Write
```

### 2. Audit 日志文件中没有工具调用记录
查看 `audit-logs/{workflow-id}/agents/{agent-id}_pre-recon_attempt-1.log`，只有：
- agent_start
- llm_response (LLM 的文本响应)
- 没有 tool_use / tool_result 记录

## 根本原因分析

### 调用链路

```
lumin ( Temporal Workflow
  → Activities
    → runAgentPrompt() (claude-executor.ts)
      → isInternalAgentEnabled()
        → runInternalAgentPrompt()
          → HTTP 请求到 mock-server
            → mock-server 调用 LLM
              → LLM 调用 MCP 工具
                → mock-server 执行工具
```

### 问题所在

**Internal Agent 模式的工具调用发生在 mock-server 进程内**，而 audit 日志是在 worker 进程中记录的：

1. `claude-executor.ts` 中的 `runInternalAgentPrompt()` 函数只是发送 HTTP 请求到 mock-server
2. mock-server 收到请求后，调用 LLM，LLM 决定调用工具
3. 工具执行结果通过 SSE 流返回给 worker
4. **但 worker 端的审计日志只记录了发送给 mock-server 的 prompt 和收到的响应，没有记录中间的工具调用**

### 对比：Direct API 模式

在 Direct API 模式下：
```
lumin → Claude SDK (在 worker 进程内)
  → SDK 执行工具调用
  → SDK 内部有完整的 tool_use/tool_result 日志记录
```

Claude SDK 运行在 worker 进程内部，可以拦截和记录所有工具调用。

## 解决方案

### 方案 1: mock-server 返回工具调用事件（推荐）

修改 mock-server，在工具调用时通过 SSE 返回额外的事件，如：
```typescript
// 工具调用开始时
res.write(`event: tool_call_start\ndata: ${JSON.stringify({ name: toolName, args: toolArgs })}\n\n`);

// 工具执行完成后
res.write(`event: tool_call_end\ndata: ${JSON.stringify({ name: toolName, result: toolResult })}\n\n`);
```

然后在 `runInternalAgentPrompt()` 中解析这些事件并记录到 audit 日志。

### 方案 2: 在 mock-server 端记录工具调用

在 mock-server 中直接记录工具调用到日志文件，然后通过某种机制同步到 worker 的 audit 目录。

### 方案 3: 修改审计日志架构

创建独立的审计日志系统，mock-server 通过 HTTP API 将工具调用记录发送给 worker。

## 影响范围

- **Internal Agent 模式**: 所有 agent（pre-recon, recon, vuln-*, exploit-*）的工具调用都不会记录到 audit 日志

---

## 问题 2：MCP 缺少 TodoWrite 工具

### 问题描述

Prompt 中大量使用 `TodoWrite` 工具来管理任务列表，但 MCP 服务器没有提供这个工具，导致 LLM 调用失败。

### 问题现象

```
[Tool] Calling TodoWrite
Tool call error: TodoWrite Error: Unknown tool: TodoWrite
```

### 根本原因

- **Direct API 模式**: Claude SDK 内置 TodoWrite 工具 ✅
- **Internal Agent 模式**: MCP 只提供了 save_deliverable, Read, Glob, Grep, Bash, Write ❌

### 影响

LLM 无法使用 TodoWrite 工具来管理任务列表，导致：
1. 无法跟踪分析进度
2. 可能影响分析质量
3. 任务执行不完整

### 解决方案

在 MCP 服务器上实现 TodoWrite 工具，或者修改 prompt 移除对 TodoWrite 的依赖。

---

## 问题 3：工具名称大小写不匹配

### 问题描述

MCP 工具名称和 LLM 调用时的工具名称大小写不一致。

### 问题现象

```
[Tool] Calling Bash
Tool call error: Bash Error: Unknown tool: Bash
```

虽然 MCP 提供了 `Bash` 工具，但 LLM 调用时仍然失败。

### 解决方案

1. 统一工具名称（全部大写或全部小写）
2. 在调用工具时进行大小写转换
- **调试困难**: 无法通过 audit 日志分析 LLM 的工具调用行为
- **审计不完整**: 渗透测试的完整执行轨迹不可追溯

## 相关代码位置

- `src/ai/claude-executor.ts`: `runInternalAgentPrompt()` 函数
- `mock-server/src/index.ts`: `/agent-api/:agentId/chatabc/chat` 端点
- `src/audit/logger.ts`: 审计日志记录逻辑
