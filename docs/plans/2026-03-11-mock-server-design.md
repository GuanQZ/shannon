# Mock-Server 设计方案

## 1. 背景与目标

### 1.1 背景

Mock-server 用于模拟内网 Agent 平台，使 Lumin 能够在开发/测试环境中模拟内网部署架构运行渗透测试。

### 1.2 目标

- mock-server 替代原来 Claude Agent SDK 的位置和职责
- Lumin 通过 REST API 调用 mock-server
- mock-server 连接 Lumin 的 MCP Server 调用工具
- 最终部署到内网时，Lumin 无需修改即可接入内网 Agent 平台
- **mock-server 定位为适配层**：本身不实现核心 LLM 调用逻辑，而是通过 Claude Agent SDK 调用 Claude Agent Server（可理解为自托管的 Claude），将结果转换为 Lumin 所需的 SSE 格式输出

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         改造后的架构                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Lumin Worker (Activity)                      │   │
│  │                                                                  │   │
│  │  1. 执行 nmap/subfinder/whatweb (直接执行 bash)                 │   │
│  │  2. 读取扫描结果文件                                            │   │
│  │  3. 调用 mock-server (HTTP REST)                                │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                │                                       │
│                                │ HTTP REST (chat 接口)                │
│                                ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       mock-server (适配层)                        │   │
│  │                                                                  │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │   │
│  │  │   REST API      │  │   MCP Client   │  │ Claude Agent  │  │   │
│  │  │                 │  │                │  │    SDK        │  │   │
│  │  │ /init_session   │  │  连接 Lumin    │  │               │  │   │
│  │  │ /chat (SSE)    │  │  MCP Server    │  │ 调用 Claude   │  │   │
│  │  │                 │  │                │  │ Agent Server  │  │   │
│  │  │                 │  │  - 获取工具列表 │  │               │  │   │
│  │  │                 │  │  - 调用工具    │  │               │  │   │
│  │  └─────────────────┘  └─────────────────┘  └────────────────┘  │   │
│  │                                                                  │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                │                                       │
│                                │ MCP 协议                             │
│                                ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │            Lumin MCP Server (两个独立服务)                        │   │
│  │                                                                  │   │
│  │  ┌─────────────────────┐    ┌────────────────────────────────┐  │   │
│  │  │  worker:8082         │    │     worker:8083                │  │   │
│  │  │                      │    │                                │  │   │
│  │  │  工具:               │    │  工具:                         │  │   │
│  │  │  - SDK 封装工具     │    │  - browser_navigate           │  │   │
│  │  │    (Read/Glob/Grep/ │    │  - browser_click               │  │   │
│  │  │     Bash/Edit/Write │    │  - browser_type                │  │   │
│  │  │     /Task Agent)    │    │  - ...                         │  │   │
│  │  │  - save_deliverable │    │                                │  │   │
│  │  │  - generate_totp    │    │                                │  │   │
│  │  └─────────────────────┘    └────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 与原架构对比

| 组件 | 原来 | 改造后 |
|------|------|--------|
| LLM 调用 | Claude Agent SDK | mock-server REST API |
| LLM | Anthropic Claude | Claude Agent Server (通过 Claude Agent SDK 调用) |
| MCP 工具 | 同进程调用 | MCP 协议远程调用 |
| nmap/subfinder/whatweb | Activity 执行 | Activity 执行 (不变) |

> **注意**: mock-server 本身不直接调用 LLM，而是通过 `@anthropic-ai/claude-agent-sdk` 调用 Claude Agent Server。Claude Agent Server 是实际执行 LLM 推理和工具调用的组件。

---

## 3. 接口设计

### 3.1 REST API

#### 3.1.1 init_session - 初始化会话

**请求 URL**:
```
POST /agent-api/{agent-id}/chatabc/init_session
```

> **注意**: URL 路径包含 `{agent-id}` 占位符，如 `tool-agent-1-fa8496f6`

**请求 Headers**:
```
Content-Type: application/json
Cookie: agt_token={jwt_token}
```

| 请求头 | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | 是 | `application/json` |
| `Cookie` | 是 | 包含 JWT 认证令牌 `agt_token` |

