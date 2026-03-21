# Dashboard 报告下载功能实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Dashboard 展示页面添加报告下载功能，用户可以查看并下载当前工作流对应的 deliverables 文件

**Architecture:** 后端提供两个 API（文件树 + 文件下载），前端使用纯 JS 实现弹窗和文件树组件

**Tech Stack:** 纯 HTML/CSS/JS，无额外依赖

---

## 文件修改清单

| 文件 | 改动 |
|------|------|
| `dashboard/server.js` | 新增 2 个 API 路由 |
| `dashboard/client.js` | 新增弹窗组件、文件树渲染逻辑、下载按钮 |
| `dashboard/index.html` | 无改动 |
| `dashboard/styles.css` | 新增弹窗和文件树样式 |

---

## 实现步骤

### Chunk 1: 后端 API 实现

#### Task 1: 新增文件树 API

**Files:**
- Modify: `dashboard/server.js`

- [ ] **Step 1: 添加 deliverables-tree API 路由**

在 `server.js` 中找到 API 路由定义区域，在 `/api/workflow-status` 路由之后添加：

```javascript
// 获取 deliverables 文件树 API
if (req.url.startsWith('/api/deliverables-tree')) {
  (async () => {
    try {
      // 从 session.json 读取 repoPath
      const sessionJsonPath = path.join(AUDIT_LOGS_DIR, sessionId, 'session.json');
      let repoPath = null;

      if (fs.existsSync(sessionJsonPath)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
        repoPath = sessionData.session?.repoPath;
      }

      if (!repoPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无法找到报告目录' }));
        return;
      }

      const deliverablesDir = path.join(repoPath, 'deliverables');

      if (!fs.existsSync(deliverablesDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tree: [], error: '报告目录不存在' }));
        return;
      }

      // 递归构建文件树
      function buildTree(dirPath, relativePath = '') {
        const items = fs.readdirSync(dirPath);
        const tree = [];

        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const relPath = path.join(relativePath, item);
          const stats = fs.statSync(fullPath);

          if (stats.isDirectory()) {
            tree.push({
              name: item,
              type: 'dir',
              path: relPath,
              children: buildTree(fullPath, relPath)
            });
          } else {
            tree.push({
              name: item,
              type: 'file',
              path: relPath
            });
          }
        }

        // 按文件夹在前、文件在后排序
        tree.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return tree;
      }

      const tree = buildTree(deliverablesDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tree, repoPath }));
    } catch (e) {
      console.error('deliverables-tree error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  })();
  return;
}
```

- [ ] **Step 2: 添加文件下载 API 路由**

在同一文件中添加：

