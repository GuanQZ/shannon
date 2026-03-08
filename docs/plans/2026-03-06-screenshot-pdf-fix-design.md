# 截图和PDF生成功能修复方案

**日期:** 2026-03-06
**目标:** 修复截图存储问题，改进PDF生成样式

---

## 1. 需求背景

### 1.1 截图问题
- 截图实际保存在项目根目录 (`repos/shannon-target/*.png`)
- 报告引用路径是 `./xxx.png`，相对于 `deliverables/` 目录
- 导致报告中的图片引用找不到文件
- 历史问题：反复修改多次未能解决

### 1.2 PDF问题
- 当前使用 `markdown-pdf` 生成的PDF样式简陋
- 中文支持不佳
- 代码块无语法高亮

---

## 2. 技术方案

### 2.1 截图路径方案

**采用方案：截图留在项目根目录，报告引用指向根目录**

```
repos/shannon-target/                    # 项目根目录
├── exploit-sqli-001.png                # 截图位置
├── exploit-xss-001.png
└── deliverables/
    └── chinese/reporting/
        └── comprehensive_xxx.md        # 引用 ../exploit-sqli-001.png
```

**修改点：**

| 序号 | 文件 | 改动内容 |
|------|------|----------|
| 1 | prompts/exploit-injection.txt | 截图路径改为 `./xxx.png` |
| 2 | prompts/exploit-xss.txt | 同上 |
| 3 | prompts/exploit-auth.txt | 同上 |
| 4 | prompts/exploit-authz.txt | 同上 |
| 5 | prompts/exploit-ssrf.txt | 同上 |
| 6 | src/phases/translation.ts | 翻译时将 `./xxx.png` 改为 `../xxx.png` |

### 2.2 PDF生成方案

**采用工具：`md-to-pdf`**

**优势：**
- 基于 Puppeteer + Chromium（容器已有）
- 自带代码高亮 (highlight.js)
- 支持自定义 CSS
- 样式美观（类似 GitHub/VSCode 预览）

**依赖：**
```json
{
  "md-to-pdf": "^5.0.0"
}
```

**修改点：**

| 序号 | 文件 | 改动内容 |
|------|------|----------|
| 1 | package.json | 添加 md-to-pdf 依赖 |
| 2 | src/phases/translation.ts | PDF生成从 markdown-pdf 改为 md-to-pdf |

---

## 3. 实施步骤

### Phase 1: 修改提示词
1. 修改5个 exploit 提示词，截图保存到根目录

### Phase 2: 修复翻译脚本
1. 添加图片路径转换逻辑
2. 切换 PDF 生成工具

### Phase 3: 测试验证
1. 重新编译并同步到 Docker
2. 测试翻译和 PDF 生成

---

## 4. 风险评估

| 风险 | 应对措施 |
|------|----------|
| 容器无 Chromium | 已确认容器有 /usr/bin/chromium |
| 图片路径转换遗漏 | 添加单元测试验证 |
| 新工具不兼容 | 先在本地测试 |

---

## 5. 验收标准

- [ ] 截图保存到项目根目录
- [ ] 中文报告中图片引用路径正确 (`../xxx.png`)
- [ ] PDF 包含截图内容
- [ ] PDF 样式美观，代码有高亮