**请求 Body**:
```
{
  "appId": "string",
  "trCode": "string",
  "trVersion": "string",
  "timestamp": 1234567890,
  "requestId": "string",
  "data": {
    "prompt_variables": []
  }
}
```

> **说明**: 所有字段均可填充固定值（测试用）。

**字段说明**：
| 字段 | 类型 | 必填 | 说明 | 测试值 |
|------|------|------|------|--------|
| `appId` | string | 是 | 应用 ID | `mock-app-id` |
| `trCode` | string | 是 | 交易代码 | `mock-tr-code` |
| `trVersion` | string | 是 | 交易版本号 | `1` |
| `timestamp` | number | 是 | 时间戳 (毫秒) | `1234567890` |
| `requestId` | string | 是 | 请求唯一 ID (UUID) | `mock-request-id` |
| `data.prompt_variables` | array | 否 | 提示词变量数组 | `[]` |

**响应**:
```json
{
  "resCode": "FAIAG0000",
  "resMessage": "SUCCESS",
  "responseId": "resp_xxx",
  "timestamp": 1234567890,
  "data": {
    "session_id": "session_xxx"
  }
}
```

#### 3.1.2 chat - 发送聊天请求

**请求 URL**:
```
POST /agent-api/{agent-id}/chatabc/chat
```

**请求 Headers**:
```
Content-Type: application/json
Cookie: agt_token={jwt_token}
```

**请求 Body**:
```
{
  "appId": "string",
  "trCode": "string",
  "trVersion": "string",
  "timestamp": 1234567890,
  "requestId": "string",
  "data": {
    "session_id": "session_xxx",
    "txt": "prompt 内容",
    "stream": true,
    "files": []
  }
}
```

> **说明**: 除 `data.txt`、`data.session_id`、`data.stream` 外，其他字段可填充固定值（测试用）。

**字段说明**：
| 字段 | 类型 | 必填 | 说明 | 测试值 |
|------|------|------|------|--------|
| `appId` | string | 是 | 应用 ID | `mock-app-id` |
| `trCode` | string | 是 | 交易代码 | `mock-tr-code` |
| `trVersion` | string | 是 | 交易版本号 | `1` |
| `timestamp` | number | 是 | 时间戳 | `1234567890` |
| `requestId` | string | 是 | 请求唯一 ID | `mock-request-id` |
| `data.session_id` | string | 是 | 从 init_session 获取 | 动态值 |
| `data.txt` | string | 是 | 用户输入（提示词） | **动态值** |
| `data.stream` | boolean | 是 | 流式输出 | `true` |
| `data.files` | array | 否 | 文件列表 | `[]` |

**响应** (SSE 流式):
```
event: chat_started
data: {"chat_id": "abc123"}

event: message
data: {
  "type": "AIMessageChunk",
  "content": "文本回复内容...",
  "metadata": {},
  "tool_calls": []
}

event: message
data: {
  "type": "AIMessageChunk",
  "content": "",
  "metadata": {},
  "tool_calls": [
    {
      "name": "save_deliverable",
      "args": "{\"deliverable_type\": \"CODE_ANALYSIS\", \"content\": \"...\"}",
      "id": "call_xxx",
      "type": "tool_call"
    }
  ]
}

event: message
data: {
  "type": "function",
  "content": "{\"status\": \"success\", \"path\": \"/path/to/file.md\"}",
  "name": "save_deliverable",
  "metadata": {}
}

event: done
data: {"code": "FAIAG0000", "success": true}
```

#### SSE 事件说明

| event | data.type | 说明 | 关键字段 |
|-------|-----------|------|----------|
| chat_started | - | 会话启动 | `chat_id` |
| message | `AIMessageChunk` | AI 消息（`tool_calls` 为空时为普通对话，有内容时为普通对话+工具调用请求） | `content`, `tool_calls` |
| message | `function` | 工具执行结果 | `content`, `name` |
| done | - | 完成 | `code`, `success` |

> **流式处理**: SDK 的 `query()` 函数是流式响应的，即时的工具调用和文本内容会实时返回。mock-server 实时处理这些流式输出，将工具调用请求和工具执行结果都转换为 SSE 格式返回给 Lumin。

#### message 事件详解

