# Lumin MCP 服务器配置文档

> 更新时间：2026-03-15
> 用途：内网 Agent 配置 MCP

---

## 一、MCP 服务器概述

Lumin 项目包含以下 MCP 工具，供内网 Agent 调用：

### 1.1 Lumin Helper MCP

> 注意：工具名称已统一使用 `lumin__helper__` 前缀

| 工具名称 | 用途 |
|---------|------|
| `lumin__helper__save_deliverable` | 保存渗透测试交付物到指定目录 |
| `lumin__helper__generate_totp` | 生成 TOTP 验证码（用于 MFA 登录） |

### 1.2 SDK 工具（Claude Agent SDK 封装）

| 工具名称 | 用途 |
|---------|------|
| `lumin__helper__read` | 读取文件内容 |
| `lumin__helper__write` | 写入文件内容 |
| `lumin__helper__glob` | 按模式匹配文件 |
| `lumin__helper__grep` | 搜索文件内容 |
| `lumin__helper__bash` | 执行 Shell 命令 |

### 1.3 Playwright MCP（浏览器自动化）

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

// 创建 Server 实例
const server = new Server({ name: 'lumin-helper', version: '1.0.0' }, {
  capabilities: { tools: {} },
});

// 注册工具处理函数
server.setRequestHandler(ListToolsRequestSchema, async () => { ... });
server.setRequestHandler(CallToolRequestSchema, async (request) => { ... });

// SSE 端点
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/sse', res);
  await server.connect(transport);
});
```

### 2.2 端口

- Lumin Helper MCP：`8082`
- Playwright MCP：`8083`

### 2.3 端点（MCP 标准协议 + 兼容性）

MCP 使用 SSE（Server-Sent Events）传输协议，遵循标准 MCP 协议格式。支持多种客户端兼容：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/sse` | GET | 建立 SSE 长连接 |
| `/messages` | GET | 建立 SSE 长连接（fastmcp 兼容） |

#### 通信原理

**Step 1: 建立 SSE 连接**

客户端发起 GET 请求建立长连接：

```bash
# 方式一
curl -N http://<host>:8082/sse

# 方式二（推荐，兼容性好）
curl -N http://<host>:8082/messages
```

**Step 2: 获取 Session Endpoint**

服务器返回的第一个 Event 包含后续调用的端点 URL：

```text
event: endpoint
data: /messages/?session_id=c52417aebe65420f81f98217d385f338
```

客户端需要解析这个返回的 URL，提取 session_id。

**Step 3: 发送工具调用**

使用上一步获取的 URL 发送 POST 请求：

```bash
# 假设 Step 2 返回的是 /messages/?session_id=xxx
curl -X POST "http://<host>:8082/messages?session_id=c52417aebe65420f81f98217d385f338" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

**关键点**：
- Session 端点由服务器在 SSE 连接建立时自动返回
- 客户端不需要自己生成 session_id，只需解析返回的 endpoint
- 后续所有工具调用都使用同一个 session 端点 URL

**Session ID 格式兼容：**
- 标准 MCP SDK：`/sse?sessionId=xxx`（驼峰）
- fastmcp/其他框架：`/messages?session_id=xxx`（下划线）
- **两种格式都支持**

**配置示例：**

```json
{
  "mcpServers": {
    "lumin-helper": {
      "url": "http://<host>:8082/sse"
    }
  }
}
```

**JSON-RPC 消息格式：**

```json
// tools/list 请求
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}

// tools/call 请求
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "lumin__helper__save_deliverable",
    "arguments": {
      "deliverable_type": "CODE_ANALYSIS",
      "content": "# Test"
    }
  }
}
```

---

## 三、工具定义

### 3.1 lumin__helper__save_deliverable

保存渗透测试交付物到目标仓库的 `deliverables/` 目录。

**工具名称**：`lumin__helper__save_deliverable`

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
  "name": "lumin__helper__save_deliverable",
  "input": {
    "deliverable_type": "XSS_ANALYSIS",
    "content": "# XSS 漏洞分析\n\n## 发现\n\n在用户评论处发现存储型 XSS..."
  }
}
```

### 3.2 lumin__helper__generate_totp

生成 6 位 TOTP 验证码，用于多因素认证登录。

**工具名称**：`lumin__helper__generate_totp`

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `secret` | string | 是 | Base32 编码的 TOTP 密钥 |

**使用示例**：

```json
{
  "name": "lumin__helper__generate_totp",
  "input": {
    "secret": "JBSWY3DPEHPK3PXP"
  }
}
```