```javascript
// 下载单个文件 API
if (req.url.startsWith('/api/deliverables/download')) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const encodedPath = url.searchParams.get('path');

    if (!encodedPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少文件路径' }));
      return;
    }

    // 解码路径
    const relativePath = decodeURIComponent(encodedPath);

    // 从 session.json 读取 repoPath
    const sessionJsonPath = path.join(AUDIT_LOGS_DIR, sessionId, 'session.json');
    let repoPath = null;

    if (fs.existsSync(sessionJsonPath)) {
      const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
      repoPath = sessionData.session?.repoPath;
    }

    if (!repoPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无法找到报告目录' }));
      return;
    }

    // 构建完整文件路径
    const filePath = path.join(repoPath, 'deliverables', relativePath);

    // 安全检查：确保文件路径在 deliverables 目录内
    const deliverablesDir = path.join(repoPath, 'deliverables');
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(deliverablesDir);

    if (!resolvedPath.startsWith(resolvedDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '禁止访问' }));
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '文件不存在' }));
      return;
    }

    // 读取文件并返回
    const content = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName}"`
    });
    res.end(content);
  } catch (e) {
    console.error('download error:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}
```

---

### Chunk 2: 前端实现

#### Task 2: 新增下载按钮

**Files:**
- Modify: `dashboard/client.js`

- [ ] **Step 1: 在 renderAgentList 函数末尾添加下载按钮**

找到 `renderAgentList` 函数，在 `container.innerHTML = html;` 之后添加：

```javascript
// 添加报告下载按钮
html += `<div class="download-section">`;
html += `<button class="download-btn" onclick="showDeliverablesModal()">`;
html += `<span class="download-icon">📁</span> 查看报告`;
html += `</button>`;
html += `</div>`;
container.innerHTML = html;
```

注意：需要把上面的 `container.innerHTML = html;` 移到添加按钮之前。

#### Task 3: 新增弹窗组件和文件树

- [ ] **Step 2: 在 client.js 末尾添加弹窗相关函数**

在文件末尾（`renderAgentList` 函数之后）添加：

```javascript
// 弹窗状态
let isModalOpen = false;

// 显示 deliverables 弹窗
async function showDeliverablesModal() {
  const modal = document.getElementById('deliverables-modal');
  if (!modal) {
    createModalHTML();
  }
  modal = document.getElementById('deliverables-modal');
  modal.style.display = 'flex';
  isModalOpen = true;

  // 加载文件树
  await loadDeliverablesTree();
}

// 创建弹窗 HTML（仅首次）
function createModalHTML() {
  const body = document.body;
  const modalHtml = `
    <div id="deliverables-modal" class="modal" style="display:none">
      <div class="modal-content">
        <div class="modal-header">
          <h3 id="modal-title">报告文件</h3>
          <button class="modal-close" onclick="closeDeliverablesModal()">×</button>
        </div>
        <div class="modal-body" id="deliverables-tree">
          <div class="loading">加载中...</div>
        </div>
      </div>
    </div>
  `;
  body.insertAdjacentHTML('beforeend', modalHtml);
}

// 关闭弹窗
function closeDeliverablesModal() {
  const modal = document.getElementById('deliverables-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  isModalOpen = false;
}

// 加载文件树
async function loadDeliverablesTree() {
  try {
    const resp = await fetch('/api/deliverables-tree');
    const data = await resp.json();

    const container = document.getElementById('deliverables-tree');

    if (data.error) {
      container.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
      return;
    }

    if (!data.tree || data.tree.length === 0) {
      container.innerHTML = '<div class="empty">暂无报告文件</div>';
      return;
    }

    // 渲染文件树
    container.innerHTML = renderFileTree(data.tree);
  } catch (e) {
    console.error('Failed to load tree:', e);
    document.getElementById('deliverables-tree').innerHTML =
      `<div class="error">加载失败: ${e.message}</div>`;
  }
}

// 渲染文件树（递归）
function renderFileTree(items, level = 0) {
  let html = '<ul class="file-tree" style="margin-left:' + (level * 16) + 'px">';

  for (const item of items) {
    if (item.type === 'dir') {
      html += `
        <li class="tree-dir">
          <span class="tree-toggle" onclick="toggleDir(this)">▶</span>
          <span class="tree-folder" onclick="toggleDir(this)">📁 ${escapeHtml(item.name)}</span>
          <div class="tree-children" style="display:none">
            ${renderFileTree(item.children || [], level + 1)}
          </div>
        </li>
      `;
    } else {
      html += `
        <li class="tree-file">
          <span class="tree-file-icon">📄</span>
          <a href="#" onclick="downloadFile('${encodeURIComponent(item.path)}'); return false;">
            ${escapeHtml(item.name)}
          </a>
        </li>
      `;
    }
  }

  html += '</ul>';
  return html;
}

// 切换文件夹展开/折叠
function toggleDir(el) {
  const li = el.closest('li');
  const children = li.querySelector('.tree-children');
  const toggle = li.querySelector('.tree-toggle');

  if (children.style.display === 'none') {
    children.style.display = 'block';
    if (toggle) toggle.textContent = '▼';
  } else {
    children.style.display = 'none';
    if (toggle) toggle.textContent = '▶';
  }
}

// 下载文件
function downloadFile(encodedPath) {
  const path = decodeURIComponent(encodedPath);
  const url = '/api/deliverables/download?path=' + encodeURIComponent(path);
  window.open(url, '_blank');
}
```

#### Task 4: 添加样式

**Files:**
- Modify: `dashboard/styles.css`

- [ ] **Step 3: 添加弹窗和文件树样式**

在 `styles.css` 末尾添加：

```css
/* 下载按钮 */
.download-section {
  padding: 12px;
  border-top: 1px solid #333;
}

.download-btn {
  width: 100%;
  padding: 10px 16px;
  background: #4a9eff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.download-btn:hover {
  background: #3a8eef;
}

.download-icon {
  font-size: 16px;
}

/* 弹窗 */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #1e1e1e;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 16px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  color: #fff;
}

.modal-close {
  background: none;
  border: none;
  color: #888;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.modal-close:hover {
  color: #fff;
}

.modal-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

/* 文件树 */
.file-tree {
  list-style: none;
  padding: 0;
  margin: 0;
}

.file-tree ul {
  list-style: none;
  padding-left: 16px;
}

.tree-dir, .tree-file {
  padding: 4px 0;
}

.tree-toggle {
  cursor: pointer;
  color: #888;
  margin-right: 4px;
  font-size: 10px;
}

.tree-folder {
  cursor: pointer;
  color: #ffd700;
}

.tree-folder:hover {
  color: #ffea70;
}

.tree-file a {
  color: #4a9eff;
  text-decoration: none;
}

.tree-file a:hover {
  text-decoration: underline;
}

.tree-file-icon {
  margin-right: 4px;
}

.loading, .empty, .error {
  padding: 20px;
  text-align: center;
  color: #888;
}

.error {
  color: #ff6b6b;
}
```

---

### Chunk 3: 联调测试

- [ ] **Step 4: 测试 API**

在容器内测试：
```bash
# 测试文件树 API
curl http://localhost:3457/api/deliverables-tree

# 测试文件下载 API
curl -o test.md "http://localhost:3457/api/deliverables/download?path=pre_recon_deliverable.md"
```

- [ ] **Step 5: 测试前端**

访问 http://localhost:3457 ，确认：
1. 右侧 sidebar 底部显示"查看报告"按钮
2. 点击按钮弹出模态框
3. 文件树正常显示
4. 文件夹可展开/折叠
5. 点击文件可下载
