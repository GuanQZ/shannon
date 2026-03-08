# Shannon 内网部署方案设计文档

> 更新时间：2026-03-06
> 版本：v3.0

## 一、项目现状分析

### 1.1 当前架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Shannon 项目                                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Temporal 工作流编排                             │  │
│  │   pre-recon → recon → vuln(5并行) → exploit(5并行) → report   │  │
│  └────────────────────────────┬────────────────────────────────────┘  │
│                               │                                         │
│                               ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Activity 层                                   │  │
│  │   runAgentActivity() → runClaudePromptWithRetry()              │  │
│  └────────────────────────────┬────────────────────────────────────┘  │
│                               │                                         │
│                               ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │               Claude SDK 执行器 (claude-executor.ts)            │  │
│  │   query() → 流式输出 → 工具调用 → 结果返回                     │  │
│  └────────────────────────────┬────────────────────────────────────┘  │
│                               │                                         │
│                               ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                       MCP 工具层                                 │  │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │  │
│  │   │ save_deliver │  │ generate     │  │   Playwright        │ │  │
│  │   │ able         │  │ totp         │  │   (浏览器自动化)     │ │  │
│  │   └──────────────┘  └──────────────┘  └──────────────────────┘ │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Prompt 模板层                                 │  │
│  │   vuln-xss.txt, exploit-auth.txt, report-executive.txt 等      │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                            Claude AI 模型
                         (外部 API 调用)