**AI 消息（包含工具调用）**:
```json
{
  "content": "文本内容...（包含下一步操作的说明）",
  "additional_kwargs": {},
  "response_metadata": {},
  "type": "AIMessageChunk",
  "name": null,
  "id": "run-xxx",
  "example": false,
  "tool_calls": [
    {
      "name": "save_deliverable",
      "args": {
        "deliverable_type": "CODE_ANALYSIS",
        "content": "..."
      },
      "id": "call_xxx",
      "type": "tool_call"
    }
  ],
  "invalid_tool_calls": [],
  "usage_metadata": null,
  "tool_call_chunks": [
    {
      "index": 0,
      "id": "call_xxx",
      "name": "save_deliverable",
      "type": "tool_call_chunk",
      "args": "{\"deliverable_type\": \"CODE_ANALYSIS\", \"content\": \"...\"}"
    }
  ]
}
```

> **说明**: 字段 `additional_kwargs`、`response_metadata`、`invalid_tool_calls`、`usage_metadata` 固定为空值，`name` 固定为 `null`，`example` 固定为 `false`。

**AI 消息（纯文本）**:
```json
{
  "content": "这是一个文本回复...",
  "additional_kwargs": {},
  "response_metadata": {},
  "type": "AIMessageChunk",
  "name": null,
  "id": "run-xxx",
  "example": false,
  "tool_calls": [],
  "invalid_tool_calls": [],
  "usage_metadata": null,
  "tool_call_chunks": []
}
```

> **说明**: `tool_calls` 中每项的 `type` 为 `"tool_call"`；`tool_call_chunks` 中每项的 `type` 为 `"tool_call_chunk"`。

**工具执行结果**:
```json
{
  "content": "工具执行返回的结果",
  "additional_kwargs": {},
  "response_metadata": {},
  "type": "function",
  "name": "save_deliverable",
  "id": null
}
```

> **说明**: 字段 `additional_kwargs`、`response_metadata` 固定为空对象，`id` 固定为 `null`。

#### 工具调用处理流程

```
1. 收到 chat 请求 (带 session_id + prompt)

2. 通过 Claude Agent SDK 调用 Claude Agent Server
   → SDK 内部配置了 MCP Servers (lumin-helper, playwright)

3. Claude Agent Server 返回响应
   → 如果需要调用工具，SDK 自动通过 MCP 执行工具
   → SDK 自动收集工具结果并继续推理

4. 循环继续直到 SDK 返回最终结果（SDK 内部处理循环）

5. mock-server 将结果转换为 SSE 格式返回给 Lumin
   → code: "FAIAG0000", success: true
```

> **重要**: 工具调用循环完全由 Claude Agent SDK 内部处理（通过 `maxTurns` 配置），mock-server 只负责：
> - 将 MCP 服务器配置传递给 SDK
> - 接收 SDK 返回的流式消息
> - 将消息转换为 SSE 格式实时转发给 Lumin
>
> **SDK 消息类型**: `query()` 返回以下流式消息：
> | 类型 | 说明 |
> |------|------|
> | `assistant` | AI 文本消息 |
> | `tool_use` | 工具调用请求（独立消息，非 assistant 的 content block） |
> | `tool_result` | 工具执行结果 |
> | `result` | 最终结果 |
> | `system` | 系统消息 |
>
> **SSE 转换**: (assistant + tool_use) → message(AIMessageChunk, 一轮完整交互), tool_result → message(function)

### 3.2 MCP Client 配置

> **重要**: 保持与原架构一致，连接两个独立的 MCP Server。

#### 3.2.1 MCP 服务器配置

> **注意**: 当前架构中，MCP Server (lumin-tool-mcp) 和 Playwright MCP 都已合并到 worker 服务中，通过 `worker:8082/sse` 和 `worker:8083/sse` 访问。

```typescript
// mock-server 连接 MCP Server (已合并到 worker 服务)
const mcpServers = {
  // MCP Server 1: lumin-tool-mcp (已合并到 worker)
  'lumin-helper': {
    type: 'sse',
    url: 'http://worker:8082/sse',
  },

  // MCP Server 2: playwright-mcp (已合并到 worker)
  'playwright-agent1': {
    type: 'sse',
    url: 'http://worker:8083/sse',
  },
};
```

#### 3.2.2 工具列表 (封装 SDK 工具层)

