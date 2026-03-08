# 渗透测试报告自动翻译功能设计文档

**项目**：Shannon 渗透测试框架
**日期**：2026-03-03
**功能**：渗透测试报告自动翻译为中文

---

## 1. 概述

在 Reporting 阶段完成后，自动翻译所有英文报告为中文，并按阶段分类存放。翻译不影响现有工作流，英文原版报告保持不变。

### 1.1 设计目标

- **自动化**：渗透流程结束后自动触发翻译，无需手动干预
- **完整性**：翻译所有阶段产生的报告文件
- **隔离性**：中文报告独立存放，不影响英文原版
- **容错性**：部分文件翻译失败不影响整体流程

### 1.2 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 翻译 API | Claude API | 复用现有 `ANTHROPIC_API_KEY` |
| Activity | Temporal Activity | 新增翻译 Activity 集成到工作流 |

## 2. 翻译范围

### 2.1 需要翻译的报告

| 阶段 | 报告文件 | 阶段标识 |
|------|----------|----------|
| Pre-Recon | `pre_recon_deliverable.md` | pre-recon |
| Recon | `recon_deliverable.md`, `code_analysis_deliverable.md` | recon |
| Vulnerability Analysis | `*_analysis_deliverable.md` (5个) | vulnerability |
| Exploitation | `*_exploitation_evidence.md` | exploitation |
| Reporting | `comprehensive_security_assessment_report.md` | reporting |

### 2.2 存放结构

```
repos/{repo}/
└── deliverables/
    ├── *.md                    (英文原版)
    └── chinese/                (新增)
        ├── pre-recon/
        │   └── pre_recon_deliverable.md
        ├── recon/
        │   ├── recon_deliverable.md
        │   └── code_analysis_deliverable.md
        ├── vulnerability/
        │   └── *_analysis_deliverable.md
        ├── exploitation/
        │   └── *_exploitation_evidence.md
        └── reporting/
            └── comprehensive_security_assessment_report.md
```

### 2.3 阶段映射规则

| 文件名前缀 | 目标文件夹 |
|------------|------------|
| `pre_recon` | pre-recon |
| `recon` | recon |
| `code_analysis` | recon |
| `*_analysis` (vuln type) | vulnerability |
| `*_exploitation_evidence` | exploitation |
| `comprehensive_security_assessment` | reporting |

## 3. 翻译规则

- **专业术语**：保留英文（SQL injection、XSS、payload、endpoint、CVE、HTTP、API 等）
- **叙事内容**：翻译为简体中文
- **格式**：保持 Markdown 格式、代码块、表格不变
- **标题**：保留英文标题或翻译为中文（可选）

## 4. 技术实现

### 4.1 文件结构

```
src/
├── phases/
│   └── translation.ts    # 新增：翻译 Activity 实现
├── temporal/
│   ├── activities.ts     # 修改：注册翻译 Activity
│   └── workflows.ts      # 修改：在 Reporting 后调用翻译
```

### 4.2 Activity 接口

```typescript
// src/phases/translation.ts
export interface TranslateReportsInput {
  repoPath: string;        // 仓库路径
}

export interface TranslateReportsOutput {
  success: boolean;
  translatedFiles: string[];
  failedFiles: { path: string; error: string }[];
}
```

### 4.3 工作流集成

在 `workflows.ts` 的 Reporting 阶段完成后添加：

```typescript
// === Phase 6: Translation (新增) ===
// 翻译所有报告为中文
await a.translateReportsActivity(activityInput);
```

### 4.4 翻译流程

1. **扫描**：读取 `deliverables/` 下所有 `.md` 文件
2. **过滤**：跳过 `chinese/` 子目录
3. **分类**：根据文件名确定目标阶段文件夹
4. **翻译**：调用 LLM API 翻译内容
5. **写入**：保存到 `chinese/{阶段}/{原文件名}`
6. **重试**：失败文件重试 3 次，间隔 5 秒
7. **完成**：记录成功/失败文件列表

### 4.5 错误处理

| 场景 | 处理方式 |
|------|----------|
| API 超时 | 重试 3 次，每次间隔 5 秒 |
| 文件读取失败 | 记录错误，跳过该文件 |
| 翻译失败 | 记录错误，继续处理其他文件 |
| 目录创建失败 | 记录错误，跳过该文件 |

## 5. 实现任务

1. 创建 `src/phases/translation.ts` - 翻译 Activity 实现
2. 修改 `src/temporal/activities.ts` - 注册翻译 Activity
3. 修改 `src/temporal/workflows.ts` - 在 Reporting 后调用翻译
4. 测试翻译功能

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 翻译 Activity 正确注册到 Temporal
- [ ] 所有 .md 文件（除 chinese/ 子目录）都被翻译
- [ ] 中文文件正确存放到对应阶段子目录
- [ ] 专业术语保留英文
- [ ] 失败文件重试逻辑正确

### 6.2 工作流验收

- [ ] 翻译在 Reporting 阶段后自动执行
- [ ] 翻译失败不影响整体流程完成
- [ ] 英文原版报告保持不变

---

**文档状态**：已批准
**批准日期**：2026-03-03
