# Lumin YAML 配置迁移实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Internal Agent 配置从环境变量迁移到 lumin.yaml 配置文件，实现 K8s 部署时可配置化

**Architecture:** 扩展现有的 LuminRuntimeConfig 接口，从 lumin.yaml 读取配置，环境变量作为 fallback 向后兼容

**Tech Stack:** TypeScript, YAML, js-yaml

---

## 文件修改范围

| 文件 | 改动 |
|------|------|
| `configs/lumin.yaml` | 添加 Internal Agent 配置项 |
| `src/ai/providers/internal-agent.ts` | 扩展接口定义，更新配置加载逻辑 |

---

## Chunk 1: 更新配置文件

### Task 1: 添加 Internal Agent 配置到 lumin.yaml

**Files:**
- Modify: `configs/lumin.yaml`

- [ ] **Step 1: 查看当前 lumin.yaml 内容**

```bash
cat configs/lumin.yaml
```

- [ ] **Step 2: 更新 lumin.yaml，添加完整配置**

```yaml
# Lumin Runtime Configuration
# 全局运行时配置，适用于 K8s 部署通过 ConfigMap 挂载

# Internal Agent 配置
internalAgent:
  # Internal Agent 服务地址
  baseUrl: "http://internal-agent:8080"

  # Agent 标识，用于 API 路由
  agentId: "security-agent"

  # 会话初始化参数
  initSession:
    appId: "lumin-app"
    trCode: "security-scan"
    trVersion: "1.0"

  # 聊天请求参数
  chat:
    appId: "lumin-app"
    trCode: "security-chat"
    trVersion: "1.0"
    stream: true

  # SSE 请求超时时间（毫秒）
  timeout: 1200000

# 日志配置（保留原有）
logging:
  level: info
```

- [ ] **Step 3: 提交更改**

```bash
git add configs/lumin.yaml
git commit -m "feat(config): add Internal Agent config to lumin.yaml

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: 修改代码实现

### Task 2: 扩展 LuminRuntimeConfig 接口

**Files:**
- Modify: `src/ai/providers/internal-agent.ts:26-34`

- [ ] **Step 1: 查看当前接口定义**

```typescript
// 当前 internal-agent.ts 第 26-34 行
interface LuminRuntimeConfig {
  internalAgent?: {
    timeout?: number;
  };
  logging?: {
    level?: string;
    verboseToolCalls?: boolean;
  };
}
```

- [ ] **Step 2: 扩展接口定义**

```typescript
interface LuminRuntimeConfig {
  internalAgent?: {
    baseUrl?: string;
    agentId?: string;
    initSession?: {
      appId?: string;
      trCode?: string;
      trVersion?: string;
    };
    chat?: {
      appId?: string;
      trCode?: string;
      trVersion?: string;
      stream?: boolean;
    };
    timeout?: number;
  };
  logging?: {
    level?: string;
    verboseToolCalls?: boolean;
  };
}
```

- [ ] **Step 3: 提交更改**

```bash
git add src/ai/providers/internal-agent.ts
git commit -m "feat(config): extend LuminRuntimeConfig interface

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 3: 更新配置加载逻辑

**Files:**
- Modify: `src/ai/providers/internal-agent.ts:159-188`

注：当前代码中 `agentId` 在 `initSession` 对象内部，加载逻辑需要适配此结构。

- [ ] **Step 1: 查看当前 loadInternalAgentConfig 函数**

