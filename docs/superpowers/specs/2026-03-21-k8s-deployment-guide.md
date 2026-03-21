# Lumin 内网 K8s 部署指引

## 概述

本文档提供 Lumin 在内网 Kubernetes 环境中部署的完整指南。

## 部署前准备

### 1. 镜像准备

```bash
# 在有外网的环境构建镜像
docker build -t ghcr.io/guanqz/lumin:latest .

# 推送到内网镜像仓库（假设内网 harbor）
docker tag ghcr.io/guanqz/lumin:latest internal-harbor.example.com/lumin/lumin:latest
docker push internal-harbor.example.com/lumin/lumin:latest

# 如需更新镜像版本，修改 Deployment 中的 image 字段
```

### 2. 配置文件准备

需要准备以下文件：

| 文件 | 用途 |
|------|------|
| `lumin-configmap.yaml` | 运行时配置（Internal Agent 等） |
| `lumin-deployment.yaml` | Pod 部署配置 |

## 部署步骤

### 步骤 1：修改配置

编辑 `lumin-configmap.yaml`，根据实际情况修改：

```yaml
# 需要修改的配置项：
# 1. internalAgent.baseUrl - Internal Agent 服务地址
# 2. internalAgent.initSession.* - 初始化参数
# 3. internalAgent.chat.* - 聊天参数
```

编辑 `lumin-deployment.yaml`，修改镜像地址：

```yaml
# 需要修改：
# 1. image 字段 - 改为内网镜像地址
```

### 步骤 2：部署

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

### 步骤 3：验证

```bash
# 检查 Pod 是否 Running
kubectl get pod -l app=lumin-worker

# 进入 Pod 调试（如需要）
kubectl exec -it <pod-name> -- /bin/bash
```

## 常见问题

### Q1: Pod 一直处于 Pending 状态

**原因**：集群资源不足或调度失败

**解决**：
```bash
# 查看详细原因
kubectl describe pod <pod-name>

# 检查节点资源
kubectl get nodes
```

### Q2: Pod 一直 Restarting

**原因**：应用程序启动失败

**解决**：
```bash
# 查看重启原因
kubectl describe pod <pod-name>

# 查看应用日志
kubectl logs <pod-name> --previous
```

### Q3: nmap 扫描失败 (Permission denied)

**原因**：缺少 NET_RAW 权限

**解决**：
```yaml
# 在 deployment 中添加 capabilities
securityContext:
  capabilities:
    add:
      - NET_RAW
```

### Q4: Chromium/Playwright 无法启动

**原因**：缺少特权模式或共享内存

**解决**：
```yaml
# 确保配置了以下项
securityContext:
  privileged: true

resources:
  limits:
    shmSize: 2Gi
```

### Q5: 无法连接 Internal Agent

**原因**：Internal Agent 服务地址配置错误

**解决**：
```bash
# 1. 检查 ConfigMap 配置
kubectl get configmap lumin-config -o yaml

# 2. 检查 Internal Agent Service 是否存在
kubectl get svc | grep internal-agent

# 3. 测试连接
kubectl exec -it <pod-name> -- curl http://internal-agent-service:8080/health
```

### Q6: MCP Server 健康检查失败

**原因**：MCP 服务未正常启动

**解决**：
```bash
# 检查 MCP 端口
kubectl exec -it <pod-name> -- curl http://localhost:8082/health
```

### Q7: 镜像拉取失败

**原因**：镜像地址错误或内网无法访问镜像仓库

**解决**：
```bash
# 1. 检查镜像地址是否正确
kubectl describe pod <pod-name> | grep -i image

# 2. 如使用私有仓库，需创建 imagePullSecret
kubectl create secret docker-registry my-harbor \
  --docker-server=internal-harbor.example.com \
  --docker-username=admin \
  --docker-password=password

# 然后在 deployment 中添加
imagePullSecrets:
  - name: my-harbor
```

### Q8: 权限不足，集群不支持 privileged

**解决**：尝试简化版配置

```bash
# 使用简化版 deployment（功能会受限）
kubectl apply -f lumin-deployment-minimal.yaml
```

简化版会禁用：
- nmap 高级扫描功能
- Chromium 浏览器（Playwright）

## 卸载

```bash
kubectl delete -f lumin-deployment.yaml
kubectl delete -f lumin-configmap.yaml
```

## 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| TEMPORAL_ADDRESS | localhost:7233 | Temporal 服务地址（同 Pod） |
| LUMIN_MCP_SERVER_URL | http://localhost:8082 | MCP 服务地址（同 Pod） |
| NODE_ENV | production | 运行模式 |

### 端口

| 端口 | 服务 |
|------|------|
| 8082 | MCP Server |
| 8083 | Playwright MCP |
| 3457 | Dashboard |

## 相关文件

- `lumin-configmap.yaml` - ConfigMap 配置
- `lumin-deployment.yaml` - 完整版 Deployment
- `lumin-deployment-minimal.yaml` - 简化版 Deployment（权限受限时使用）