```

### 1.2 核心组件说明

| 组件 | 文件 | 职责 |
|------|------|------|
| 工作流编排 | `src/temporal/workflows.ts` | 定义 5 阶段执行流程、并行逻辑、重试策略 |
| Agent 定义 | `src/session-manager.ts` | 定义 13 个 Agent 角色及依赖关系 |
| Activity | `src/temporal/activities.ts` | 调用执行器、审计日志、结果校验 |
| 执行器 | `src/ai/claude-executor.ts` | SDK 调用、流式处理、工具调用分发 |
| MCP 工具 | `mcp-server/src/` | 文件操作、TOTP 生成、浏览器自动化 |
| Prompt | `prompts/*.txt` | 各阶段提示词（含工具说明、交付物格式） |

### 1.3 关键依赖

1. **AI 模型调用**：通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数
2. **工具能力**：MCP 协议（Playwright 浏览器、文件读写、TOTP）
3. **工作流**：Temporal（支持持久化、重试、查询）

---

## 二、内网环境限制

### 2.1 核心限制

- ❌ 不直接暴露 AI 模型 API
- ✅ 支持通过内网 Agent 平台的 5 个 HTTP 接口调用大模型
- ✅ 支持配置 HTTP MCP 工具（❓ 待确认：大模型直接请求 MCP 还是 Agent 转发）

### 2.2 可用接口

内网 Agent 平台提供的 5 个 HTTP 接口：

| 接口 | 方法 | 用途 |
|------|------|------|
| `chatabc/init_session` | POST | 创建会话 |
| `chatabc/upload_file` | POST | 上传文件（如源码） |
| `chatabc/download_file` | POST | 下载文件（如报告） |
| `chatabc/chat` | POST | 流式对话（核心 AI 调用） |
| `chatabc/fetch_history` | POST | 查询历史对话（轮询状态） |

### 2.3 工具能力

- 内网 Agent 支持配置 **HTTP MCP** 工具
- 大模型可以直接发起 HTTP 请求到配置的 MCP 地址
- 支持自定义 HTTP 请求格式

---

## 三、方案概述

### 3.1 设计原则

1. **保持 Shannon 原有设计不变** — Temporal 调度、13 个 Agent 定义、MCP 工具、审计日志全部保留
2. **只替换 AI 调用层** — 将 Claude SDK 调用替换为内网 Agent HTTP 接口调用
3. **内网 Agent 纯转发** — 不在内网 Agent 上做任何业务逻辑，只转发 prompt 和工具调用

### 3.2 最终架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Shannon 项目（你运行）                           │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Temporal 工作流编排                            │    │
│  │   pre-recon → recon → vuln(5并行) → exploit(5并行) → report  │    │
│  └────────────────────────────┬────────────────────────────────────┘    │
│                               │                                          │
│                               ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Activity 层                                   │    │
│  │   runAgentActivity() → InternalAgentAdapter                   │    │
│  └────────────────────────────┬────────────────────────────────────┘    │
│                               │                                          │
│                               ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              Internal Agent Adapter (新增)                      │    │
│  │   init_session → upload_file → chat → fetch_history → down   │    │
│  └────────────────────────────┬────────────────────────────────────┘    │
│                               │                                          │
│                               ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              HTTP API 桥接层 (新增)                              │    │
│  │   /api/tools/browser, /api/tools/file_*, /api/tools/save_*     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
           ┌──────────┐     ┌──────────┐     ┌──────────┐
           │ chat()   │     │ fetch_   │     │  MCP     │
           │          │     │ history()│     │  HTTP    │
           └──────────┘     └──────────┘     └──────────┘
                  │               │               │
                  └───────────────┼───────────────┘
                                  │
                          内网 Agent 平台
                        (纯转发，无业务逻辑)
                                  │
                                  ▼
                          ┌──────────────┐
                          │   大模型      │
                          └──────────────┘
```

### 3.3 核心交互流程

```
Shannon Activity
    │
    ├─ 1. init_session() → session_id
    │
    ├─ 2. upload_file(源码 + 前序交付物)
    │
    ├─ 3. chat(session_id, prompt_with_tools_description)
    │       ↓
    │   内网 Agent → 大模型
    │       ↓
    │   大模型需要工具 → HTTP 请求到 Shannon HTTP Bridge
    │       ↓
    │   Shannon 执行工具 → 返回结果
    │       ↓
    │   大模型收到结果 → 继续处理 → 返回
    │
    ├─ 4. 轮询 fetch_history(session_id) 直到完成
    │
    ├─ 5. download_file(交付物文件)
    │
    └─ 6. 解析结果，继续工作流
```

### 3.4 优势

- ✅ 保留 Temporal 复杂流程编排能力
- ✅ 复用 Shannon 所有 Agent 定义和验证器
- ✅ 复用 Prompt 模板（仅需微调工具说明部分）
- ✅ 复用审计日志系统
- ✅ 内网 Agent 完全透明，只做纯转发

---

## 四、详细设计

### 4.1 Agent 会话管理

#### 4.1.1 设计原则

每个 Agent 执行时创建独立 session，执行完成后结束：

```
工作流 1: shannon-juice-123
├─ Agent(pre-recon): init_session → session_abc123 → chat → download → end
├─ Agent(recon):     init_session → session_def456 → chat → download → end
├─ Agent(vuln-xss): init_session → session_ghi789 → chat → download → end
└─ ...

工作流 2: shannon-bwapp-124 (完全独立)
├─ Agent(pre-recon): init_session → session_xyz111 → chat → download → end
└─ ...
```

#### 4.1.2 session 管理接口

```typescript
// src/ai/providers/internal-agent.ts

export interface InternalAgentConfig {
  baseUrl: string;        // 内网 Agent 平台地址
  apiKey?: string;        // 认证密钥
}

export class InternalAgentProvider implements AIProvider {
  private config: InternalAgentConfig;
  private sessionId: string | null = null;

  /**
   * 调用 chatabc/init_session 创建会话
   */
  async initSession(): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/chatabc/init_session`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    const data = await response.json();
    this.sessionId = data.session_id;
    return this.sessionId;
  }

  /**
   * 调用 chatabc/upload_file 上传文件
   */
  async uploadFile(filename: string, content: string): Promise<void> {
    const formData = new FormData();
    formData.append('file', new Blob([content]), filename);
    formData.append('session_id', this.sessionId!);

    await fetch(`${this.config.baseUrl}/chatabc/upload_file`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * 调用 chatabc/chat 发送消息
   */
  async chat(message: string): Promise<string> {
    const response = await fetch(
      `${this.config.baseUrl}/chatabc/chat`,
      {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: this.sessionId,
          message: message,
        }),
      }
    );
    return response.text();
  }

  /**
   * 调用 chatabc/fetch_history 轮询结果
   */
  async fetchHistory(): Promise<ChatHistoryResult> {
    const response = await fetch(
      `${this.config.baseUrl}/chatabc/fetch_history`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ session_id: this.sessionId }),
      }
    );
    return response.json();
  }

  /**
   * 调用 chatabc/download_file 下载文件
   */
  async downloadFile(filename: string): Promise<string> {
    const response = await fetch(
      `${this.config.baseUrl}/chatabc/download_file?session_id=${this.sessionId}&filename=${filename}`
    );
    return response.text();
  }

  /**
   * 结束会话
   */
  async endSession(): Promise<void> {
    this.sessionId = null;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}
```

### 4.2 HTTP API 桥接层

Shannon 需要暴露 HTTP 接口，供大模型通过内网 Agent 调用：