```typescript
// 当前第 159-188 行
export function loadInternalAgentConfig(): InternalAgentConfig | null {
  const baseUrl = process.env.INTERNAL_AGENT_BASE_URL;

  if (!baseUrl) {
    return null;
  }

  // 加载运行时配置
  const runtimeConfig = loadLuminRuntimeConfig();
  const timeout = runtimeConfig.internalAgent?.timeout || 120000; // 默认 2 分钟

  const config: InternalAgentConfig = {
    baseUrl: baseUrl.replace(/\/$/, ''), // 移除末尾斜杠
    initSession: {
      appId: process.env.INTERNAL_AGENT_INIT_SESSION_APP_ID || '',
      trCode: process.env.INTERNAL_AGENT_INIT_SESSION_TR_CODE || '',
      trVersion: process.env.INTERNAL_AGENT_INIT_SESSION_TR_VERSION || '1.0',
      agentId: process.env.INTERNAL_AGENT_INIT_SESSION_AGENT_ID || '',
    },
    chat: {
      appId: process.env.INTERNAL_AGENT_CHAT_APP_ID || '',
      trCode: process.env.INTERNAL_AGENT_CHAT_TR_CODE || '',
      trVersion: process.env.INTERNAL_AGENT_CHAT_TR_VERSION || '1.0',
      stream: process.env.INTERNAL_AGENT_CHAT_STREAM === 'true',
    },
    timeout,
  };

  return config;
}
```

- [ ] **Step 2: 更新配置加载函数**

```typescript
export function loadInternalAgentConfig(): InternalAgentConfig | null {
  // 加载运行时配置
  const runtimeConfig = loadLuminRuntimeConfig();
  const iaConfig = runtimeConfig.internalAgent;

  // 优先从 lumin.yaml 读取，fallback 到环境变量
  const baseUrl = iaConfig?.baseUrl || process.env.INTERNAL_AGENT_BASE_URL;

  if (!baseUrl) {
    return null;
  }

  const config: InternalAgentConfig = {
    baseUrl: baseUrl.replace(/\/$/, ''), // 移除末尾斜杠
    initSession: {
      appId: iaConfig?.initSession?.appId || process.env.INTERNAL_AGENT_INIT_SESSION_APP_ID || '',
      trCode: iaConfig?.initSession?.trCode || process.env.INTERNAL_AGENT_INIT_SESSION_TR_CODE || '',
      trVersion: iaConfig?.initSession?.trVersion || process.env.INTERNAL_AGENT_INIT_SESSION_TR_VERSION || '1.0',
      agentId: iaConfig?.initSession?.agentId || process.env.INTERNAL_AGENT_INIT_SESSION_AGENT_ID || '',
    },
    chat: {
      appId: iaConfig?.chat?.appId || process.env.INTERNAL_AGENT_CHAT_APP_ID || '',
      trCode: iaConfig?.chat?.trCode || process.env.INTERNAL_AGENT_CHAT_TR_CODE || '',
      trVersion: iaConfig?.chat?.trVersion || process.env.INTERNAL_AGENT_CHAT_TR_VERSION || '1.0',
      stream: iaConfig?.chat?.stream ?? (process.env.INTERNAL_AGENT_CHAT_STREAM === 'true'),
    },
    timeout: iaConfig?.timeout || 120000,
  };

  return config;
}
```

- [ ] **Step 3: 提交更改**

```bash
git add src/ai/providers/internal-agent.ts
git commit -m "feat(config): load Internal Agent config from lumin.yaml with env fallback

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: 测试验证

### Task 4: 验证配置加载

**Files:**
- Test: 手动测试配置加载

- [ ] **Step 1: 构建项目**

```bash
npm run build
```

- [ ] **Step 2: 验证 TypeScript 编译无错误**

Expected: 编译成功，无 error

- [ ] **Step 3: 测试配置加载（可选：启动 worker 检查日志）**

```bash
# 启动 worker，检查日志中是否显示加载了配置
./lumin start URL=http://localhost:8080 REPO=test
```

Expected: 日志中应显示 `[InternalAgent] Loaded runtime config from: /app/configs/lumin.yaml`

- [ ] **Step 4: 提交完成**

```bash
git add .
git commit -m "chore: complete lumin.yaml config migration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 总结

| 任务 | 文件 | 步骤数 |
|------|------|--------|
| Task 1 | configs/lumin.yaml | 3 |
| Task 2 | internal-agent.ts | 3 |
| Task 3 | internal-agent.ts | 4 |
| Task 4 | 测试验证 | 4 |

**预计总步骤: 14 步**
