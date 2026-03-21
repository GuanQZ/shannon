# 渗透测试 Pre-Recon 阶段问题排查文档

## 问题概述

2026年3月18日，执行 `./lumin start` 命令启动渗透测试任务时，recon 阶段反复失败，提示找不到 `pre_recon_deliverable.md` 文件。

## 排查过程

### 第一阶段：发现验证失败

**现象**：
- recon 阶段验证失败，提示 "Missing required deliverable files"
- 错误码：`OutputValidationError`
- 重试 3 次后仍然失败

**日志证据**：
```
Validation failed: Missing required deliverable files
type: 'OutputValidationError',
```

### 第二阶段：追踪验证器逻辑

**发现**：查看 `src/constants.ts` 中的验证器配置：

```typescript
export const AGENT_VALIDATORS: Record<AgentName, AgentValidator> = Object.freeze({
  'pre-recon': async (sourceDir: string): Promise<boolean> => {
    const codeAnalysisFile = path.join(sourceDir, 'deliverables', 'code_analysis_deliverable.md');
    return await fs.pathExists(codeAnalysisFile);
  },

  recon: async (sourceDir: string): Promise<boolean> => {
    const reconFile = path.join(sourceDir, 'deliverables', 'recon_deliverable.md');
    return await fs.pathExists(reconFile);
  },
  // ...
});
```

**验证器检查的文件**：
- pre-recon 阶段：检查 `code_analysis_deliverable.md` ✅
- recon 阶段：检查 `recon_deliverable.md`

### 第三阶段：对比成功与失败执行

找到 3月17日成功执行的日志进行对比：

| 步骤 | 成功执行 (3月17日) | 失败执行 (3月18日) |
|------|-------------------|-------------------|
| pre-recon 执行时间 | 8.2 分钟 | 4.2 分钟 |
| recon 执行时间 | 6.5 分钟 ✅ | 1 分钟 ❌ |
| browser_navigate | 访问 `/` | 访问 `/login` (GET) |
| **Bash 运行 mvn** | ✅ 启动应用 | ❌ 没有执行 |
| Read 多个 Java 源码 | ✅ | ❌ |
| **save_deliverable** | ✅ 生成 recon_deliverable.md | ❌ 没有调用 |

### 第四阶段：确认根本原因

**关键发现**：

1. **浏览器访问失败**：recon 阶段通过 Playwright 访问应用时返回 404 错误
   ```
   - Page URL: http://host.docker.internal:8080/
   - heading "Whitelabel Error Page"
   - There was an unexpected error (type=Not Found, status=404).
   ```

2. **根因**：lumin-target 容器的 JAR 文件不存在
   ```bash
   # 容器配置显示挂载路径：
   Mount: /Users/zengguanqin/VSCodeWorkspace/lumin/repos/lumin-target/target/lumin-target-1.0.0.jar → /app.jar

   # 但实际目录为空：
   ls /Users/zengguanqin/VSCodeWorkspace/lumin/repos/lumin-target/target/
   → No such file or directory
   ```

3. **LLM 行为差异**：
   - 成功执行中：LLM 尝试运行 `mvn spring-boot:run` 启动应用，然后继续分析
   - 失败执行中：LLM 直接访问 `/login` 端点（GET 方法），但该端点只接受 POST，返回 405 错误

### 第五阶段：验证网络连通性

**发现**：worker 容器无法访问前端服务

- 前端 vite 服务绑定在 `localhost:5173`，Docker 网络无法访问
- 需要使用 `--host 0.0.0.0` 暴露到网络

### 第六阶段：修复问题

**修复步骤**：

1. **重新运行后端**：
   ```bash
   docker stop lumin-target && docker rm lumin-target
   docker run -d --name lumin-target -p 8080:8080 ghcr.io/guanqz/lumin-target:latest
   docker network connect lumin_default lumin-target
   ```

2. **修复前端**：
   - 修改 `vite.config.ts`，添加 `allowedHosts` 配置
   ```typescript
   server: {
     port: 5173,
     allowedHosts: ['host.docker.internal', 'localhost'],
     proxy: {
       '/': {
         target: 'http://localhost:8080',
         changeOrigin: true
       }
     }
   }
   ```
   - 使用 `--host 0.0.0.0` 启动
   ```bash
   cd /Users/zengguanqin/VSCodeWorkspace/lumin-target-frontend
   npm run dev -- --host 0.0.0.0
   ```

## 额外发现：设计缺陷

### 问题1：pre_recon_deliverable 从未生成

通过对比 shannon 项目（原版）发现一个设计缺陷：

| 阶段 | Prompt 要求保存 | 验证器检查 |
|------|----------------|-----------|
| pre-recon | `code_analysis_deliverable.md` (CODE_ANALYSIS) | `code_analysis_deliverable.md` ✅ |
| recon | - | `pre_recon_deliverable.md` ❌ |

**根本原因**：
- `prompts/pre-recon-code.txt` 要求保存 `code_analysis_deliverable.md`
- `prompts/recon.txt` 要求读取 `pre_recon_deliverable.md`
- 但 `stitchPreReconOutputs` 函数从未被调用（workflow 中没有调用 executePreReconPhase）

### 问题2：pre-recon 阶段 Wave1 扫描未执行

设计意图：
- Wave1: nmap、subfinder、whatweb 扫描
- Wave2: schemathesis 扫描
- stitchPreReconOutputs: 合并生成 pre_recon_deliverable.md

实际执行：
- 只有 pre-recon-code agent 执行（代码分析）
- 外部扫描从未执行
- stitchPreReconOutputs 从未调用

## 总结

本次排查发现的问题：

1. **直接原因**：lumin-target 应用未正确运行，导致 browser_navigate 失败
2. **次要原因**：前端未暴露到 Docker 网络
3. **设计缺陷**：pre_recon_deliverable.md 生成逻辑缺失
4. **LLM 行为差异**：不同执行中 LLM 的行为不完全可控

## 验证命令

```bash
# 验证后端
curl -X POST http://localhost:8080/login -d "username=admin&password=password123"

# 验证前端
curl http://localhost:5173/

# 验证 worker 到前端的连通性
docker exec lumin-worker-1 curl http://host.docker.internal:5173/
```