```typescript
// src/http-bridge/server.ts

import express from 'express';
import { createShannonHelperServer } from '../mcp-server/dist/index.js';
import { chromium } from 'playwright';

const app = express();
app.use(express.json());

// 为每个工作流创建独立的 MCP 服务实例
function createMcpServer(targetDir: string) {
  return createShannonHelperServer(targetDir);
}

// ========== 工具接口 ==========

// 浏览器工具
app.post('/api/tools/browser', async (req, res) => {
  const { action, params } = req.body;

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    let result;
    switch (action) {
      case 'visit':
        await page.goto(params.url);
        result = { url: page.url(), title: await page.title() };
        break;
      case 'screenshot':
        await page.goto(params.url);
        const screenshot = await page.screenshot();
        result = { screenshot: screenshot.toString('base64') };
        break;
      // 其他操作...
    }

    await browser.close();
    res.json({ status: 'success', result });
  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
});

// 文件读取
app.get('/api/tools/file_read', async (req, res) => {
  const { path } = req.query;
  try {
    const content = await fs.readFile(path as string, 'utf-8');
    res.json({ status: 'success', content });
  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
});

// 文件写入
app.post('/api/tools/file_write', async (req, res) => {
  const { path, content } = req.body;
  try {
    await fs.writeFile(path, content);
    res.json({ status: 'success' });
  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
});

// 保存交付物
app.post('/api/tools/save_deliverable', async (req, res) => {
  const { deliverable_type, content, file_path, target_dir } = req.body;

  try {
    const mcpServer = createMcpServer(target_dir);
    const result = await mcpServer.tools.save_deliverable({
      deliverable_type,
      content,
      file_path,
    });
    res.json(result);
  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
});

// TOTP 生成
app.post('/api/tools/generate_totp', async (req, res) => {
  const { secret } = req.body;

  try {
    const mcpServer = createMcpServer(process.cwd());
    const result = await mcpServer.tools.generate_totp({ secret });
    res.json(result);
  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
});

app.listen(8080, () => {
  console.log('Shannon HTTP Bridge listening on port 8080');
});
```

### 4.3 Prompt 工具说明修改

将 `prompts/` 中的工具说明从 MCP 格式改为 HTTP 调用格式：

```markdown
## 可用工具

### 浏览器工具
- 名称: browser
- 用途: 访问网页、点击元素、截图
- 调用方式: HTTP POST
- 参数:
  ```json
  {
    "action": "visit",
    "params": {"url": "https://target.com"}
  }
  ```

### 文件读取
- 名称: file_read
- 调用: HTTP GET /api/tools/file_read?path=/path/to/file

### 文件写入
- 名称: file_write
- 调用: HTTP POST /api/tools/file_write
- Body: {"path": "/path/to/file", "content": "..."}

### 保存交付物
- 名称: save_deliverable
- 调用: HTTP POST /api/tools/save_deliverable
- Body:
  ```json
  {
    "target_dir": "/path/to/repo",
    "deliverable_type": "XSS_ANALYSIS",
    "content": "...",
    "file_path": "deliverables/xss_analysis.md"
  }
  ```
- deliverable_type 可选值: CODE_ANALYSIS, RECON, XSS_ANALYSIS, XSS_QUEUE, INJECTION_ANALYSIS, INJECTION_QUEUE, AUTH_ANALYSIS, AUTH_QUEUE, SSRF_ANALYSIS, SSRF_QUEUE, AUTHZ_ANALYSIS, AUTHZ_QUEUE, EXPLOITATION_EVIDENCE, EXECUTIVE_REPORT

### TOTP 生成
- 名称: generate_totp
- 调用: HTTP POST /api/tools/generate_totp
- Body: {"secret": "JBSWY3DPEHPK3PXP"}
```

### 4.4 内网 Agent 配置

内网 Agent 平台只需要配置 **一个** HTTP MCP 服务：

```json
{
  "mcp_servers": {
    "shannon-tools": {
      "type": "http",
      "url": "http://<shannon-ip>:8080",
      "methods": {
        "browser": {
          "url": "http://<shannon-ip>:8080/api/tools/browser",
          "method": "POST"
        },
        "file_read": {
          "url": "http://<shannon-ip>:8080/api/tools/file_read",
          "method": "GET"
        },
        "file_write": {
          "url": "http://<shannon-ip>:8080/api/tools/file_write",
          "method": "POST"
        },
        "save_deliverable": {
          "url": "http://<shannon-ip>:8080/api/tools/save_deliverable",
          "method": "POST"
        },
        "generate_totp": {
          "url": "http://<shannon-ip>:8080/api/tools/generate_totp",
          "method": "POST"
        }
      }
    }
  }
}
```

---

## 五、并发场景

### 5.1 多任务并行

不同目标仓库的任务完全隔离：

```
工作流 1: shannon-juice-123 → repos/juice-shop/
工作流 2: shannon-bwapp-124  → repos/bwapp/
```