> **重要**: 当前架构中，MCP Server 和 Playwright MCP 已合并到 worker 服务中。

**MCP Server (lumin-tool-mcp, 端口 8082)**

该服务包含两类工具：

1. **SDK 封装工具** (从 Claude Agent SDK 提取)
   - 封装 SDK 内置工具为 MCP 工具
   - 自动获取工具列表，不遗漏任何工具
   - 包含: `Read`, `Glob`, `Grep`, `Bash`, `Edit`, `Write`, `Task` (Agent) 等
   - **实现方式**: 在 lumin-tool-mcp 中实现这些工具的 MCP 版本，调用本地文件系统

2. **Lumin 专用工具** (原有功能)
   - `save_deliverable`: 保存交付物到 deliverables/ 目录
   - `generate_totp`: 生成 TOTP 验证码

**Playwright MCP (端口 8083)**

- Playwright 浏览器自动化工具
- 包含: `browser_navigate`, `browser_click`, `browser_type` 等
- 复用 @playwright/mcp 官方工具

#### 3.2.3 MCP 服务合并说明

> **注意**: 当前架构中，MCP Server (lumin-tool-mcp) 和 Playwright MCP 已合并到 worker 服务中，不再是独立服务。

worker 服务启动时同时运行：
- `lumin-tool-mcp` (端口 8082) - SDK 工具 + Lumin 专用工具
- `playwright-mcp` (端口 8083) - 浏览器自动化工具
- `temporal-worker` - 工作流执行

#### 3.2.4 路径传递方案 (方案 2)

通过环境变量传递每次任务的仓库路径，保持与原架构一致：

```typescript
// lumin-tool-mcp/src/http-server.ts (原有实现)
const targetRepo = process.env.LUMIN_TARGET_REPO || 'default';
const targetDir = `/app/deliverables/${targetRepo}`;

// playwright-mcp 也读取相同环境变量
// 截图保存到: /app/deliverables/${LUMIN_TARGET_REPO}/screenshots/
```

**执行流程**:
1. Lumin 启动任务时设置环境变量 `LUMIN_TARGET_REPO=lumin-target`
2. worker 服务中的 lumin-tool-mcp 和 playwright-mcp 读取该环境变量
3. 工具调用时使用正确的目录路径

---

## 4. 数据流设计

### 4.1 Pre-Recon 阶段完整流程

```
1. Lumin Activity
   │
   ├── 执行 nmap -sV -sC target
   ├── 执行 subfinder -d domain
   ├── 执行 whatweb target
   │
   └── 扫描结果写入文件

2. Lumin Activity 读取扫描结果
   │
   └── 组装 prompt (包含扫描结果)

3. Lumin 调用 mock-server
   │
   ├── POST /chatabc/init_session
   │   └── 获取 session_id
   │
   └── POST /chatabc/chat (SSE 流)
       └── 发送 prompt

4. mock-server 处理
   │
   ├── 通过 Claude Agent SDK 调用 Claude Agent Server
   │   └── SDK 内部配置了 MCP Servers (lumin-helper, playwright)
   │
   ├── Claude Agent Server 返回响应
   │   └── SDK 自动通过 MCP 执行工具（如果有）
   │   └── SDK 自动收集工具结果并继续推理
   │
   └── SDK 内部循环直到返回最终结果
       └── SSE 返回最终结果给 Lumin

5. Lumin 接收结果
   │
   └── 继续后续流程
```

> **注意**: 工具调用循环完全由 Claude Agent SDK 内部处理（通过 `maxTurns` 配置），mock-server 不参与工具执行。

### 4.2 数据格式

#### Prompt 传递方式

扫描结果**嵌入在 prompt 文本中**，不是通过文件上传:

```
prompt = `
# Pre-Reconnaissance

## Port Discovery
[扫描结果...]

## Network Scanning
[扫描结果...]

## Subdomain Discovery
[扫描结果...]

## Technology Detection
[扫描结果...]

## Code Analysis
[代码分析结果...]

[任务指令...]
`
```

#### 工具调用流程

