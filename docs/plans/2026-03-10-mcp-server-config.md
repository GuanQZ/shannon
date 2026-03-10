# Lumin MCP 服务器配置文档

> 更新时间：2026-03-10
> 用途：内网 Agent 配置 MCP

---

## 一、MCP 服务器概述

Lumin 项目包含以下 MCP 工具，供内网 Agent 调用：

### 1.1 Lumin Helper MCP（需独立部署）

| 工具名称 | 用途 |
|---------|------|
| `save_deliverable` | 保存渗透测试交付物到指定目录 |
| `generate_totp` | 生成 TOTP 验证码（用于 MFA 登录） |

### 1.2 Playwright MCP（浏览器自动化）

使用 `@playwright/mcp` 包，提供浏览器自动化能力：

| 工具名称 | 用途 |
|---------|------|
| `browser_navigate` | 导航到指定 URL |
| `browser_navigate_back` | 浏览器后退 |
| `browser_click` | 点击元素 |
| `browser_hover` | 悬停元素 |
| `browser_type` | 输入文本 |
| `browser_press_key` | 按键 |
| `browser_fill_form` | 填写表单 |
| `browser_select_option` | 选择下拉选项 |
| `browser_file_upload` | 文件上传 |
| `browser_snapshot` | 获取页面快照 |
| `browser_take_screenshot` | 截图 |
| `browser_evaluate` | 执行 JavaScript |
| `browser_wait_for` | 等待元素 |
| `browser_console_messages` | 获取控制台消息 |
| `browser_network_requests` | 获取网络请求 |
| `browser_tabs` | 管理标签页 |
| `browser_handle_dialog` | 处理对话框 |

---

## 二、服务器部署

### 2.1 部署方式

使用 `@modelcontextprotocol/sdk` 创建独立的 SSE 服务器：

```typescript
// mcp-server/src/http-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const server = new Server({ name: 'lumin-helper', version: '1.0.0' }, {
  capabilities: { tools: {} },
});

// 注册工具
server.registerTool('save_deliverable', { ... });
server.registerTool('generate_totp', { ... });

const transport = new SSEServerTransport('/mcp');
await transport.start();
```

### 2.2 端口

默认端口：`8080`

### 2.3 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/mcp` | SSE | MCP 工具调用（供内网 Agent 配置） |
| `/mcp/connect` | GET | SSE 连接 |

---

## 三、工具定义

### 3.1 save_deliverable

保存渗透测试交付物到目标仓库的 `deliverables/` 目录。

