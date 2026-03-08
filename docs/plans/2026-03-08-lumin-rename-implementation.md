# Lumin Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename project from shannon to Lumin and change cost display from USD to token count

**Architecture:** Two parallel tracks: (1) Token display modification in types/handlers, (2) Global search-and-replace for shannon→Lumin across all files

**Tech Stack:** TypeScript, Bash

---

## Task 1: Token Display (USD → Tokens)

### Task 1.1: Add token field to ResultMessage type

**Files:**
- Modify: `src/ai/types.ts:94-102`

**Step 1: Add total_tokens to ResultMessage**

```typescript
export interface ResultMessage {
  type: 'result';
  result?: string;
  total_cost_usd?: number;
  total_tokens?: number;  // NEW: token count
  duration_ms?: number;
  subtype?: string;
  stop_reason?: string | null;
  permission_denials?: unknown[];
}
```

**Step 2: Commit**

```bash
git add src/ai/types.ts
git commit -m "feat: add total_tokens field to ResultMessage"
```

---

### Task 1.2: Calculate tokens from cost in message-handlers

**Files:**
- Modify: `src/ai/message-handlers.ts:248-254`

**Step 1: Add token calculation constant and modify handleResultMessage**

```typescript
// Add constant at top of file
const TOKENS_PER_DOLLAR = 100_000;

export function handleResultMessage(message: ResultMessage): ResultData {
  const cost = message.total_cost_usd || 0;
  const totalTokens = Math.round(cost * TOKENS_PER_DOLLAR);  // NEW

  const result: ResultData = {
    result: message.result || null,
    cost,                    // Keep for backward compatibility
    total_tokens: totalTokens, // NEW
    duration_ms: message.duration_ms || 0,
    permissionDenials: message.permission_denials?.length || 0,
  };
  // ...
}
```

**Step 2: Commit**

```bash
git add src/ai/message-handlers.ts
git commit -m "feat: calculate token count from cost"
```

---

### Task 1.3: Add token metrics to metrics-tracker

**Files:**
- Modify: `src/audit/metrics-tracker.ts`

**Step 1: Add token fields to interfaces**

```typescript
// In AttemptData interface (line ~32)
interface AttemptData {
  attempt_number: number;
  duration_ms: number;
  cost_usd: number;
  total_tokens: number;  // NEW
  success: boolean;
  timestamp: string;
  model?: string | undefined;
}

// In AgentMetrics interface (line ~43)
interface AgentMetrics {
  status: 'in-progress' | 'success' | 'failed';
  attempts: AttemptData[];
  final_duration_ms: number;
  total_cost_usd: number;
  total_tokens: number;  // NEW
  model?: string | undefined;
  checkpoint?: string | undefined;
}

// In PhaseMetrics interface (line ~51)
interface PhaseMetrics {
  duration_ms: number;
  duration_percentage: number;
  cost_usd: number;
  total_tokens: number;  // NEW
  agent_count: number;
}

// In SessionMetrics interface (line ~66)
interface SessionMetrics {
  total_duration_ms: number;
  total_cost_usd: number;
  total_tokens: number;  // NEW
  phases: Record<string, PhaseMetrics>;
  agents: Record<string, AgentMetrics>;
}
```

**Step 2: Update endAgent to accept and store tokens**

```typescript
interface AgentEndResult {
  attemptNumber: number;
  duration_ms: number;
  cost_usd: number;
  total_tokens: number;  // NEW
  success: boolean;
  // ...
}
```

**Step 3: Update recalculate tokens**

```typescript
private recalculateAggregations to includeAggregations(): void {
  // ... existing code ...

  const totalTokens = successfulAgents.reduce((sum, [, data]) => sum + data.total_tokens, 0);
  this.data.metrics.total_tokens = totalTokens;

  // In phase calculation:
  const phaseTokens = agentList.reduce((sum, agent) => sum + agent.total_tokens, 0);
  phaseMetrics[phaseName] = {
    duration_ms: phaseDuration,
    duration_percentage: calculatePercentage(phaseDuration, totalDuration),
    cost_usd: phaseCost,
    total_tokens: phaseTokens,  // NEW
    agent_count: agentList.length,
  };
}
```

**Step 4: Commit**

```bash
git add src/audit/metrics-tracker.ts
git commit -m "feat: add token metrics tracking"
```

---

### Task 1.4: Update display format in output-formatters

**Files:**
- Modify: `src/ai/output-formatters.ts:70-75`

**Step 1: Change cost display to tokens**

```typescript
// Before:
lines.push(
  chalk.gray(
    `    耗时：${(data.duration_ms / 1000).toFixed(1)}s，成本：$${data.cost.toFixed(4)}`
  )
);

// After:
const tokens = data.total_tokens || Math.round((data.cost || 0) * 100_000);
lines.push(
  chalk.gray(
    `    耗时：${(data.duration_ms / 1000).toFixed(1)}s，${tokens.toLocaleString()} tokens`
  )
);
```

**Step 2: Commit**

```bash
git add src/ai/output-formatters.ts
git commit -m "feat: display token count instead of USD"
```

---

### Task 1.5: Update ResultData interface

**Files:**
- Modify: `src/ai/types.ts:51-58`

**Step 1: Add total_tokens to ResultData**

