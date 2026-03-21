# Mock-Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 mock-server 替代 Claude Agent SDK，使 Lumin 能通过 REST API 调用内网 Agent 平台

**Architecture:** mock-server 作为 Lumin 与内网 Agent 平台之间的代理层：接收 Lumin 的 HTTP 请求 → 调用 MiniMax LLM → 通过 MCP 协议调用工具 → 返回 SSE 流式响应

**Tech Stack:** Node.js/TypeScript, Express, SSE, MCP SDK, MiniMax API

---

## Task 1: Create mock-server Project Structure

**Files:**
- Create: `mock-server/package.json`
- Create: `mock-server/tsconfig.json`
- Create: `mock-server/src/index.ts`
- Create: `mock-server/src/types.ts`

**Step 1: Create project directories**

```bash
mkdir -p mock-server/src
```

**Step 2: Create package.json**

```json
{
  "name": "mock-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "@modelcontextprotocol/sdk": "^0.5.0",
    "dotenv": "^16.3.1",
    "uuid": "^9.0.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "@types/uuid": "^9.0.7",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create basic index.ts**

```typescript
import express from 'express';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Mock server running on port ${PORT}`);
});
```

**Step 5: Create types.ts**

```typescript
// Request/Response types matching the API spec

export interface InitSessionRequest {
  appId: string;
  trCode: string;
  trVersion: string;
  timestamp: number;
  requestId: string;
  data: {
    prompt_variables?: Record<string, unknown>[];
  };
}

export interface InitSessionResponse {
  resCode: string;
  resMessage: string;
  responseId: string;
  timestamp: number;
  data: {
    session_id: string;
  };
}

export interface ChatRequest {
  appId: string;
  trCode: string;
  trVersion: string;
  timestamp: number;
  requestId: string;
  data: {
    session_id: string;
    txt: string;
    stream: boolean;
    files?: string[];
  };
}

export interface SSEvent {
  event: string;
  data: unknown;
}
```

**Step 6: Commit**

```bash
git add mock-server/
git commit -m "feat: create mock-server project structure"
```

---

## Task 2: Implement REST API Endpoints (init_session, chat)

**Files:**
- Modify: `mock-server/src/index.ts`

**Step 1: Add init_session endpoint**

```typescript
import { v4 as uuidv4 } from 'uuid';

// In-memory session store (for single session support)
const sessions = new Map<string, { sessionId: string; createdAt: number }>();

app.post('/agent-api/:agentId/chatabc/init_session', (req, res) => {
  const { agentId } = req.params;
  const { appId, trCode, trVersion, timestamp, requestId, data } = req.body;

  // Generate session_id
  const sessionId = uuidv4();
  sessions.set(sessionId, { sessionId, createdAt: Date.now() });

  const response: InitSessionResponse = {
    resCode: 'FAIAG0000',
    resMessage: 'SUCCESS',
    responseId: requestId || uuidv4(),
    timestamp: timestamp || Date.now(),
    data: {
      session_id: sessionId,
    },
  };

  res.json(response);
});
```

**Step 2: Add chat endpoint (basic, returns mock response)**

```typescript
app.post('/agent-api/:agentId/chatabc/chat', (req, res) => {
  const { agentId } = req.params;
  const { appId, trCode, trVersion, timestamp, requestId, data } = req.body;

  const { session_id, txt, stream } = data;

  // Validate session
  if (!sessions.has(session_id)) {
    return res.status(400).json({
      resCode: 'FAIAG0001',
      resMessage: 'Invalid session_id',
      responseId: requestId,
      timestamp: Date.now(),
      data: {},
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send chat_started event
  res.write(`event: chat_started\ndata: ${JSON.stringify({ chat_id: uuidv4() })}\n\n`);

  // TODO: Integrate LLM and tool calling in next tasks

  // For now, send a mock text response
  res.write(`event: message\ndata: ${JSON.stringify({
    content: txt,
    additional_kwargs: {},
    response_metadata: {},
    type: 'AIMessageChunk',
    name: null,
    id: uuidv4(),
    example: false,
    tool_calls: [],
    invalid_tool_calls: [],
    usage_metadata: null,
    tool_call_chunks: []
  })}\n\n`);

  res.write(`event: done\ndata: ${JSON.stringify({ code: 'FAIAG0000', success: true })}\n\n`);

  res.end();
});
```