**工具名称**：`save_deliverable`

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deliverable_type` | string | 是 | 交付物类型（见下方枚举值） |
| `content` | string | 否 | 交付物内容（Markdown 或 JSON） |
| `file_path` | string | 否 | 文件路径（相对于 deliverables 目录） |

**deliverable_type 枚举值**：

| 值 | 文件名 | 用途 |
|---|--------|------|
| `CODE_ANALYSIS` | `code_analysis_deliverable.md` | 预侦察阶段代码分析 |
| `RECON` | `recon_deliverable.md` | 侦察阶段发现 |
| `INJECTION_ANALYSIS` | `injection_analysis_deliverable.md` | 注入漏洞分析 |
| `INJECTION_QUEUE` | `injection_exploitation_queue.json` | 注入漏洞利用队列 |
| `XSS_ANALYSIS` | `xss_analysis_deliverable.md` | XSS 漏洞分析 |
| `XSS_QUEUE` | `xss_exploitation_queue.json` | XSS 漏洞利用队列 |
| `AUTH_ANALYSIS` | `auth_analysis_deliverable.md` | 认证漏洞分析 |
| `AUTH_QUEUE` | `auth_exploitation_queue.json` | 认证漏洞利用队列 |
| `AUTHZ_ANALYSIS` | `authz_analysis_deliverable.md` | 授权漏洞分析 |
| `AUTHZ_QUEUE` | `auth_exploitation_queue.json` | 授权漏洞利用队列 |
| `SSRF_ANALYSIS` | `ssrf_analysis_deliverable.md` | SSRF 漏洞分析 |
| `SSRF_QUEUE` | `ssrf_exploitation_queue.json` | SSRF 漏洞利用队列 |
| `INJECTION_EVIDENCE` | `injection_exploitation_evidence.md` | 注入漏洞利用证据 |
| `XSS_EVIDENCE` | `xss_exploitation_evidence.md` | XSS 漏洞利用证据 |
| `AUTH_EVIDENCE` | `auth_exploitation_evidence.md` | 认证漏洞利用证据 |
| `AUTHZ_EVIDENCE` | `authz_exploitation_evidence.md` | 授权漏洞利用证据 |
| `SSRF_EVIDENCE` | `ssrf_exploitation_evidence.md` | SSRF 漏洞利用证据 |

**使用示例**：

```json
{
  "name": "save_deliverable",
  "input": {
    "deliverable_type": "XSS_ANALYSIS",
    "content": "# XSS 漏洞分析\n\n## 发现\n\n在用户评论处发现存储型 XSS..."
  }
}
```

### 3.2 generate_totp

生成 6 位 TOTP 验证码，用于多因素认证登录。

**工具名称**：`generate_totp`

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `secret` | string | 是 | Base32 编码的 TOTP 密钥 |

**使用示例**：

```json
{
  "name": "generate_totp",
  "input": {
    "secret": "JBSWY3DPEHPK3PXP"
  }
}
```

---

## 四、内网 Agent 配置

### 4.1 Lumin Helper MCP 配置

根据内网 Agent 平台的 HTTP MCP 配置格式：

| 字段 | 必填 | 说明 |
|------|------|------|
| 名称 | 是 | MCP 服务名称，如 `lumin-helper` |
| 描述 | 否 | MCP 服务描述 |
| URL | 是 | MCP 服务地址，如 `http://<lumin-mcp-host>:8080/mcp` |
| HTTP 请求头 | 否 | 认证信息等 |

**配置示例**：

```json
{
  "名称": "lumin-helper",
  "描述": "Lumin 渗透测试辅助工具",
  "url": "http://<lumin-mcp-host>:8080/mcp",
  "http 请求头": {
    "Authorization": "Bearer your-api-key"
  }
}
```

### 4.2 Playwright MCP 配置

Playwright MCP 需要部署为 HTTP SSE 服务器，供内网 Agent 调用。

**方案选择**：

| 方案 | 说明 |
|------|------|
| **方案 A** | 使用 `mcp-proxy` 工具把 stdio MCP 转为 HTTP（推荐） |
| **方案 B** | 自行开发 Playwright HTTP SSE 服务器 |

**配置示例**：

```json
{
  "名称": "playwright",
  "描述": "浏览器自动化工具",
  "url": "http://<playwright-mcp-host>:8081/mcp",
  "http 请求头": {}
}
```

**文件保存位置说明**：

Playwright MCP 的截图、下载文件默认保存到**工作目录**（cwd）。

- 当前 Lumin 实现：SDK 启动时 `cwd` 参数设置为目标仓库目录（如 `./repos/juice-shop/`）
- 提示词要求：截图保存到"当前工作目录（仓库根目录）"
- **因此当前无需额外配置**，`--output-dir` 可保持默认

**翻译流程依赖**：

翻译阶段（`src/utils/image-embedder.ts`）需要读取截图文件，代码中已支持以下查找路径：
1. `deliverables/chinese/reporting/` -> `../../../screenshots/`
2. 相对于 markdown 文件 `./screenshots/`
3. `deliverables/` -> `../../screenshots/`
4. **repo root**（当前 Playwright MCP 截图的实际保存位置）

**潜在问题**：

