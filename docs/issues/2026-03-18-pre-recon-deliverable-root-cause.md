# Pre-Recon 阶段 Deliverable 生成问题根因分析

## 问题描述

recon 阶段验证失败，提示找不到 `pre_recon_deliverable.md`。但实际上，这个文件**设计层面就从未被生成过**。

## 设计意图 vs 实际执行

### 设计意图

Pre-recon 阶段应该生成两个 deliverable 文件：

1. **code_analysis_deliverable.md** - 由 pre-recon-code agent 生成（代码分析）
2. **pre_recon_deliverable.md** - 由 stitchPreReconOutputs 函数生成（合并扫描结果 + 代码分析）

```
Wave1 (nmap/subfinder/whatweb) → Wave2 (schemathesis) → stitchPreReconOutputs → pre_recon_deliverable.md
                                    ↑
pre-recon-code agent → code_analysis_deliverable.md ──────────────────────────┘
```

### 实际执行

- ✅ pre-recon-code agent 执行，生成了 `code_analysis_deliverable.md`
- ❌ nmap/subfinder/whatweb 扫描**从未执行**
- ❌ stitchPreReconOutputs 函数**从未被调用**
- ❌ `pre_recon_deliverable.md` **从未生成**

## 根因分析

### 调用链分析

Workflow 的执行流程：

```
workflows.ts
  └── runPreReconAgent(activityInput)
        └── activities.ts: runAgentActivity('pre-recon', input)
              └── 问题出在这里！
```

让我追踪代码：

**1. workflows.ts 调用：**
```typescript
// src/temporal/workflows.ts:194
state.agentMetrics['pre-recon'] = await a.runPreReconAgent(activityInput);
```

**2. activities.ts 导出：**
```typescript
// src/temporal/activities.ts:414
export async function runPreReconAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('pre-recon', input);
}
```

**3. runAgentActivity 是通用函数：**
```typescript
// src/temporal/activities.ts
async function runAgentActivity(agentName: string, input: ActivityInput): Promise<AgentMetrics> {
  // ...
  const result = await executeAgent({
    agentName,
    // ...
  });
  // ...
}
```

**4. executeAgent 函数：**
查看 `src/ai/claude-executor.ts`，executeAgent 调用 Claude Agent SDK 执行 prompt。

**问题核心：**
- `runPreReconAgent` 直接调用 `runAgentActivity('pre-recon', input)`
- `runAgentActivity` 只执行 LLM agent，不执行 Phase 层面的逻辑
- Phase 层面的逻辑（Wave1 扫描、stitchPreReconOutputs）在 `executePreReconPhase` 函数中
- **但 `executePreReconPhase` 从未被调用！**

### executePreReconPhase 函数

这个函数存在于 `src/phases/pre-recon.ts`：

```typescript
// src/phases/pre-recon.ts:382
export async function executePreReconPhase(
  webUrl: string,
  sourceDir: string,
  variables: PromptVariables,
  config: DistributedConfig | null,
  toolAvailability: ToolAvailability,
  pipelineTestingMode: boolean,
  sessionId: string | null = null,
  outputPath: string | null = null
): Promise<PreReconResult> {
  // Wave1: nmap, subfinder, whatweb
  const wave1Results = await runPreReconWave1(...);

  // Wave2: schemathesis
  const wave2Results = await runPreReconWave2(...);

  // 合并生成 pre_recon_deliverable.md
  const preReconReport = await stitchPreReconOutputs(wave1Results, additionalScans, sourceDir);
}
```

**但这个函数在 workflow 中从未被调用。**

## 对比 shannon 项目（原版）

通过 GitHub API 查看 KeygraphHQ/shannon 项目，发现：

1. **相同的验证器配置**：
   - pre-recon 验证器检查 `code_analysis_deliverable.md`
   - recon 验证器检查 `recon_deliverable.md`

2. **相同的 prompt 配置**：
   - pre-recon-code.txt 要求保存 `CODE_ANALYSIS` 类型
   - recon.txt 要求读取 `pre_recon_deliverable.md`

3. **相同的未调用问题**：
   - shannon 的 workflow 也没有调用 `executePreReconPhase`
   - shannon 也有 `stitchPreReconOutputs` 函数但从未调用

**结论**：这是 shannon 和 lumin **共同的设计缺陷**，不是 lumin 特有的问题。

## 验证器期望 vs 实际

| 阶段 | 验证器检查的文件 | 实际生成的文件 |
|------|----------------|--------------|
| pre-recon | `code_analysis_deliverable.md` | ✅ 存在 |
| recon | `recon_deliverable.md` | ❌ 不存在 |

但 prompt 的逻辑问题：

| 阶段 | Prompt 要求读取 | Prompt 要求保存 |
|------|---------------|---------------|
| pre-recon | 无 | `code_analysis_deliverable.md` (CODE_ANALYSIS) |
| recon | `pre_recon_deliverable.md` | `recon_deliverable.md` (RECON) |

**问题**：pre-recon 没有被要求生成 `pre_recon_deliverable.md`，而是被要求生成 `code_analysis_deliverable.md`。

## 三种修复方案

### 方案1：修改 pre-recon prompt（简单）

让 pre-recon-code agent 调用两次 save_deliverable：
1. CODE_ANALYSIS → code_analysis_deliverable.md
2. PRE_RECON → pre_recon_deliverable.md

**优点**：无需改代码
**缺点**：prompt 变得复杂

### 方案2：修改 recon prompt（简单）

让 recon 读取已有的 `code_analysis_deliverable.md`，而不是不存在的 `pre_recon_deliverable.md`

**优点**：改动最小
**缺点**：不符合原始设计意图

### 方案3：修复 workflow 调用链（复杂）

在 workflow 中正确调用 `executePreReconPhase`，让 Phase 层面的逻辑执行。

**优点**：符合原始设计
**缺点**：改动较大，需要理解完整的调用链

## 总结

| 问题 | 根因 |
|------|------|
| pre_recon_deliverable.md 未生成 | executePreReconPhase 函数从未被调用 |
| nmap/subfinder/whatweb 未执行 | 同上，Wave1 扫描在该函数中 |
| 设计 vs 实现不一致 | shannon 和 lumin 共同的设计缺陷 |

这个问题是**架构层面**的问题，不是简单的 bug。需要决定是否修复以及采用哪种方案。