---

## 四、内网 Agent 配置

### 4.0 镜像构建（内网部署前）

内网部署前需要重建镜像，预装 playwright-mcp：

```bash
# 重建镜像（Dockerfile 中已添加 playwright-mcp 预装）
./lumin build

# 或手动构建
docker build -t lumin-worker:latest .
```

**镜像包含内容**：
- Lumin 主程序
- mcp-server（端口 8082）
- playwright-mcp（端口 8083）
- Chromium 浏览器
- ripgrep 等工具

### 4.1 Lumin Helper MCP 配置

根据内网 Agent 平台的 HTTP MCP 配置格式：

| 字段 | 必填 | 说明 |
|------|------|------|
| 名称 | 是 | MCP 服务名称，如 `lumin-helper` |
| 描述 | 否 | MCP 服务描述 |
| URL | 是 | MCP 服务地址，如 `http://<host>:8082/sse` 或 `http://<host>:8082/messages` |
| HTTP 请求头 | 否 | 认证信息等 |

**配置示例**：

```json
{
  "名称": "lumin-helper",
  "描述": "Lumin 渗透测试辅助工具",
  "url": "http://<host>:8082/sse",
  "http 请求头": {
    "Authorization": "Bearer your-api-key"
  }
}
```

### 4.2 Playwright MCP 配置

Playwright MCP 已预装在镜像中，部署为 HTTP SSE 服务器，供内网 Agent 调用。

**启动命令**（镜像重建后）：

```bash
# 方式一：直接调用（推荐，镜像已预装）
playwright-mcp --port 8083 --host 0.0.0.0 --allowed-hosts "*" --headless --executable-path /usr/bin/chromium-browser --no-sandbox

# 方式二：临时使用 npx（需要网络下载，不推荐内网部署）
npx @playwright/mcp@latest --port 8083 --host 0.0.0.0 --allowed-hosts "*" --headless --executable-path /usr/bin/chromium-browser --no-sandbox
```

**配置示例**：

```json
{
  "名称": "playwright",
  "描述": "浏览器自动化工具",
  "url": "http://<host>:8083/sse",
  "http 请求头": {}
}
```

**参数说明**：

| 参数 | 说明 |
|-----|------|
| `--port 8083` | 监听端口 |
| `--host 0.0.0.0` | 允许外部访问（默认 localhost） |
| `--allowed-hosts "*"` | 允许所有来源访问（Docker 网络必需） |
| `--headless` | 无头模式运行浏览器 |
| `--executable-path /usr/bin/chromium-browser` | Chromium 可执行文件路径 |
| `--no-sandbox` | 禁用沙箱模式（Docker 环境必需） |

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
playwright-mcp --host 0.0.0.0 --executable-path /usr/bin/chromium-browser --no-sandbox

# 方案 B：显式指定输出目录（需修改翻译代码）
playwright-mcp --host 0.0.0.0 --output-dir /app/repos/${LUMIN_TARGET_REPO} --executable-path /usr/bin/chromium-browser --no-sandbox
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

### lumin__helper__save_deliverable
- 用途：保存渗透测试交付物到目标仓库
- 参数：
  - deliverable_type：交付物类型（CODE_ANALYSIS, RECON, XSS_ANALYSIS, XSS_QUEUE, INJECTION_ANALYSIS, INJECTION_QUEUE, AUTH_ANALYSIS, AUTH_QUEUE, AUTHZ_ANALYSIS, AUTHZ_QUEUE, SSRF_ANALYSIS, SSRF_QUEUE, INJECTION_EVIDENCE, XSS_EVIDENCE, AUTH_EVIDENCE, AUTHZ_EVIDENCE, SSRF_EVIDENCE）
  - content：文件内容（Markdown 或 JSON 格式）
  - file_path：可选，文件路径

### lumin__helper__generate_totp
- 用途：生成 TOTP 验证码
- 参数：
  - secret：Base32 编码的密钥

### SDK 工具（lumin__helper__read/write/glob/grep/bash）
- lumin__helper__read: 读取文件内容
  - 参数：file_path（文件路径）
- lumin__helper__write: 写入文件内容
  - 参数：file_path（文件路径）、content（内容）
- lumin__helper__glob: 按模式匹配文件
  - 参数：pattern（glob 模式，如 **/*.ts）
- lumin__helper__grep: 搜索文件内容（依赖 ripgrep）
  - 参数：pattern（搜索模式）、path（可选，搜索路径）
- lumin__helper__bash: 执行 Shell 命令
  - 参数：command（命令字符串）
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