```
LLM (Claude Agent Server): "我需要保存分析报告"
SDK: 自动通过 MCP 调用 Lumin MCP Server
Lumin MCP Server: 执行 save_deliverable
Lumin MCP Server: 返回结果
SDK: 接收结果，继续调用 LLM
LLM: "报告已保存，这是完整分析..."

（整个循环由 SDK 内部处理，mock-server 只负责格式适配）
```

---

## 5. 组件设计

### 5.1 mock-server 组件

> **注意**: mock-server 本质是一个适配层，核心 LLM 调用逻辑由 Claude Agent SDK 完成。

```
mock-server/
├── src/
│   ├── index.ts              # Express 服务器，REST API (init_session, chat)
│   ├── config.ts             # 配置 (ANTHROPIC_*, MCP URLs)
│   ├── llm-client.ts         # Claude Agent SDK 客户端
│   ├── mcp-client.ts        # MCP Client (连接 Lumin MCP Server)
│   └── types.ts              # 类型定义
├── .env                      # 环境变量配置
├── Dockerfile                # Docker 镜像构建
├── docker-compose.yml        # Docker Compose 配置
├── package.json
└── tsconfig.json
```

### 5.2 各组件职责

| 组件 | 职责 |
|------|------|
| index.ts | Express 服务器，提供 REST API 端点；格式适配层，将 SDK 返回结果转换为 SSE 格式 |
| config.ts | 加载环境变量配置 |
| llm-client.ts | 通过 Claude Agent SDK 调用 Claude Agent Server；SDK 内部处理工具调用循环 |
| mcp-client.ts | MCP 连接（备用，当前主要由 SDK 内部处理） |
| types.ts | 请求/响应类型定义 |

> **mock-server 核心逻辑**: `index.ts` 中的 chat 接口接收 prompt → 调用 `llm-client` 通过 Claude Agent SDK 获取响应（SDK 内部自动处理工具调用循环） → 将结果转换为 SSE 格式返回给 Lumin。
>
> **定位**: mock-server 是格式适配层，本身不实现核心 LLM 调用逻辑或工具执行循环，所有这些由 Claude Agent SDK 内部完成。

### 5.3 SDK 工具封装实现

> **核心设计**: lumin-tool-mcp 不枚举 SDK 工具，而是实现与 SDK 内置工具等效的 MCP 工具。

**实现方案**:

```typescript
// lumin-tool-mcp/src/tools/sdk-tools.ts
// 实现 SDK 内置工具的 MCP 版本

// Read 工具 - 读取文件内容
const readTool = {
  name: 'Read',
  description: 'Read a file from the repository...',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to file relative to repo root' }
    },
    required: ['file_path']
  },
  handler: async ({ file_path }) => {
    const fullPath = path.join(process.cwd(), file_path);
    return await fs.promises.readFile(fullPath, 'utf-8');
  }
};

// Glob 工具 - 查找匹配文件
const globTool = {
  name: 'Glob',
  description: 'Find files matching a pattern...',
  inputSchema: { ... },
  handler: async ({ pattern }) => {
    return await glob(pattern, { cwd: process.cwd() });
  }
};

// Grep 工具 - 搜索文件内容
const grepTool = {
  name: 'Grep',
  description: 'Search for patterns in files...',
  inputSchema: { ... },
  handler: async ({ pattern, path }) => {
    // 使用 ripgrep 实现
    return await grep(pattern, { cwd: process.cwd(), path });
  }
};

// Bash 工具 - 执行命令
const bashTool = {
  name: 'Bash',
  description: 'Run a shell command...',
  inputSchema: { ... },
  handler: async ({ command }) => {
    return await $`${command}`.stdout;
  }
};

// Write/Edit 工具 - 写/编辑文件
// Task Agent 工具 - 嵌套 Agent 调用
```

**工具注册流程**:
1. lumin-tool-mcp (worker:8082) 启动时，注册所有 SDK 封装工具
2. mock-server 通过 MCP 连接到 lumin-tool-mcp (worker:8082)
3. mock-server 调用 `tools/list` 获取完整工具列表
4. 将工具列表传递给 Claude Agent Server（通过 Claude Agent SDK）

---

## 6. Docker 部署

### 6.1 docker-compose.yml