```typescript
export interface ResultData {
  result: string | null;
  cost: number;
  total_tokens: number;  // NEW
  duration_ms: number;
  subtype?: string;
  stop_reason?: string | null;
  permissionDenials: number;
}
```

**Step 2: Commit**

```bash
git add src/ai/types.ts
git commit -m "feat: add total_tokens to ResultData"
```

---

## Task 2: Project Rename (shannon → Lumin)

### Task 2.1: Rename CLI script

**Files:**
- Rename: `shannon` → `lumin`

**Step 1: Rename file**

```bash
mv shannon lumin
chmod +x lumin
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: rename to lumin"
```

 CLI script---

### Task 2.2: Update package.json

**Files:**
- Modify: `package.json`

**Step 1: Update name and bin**

```json
{
  "name": "lumin",
  "bin": {
    "lumin": "./lumin"
  }
}
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "feat: rename package to lumin"
```

---

### Task 2.3: Update shannon CLI script internals

**Files:**
- Modify: `lumin` (formerly shannon)

**Step 1: Replace all shannon references**

```bash
# In the lumin file, replace:
# - "shannon" → "lumin" (case sensitive for variable names)
# - "Shannon" → "Lumin"
# - "SHANNON" → "LUMIN"
# - "./shannon" → "./lumin"
# - "shannon-" → "lumin-"
# - "shannon-router-key" → "lumin-router-key"
# - "SHANNON_DISABLE_GIT_WRITES" → "LUMIN_DISABLE_GIT_WRITES"

# Key replacements:
sed -i '' 's/SHANNON/LUMIN/g' lumin
sed -i '' 's/Shannon/Lumin/g' lumin
sed -i '' 's/"\.\/shannon"/".\/lumin"/g' lumin
sed -i '' 's/shannon-/lumin-/g' lumin
sed -i '' 's/shannon_router_key/lumin_router_key/g' lumin
sed -i '' 's/SHANNON_DISABLE_GIT_WRITES/LUMIN_DISABLE_GIT_WRITES/g' lumin
```

**Step 2: Also replace variable references in help text**

```bash
sed -i '' 's/shannon/lumin/g' lumin
```

**Step 3: Commit**

```bash
git add lumin
git commit -m "feat: update shannon references in CLI script"
```

---

### Task 2.4: Update splash-screen.ts

**Files:**
- Modify: `src/splash-screen.ts`

**Step 1: Replace ASCII art and variables**

- Change `'SHANNON'` → `'LUMIN'`
- Change `shannonText` → `luminText`
- Change `gradientShannon` → `gradientLumin`

**Step 2: Commit**

```bash
git add src/splash-screen.ts
git commit -m "feat: update splash screen to Lumin"
```

---

### Task 2.5: Update constants.ts

**Files:**
- Modify: `src/constants.ts`

**Step 1: Check for shannon references and replace**

```bash
grep -n "shannon" src/constants.ts
```

Then replace any occurrences.

**Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat: update constants"
```

---

### Task 2.6: Update all other source files

**Files:**
- Modify: All `.ts` files in `src/` with shannon references

**Step 1: Find all remaining references**

```bash
grep -r "shannon" src/ --include="*.ts" -l
```

**Step 2: Replace in each file**

For each file, replace:
- `shannon` → `lumin`
- `Shannon` → `Lumin`

Common files to check:
- src/temporal/workflows.ts
- src/temporal/activities.ts
- src/temporal/client.ts
- src/temporal/worker.ts
- src/temporal/query.ts
- src/audit/logger.ts
- src/audit/index.ts
- src/audit/utils.ts
- src/audit/workflow-logger.ts
- src/cli/ui.ts
- src/ai/claude-executor.ts
- src/ai/message-handlers.ts
- src/ai/audit-logger.ts
- src/setup/environment.ts

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: rename shannon to Lumin in source files"
```

---

### Task 2.7: Update MCP server

**Files:**
- Modify: `mcp-server/package.json`
- Modify: `mcp-server/src/index.ts`

**Step 1: Update package.json name**

```json
{
  "name": "lumin-mcp-server"
}
```

**Step 2: Replace shannon references in source**

```bash
grep -r "shannon" mcp-server/src/ -l
```

Replace all occurrences.

**Step 3: Commit**

```bash
git add mcp-server/
git commit -m "feat: rename MCP server to Lumin"
```

---

### Task 2.8: Update configuration files

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile`
- Modify: `.env.example`
- Modify: `configs/router-config.json`

**Step 1: Replace shannon in each file**

```bash
grep -l "shannon" *.yml *.yaml Dockerfile .env.example 2>/dev/null
```

Replace all occurrences.

**Step 2: Commit**

```bash
git add docker-compose.yml Dockerfile .env.example configs/router-config.json
git commit -m "feat: update config files for Lumin"
```

---

### Task 2.9: Update README and docs

**Files:**
- Modify: `README.md`

**Step 1: Replace shannon references**

Replace all shannon → Lumin in README.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for Lumin"
```

---

## Verification

After all tasks complete:

```bash
# Test CLI
./lumin help

# Verify no shannon references remain
grep -r "shannon" . --include="*.ts" --include="*.js" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.sh" --include="*.md" | grep -v node_modules | grep -v ".git" | grep -v "xben-benchmark" | grep -v "worktrees"
```

Expected: No matches (except possibly in historical data)

---

## Plan complete

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