| 隔离层级 | 机制 |
|---------|------|
| Workflow ID | 每个任务唯一 |
| Repo 目录 | 每个任务操作不同仓库 |
| Session | 每个 Agent 调用独立 session |

### 5.2 同一仓库多任务

如果两个任务指向同一个仓库，需要确保 workflowId 不同，避免文件冲突。

---

## 六、实施计划

### 6.1 阶段一：Shannon 端改造

| 序号 | 任务 | 文件 |
|------|------|------|
| 1 | 创建 AI Provider 接口定义 | `src/ai/providers/index.ts` |
| 2 | 实现 InternalAgentProvider | `src/ai/providers/internal-agent.ts` |
| 3 | 创建 HTTP API 桥接服务 | `src/http-bridge/server.ts` |
| 4 | 改造 claude-executor.ts 支持 Provider 切换 | `src/ai/claude-executor.ts` |
| 5 | 添加内网配置项 | `src/config-parser.ts` |
| 6 | 微调 Prompt 工具说明 | `prompts/*.txt` |

### 6.2 阶段二：内网平台配置

| 序号 | 任务 | 说明 |
|------|------|------|
| 1 | 配置 HTTP MCP | 指向 Shannon HTTP Bridge |
| 2 | 测试连通性 | 验证大模型能调用 MCP |

### 6.3 阶段三：测试验证

| 序号 | 任务 |
|------|------|
| 1 | 单元测试 Provider 接口 |
| 2 | HTTP API 桥接测试 |
| 3 | 端到端渗透测试 |
| 4 | 验证交付物生成 |

---

## 七、文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/ai/providers/index.ts` | 新增 | AIProvider 接口定义 |
| `src/ai/providers/internal-agent.ts` | 新增 | 内网 Agent 适配器（调用 5 个 HTTP 接口） |
| `src/http-bridge/server.ts` | 新增 | HTTP API 服务（暴露工具能力） |
| `src/ai/claude-executor.ts` | 改造 | 添加 Provider 切换逻辑 |
| `src/temporal/activities.ts` | 改造 | 适配新的执行器接口 |
| `src/config-parser.ts` | 改造 | 添加内网 Agent 配置项 |
| `prompts/*.txt` | 改造 | 修改工具说明为 HTTP 调用格式 |

---

## 八、网络拓扑

### 8.1 部署要求

| 组件 | 网络要求 | 说明 |
|------|---------|------|
| Shannon 服务 | 需要被内网访问 | HTTP Bridge 需要暴露端口给内网 Agent |
| Temporal UI | 可选 | http://localhost:8233 本地访问 |

### 8.2 端口规划

| 端口 | 服务 | 说明 |
|------|------|------|
| 7233 | Temporal | 工作流编排 |
| 8080 | HTTP Bridge | 工具 API（供大模型调用） |

---

## 九、风险与注意事项

### 9.1 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 网络连通性 | 高 | 确保内网 Agent 能访问 Shannon HTTP Bridge |
| HTTP MCP 格式 | 中 | 待确认：1. 大模型是直接请求 MCP 还是 Agent 转发；2. 请求格式是 JSON-RPC 还是自定义 JSON |
| 轮询超时 | 中 | 设置合理的 fetch_history 轮询间隔和超时 |
| 并发冲突 | 中 | 确保不同任务使用不同 workflowId |

### 9.2 注意事项

1. **网络拓扑**：内网 Agent 所在机器需要能访问 Shannon 的 8080 端口
2. **认证机制**：HTTP API 需要适当的认证机制（如 API Key）
3. **target_dir 传递**：工具调用需要传递 target_dir 参数，指定目标仓库
4. **日志追踪**：保留审计日志便于问题排查
5. **优雅降级**：支持在两种模式间切换（本地 SDK / 内网 Agent）

---

## 十、总结

本方案通过以下方式实现内网部署：

1. **保留流程管理**：Temporal 工作流完全复用（复杂流程不适合在内网平台手绘）
2. **AI 调用改造**：调用内网 Agent 平台的 5 个 HTTP 接口
3. **工具能力**：大模型通过 HTTP MCP 调用 Shannon 暴露的工具 API
4. **内网 Agent 纯转发**：不修改任何业务逻辑，只做消息转发

**关键接口映射**：

| Shannon 原有能力 | 内网部署后的实现 |
|-----------------|-----------------|
| Claude SDK query() | chat() + fetch_history() 轮询 |
| MCP 工具调用 | HTTP MCP 指向 Shannon HTTP Bridge API |
| Temporal 流程编排 | 保留不变 |

该方案改动最小化，风险可控，推荐实施。
