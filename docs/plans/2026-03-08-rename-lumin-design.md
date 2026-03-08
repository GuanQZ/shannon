# Project Rename & Token Display Design

## Overview

1. **Project Rename**: shannon → Lumin
2. **Cost Display**: USD → token count
3. **Script Rename**: ./shannon → ./lumin

---

## Task 1: Token Display

### Problem
Current SDK returns `total_cost_usd` (dollars). Need to display as token count.

### Solution: Estimation Formula

```typescript
// Claude Sonnet 4-20250514: ~$10/1M average
const TOKENS_PER_DOLLAR = 100_000;
const totalTokens = Math.round(total_cost_usd * TOKENS_PER_DOLLAR);
```

### Files to Modify

| File | Change |
|------|--------|
| `src/ai/types.ts` | Add `total_tokens` to ResultMessage |
| `src/ai/message-handlers.ts` | Calculate tokens from cost |
| `src/audit/metrics-tracker.ts` | Add token metrics |
| `src/ai/output-formatters.ts` | Display `12340 tokens` instead of `$0.1234` |

### Display Format
- Before: `成本：$0.1234`
- After: `12340 tokens`

---

## Task 2: Project Rename

### Scope
All references to "shannon" → "Lumin" across entire codebase.

### Replace Rules

| Type | Example |
|------|---------|
| ASCII art | `SHANNON` → `LUMIN` |
| CLI references | `./shannon` → `./lumin` |
| Environment variables | `SHANNON_DISABLE_GIT_WRITES` → `LUMIN_DISABLE_GIT_WRITES` |
| Variables | `shannonText` → `luminText` |
| Comments | `Shannon CLI` → `Lumin CLI` |

### Core Files

**Root**
- `shannon` → `lumin` (rename file)
- `package.json`
- `README.md`

**Config**
- `docker-compose.yml`
- `Dockerfile`
- `.env.example`

**Source Code**
- `src/splash-screen.ts` (ASCII art)
- `src/constants.ts`
- All `.ts` files with shannon references

**MCP Server**
- `mcp-server/package.json`
- `mcp-server/src/index.ts`

---

## Verification

After implementation:
1. `./lumin help` displays correctly
2. `./lumin start` works
3. Dashboard shows token count instead of USD
