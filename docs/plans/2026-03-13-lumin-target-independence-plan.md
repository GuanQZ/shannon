# Lumin-target 独立化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从 lumin 项目中移除 lumin-target 相关内容，实现完全独立部署

**Architecture:** 纯删除操作，无需代码修改，仅需删除 docker-compose.yml 中的服务定义和 repos 目录

**Tech Stack:** Docker, docker-compose

---

## Task 1: 移除 docker-compose.yml 中的 lumin-target 服务

**Files:**
- Modify: `docker-compose.yml:88-97`

**Step 1: 编辑 docker-compose.yml，删除 lumin-target 服务**

删除第 88-97 行的 lumin-target 服务定义：

```yaml
删除：
  # Lumin-target vulnerable application
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

**Step 2: 验证修改**

```bash
grep -n "lumin-target" docker-compose.yml
```
预期输出：无匹配（已删除）

**Step 3: 提交更改**

```bash
git add docker-compose.yml
git commit -m "chore: remove lumin-target service from docker-compose"
```

---

## Task 2: 删除 repos/lumin-target 目录

**Files:**
- Delete: `repos/lumin-target/`

**Step 1: 删除目录**

```bash
rm -rf repos/lumin-target
```

**Step 2: 验证删除**

```bash
ls -la repos/
```
预期输出：目录列表中不包含 lumin-target

**Step 3: 提交更改**

```bash
git add repos/
git commit -m "chore: remove lumin-target directory (moved to independent project)"
```

---

## Task 3: 验证整体状态

**Step 1: 确认无遗留引用**

```bash
grep -r "lumin-target" . --include="*.yml" --include="*.yaml" --include="*.json" --include="*.ts" --include="*.js" 2>/dev/null | grep -v node_modules | grep -v ".git"
```
预期输出：无匹配或仅有文档引用

**Step 2: 确认 docker-compose 仍可正常解析**

```bash
docker compose config > /dev/null && echo "OK"
```
预期输出：OK