**Step 3: Test endpoint manually**

```bash
cd mock-server && npm install && npm run dev
```

Test init_session:
```bash
curl -X POST http://localhost:3000/agent-api/test/chatabc/init_session \
  -H "Content-Type: application/json" \
  -d '{"appId":"test","trCode":"test","trVersion":"1","timestamp":1234567890,"requestId":"req-1","data":{"prompt_variables":[]}}'
```

**Step 4: Commit**

```bash
git add mock-server/src/index.ts
git commit -m "feat: implement init_session and chat endpoints"
```

---

## Task 3: Implement MiniMax LLM Client

**Files:**
- Create: `mock-server/src/llm-client.ts`

**Step 1: Create LLM client**

```typescript
import { z } from 'zod';

// Tool call schema
const ToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()),
  id: z.string(),
  type: z.literal('tool_call'),
});

const AIMessageChunkSchema = z.object({
  content: z.string(),
  additional_kwargs: z.record(z.unknown()).default({}),
  response_metadata: z.record(z.unknown()).default({}),
  type: z.literal('AIMessageChunk'),
  name: z.null().default(null),
  id: z.string().optional(),
  example: z.boolean().default(false),
  tool_calls: z.array(ToolCallSchema).default([]),
  invalid_tool_calls: z.array(z.unknown()).default([]),
  usage_metadata: z.null().default(null),
  tool_call_chunks: z.array(z.unknown()).default([]),
});

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

export class MiniMaxLLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[]): Promise<{
    content: string;
    toolCalls: ToolCall[];
  }> {
    const response = await fetch(`${this.config.baseUrl}/v1/text/chatcompletion_pro`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map(m => ({
          sender_type: m.role === 'user' ? 'USER' : 'BOT',
          sender_name: m.role === 'user' ? 'User' : 'Assistant',
          text: m.content,
        })),
        tokens_to_generate: 4096,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.text || '';

    // TODO: Parse tool calls from response
    // This is a simplified version - actual implementation needs to handle tool calls

    return { content, toolCalls: [] };
  }

  *streamChat(messages: ChatMessage[]): Generator<{
    type: 'chunk' | 'tool_call' | 'done';
    content?: string;
    toolCalls?: ToolCall[];
  }> {
    // TODO: Implement streaming
    // For now, use non-streaming version
    const result = this.chat(messages);
    yield { type: 'chunk', content: result.content };
    if (result.toolCalls.length > 0) {
      yield { type: 'tool_call', toolCalls: result.toolCalls };
    }
    yield { type: 'done' };
  }
}
```

**Step 2: Add environment config**

```typescript
// src/config.ts
export const config = {
  minimax: {
    apiKey: process.env.MINIMAX_API_KEY || '',
    baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat',
    model: process.env.MINIMAX_MODEL || 'abab6.5s-chat',
  },
  mcp: {
    luminHelperUrl: process.env.LUMIN_MCP_SERVER_URL || 'http://mcp-server:8082/sse',
    playwrightUrl: process.env.PLAYWRIGHT_MCP_SERVER_URL || 'http://playwright-mcp:8083/sse',
  },
  auth: {
    agentId: process.env.AGENT_ID || 'tool-agent-1-default',
    agentToken: process.env.AGENT_TOKEN || 'mock-token-for-testing',
  },
};
```

**Step 3: Commit**

```bash
git add mock-server/src/llm-client.ts mock-server/src/config.ts
git commit -m "feat: implement MiniMax LLM client"
```

---

## Task 4: Implement MCP Client

