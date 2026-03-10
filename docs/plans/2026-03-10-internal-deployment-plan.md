# Lumin 内网部署实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Lumin 改造为支持内网部署，不再依赖 Claude SDK，实现 MCP SSE 服务器暴露工具能力，并调用内网 Agent HTTP API

**Architecture:** 本项目不再使用 SDK，需要自己实现：1) MCP SSE 服务器暴露工具（save_deliverable, generate_totp, browser_*）；2) 调用内网 Agent 的适配层；3) 改造模拟服务真正调用 LLM

**Tech Stack:** @anthropic-ai/sdk, @modelcontextprotocol/sdk, Express, SSE

**参考文档：**
- SSE 响应格式：`docs/plans/2026-03-10-chat-response-format.md`

---

## 阶段一：改造模拟服务（真正调用 LLM）

### Task 1: 添加 LLM 客户端到模拟服务

**Files:**
- Create: `.claude/worktrees/lumin-internal-agent-mock/mock-server/src/llm-client.ts`
- Modify: `.claude/worktrees/lumin-internal-agent-mock/mock-server/package.json`
- Test: 使用 curl 测试 `/chat` 接口

**Step 1: 添加 Anthropic SDK 依赖**

进入 worktree 目录，安装依赖：

```bash
cd .claude/worktrees/lumin-internal-agent-mock/mock-server
npm install @anthropic-ai/sdk
```

**Step 2: 创建 LLM 客户端**

创建文件 `.claude/worktrees/lumin-internal-agent-mock/mock-server/src/llm-client.ts`：

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  stopReason: string;
}

/**
 * 调用 LLM 获取回复
 */
export async function callLLM(
  messages: LLMMessage[],
  systemPrompt?: string,
  tools?: readonly any[]
): Promise<LLMResponse> {
  const params: any = {
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: 8192,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  if (tools && tools.length > 0) {
    params.tools = tools;
  }

  const response = await anthropic.messages.create(params);

  // 提取文本内容
  const contentBlocks = response.content.filter((block: any) => block.type === 'text');
  const content = contentBlocks.map((block: any) => block.text).join('\n');

  return {
    content,
    stopReason: response.stop_reason || 'end_turn',
  };
}

/**
 * 流式调用 LLM
 */
export async function* callLLMStream(
  messages: LLMMessage[],
  systemPrompt?: string,
  tools?: readonly any[]
): AsyncGenerator<{ type: string; content?: string; toolName?: string; toolInput?: any }> {
  const params: any = {
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: 8192,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    stream: true,
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  if (tools && tools.length > 0) {
    params.tools = tools;
  }

  const stream = await anthropic.messages.create(params);

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_start') {
      yield { type: 'content_block_start', content: '' };
    } else if (chunk.type === 'content_block_delta') {
      if (chunk.delta.type === 'text_delta') {
        yield { type: 'chunk', content: chunk.delta.text };
      } else if (chunk.delta.type === 'input_json_delta') {
        yield { type: 'tool_input', content: chunk.delta.partial_json };
      }
    } else if (chunk.type === 'content_block_stop') {
      yield { type: 'content_block_stop', content: '' };
    } else if (chunk.type === 'message_delta') {
      yield { type: 'delta', content: '' };
    } else if (chunk.type === 'message_stop') {
      yield { type: 'done', content: '' };
    }
  }
}

export { anthropic };
```

**Step 3: 验证 LLM 客户端**

运行模拟服务并测试：

```bash
# 确保 .env 有 API key
cd .claude/worktrees/lumin-internal-agent-mock/mock-server
echo "ANTHROPIC_API_KEY=your-key-here" > .env

# 测试 LLM 调用
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Say hello", "sessionId": "test-123"}'
```

**Expected:** SSE 流式返回 LLM 回复

**Step 4: Commit**

```bash
git add mock-server/src/llm-client.ts mock-server/package.json
git commit -m "feat: add LLM client to mock server"
```

---

### Task 2: 改造 SSE 控制器支持工具调用

**Files:**
- Modify: `.claude/worktrees/lumin-internal-agent-mock/mock-server/src/sse-controller.ts`
- Modify: `.claude/worktrees/lumin-internal-agent-mock/mock-server/src/index.ts`
- Test: 测试带工具的对话

**Step 1: 修改 SSEController 支持工具调用**

修改 `.claude/worktrees/lumin-internal-agent-mock/mock-server/src/sse-controller.ts`，添加真实 LLM 调用和工具执行循环：

```typescript
// 在文件顶部添加导入
import { callLLM, type LLMMessage } from './llm-client.js';
import { MCPManager } from './mcp-manager.js';

