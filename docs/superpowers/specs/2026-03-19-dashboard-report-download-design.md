# Dashboard 报告下载功能设计

## 目标
在 Dashboard 展示页面添加报告下载功能，用户可以查看并下载当前工作流对应的 deliverables 文件。

## 功能需求

1. **下载按钮**：在右侧 sidebar 底部添加"查看报告"按钮
2. **文件树弹窗**：点击按钮弹出模态框，显示 deliverables 目录的文件树
3. **文件夹展开/折叠**：支持展开/折叠文件夹
4. **单文件下载**：点击文件可以下载该文件

## 技术方案

### 数据流

```
session.json (repoPath) → 映射到容器内路径 → 读取 deliverables 文件树 → 前端展示
```

### Session 到 Repo 的映射

从 `audit-logs/{session}/session.json` 读取：
```json
{
  "session": {
    "repoPath": "/app/repos/lumin-20260318-230426-8297"
  }
}
```

### API 设计

#### 1. 获取文件树
```
GET /api/deliverables-tree?sessionId={sessionId}
```

响应：
```json
{
  "tree": [
    { "name": "pre_recon_deliverable.md", "type": "file", "path": "/app/repos/xxx/deliverables/pre_recon_deliverable.md" },
    { "name": "recon_deliverable.md", "type": "file", "path": "..." },
    { "name": "subdir", "type": "dir", "children": [...] }
  ]
}
```

#### 2. 下载文件
```
GET /api/deliverables/download?path={encodedPath}
```

- 后端验证 path 必须在 `/app/repos/` 目录下（防止路径穿越）
- 设置 `Content-Disposition: attachment` 触发下载

### 前端实现

#### 1. 按钮
- 位置：右侧 sidebar 底部，Agent 列表下方
- 样式：与现有按钮风格一致

#### 2. 弹窗组件
- 模态框遮罩层
- 标题："{sessionId} 的报告"
- 文件树容器（可滚动）
- 关闭按钮

#### 3. 文件树渲染逻辑
- 递归渲染目录和文件
- 点击文件夹切换展开/折叠
- 点击文件触发下载

## 文件修改

1. **server.js** - 新增 2 个 API 路由
2. **client.js** - 新增弹窗组件和文件树渲染逻辑
3. **index.html** - 无改动（或添加弹窗容器）
4. **styles.css** - 添加弹窗和文件树样式

## 边界情况处理

1. **session.json 不存在或无 repoPath**：弹窗显示"无法找到报告目录"
2. **deliverables 目录不存在**：显示"报告目录不存在"
3. **目录为空**：显示"暂无报告文件"
4. **文件读取失败**：显示错误信息

## 实现顺序

1. 后端：文件树 API
2. 后端：文件下载 API
3. 前端：弹窗组件
4. 前端：文件树渲染
5. 联调测试
