# 中文报告 PDF 生成设计方案

## 概述

将中文渗透测试报告的输出格式从 Markdown（base64 嵌入图片）改为 PDF（路径引用图片），减少 token 消耗并提升报告可分享性。

## 当前流程

| 报告类型 | 输出格式 | 图片处理 |
|---------|---------|---------|
| 英文报告 | .md | 路径引用（如 `./screenshots/vuln-xxx.png`） |
| 中文报告 | .md | base64 嵌入（消耗大量 token） |

## 改进后流程

| 报告类型 | 输出格式 | 图片处理 |
|---------|---------|---------|
| 英文报告 | .md | 路径引用（保持不变）|
| 中文报告 | .pdf | 路径引用（无需 base64） |

## 技术方案

### 依赖

添加 `markdown-pdf` 包到 `package.json`：

```json
"markdown-pdf": "^11.0.0"
```

### 文件修改

1. **package.json** - 添加依赖
2. **src/phases/translation.ts** - 翻译完成后调用 PDF 生成

### 输出结构

```
repos/{repo}/
├── deliverables/
│   ├── english/           # 英文报告 (.md)
│   │   ├── reporting/
│   │   └── ...
│   ├── chinese/           # 中文报告 (.pdf)
│   │   ├── reporting/
│   │   └── ...
│   └── screenshots/      # 截图文件（不变）
│       └── ...
```

### 图片路径说明

- 中文 PDF 报告中的图片使用相对路径引用
- 路径格式：`../screenshots/xxx.png`（相对于 PDF 文件位置）
- 图片文件本身存于 `deliverables/screenshots/`

## 实施步骤

1. 添加 `markdown-pdf` 依赖并安装
2. 修改 `src/phases/translation.ts`，在翻译完成后生成 PDF
3. 测试验证 PDF 生成和图片显示

## 待确认

- PDF 样式是否需要自定义（如页眉页脚、字体）
