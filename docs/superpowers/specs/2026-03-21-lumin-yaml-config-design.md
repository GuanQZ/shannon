# Lumin 运行时配置设计文档

## 背景

本项目计划将硬编码的常量和环境变量迁移到 `lumin.yaml` 配置文件，方便 K8s 部署时通过 ConfigMap 挂载修改。

## 目标

将 Internal Agent 相关配置从环境变量迁移到 `configs/lumin.yaml`，实现：
- K8s 部署时可配置
- 运行时配置与代码分离
- 保持向后兼容

## 配置结构

```yaml
# configs/lumin.yaml - Lumin 运行时配置

internalAgent:
  # Internal Agent 服务地址
  baseUrl: "http://internal-agent:8080"

  # 会话初始化参数
  initSession:
    appId: "lumin-app"
    agentId: "security-agent"  # Agent 标识，用于 API 路由
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
```

## 修改范围

### 1. 配置文件

- 修改 `configs/lumin.yaml`，添加 Internal Agent 配置项
- 注：`lumin.yaml` 是运行时配置，不需要通过 `config-schema.json` 验证（该 schema 仅用于目标配置文件）

### 2. 代码修改

**src/ai/providers/internal-agent.ts**:

1. 扩展 `LuminRuntimeConfig` 接口，添加完整配置字段：

```typescript
interface LuminRuntimeConfig {
  internalAgent?: {
    baseUrl?: string;
    initSession?: {
      appId?: string;
      agentId?: string;
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

2. 修改 `loadInternalAgentConfig()` 函数：
- 从 `lumin.yaml` 读取配置，替代环境变量
- 保留环境变量作为 fallback（向后兼容）

### 3. 配置加载逻辑

```typescript
// 改为：从 lumin.yaml 加载，fallback 到环境变量
export function loadInternalAgentConfig(): InternalAgentConfig | null {
  const runtimeConfig = loadLuminRuntimeConfig();
  const iaConfig = runtimeConfig.internalAgent;

  const baseUrl = iaConfig?.baseUrl || process.env.INTERNAL_AGENT_BASE_URL;

  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl,
    initSession: {
      appId: iaConfig?.initSession?.appId || process.env.INTERNAL_AGENT_INIT_SESSION_APP_ID || '',
      agentId: iaConfig?.initSession?.agentId || process.env.INTERNAL_AGENT_INIT_SESSION_AGENT_ID || '',
      trCode: iaConfig?.initSession?.trCode || process.env.INTERNAL_AGENT_INIT_SESSION_TR_CODE || '',
      trVersion: iaConfig?.initSession?.trVersion || process.env.INTERNAL_AGENT_INIT_SESSION_TR_VERSION || '1.0',
    },
    chat: {
      appId: iaConfig?.chat?.appId || process.env.INTERNAL_AGENT_CHAT_APP_ID || '',
      trCode: iaConfig?.chat?.trCode || process.env.INTERNAL_AGENT_CHAT_TR_CODE || '',
      trVersion: iaConfig?.chat?.trVersion || process.env.INTERNAL_AGENT_CHAT_TR_VERSION || '1.0',
      stream: iaConfig?.chat?.stream ?? (process.env.INTERNAL_AGENT_CHAT_STREAM === 'true'),
    },
    timeout: iaConfig?.timeout || 120000,
  };
}
```

## 配置加载流程

### 配置文件查找顺序

代码已实现自动查找，按顺序查找以下路径，找到第一个存在的文件即停止：

1. `./configs/lumin.yaml` - 本地开发
2. `./lumin.yaml` - 项目根目录（备用）
3. `/app/configs/lumin.yaml` - Docker 容器
4. `/app/lumin.yaml` - 容器根目录（备用）

### 运行时加载

```
Worker 启动
    │
    ▼
loadLuminRuntimeConfig()
    │  查找配置文件路径
    │  解析 YAML
    │  缓存到内存
    ▼
loadInternalAgentConfig()
    │  优先从 lumin.yaml 读取
    │  fallback 到环境变量
    ▼
返回配置对象
```

### 配置优先级

1. **lumin.yaml** - 最高优先级
2. **环境变量** - fallback（向后兼容）

## 兼容性

- 优先从 `lumin.yaml` 读取
- 如果配置文件中没有，则 fallback 到环境变量
- 现有环境变量配置仍然生效

## 部署说明

### Docker Compose

挂载配置文件：
```yaml
worker:
  volumes:
    - ./configs/lumin.yaml:/app/configs/lumin.yaml
```

### Kubernetes

通过 ConfigMap 挂载到 `/app/configs/lumin.yaml`：

```yaml
# ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: lumin-config
data:
  lumin.yaml: |
    internalAgent:
      baseUrl: "http://internal-agent:8080"
      initSession:
        appId: "lumin-app"
        agentId: "security-agent"
        trCode: "security-scan"
        trVersion: "1.0"
      chat:
        appId: "lumin-app"
        trCode: "security-chat"
        trVersion: "1.0"
        stream: true
      timeout: 1200000

---
# Deployment
volumeMounts:
  - name: lumin-config
    mountPath: /app/configs/lumin.yaml
    subPath: lumin.yaml
volumes:
  - name: lumin-config
    configMap:
      name: lumin-config
```

## 待办

- [ ] 更新 configs/lumin.yaml，添加 Internal Agent 配置
- [ ] 修改 src/ai/providers/internal-agent.ts，扩展接口并更新加载逻辑
- [ ] 测试配置加载