// 修改 handleChatMessage 方法
async handleChatMessage(parsed: any, res: Response) {
  const messages: LLMMessage[] = [
    { role: 'user', content: parsed.message }
  ];

  // 获取可用的工具
  const tools = this.mcpManager.listTools();

  // 第一次调用 LLM
  let llmResponse = await callLLM(
    messages,
    parsed.systemPrompt,
    tools
  );

  // 流式输出 LLM 回复
  for (const word of llmResponse.content.split(' ')) {
    res.write(`data: {"type":"chunk","content":"${word} "}\n\n`);
    await new Promise(r => setTimeout(r, 30));
  }

  res.write(`data: {"type":"message","content":"${llmResponse.content}"}\n\n`);

  // 检查是否需要调用工具
  // 注意：这里需要解析 LLM 响应中的 tool_use
  // 简化实现：检测响应中是否包含工具调用标记
  if (this.containsToolCall(llmResponse.content)) {
    const toolCalls = this.parseToolCalls(llmResponse.content);

    for (const toolCall of toolCalls) {
      // 调用 MCP 工具
      const toolResult = await this.mcpManager.callTool(
        toolCall.name,
        toolCall.input
      );

      // 将工具结果添加为消息
      messages.push({ role: 'assistant', content: llmResponse.content });
      messages.push({
        role: 'user',
        content: `Tool ${toolCall.name} result: ${JSON.stringify(toolResult)}`
      });

      // 继续调用 LLM
      llmResponse = await callLLM(messages, parsed.systemPrompt, tools);

      // 输出后续响应
      for (const word of llmResponse.content.split(' ')) {
        res.write(`data: {"type":"chunk","content":"${word} "}\n\n`);
        await new Promise(r => setTimeout(r, 30));
      }
      res.write(`data: {"type":"message","content":"${llmResponse.content}"}\n\n`);
    }
  }
}

// 辅助方法：检测是否包含工具调用
private containsToolCall(content: string): boolean {
  return content.includes('[TOOL_CALL]') || content.includes('tool_use');
}

// 辅助方法：解析工具调用
private parseToolCalls(content: string): Array<{ name: string; input: any }> {
  // 简化实现：正则匹配 [TOOL_CALL] 格式
  // 实际应该解析 SDK 返回的 tool_use 结构
  const toolCallRegex = /\[TOOL_CALL\]\s*(\w+)\s*:\s*([\s\S]*?)\[\/TOOL_CALL\]/g;
  const calls = [];
  let match;

  while ((match = toolCallRegex.exec(content)) !== null) {
    calls.push({
      name: match[1],
      input: JSON.parse(match[2]),
    });
  }

  return calls;
}
```

**Step 2: 启动服务测试**

```bash
cd .claude/worktrees/lumin-internal-agent-mock/mock-server
npm run dev
```

**Step 3: 测试工具调用**

配置 MCP 服务器，然后测试：

```bash
# 配置 MCP（可选，如果没有配置内置模拟工具）
curl -X POST http://localhost:3000/mcp/config \
  -H "Content-Type: application/json" \
  -d '{"name": "lumin-helper", "url": "http://localhost:8080/mcp"}'

