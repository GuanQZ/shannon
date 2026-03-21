# Lumin K8s 部署配置设计文档

## 背景

本文档提供 Lumin 项目在 Kubernetes 集群中部署所需的配置示例和说明。

## 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│  Kubernetes Pod                                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  lumin-worker (container)                            │   │
│  │                                                     │   │
│  │  ├── Temporal Worker  (localhost:7233)             │   │
│  │  ├── MCP Server      (localhost:8082)              │   │
│  │  ├── Playwright MCP (localhost:8083)               │   │
│  │  └── Dashboard      (localhost:3457)               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  集群内服务                                                │
│  ├── internal-agent-service:8080  (Internal Agent)        │
│  └── temporal-headless:7233      (Temporal)              │
└─────────────────────────────────────────────────────────────┘
```

## K8s 权限要求

### 来自 docker-compose 的配置映射

| docker-compose | K8s 配置 |
|----------------|----------|
| `privileged: true` | `securityContext.privileged: true` |
| `cap_add: NET_RAW` | `securityContext.capabilities.add: [NET_RAW]` |
| `seccomp:unconfined` | `securityContext.seccompProfile.type: Unconfined` |
| `shm_size: 2gb` | `resources.limits.shmSize: 2Gi` |
| `ipc: host` | `hostIPC: true` |

## ConfigMap 配置

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: lumin-config
data:
  lumin.yaml: |
    # Internal Agent 配置
    internalAgent:
      # Internal Agent 服务地址（集群内 Service 名称）
      baseUrl: "http://internal-agent-service:8080"

      # 会话初始化参数
      initSession:
        appId: "lumin-app"
        agentId: "security-agent"
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

    # 日志配置
    logging:
      level: info
```

## Deployment 配置

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lumin-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lumin-worker
  template:
    metadata:
      labels:
        app: lumin-worker
    spec:
      # 安全上下文配置
      securityContext:
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001

      # 容器配置
      containers:
        - name: worker
          image: ghcr.io/guanqz/lumin:latest
          imagePullPolicy: Always

          # K8s 权限配置
          securityContext:
            privileged: true
            capabilities:
              add:
                - NET_RAW
            seLinuxOptions: ""
            seccompProfile:
              type: Unconfined

          # 共享内存
          resources:
            limits:
              shmSize: 2Gi

          # 环境变量
          env:
            - name: NODE_ENV
              value: "production"
            - name: TEMPORAL_ADDRESS
              value: "localhost:7233"  # 同 Pod 内
            - name: LUMIN_MCP_SERVER_URL
              value: "http://localhost:8082"  # 同 Pod 内

          # 端口
          ports:
            - containerPort: 8082
              name: mcp
            - containerPort: 8083
              name: playwright
            - containerPort: 3457
              name: dashboard

          # 健康检查
          livenessProbe:
            httpGet:
              path: /health
              port: 8082
            initialDelaySeconds: 30
            periodSeconds: 10

          readinessProbe:
            httpGet:
              path: /health
              port: 8082
            initialDelaySeconds: 10
            periodSeconds: 5

          # 配置挂载
          volumeMounts:
            - name: lumin-config
              mountPath: /app/configs/lumin.yaml
              subPath: lumin.yaml
            - name: audit-logs
              mountPath: /app/audit-logs
            - name: repos
              mountPath: /app/repos
            - name: deliverables
              mountPath: /app/deliverables

      # 启用 hostIPC（对应 docker-compose ipc: host）
      hostIPC: true

      # 卷配置
      volumes:
        - name: lumin-config
          configMap:
            name: lumin-config
        - name: audit-logs
          emptyDir: {}
        - name: repos
          emptyDir: {}
        - name: deliverables
          emptyDir: {}
```

## Service 配置（如需暴露端口）

```yaml
apiVersion: v1
kind: Service
metadata:
  name: lumin-worker
spec:
  selector:
    app: lumin-worker
  ports:
    - name: mcp
      port: 8082
      targetPort: 8082
    - name: playwright
      port: 8083
      targetPort: 8083
    - name: dashboard
      port: 3457
      targetPort: 3457
  # 如需集群内访问使用 ClusterIP
  # 如需外部访问使用 LoadBalancer 或 NodePort
  type: ClusterIP
```

## 部署检查清单

### 部署前确认

- [ ] 集群支持 privileged 模式
- [ ] 集群支持 NET_RAW capability
- [ ] 集群支持 seccomp:unconfined
- [ ] 已构建镜像并推送到内网镜像仓库
- [ ] ConfigMap 和 Deployment YAML 已准备

### 部署步骤

```bash
# 1. 创建 ConfigMap
kubectl apply -f lumin-configmap.yaml

# 2. 创建 Deployment
kubectl apply -f lumin-deployment.yaml

# 3. 检查 Pod 状态
kubectl get pods -l app=lumin-worker

# 4. 查看日志
kubectl logs -l app=lumin-worker -f
```

## 已知问题

| 问题 | 解决方案 |
|------|----------|
| nmap 需要 NET_RAW | 配置 capabilities.add: NET_RAW |
| Chromium 需要 /dev/shm | 配置 shmSize: 2Gi |
| MCP Server 需要 IPC | 配置 hostIPC: true |

## 相关文件

- Dockerfile: 构建镜像使用
- docker-compose.yml: 本地开发参考
- configs/lumin.yaml: 运行时配置
