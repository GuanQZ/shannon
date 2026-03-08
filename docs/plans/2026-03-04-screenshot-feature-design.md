# 截图功能设计方案

**日期:** 2026-03-04
**目标:** 在渗透测试报告中添加截图功能，增强证据可信度

---

## 1. 需求概述

- 在exploitation阶段的证据报告中添加截图
- 截图用于证明确实成功利用了漏洞
- 英文报告使用路径引用（节省token）
- 中文报告使用base64嵌入（自包含，可直接分享）
- 截图命名清晰，不重名

---

## 2. 技术方案

### 2.1 截图存储结构

```
repos/bwapp/deliverables/
├── screenshots/          # 所有截图
│   ├── vuln-injection-sqli-001.png
│   ├── exploit-xss-reflected-001.png
│   └── ...
└── *.md                 # 原始报告（含路径引用）
```

**命名规则:** `[阶段]-[漏洞类型]-[序号].png`
- 阶段: `vuln-` (分析) / `exploit-` (利用)
- 漏洞类型: `injection`, `xss`, `auth`, `authz`, `ssrf`
- 序号: 001, 002, ...

### 2.2 提示词修改

在5个正式版exploit提示词中添加截图指导:

| 文件 | 位置 | 内容 |
|------|------|------|
| prompts/exploit-injection.txt | 证据要求部分 | 截图指导 |
| prompts/exploit-xss.txt | 证据要求部分 | 截图指导 |
| prompts/exploit-auth.txt | 证据要求部分 | 截图指导 |
| prompts/exploit-authz.txt | 证据要求部分 | 截图指导 |
| prompts/exploit-ssrf.txt | 证据要求部分 | 截图指导 |

**截图指导内容:**
```
### 截图要求
1. 使用 Playwright MCP 工具截取关键步骤截图
2. 截图文件保存到 `screenshots/` 目录
3. 文件命名格式: `[阶段]-[漏洞类型]-[序号].png`
4. 在证据报告中使用路径引用: `![描述](./screenshots/xxx.png)`
5. 每个成功利用的漏洞至少包含一张截图
```

### 2.3 翻译流程增强

在报告翻译脚本中增加图片嵌入功能:

**翻译后处理:**
1. 扫描中文报告中的图片路径引用
2. 读取对应的截图文件
3. 转换为base64嵌入到md中
4. 生成自包含的中文报告

---

## 3. Token消耗分析

| 阶段 | 方式 | Token消耗 |
|------|------|----------|
| Agent生成报告 | 路径引用 | ~0 |
| 报告翻译 | 路径引用保留 | ~0 |
| 中文报告后处理 | base64嵌入 | ~0 (纯代码处理) |

---

## 4. 兼容性

- 截图路径引用会被翻译流程保留
- 中文报告生成时自动嵌入图片
- 不影响现有交付物结构

---

## 5. 实施步骤

### Phase 1: 提示词修改
1. 修改5个exploit提示词，添加截图指导

### Phase 2: 翻译脚本增强
1. 在翻译报告中增加图片嵌入功能

### Phase 3: 测试验证
1. 使用现有报告测试截图嵌入功能

---

## 6. 待修改文件

- prompts/exploit-injection.txt
- prompts/exploit-xss.txt
- prompts/exploit-auth.txt
- prompts/exploit-authz.txt
- prompts/exploit-ssrf.txt
- src/phases/translation.ts (或新建处理脚本)
