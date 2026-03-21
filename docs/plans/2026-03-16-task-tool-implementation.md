# Task 工具实现文档

> 创建时间：2026-03-16
> 更新原因：实现 Task 工具以支持 LLM 并行调用子任务

## 1. 背景

### 问题

Lumin 的 prompts（特别是 pre-recon-code.txt）中要求 LLM 使用 Task 工具来并行执行多个子任务：

```
Phase 1: Launch all three Phase 1 agents in parallel using multiple Task tool calls in a single message
```

原始的 Claude Code Task 工具功能：
- 接收 `description` 和 `prompt` 参数
- 创建一个独立的 SubAgent 执行子任务
- 每个 Task 调用有独立的 session

### 需求

1. LLM 能够调用 Task 工具
2. 多个 Task 工具调用能够并行执行
3. 每个 Task 调用使用独立的 session

## 2. 设计思路

### 2.1 Task 工具参数设计

与 Claude Code 保持一致：

```typescript
{
  description: string,  // 任务简短描述（3-5词）
  prompt: string        // 详细任务指令
}
```

### 2.2 执行流程

```
LLM 发起 Task 工具调用
    ↓
Task 工具 handler 执行:
  1. init_session - 获取新的 session_id
  2. chat - 调用 LLM 执行子任务
    ↓
返回结果给 LLM
```

**关键点**：每次 Task 调用都会创建新的 session，确保任务隔离。

### 2.3 并行执行

修改 mock-server 支持多个 tool_calls 并行执行：

```typescript
// 修改前：顺序执行
for (const toolCall of llmResponse.toolCalls) {
  const result = await mcpClient.callToolByFullName(...);
}

// 修改后：并行执行
const toolCallResults = await Promise.all(
  llmResponse.toolCalls.map(async (toolCall) => {
    return await mcpClient.callToolByFullName(...);
  })
);
```

### 2.4 完整调用链

```
主 Agent (LLM)
  │
  ├── Task(description="架构扫描", prompt="...")
  ├── Task(description="入口点映射", prompt="...")
  └── Task(description="安全模式查找", prompt="...")
       │
       ▼
mock-server (并行执行)
  │
  ├── lumin-tool-mcp (Task1) → init_session → chat → 返回
  ├── lumin-tool-mcp (Task2) → init_session → chat → 返回
  └── lumin-tool-mcp (Task3) → init_session → chat → 返回
       │
       ▼
主 Agent 收集结果继续处理
```

## 3. 实现

### 3.1 文件修改

| 文件 | 修改内容 |
|------|---------|
| `lumin-tool-mcp/src/tools/task.ts` | 新建 - Task 工具实现 |
| `lumin-tool-mcp/src/http-server.ts` | 添加 Task 工具注册和 handler |
| `mock-server/src/index.ts` | 修改 tool_calls 执行逻辑，支持并行 |

### 3.2 Task 工具实现要点

**lumin-tool-mcp/src/tools/task.ts**:

```typescript
export async function executeTask(input: TaskInput): Promise<{ result: string }> {
  // 1. 从环境变量获取 Agent 配置
  const { INTERNAL_AGENT_BASE_URL, ... } = process.env;

  // 2. init_session - 创建新 session
  const initResponse = await fetch(initUrl, { ... });
  const sessionId = initData.data.session_id;

  // 3. chat - 发送任务
  const chatResponse = await fetch(chatUrl, { body: { session_id: sessionId, txt: input.prompt } });

  // 4. 解析 SSE 流式响应
  let result = '';
  for await (const event of parseSSEStream(chatResponse)) {
    // 提取 content
  }

  return { result };
}
```

### 3.3 MCP 工具注册

**lumin-tool-mcp/src/http-server.ts**:

```typescript
// 工具定义
{
  name: 'Task',
  description: 'Launch a new task - execute a sub-task in an isolated environment using LLM.',
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'A short (3-5 word) description of the task' },
      prompt: { type: 'string', description: 'The task for the agent to perform' },
    },
    required: ['description', 'prompt'],
  },
}

// Handler
if (toolName === 'Task') {
  const { executeTask, TaskInputSchema } = await import('./tools/task.js');
  const validatedArgs = TaskInputSchema.parse(toolArgs);
  const result = await executeTask(validatedArgs);
  return { content: [{ type: 'text', text: result.result }] };
}
```

## 4. 部署

### 4.1 重新构建

```bash
# 1. 重新构建 lumin-tool-mcp 镜像
docker build -t lumin-tool-mcp ./lumin-tool-mcp

# 2. 重新构建 mock-server 镜像
docker build -t mock-server ./mock-server

# 3. 重启服务
docker compose down
docker compose up -d
```

### 4.2 环境变量

Task 工具使用以下环境变量（已在容器中配置）：

| 变量 | 说明 | 默认值 |
|------|------|---------|
| INTERNAL_AGENT_BASE_URL | Agent 服务地址 | http://mock-server:3000 |
| INTERNAL_AGENT_INIT_SESSION_AGENT_ID | Agent ID | tool-agent-1 |

## 5. 验证

### 5.1 检查 Task 工具是否注册

```bash
# 查看 MCP 工具列表，应该包含 Task
curl http://localhost:8080/health
```

### 5.2 测试并行执行

1. 发送包含多个 Task 工具调用的 prompt
2. 观察日志中是否显示 `(parallel)` 标记
3. 确认 3 个 Task 同时执行

## 6. 限制与未来优化

### 当前限制

1. **Session 复用**：每次 Task 调用都创建新 session，可考虑缓存
2. **结果合并**：多个 Task 结果由主 Agent 手动合并，可增加合成 Agent
3. **错误处理**：单个 Task 失败不影响其他 Task

### 未来优化

1. 支持 `parallelCount` 参数，相同任务执行多次
2. 支持 `subTasks` 数组，明确指定子任务
3. 增加超时控制和重试机制
