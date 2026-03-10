# Lumin 内网部署实现方案

> 更新时间：2026-03-10
> 状态：进行中

---

## 一、目标

将 Lumin 改造为支持内网部署，不再依赖 Claude SDK，通过以下方式实现：
1. Lumin 暴露 MCP SSE 服务器供内网 Agent 调用工具
2. Lumin 直接调用内网 Agent 的 HTTP API（模拟服务）

---

## 二、架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Lumin                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Temporal Workflow (不变)                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  InternalAgentAdapter (新增)                        │   │
│  │  - 直接调用 /chat 接口                              │   │
│  │  - 处理 SSE 流式响应                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   Mock Server         │
              │  (模拟内网 Agent)      │
              │  - 调用真实 LLM       │
              │  - MCP 工具调用       │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │    大模型              │
              │  (Anthropic API)      │
              └───────────────────────┘
```

---

## 三、实现内容

### 3.1 MCP SSE 服务器

**位置**：`mcp-server/src/http-server.ts`

**功能**：
- 使用 `@modelcontextprotocol/sdk` 创建独立 HTTP SSE 服务器
- 端口：8080
- 端点：`/mcp` (SSE)

**工具列表**：

| 工具 | 用途 | 实现方式 |
|------|------|---------|
| `save_deliverable` | 保存交付物 | 复用现有 `mcp-server/src/tools/save-deliverable.ts` |
| `generate_totp` | 生成 TOTP | 复用现有 `mcp-server/src/tools/generate-totp.ts` |
| `browser_*` | 浏览器自动化 | 通过 `mcp-proxy` 转发 Playwright MCP |

**targetDir 传递**：
- 通过环境变量 `LUMIN_TARGET_REPO` 指定
- MCP 服务器读取环境变量构建目标目录

### 3.2 模拟内网 Agent 服务（改造）

**位置**：`.claude/worktrees/lumin-internal-agent-mock/mock-server/`

**改造内容**：

| 功能 | 实现 |
|------|------|
| LLM 调用 | 使用 `@anthropic-ai/sdk` 调用真实 API |
| 工具调用 | 通过 MCP 协议调用工具 |
| SSE 响应 | 保持现有格式 (`chat_started`, `chunk`, `message`, `done`) |

**环境变量**：
```bash
ANTHROPIC_API_KEY=sk-...
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
```

### 3.3 Lumin 调用适配层

**位置**：`src/ai/providers/internal-agent.ts`

**接口设计**：

```typescript
export interface InternalAgentConfig {
  baseUrl: string;        // 内网 Agent 地址
  apiKey?: string;        // 认证密钥
}

export class InternalAgentProvider {
  /**
   * 发送消息，获取流式响应
   */
  async chat(prompt: string, sessionId?: string): Promise<string> {
    // 1. 可选：创建会话
    // 2. 发送消息到 /chat
    // 3. 解析 SSE 响应
    // 4. 返回最终结果
  }
}
```

**集成方式**：
- 替换 `src/ai/claude-executor.ts` 中的 SDK 调用
- 或者新增入口，根据配置选择使用

---

## 四、实施步骤

### 步骤 1：改造模拟服务（真实 LLM 调用）

| 任务 | 文件 |
|------|------|
| 添加 Anthropic SDK 调用 | `mock-server/src/llm-client.ts` (新增) |
| 实现工具调用循环 | `mock-server/src/sse-controller.ts` |
| 添加环境变量读取 | `mock-server/src/index.ts` |

### 步骤 2：实现 MCP SSE 服务器

| 任务 | 文件 |
|------|------|
| 创建 HTTP SSE 服务器 | `mcp-server/src/http-server.ts` (新增) |
| 复用现有工具 | `mcp-server/src/tools/*` |
| 添加环境变量读取 | 读取 `LUMIN_TARGET_REPO` |

### 步骤 3：实现 Lumin 适配层

| 任务 | 文件 |
|------|------|
| 创建适配器 | `src/ai/providers/internal-agent.ts` (新增) |
| 集成到执行器 | `src/ai/claude-executor.ts` |

### 步骤 4：测试验证

| 测试项 | 验证方式 |
|--------|---------|
| MCP 工具调用 | 配置模拟服务 MCP，测试工具调用 |
| LLM 响应 | 发送 prompt，验证 LLM 回复 |
| 端到端流程 | 完整渗透测试流程 |

---

## 五、文件改动清单

| 文件 | 改动 |
|------|------|
| `mock-server/src/llm-client.ts` | 新增 - LLM 调用 |
| `mock-server/src/sse-controller.ts` | 改造 - 工具调用循环 |
| `mock-server/src/index.ts` | 改造 - 环境变量 |
| `mcp-server/src/http-server.ts` | 新增 - MCP SSE 服务器 |
| `src/ai/providers/internal-agent.ts` | 新增 - Lumin 适配层 |
| `src/ai/claude-executor.ts` | 改造 - 调用适配层 |

---

## 六、Prompt 不需要修改

原因：
- 工具描述通过 MCP 的 `tool/list` 端点自动获取
- LLM 会从 MCP 服务器响应中获取工具定义
- Prompt 中的工具说明是备用方案，当前不需要

---

## 七、测试目标

1. **模拟服务** → 连接真实 LLM，能响应消息
2. **MCP 服务器** → 能被模拟服务调用，执行工具
3. **Lumin 适配层** → 能调用模拟服务，获取结果
4. **端到端** → 完整渗透测试流程

---

## 八、注意事项

- 同一时间只运行一个渗透任务（依赖 `LUMIN_TARGET_REPO` 环境变量）
- 模拟服务需要暴露到可访问的地址
- MCP 服务器需要实现 `tool/list` 端点
