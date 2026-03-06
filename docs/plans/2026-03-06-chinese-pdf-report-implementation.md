# 中文报告 PDF 生成实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将中文渗透测试报告的输出格式从 Markdown（base64 嵌入图片）改为 PDF（路径引用图片）

**Architecture:** 在翻译阶段完成后，使用 markdown-pdf 将翻译好的中文 Markdown 文件转换为 PDF，保留图片路径引用

**Tech Stack:** markdown-pdf (Node.js), TypeScript

---

## Task 1: 添加 markdown-pdf 依赖

**Files:**
- Modify: `package.json`

**Step 1: 添加依赖到 package.json**

修改 package.json，在 dependencies 中添加：

```json
"markdown-pdf": "^11.0.0"
```

文件路径: `/Users/zengguanqin/VSCodeWorkspace/shannon/package.json:13-28`

**Step 2: 安装依赖**

Run: `npm install`

Expected: 安装成功，package-lock.json 更新

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add markdown-pdf for Chinese report generation"
```

---

## Task 2: 修改翻译模块生成 PDF

**Files:**
- Modify: `src/phases/translation.ts`

**Step 1: 读取当前 translation.ts 文件**

查看现有的翻译和图片嵌入逻辑，了解代码结构

文件路径: `/Users/zengguanqin/VSCodeWorkspace/shannon/src/phases/translation.ts`

**Step 2: 添加 PDF 生成函数**

在 translation.ts 中添加 PDF 生成函数，使用 markdown-pdf：

```typescript
import markdownpdf from 'markdown-pdf';

/**
 * Convert markdown to PDF
 * 将 Markdown 转换为 PDF
 */
async function convertMarkdownToPdf(
  markdownPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    markdownpdf()
      .from(markdownPath)
      .to(outputPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
  });
}
```

**Step 3: 修改 translateReports 函数**

在 translateReports 函数中，翻译完成后：
1. 不再调用 embedImagesInDirectory（跳过 base64 嵌入）
2. 改为调用 convertMarkdownToPdf 生成 PDF

修改位置: `src/phases/translation.ts:237-256`（当前调用 embedImagesInDirectory 的部分）

替换为：

```typescript
// Generate PDF from translated Chinese reports
if (translatedFiles.length > 0) {
  console.log(chalk.blue('📄 Generating PDF from Chinese reports...'));

  for (const relativePath of translatedFiles) {
    const mdPath = path.join(deliverablesDir, relativePath);
    const pdfPath = mdPath.replace('.md', '.pdf');

    try {
      await convertMarkdownToPdf(mdPath, pdfPath);
      console.log(chalk.green(`✅ PDF generated: ${path.basename(pdfPath)}`));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to generate PDF: ${path.basename(mdPath)}: ${error}`));
    }
  }
}
```

**Step 4: 验证 TypeScript 编译**

Run: `npm run build`

Expected: 编译成功，无错误

**Step 5: Commit**

```bash
git add src/phases/translation.ts
git commit -m "feat: generate PDF instead of base64-embedded markdown for Chinese reports"
```

---

## Task 3: 测试验证

**Files:**
- Test: 已有测试目录或手动测试

**Step 1: 运行翻译功能测试**

确保翻译功能正常工作

**Step 2: 验证 PDF 生成**

检查生成的 PDF 文件：
- 文件存在于 `deliverables/chinese/**/*.pdf`
- PDF 中图片正确显示（使用路径引用）

---

## 实施顺序

1. Task 1: 添加依赖
2. Task 2: 修改代码
3. Task 3: 测试验证