**Files:**
- Create: `mock-server/src/mcp-client.ts`

**Step 1: Create MCP client using MCP SDK**

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export class MCPClient {
  private clients: Map<string, Client> = new Map();

  async connect(name: string, url: string): Promise<void> {
    const transport = new SSEClientTransport(new URL(url));
    const client = new Client(
      {
        name: `mock-server-${name}`,
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
    this.clients.set(name, client);
    console.log(`Connected to MCP server: ${name}`);
  }

  async connectAll(config: { luminHelper: string; playwright: string }): Promise<void> {
    await this.connect('lumin-helper', config.luminHelper);
    await this.connect('playwright', config.playwright);
  }

  async listTools(serverName: string): Promise<Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const response = await client.request(
      { method: 'tools/list' },
      { method: 'tools/list', params: {} }
    );

    return response.tools || [];
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const response = await client.request(
      { method: 'tools/call' },
      {
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      }
    );

    return response.content?.[0]?.text || response.content;
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
```

**Step 2: Commit**

```bash
git add mock-server/src/mcp-client.ts
git commit -m "feat: implement MCP client for tool calling"
```

---

## Task 5: Integrate LLM + MCP + SSE in chat endpoint

**Files:**
- Modify: `mock-server/src/index.ts`

**Step 1: Update chat endpoint with full implementation**

```typescript
import { MiniMaxLLMClient } from './llm-client.js';
import { MCPClient } from './mcp-client.js';
import { config } from './config.js';

// Initialize clients
const llmClient = new MiniMaxLLMClient(config.minimax);
const mcpClient = new MCPClient();

// Connect to MCP servers on startup
async function initialize() {
  try {
    await mcpClient.connectAll({
      luminHelper: config.mcp.luminHelperUrl,
      playwright: config.mcp.playwrightUrl,
    });
  } catch (error) {
    console.error('Failed to connect to MCP servers:', error);
  }
}
initialize();

// Update chat endpoint
app.post('/agent-api/:agentId/chatabc/chat', async (req, res) => {
  // ... validate session ...

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { txt: prompt } = data;
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  let finalContent = '';
  let toolCalls: ToolCall[] = [];

  // Main loop: LLM → tool call → execute → LLM
  while (true) {
    // Call LLM
    const llmResponse = await llmClient.chat(messages);
    finalContent += llmResponse.content;
    toolCalls = llmResponse.toolCalls;

    // Send content chunk
    res.write(`event: message\ndata: ${JSON.stringify({
      content: llmResponse.content,
      additional_kwargs: {},
      response_metadata: {},
      type: 'AIMessageChunk',
      name: null,
      id: uuidv4(),
      example: false,
      tool_calls: toolCalls.map(tc => ({
        name: tc.name,
        args: tc.args,
        id: tc.id,
        type: 'tool_call',
      })),
      invalid_tool_calls: [],
      usage_metadata: null,
      tool_call_chunks: [],
    })}\n\n`);

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      break;
    }

    // Execute tool calls
    for (const toolCall of toolCalls) {
      try {
        // Determine which MCP server has this tool
        // For now, try lumin-helper first
        const result = await mcpClient.callTool('lumin-helper', toolCall.name, toolCall.args);

        // Send tool result
        res.write(`event: message\ndata: ${JSON.stringify({
          content: JSON.stringify(result),
          additional_kwargs: {},
          response_metadata: {},
          type: 'function',
          name: toolCall.name,
          id: null,
        })}\n\n`);

        // Add tool result to messages
        messages.push({
          role: 'assistant',
          content: '',
        });
        messages.push({
          role: 'user',
          content: JSON.stringify(result),
        });
      } catch (error) {
        console.error(`Tool call error: ${toolCall.name}`, error);
      }
    }
  }

  res.write(`event: done\ndata: ${JSON.stringify({ code: 'FAIAG0000', success: true })}\n\n`);
  res.end();
});
```

**Step 2: Commit**

```bash
git add mock-server/src/index.ts
git commit -m "feat: integrate LLM, MCP, and SSE in chat endpoint"
```

---

## Task 6: Add SDK Tools to mcp-server

**Files:**
- Create: `mcp-server/src/tools/sdk-tools.ts`

**Step 1: Implement SDK tools (Read, Glob, Grep, Bash, Write, Edit)**

```typescript
import { glob } from 'glob';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export const sdkTools = [
  {
    name: 'Read',
    description: 'Read a file from the repository. Returns the file content.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file relative to repo root' },
      },
      required: ['file_path'],
    },
    handler: async ({ file_path }: { file_path: string }, context: { cwd: string }) => {
      const fullPath = path.join(context.cwd, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    },
  },
  {
    name: 'Glob',
    description: 'Find files matching a pattern in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.ts)' },
      },
      required: ['pattern'],
    },
    handler: async ({ pattern }: { pattern: string }, context: { cwd: string }) => {
      const files = await glob(pattern, { cwd: context.cwd });
      return JSON.stringify(files);
    },
  },
  {
    name: 'Grep',
    description: 'Search for patterns in files.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        path: { type: 'string', description: 'File path or directory to search' },
      },
      required: ['pattern'],
    },
    handler: async ({ pattern, path: searchPath }: { pattern: string; path?: string }, context: { cwd: string }) => {
      const searchDir = searchPath ? path.join(context.cwd, searchPath) : context.cwd;
      try {
        const { stdout } = await execAsync(`rg -n "${pattern}" "${searchDir}" || true`);
        return stdout || 'No matches found';
      } catch {
        return 'No matches found';
      }
    },
  },
  {
    name: 'Bash',
    description: 'Run a shell command in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
      },
      required: ['command'],
    },
    handler: async ({ command }: { command: string }, context: { cwd: string }) => {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: context.cwd });
        return stdout || stderr;
      } catch (error: unknown) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  {
    name: 'Write',
    description: 'Write content to a file in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file relative to repo root' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['file_path', 'content'],
    },
    handler: async ({ file_path, content }: { file_path: string; content: string }, context: { cwd: string }) => {
      const fullPath = path.join(context.cwd, file_path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return `File written: ${file_path}`;
    },
  },
];
```

**Step 2: Register tools in mcp-server**

Modify `mcp-server/src/http-server.ts` to register SDK tools alongside existing tools.

**Step 3: Commit**

```bash
git add mcp-server/src/tools/sdk-tools.ts
git commit -m "feat: add SDK tools (Read, Glob, Grep, Bash, Write) to mcp-server"
```

---

## Task 7: Update docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add mock-server service**

```yaml
services:
  # ... existing services ...

  mock-server:
    build:
      context: ./mock-server
    ports:
      - "3000:3000"
    environment:
      - MINIMAX_API_KEY=${MINIMAX_API_KEY}
      - MINIMAX_BASE_URL=${MINIMAX_BASE_URL}
      - MINIMAX_MODEL=${MINIMAX_MODEL:-abab6.5s-chat}
      - LUMIN_MCP_SERVER_URL=http://mcp-server:8082/sse
      - PLAYWRIGHT_MCP_SERVER_URL=http://playwright-mcp:8083/sse
      - AGENT_ID=${AGENT_ID:-tool-agent-1-default}
      - AGENT_TOKEN=${AGENT_TOKEN:-mock-token}
    depends_on:
      - mcp-server
      - playwright-mcp
    volumes:
      - ./repos:/app/repos

  playwright-mcp:
    image: mcr.microsoft.com/playwright:latest
    command: npx @playwright/mcp@latest --port 8083
    ports:
      - "8083:8083"
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add mock-server to docker-compose"
```

---

## Task 8: End-to-End Testing

**Step 1: Build and start services**

```bash
docker compose build
docker compose up -d mock-server mcp-server playwright-mcp
```

**Step 2: Test init_session**

```bash
curl -X POST http://localhost:3000/agent-api/test/chatabc/init_session \
  -H "Content-Type: application/json" \
  -d '{"appId":"test","trCode":"test","trVersion":"1","timestamp":1234567890,"requestId":"req-1","data":{"prompt_variables":[]}}'