# 测试带工具的对话
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Use the browser to navigate to https://example.com and take a screenshot", "sessionId": "test-123"}'
```

**Expected:** LLM 调用浏览器工具，返回结果

**Step 4: Commit**

```bash
git add mock-server/src/sse-controller.ts mock-server/src/index.ts
git commit -m "feat: add real LLM calls with tool execution to mock server"
```

---

## 阶段二：实现 MCP SSE 服务器

### Task 3: 创建 MCP HTTP SSE 服务器

**Files:**
- Create: `mcp-server/src/http-server.ts`
- Modify: `mcp-server/package.json`
- Test: 启动服务器，测试 tool/list 端点

**Step 1: 创建 HTTP SSE 服务器**

创建 `mcp-server/src/http-server.ts`：

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import express from 'express';
import cors from 'cors';
import { createSaveDeliverableTool } from './tools/save-deliverable.js';
import { generateTotpTool } from './tools/generate-totp.js';

// 获取目标目录
const targetRepo = process.env.LUMIN_TARGET_REPO || 'default';
const targetDir = `/app/deliverables/${targetRepo}`;

// 创建 MCP 服务器
const server = new Server(
  { name: 'lumin-helper', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// 注册工具
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'save_deliverable',
        description: 'Saves deliverable files with automatic validation. Queue files must have {"vulnerabilities": [...]} structure.',
        inputSchema: {
          type: 'object',
          properties: {
            deliverable_type: {
              type: 'string',
              enum: ['CODE_ANALYSIS', 'RECON', 'INJECTION_ANALYSIS', 'INJECTION_QUEUE',
                     'XSS_ANALYSIS', 'XSS_QUEUE', 'AUTH_ANALYSIS', 'AUTH_QUEUE',
                     'AUTHZ_ANALYSIS', 'AUTHZ_QUEUE', 'SSRF_ANALYSIS', 'SSRF_QUEUE',
                     'INJECTION_EVIDENCE', 'XSS_EVIDENCE', 'AUTH_EVIDENCE',
                     'AUTHZ_EVIDENCE', 'SSRF_EVIDENCE'],
            },
            content: { type: 'string' },
            file_path: { type: 'string' },
          },
          required: ['deliverable_type'],
        },
      },
      {
        name: 'generate_totp',
        description: 'Generates 6-digit TOTP code for authentication. Secret must be base32-encoded.',
        inputSchema: {
          type: 'object',
          properties: {
            secret: { type: 'string', description: 'Base32-encoded TOTP secret' },
          },
          required: ['secret'],
        },
      },
    ],
  };
});

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'save_deliverable') {
    const handler = createSaveDeliverableTool(targetDir);
    const result = await handler(args as any);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  if (name === 'generate_totp') {
    const { generateTotp } = await import('./tools/generate-totp.js');
    const result = await generateTotp(args as any);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// 创建 Express 应用
const app = express();
app.use(cors());
app.use(express.json());

// SSE 端点
app.get('/mcp', async (req, res) => {
  const transport = new SSEServerTransport('/mcp', res);
  await transport.start();
  await server.connect(transport);
});

// 启动服务器
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Lumin MCP Server running on port ${PORT}`);
  console.log(`Target directory: ${targetDir}`);
});

export { server, app };
```

**Step 2: 安装依赖**

```bash
cd mcp-server
npm install @modelcontextprotocol/sdk express cors zod
npm install -D @types/express @types/cors
```

**Step 3: 启动并测试**

```bash
# 启动 MCP 服务器
cd mcp-server
LUMIN_TARGET_REPO=juice-shop npx tsx src/http-server.ts

# 在另一个终端测试
curl http://localhost:8080/mcp
# 或者使用 MCP 客户端测试 tool/list
```

**Step 4: Commit**

```bash
git add mcp-server/src/http-server.ts mcp-server/package.json
git commit -m "feat: add MCP HTTP SSE server"
```

---

## 阶段三：实现 Lumin 适配层

### Task 4: 创建 Lumin 内网 Agent 适配器

**Files:**
- Create: `src/ai/providers/internal-agent.ts`
- Modify: `src/ai/claude-executor.ts`
- Test: 测试调用模拟服务

**Step 1: 创建适配器**

创建 `src/ai/providers/internal-agent.ts`：

```typescript
import { z } from 'zod';

/**
 * 内网 Agent 配置
 */
export interface InternalAgentConfig {
  baseUrl: string;      // 内网 Agent 地址，如 http://localhost:3000
  apiKey?: string;      // 可选的 API Key
}

/**
 * 调用结果
 */
export interface ChatResult {
  content: string;
  sessionId: string;
}

/**
 * SSE 事件解析
 */
interface SSEEvent {
  type: string;
  data: any;
}

/**
 * 内网 Agent Provider
 * 直接调用内网 Agent 的 HTTP API
 */
export class InternalAgentProvider {
  private config: InternalAgentConfig;
  private currentSessionId: string | null = null;

  constructor(config: InternalAgentConfig) {
    this.config = config;
  }

  /**
   * 发送消息，获取回复
   */
  async chat(prompt: string, sessionId?: string): Promise<ChatResult> {
    const useSessionId = sessionId || this.currentSessionId || `session-${Date.now()}`;

    const response = await fetch(`${this.config.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
      },
      body: JSON.stringify({
        message: prompt,
        sessionId: useSessionId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat failed: ${response.status} ${response.statusText}`);
    }

    // 解析 SSE 响应
    const result = await this.parseSSEResponse(response.body!);