当 MCP 部署为独立 HTTP 服务器时：
- 工作目录可能不是仓库目录，导致截图保存位置不正确
- 翻译阶段按现有逻辑（repo root）找不到截图

**建议**：
- 方案 A：确保 HTTP MCP 服务器的工作目录设置为仓库目录（依赖平台配置）- **推荐**，翻译代码无需修改
- 方案 B：显式配置 `--output-dir` 参数 - **需同步修改翻译代码**，支持新的截图查找路径

```bash
# 方案 A：无额外配置（依赖工作目录设置）
npx @playwright/mcp

# 方案 B：显式指定输出目录（需修改翻译代码）
npx @playwright/mcp --output-dir /app/repos/${LUMIN_TARGET_REPO}
```

**结论**：推荐**方案 A**，可保持现有翻译代码不变。

### 4.3 System Prompt 工具说明（必填）

由于内网 Agent 的 HTTP MCP 可能不会自动获取工具描述（取决于平台实现），**必须在 System Prompt 中添加工具说明**：

> **注意**：这是确保 Agent 知道有哪些工具可用的关键步骤

```markdown
## 可用工具

### 浏览器工具（Playwright）
- browser_navigate: 导航到 URL
- browser_navigate_back: 后退
- browser_click: 点击元素
- browser_hover: 悬停
- browser_type: 输入文本
- browser_press_key: 按键
- browser_fill_form: 填写表单
- browser_select_option: 选择选项
- browser_file_upload: 文件上传
- browser_snapshot: 页面快照
- browser_take_screenshot: 截图
- browser_evaluate: 执行 JavaScript
- browser_wait_for: 等待元素
- browser_console_messages: 控制台消息
- browser_network_requests: 网络请求
- browser_tabs: 标签页管理
- browser_handle_dialog: 对话框处理

### save_deliverable
- 用途：保存渗透测试交付物到目标仓库
- 参数：
  - deliverable_type：交付物类型（CODE_ANALYSIS, RECON, XSS_ANALYSIS, XSS_QUEUE, INJECTION_ANALYSIS, INJECTION_QUEUE, AUTH_ANALYSIS, AUTH_QUEUE, AUTHZ_ANALYSIS, AUTHZ_QUEUE, SSRF_ANALYSIS, SSRF_QUEUE, INJECTION_EVIDENCE, XSS_EVIDENCE, AUTH_EVIDENCE, AUTHZ_EVIDENCE, SSRF_EVIDENCE）
  - content：文件内容（Markdown 或 JSON 格式）
  - file_path：可选，文件路径

### generate_totp
- 用途：生成 TOTP 验证码
- 参数：
  - secret：Base32 编码的密钥
```

---

## 五、注意事项

### 5.1 targetDir 解决方案

由于 MCP 服务器独立部署，无法像进程内 MCP 那样通过闭包捕获 targetDir。采用**环境变量**方案：

**工作流程**：
```
任务1: juice-shop
  → 设置环境变量 LUMIN_TARGET_REPO=juice-shop
  → MCP 保存到 /app/deliverables/juice-shop/
  → 任务完成

任务2: bwapp
  → 设置环境变量 LUMIN_TARGET_REPO=bwapp
  → MCP 保存到 /app/deliverables/bwapp/
  → 任务完成
```

**MCP 服务器实现**：
```typescript
const targetRepo = process.env.LUMIN_TARGET_REPO || 'default';
const targetDir = `/app/deliverables/${targetRepo}`;
```

**配置方式**：
- 每次启动渗透任务前，设置环境变量 `LUMIN_TARGET_REPO=<repo-name>`
- MCP 服务器读取该环境变量确定存储目录

### 5.2 前提条件

- 同一时间只运行一个渗透任务
- 任务之间串行执行

### 5.3 安全

建议在 MCP 服务器前添加认证机制。

### 5.4 错误处理

工具执行失败时返回错误信息，内网 Agent 需要正确处理。