```

Expected response:
```json
{
  "resCode":"FAIAG0000",
  "resMessage":"SUCCESS",
  "responseId":"req-1",
  "timestamp":1234567890,
  "data":{
    "session_id":"<uuid>"
  }
}
```

**Step 3: Test chat with a prompt**

```bash
curl -X POST http://localhost:3000/agent-api/test/chatabc/chat \
  -H "Content-Type: application/json" \
  -d '{
    "appId":"test",
    "trCode":"test",
    "trVersion":"1",
    "timestamp":1234567890,
    "requestId":"req-2",
    "data":{
      "session_id":"<from-step-2>",
      "txt":"Hello, this is a test",
      "stream":true,
      "files":[]
    }
  }'
```

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "test: add e2e tests for mock-server"
```

---

## 实际实现总结

以下是实际开发中做的关键修改，与原计划有所不同：

### 1. LLM 连接方式

使用 Anthropic SDK 兼容 MiniMax API（而非直接调用 MiniMax API）：

```typescript
// src/llm-client.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: config.apiKey,
  baseURL: config.baseUrl, // https://api.minimaxi.com/anthropic
});

// 使用标准的 Anthropic Messages API
const response = await client.messages.create({
  model: 'minimax-m2.5',
  messages: sdkMessages,
  tools: tools,
});
```

