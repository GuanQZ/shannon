# Pre-Recon 阶段 Deliverable 生成修复记录

## 日期
2026-03-18

## 问题描述
recon 阶段验证失败，提示找不到 `pre_recon_deliverable.md`。根因是 `executePreReconPhase` 函数从未被调用。

## 修复方案
采用方案3：修复 workflow 调用链，在 `runPreReconAgent` 中先执行 LLM 生成 `code_analysis_deliverable.md`，再执行扫描工具生成 `pre_recon_deliverable.md`。

## 修改内容

### 1. src/temporal/activities.ts

**新增 imports:**
```typescript
import { checkToolAvailability, type ToolAvailability } from '../tool-checker.js';
import { executePreReconPhase } from '../phases/pre-recon.js';
```

**修改 runPreReconAgent 函数:**
- 先执行 LLM 代码分析（生成 code_analysis_deliverable.md）
- 再执行外部扫描工具（生成 pre_recon_deliverable.md）

### 2. src/phases/pre-recon.ts

**修改 runPreReconWave1 函数:**
- 新增 `skipCodeAnalysis` 参数
- 当从 executePreReconPhase 调用时跳过 LLM（因为 LLM 已在 runAgentActivity 中执行）

## 执行流程（修复后）

```
runPreReconAgent(input)
  │
  ├─► 1. runAgentActivity('pre-recon')  ← LLM 执行代码分析
  │      → 生成 code_analysis_deliverable.md
  │
  └─► 2. executePreReconPhase()  ← 扫描工具
         ├─► runPreReconWave1() (skipCodeAnalysis=true)
         │    ├─► nmap 扫描
         │    ├─► subfinder 扫描
         │    └─► whatweb 扫描
         │
         ├─► runPreReconWave2()
         │    └─► schemathesis 扫描
         │
         └─► stitchPreReconOutputs()
              → 读取 code_analysis_deliverable.md
              → 生成 pre_recon_deliverable.md
```

## 测试结果

### ✅ 成功
- `pre_recon_deliverable.md` 成功生成
- pre-recon 阶段完整执行
- 扫描工具执行（subfinder 成功，nmap/whatweb 因容器架构问题失败）

### ⚠️ 已知问题
1. **nmap/whatweb 失败**: Docker 容器运行在 arm64 (Apple Silicon)，但镜像是 amd64 编译的
   - nmap 需要 `--cap-add=NET_RAW` + 特殊处理
   - whatweb 镜像构建时未正确安装
2. **recon 阶段问题**: LLM 执行时间过短，未能生成 recon_deliverable.md（待排查）

## 回退方法
```bash
git checkout -- src/temporal/activities.ts src/phases/pre-recon.ts
npm run build
docker compose restart worker
```

## 相关文档
- [2026-03-18-pre-recon-deliverable-root-cause.md](2026-03-18-pre-recon-deliverable-root-cause.md) - 根因分析
- [2026-03-18-pre-recon-debugging.md](2026-03-18-pre-recon-debugging.md) - 排查记录