    return {
      content: result.content,
      sessionId: useSessionId,
    };
  }

  /**
   * 解析 SSE 流式响应
   */
  private async parseSSEResponse(body: ReadableStream<Uint8Array>): Promise<{ content: string }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 事件
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'chunk' && data.content) {
              // 流式输出中
            } else if (data.type === 'message' && data.content) {
              content = data.content;
            } else if (data.type === 'done') {
              return { content };
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    return { content };
  }

  /**
   * 关闭会话
   */
  async close(): Promise<void> {
    this.currentSessionId = null;
  }
}

/**
 * 创建默认配置
 */
export function createInternalAgentConfig(): InternalAgentConfig {
  return {
    baseUrl: process.env.INTERNAL_AGENT_BASE_URL || 'http://localhost:3000',
    apiKey: process.env.INTERNAL_AGENT_API_KEY,
  };
}

export type { InternalAgentConfig as InternalAgentOptions };
```

**Step 2: 修改 claude-executor.ts 集成适配层**

在 `src/ai/claude-executor.ts` 中添加适配层调用：

```typescript
// 在文件顶部添加导入
import { InternalAgentProvider, createInternalAgentConfig } from './providers/internal-agent.js';

// 查找现有代码位置，大约在 line 230 runClaudePrompt 函数
// 添加环境变量检查
const useInternalAgent = process.env.USE_INTERNAL_AGENT === 'true';

// 修改 runClaudePrompt 函数
export async function runClaudePrompt(/* ... 现有参数 */): Promise<ClaudePromptResult> {
  if (useInternalAgent) {
    // 使用内网 Agent
    return runWithInternalAgent(prompt, sourceDir, context, description, agentName);
  }

  // 现有 SDK 逻辑
  // ...
}

// 新增：内网 Agent 执行逻辑
async function runWithInternalAgent(
  prompt: string,
  sourceDir: string,
  context: string = '',
  description: string = 'Internal Agent analysis',
  agentName: string | null = null
): Promise<ClaudePromptResult> {
  const config = createInternalAgentConfig();
  const provider = new InternalAgentProvider(config);

  const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;

  try {
    const result = await provider.chat(fullPrompt);

    return {
      result: result.content,
      turnCount: 1,
      model: 'internal-agent',
      cost: 0,
      apiErrorDetected: false,
    };
  } finally {
    await provider.close();
  }
}
```

**Step 3: 测试**

```bash
# 设置环境变量
export USE_INTERNAL_AGENT=true
export INTERNAL_AGENT_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY=your-key

# 运行测试
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Say hello in Chinese", "sessionId": "test-123"}'
```

**Step 4: Commit**

```bash
git add src/ai/providers/internal-agent.ts src/ai/claude-executor.ts
git commit -m "feat: add internal agent adapter for Lumin"
```

---

## 阶段四：端到端测试

### Task 5: 完整流程测试

**Files:**
- Test: 启动所有服务，运行完整渗透测试

**Step 1: 启动所有服务**

```bash
# 终端 1: 启动 MCP 服务器
cd mcp-server
LUMIN_TARGET_REPO=test-repo npx tsx src/http-server.ts

# 终端 2: 启动模拟服务（需要先改造完成）
cd .claude/worktrees/lumin-internal-agent-mock/mock-server
npm run dev

# 终端 3: 配置 MCP 到模拟服务
curl -X POST http://localhost:3000/mcp/config \
  -H "Content-Type: application/json" \
  -d '{"name": "lumin-helper", "url": "http://localhost:8080/mcp"}'
```

**Step 2: 测试完整流程**

```bash
# 测试 Lumin 调用模拟服务
export USE_INTERNAL_AGENT=true
./lumin start URL=https://example.com REPO=test-repo
```

**Step 3: 验证**

- 检查 deliverables 是否正确保存
- 检查日志是否完整
- 验证工具调用是否成功

**Step 4: Commit**

```bash
git add .
git commit -m "test: verify end-to-end internal deployment"
```

---

## 总结

### 实现顺序

1. **Task 1-2**: 改造模拟服务，真正调用 LLM
2. **Task 3**: 实现 MCP SSE 服务器
3. **Task 4**: 实现 Lumin 适配层
4. **Task 5**: 端到端测试

### 依赖关系

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
         ↑                      ↑
         └──────────────────────┘
              (可并行测试)
```

### 预期产出

- 模拟服务可真正调用 LLM
- MCP 服务器可被调用执行工具
- Lumin 可调用模拟服务完成渗透测试