**环境变量**：
- `ANTHROPIC_API_KEY` = MiniMax API Key
- `ANTHROPIC_BASE_URL` = https://api.minimaxi.com/anthropic
- `ANTHROPIC_MODEL` = minimax-m2.5

### 2. Tool 命名前缀

MCP 工具名添加了 `lumin__helper__` 前缀：

```
lumin__helper__bash
lumin__helper__read
lumin__helper__glob
lumin__helper__write
lumin__helper__edit
lumin__helper__grep
```

这是为了避免工具名冲突。mock-server 中有工具名映射逻辑。

### 3. 消息累积逻辑

每次 chat 请求内部循环时，需要累积消息：

```typescript
// 第一次调用
// messages: [user(prompt)]

// LLM 返回 tool_use → 执行工具 → 返回 tool_result
// messages: [user(prompt), assistant(tool_use), user(tool_result)]

// 第二次调用（如果需要）
// messages: [user(prompt), assistant(tool_use), user(tool_result), assistant(tool_use_2), user(tool_result_2)]
```

**注意**：
- 原始 prompt 只需要在第一次发送
- Tool results 会被累积（这是 LLM 推理的必要条件）
- 每次 LLM 调用都需要发送完整的 tools（14KB）

### 4. maxIterations 配置

工具调用循环上限，默认 10000：

```typescript
const maxIterations = 10000;
```

如果 LLM 需要超过这个次数的工具调用，会停止并返回当前结果。

### 5. MCP 工具映射

mock-server 连接两个 MCP 服务器：
- `lumin-helper`: Worker 的 8082 端口（本地工具）
- `playwright`: Worker 的 8083 端口（浏览器自动化）

工具调用通过 `callToolByFullName` 方法，根据工具名前缀路由到对应的 MCP 服务器。

### 6. 与 Claude Agent SDK 的区别

| 特性 | Claude Agent SDK | mock-server |
|------|-----------------|-------------|
| Tools 发送 | 初始化时一次 | 每次请求都发 (14KB) |
| 工具循环 | SDK 内部处理 | 外部循环 (maxIterations) |
| 消息累积 | SDK 自动 | 手动维护 session.messages |
| 上下文窗口 | SDK 管理 | 需要自己处理 |

**关键点**：每次 LLM 调用都需要发送 tools（Anthropic Messages API 设计决定），这是正常的。