```yaml
services:
  # Worker 服务已合并 MCP Server 和 Playwright MCP
  worker:
    image: lumin-worker:latest
    # ... 其他配置
    # 内部启动: lumin-tool-mcp (8082) + playwright-mcp (8083) + temporal-worker

  # mock-server: LLM 代理 + MCP Client
  mock-server:
    build: ./mock-server
    ports:
      - "3000:3000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}
      - ANTHROPIC_MODEL=${ANTHROPIC_MODEL}
      - LUMIN_MCP_SERVER_URL=http://worker:8082/sse
      - PLAYWRIGHT_MCP_SERVER_URL=http://worker:8083/sse
    depends_on:
      - worker
```

---

## 7. 配置项

### 7.1 环境变量

#### mock-server 环境变量

| 变量名 | 描述 | 必填 | 默认值 |
|--------|------|------|--------|
| ANTHROPIC_API_KEY | Claude Agent Server API 密钥 | 是 | - |
| ANTHROPIC_BASE_URL | Claude Agent Server API 地址 | 是 | `https://api.minimaxi.com/anthropic` |
| ANTHROPIC_MODEL | 使用的模型 | 是 | `minimax-m2.5` |
| LUMIN_MCP_SERVER_URL | Lumin MCP Server (worker:8082) 端点 | 是 | `http://worker:8082/sse` |
| PLAYWRIGHT_MCP_SERVER_URL | Playwright MCP Server (worker:8083) 端点 | 是 | `http://worker:8083/sse` |

#### MCP Server 环境变量

| 变量名 | 描述 | 必填 | 适用服务 |
|--------|------|------|----------|
| LUMIN_TARGET_REPO | 目标仓库名称，用于构建 deliverables 路径 | 是 | worker (lumin-tool-mcp, playwright-mcp) |

### 7.2 认证配置

#### 请求头认证

| 请求头 | 值 | 说明 |
|--------|-----|------|
| `Content-Type` | `application/json` | JSON 格式 |
| `Cookie` | `agt_token={jwt_token}` | JWT 认证令牌 |

#### JWT Token 配置

> **注意**: JWT token 可以是固定值（用于测试/开发），mock-server 接收请求时不强制验证。

```typescript
// mock-server/src/auth.ts
interface AuthConfig {
  agentId: string;        // Agent ID，如 "tool-agent-1-fa8496f6"
  jwtToken: string;       // JWT 认证令牌（可以是固定值）
}

// 从环境变量或配置文件加载
const authConfig: AuthConfig = {
  agentId: process.env.AGENT_ID || 'tool-agent-1-default',
  jwtToken: process.env.AGENT_TOKEN || 'mock-token-for-testing',
};
```

**固定值示例**:
```yaml
# config.yaml
internal_agent:
  agent_id: "tool-agent-1-fa8496f6"
  agent_token: "mock-jwt-token"  # 固定值，用于测试
```

#### API 请求封装

```typescript
// 发起请求时自动添加认证头
async function callAPI(endpoint: string, body: object) {
  return fetch(`/agent-api/${authConfig.agentId}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `agt_token=${authConfig.jwtToken}`,
    },
    body: JSON.stringify(body),
  });
}
```

#### 配置文件示例

```yaml
# config.yaml
internal_agent:
  agent_id: "tool-agent-1-fa8496f6"
  agent_token: "eyJhbGciOiJIUzI1NiJ9..."
  base_url: "http://mock-server:3000"
```

---

## 8. 实施步骤

### Phase 1: 基础架构

1. 创建 mock-server 项目结构
2. 实现 REST API (init_session, chat)
3. 实现 Claude Agent SDK 客户端

### Phase 2: MCP 集成

4. 实现 MCP Client (连接 Lumin MCP Server)
5. 实现工具列表自动获取
6. 实现工具调用执行

### Phase 3: SSE 流式处理

7. 实现 LLM 调用和工具调用协调
8. 实现 SSE 流式输出

### Phase 4: 测试与调优

9. 端到端测试
10. 性能调优

---

## 9. 风险与注意事项

1. **MCP 工具调用延迟**: 通过 MCP 协议调用工具有网络延迟，需考虑超时处理
2. **工具列表同步**: 启动时获取工具列表，需确保 Lumin MCP Server 已启动
3. **会话管理**: 单会话支持，与原架构一致（每个 Agent 一次性调用，无多轮会话）
