# Lumin-target 独立化设计

## 目标

将 lumin-target 从 lumin 项目中分离，实现完全独立部署，缩小 lumin 项目体积。

## 当前状态

- `repos/lumin-target` 作为子目录存在于 lumin 项目中
- docker-compose.yml 定义了 lumin-target 服务
- 用户进行渗透测试时需要指定目标 URL

## 变更内容

### 1. 移除 docker-compose.yml 中的 lumin-target 服务

删除 `docker-compose.yml` 第 88-97 行的 lumin-target 服务定义：

```yaml
# 删除以下内容
lumin-target:
  build: ./repos/lumin-target
  ports:
    - "8080:8080"
  healthcheck:
    test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 60s
```

### 2. 删除 repos/lumin-target 目录

删除整个 `repos/lumin-target` 目录（已迁移到独立项目）

## 用户使用方式

### 独立启动 lumin-target

```bash
# 方式 1: 本地构建
cd /Users/zengguanqin/VSCodeWorkspace/lumin-target
docker build -t lumin-target .
docker run -d -p 8080:8080 lumin-target

# 方式 2: 使用 GitHub 镜像（待配置）
docker run -d -p 8080:8080 guanqz/lumin-target
```

### 运行 lumin 渗透测试

```bash
./lumin start URL=http://localhost:8080 REPO=my-repo
```

## 预期效果

1. **lumin 项目简化** - 专注于渗透测试核心功能
2. **lumin-target 完全独立** - 可独立部署、维护、升级
3. **职责分离** - 测试工具与被测目标解耦
