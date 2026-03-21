const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3457;
const AUDIT_LOGS_DIR = path.join(__dirname, '..', 'audit-logs');
const CHINESE_AGENTS_DIR = 'chinese-agents';

// 解析命令行参数
const args = process.argv.slice(2);
const sessionArg = args.find(arg => arg.startsWith('--session='));
let sessionId = sessionArg ? sessionArg.split('=')[1] : undefined;

if (!sessionId) {
  // 如果没有指定session，自动查找最新的运行中工作流
  if (fs.existsSync(AUDIT_LOGS_DIR)) {
    const sessions = fs.readdirSync(AUDIT_LOGS_DIR).filter(f => {
      return fs.statSync(path.join(AUDIT_LOGS_DIR, f)).isDirectory();
    });
    // 按修改时间倒序排列（最新的在前）
    sessions.sort((a, b) => {
      const statA = fs.statSync(path.join(AUDIT_LOGS_DIR, a));
      const statB = fs.statSync(path.join(AUDIT_LOGS_DIR, b));
      return statB.mtimeMs - statA.mtimeMs;
    });
    console.log('Available sessions (newest first):');
    sessions.slice(0, 5).forEach(s => console.log(`  - ${s}`));
    if (sessions.length > 0) {
      sessionId = sessions[0]; // 使用最新的
      console.log(`Using latest session: ${sessionId}`);
    } else {
      console.error('No sessions found in audit-logs/');
      process.exit(1);
    }
  } else {
    console.error('No audit-logs directory found');
    process.exit(1);
  }
}

console.log(`Watching session: ${sessionId}`);

// HTTP服务器
const server = http.createServer((req, res) => {
  // 中文日志 API
  if (req.url === '/api/logs') {
    const chineseAgentsDir = path.join(AUDIT_LOGS_DIR, sessionId, CHINESE_AGENTS_DIR);
    const allLogs = [];

    if (fs.existsSync(chineseAgentsDir)) {
      const files = fs.readdirSync(chineseAgentsDir).filter(f => f.endsWith('.zh.log'));
      for (const file of files) {
        const filePath = path.join(chineseAgentsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const logs = content.split('\n').filter(line => line.trim())
          .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
          .filter(Boolean);
        allLogs.push(...logs);
      }
      allLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: allLogs }));
    return;
  }

  // 全部日志 API（包含工具调用）
  if (req.url === '/api/all-logs') {
    const allLogs = [];
    const sessionDir = path.join(AUDIT_LOGS_DIR, sessionId);

    if (fs.existsSync(sessionDir)) {
      const entries = fs.readdirSync(sessionDir);
      for (const entry of entries) {
        const entryPath = path.join(sessionDir, entry);
        if (fs.statSync(entryPath).isDirectory() && entry !== CHINESE_AGENTS_DIR) {
          const agentDir = path.join(sessionDir, entry);
          const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.log') && !f.endsWith('.zh.log'));
          for (const file of files) {
            const filePath = path.join(agentDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const logs = content.split('\n').filter(line => line.trim())
              .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
              .filter(Boolean);
            logs.forEach(log => {
              if (log && !log.agent) {
                // 从文件名提取agent名称，如: 1773711957402_pre-recon_attempt-1.log -> pre-recon
                log.agent = file.replace(/^\d+_([^_]+)_attempt.*\.log$/, '$1');
              }
            });
            allLogs.push(...logs);
          }
        }
      }
    }

    allLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: allLogs }));
    return;
  }

  // 获取所有工作流列表 API
  if (req.url === '/api/sessions') {
    const sessions = [];
    if (fs.existsSync(AUDIT_LOGS_DIR)) {
      const dirs = fs.readdirSync(AUDIT_LOGS_DIR).filter(f => {
        return fs.statSync(path.join(AUDIT_LOGS_DIR, f)).isDirectory();
      });
      for (const dir of dirs) {
        const stats = fs.statSync(path.join(AUDIT_LOGS_DIR, dir));
        sessions.push({
          id: dir,
          modified: stats.mtime.toISOString()
        });
      }
    }
    sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions, current: sessionId }));
    return;
  }

  // 切换工作流 API
  if (req.url === '/api/switch-session' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sessionId: newSessionId } = JSON.parse(body);
        if (newSessionId && fs.existsSync(path.join(AUDIT_LOGS_DIR, newSessionId))) {
          sessionId = newSessionId;
          // 重置文件位置跟踪
          filePositions.clear();
          chineseLogTimestamps.clear();
          initFilePositions();
          // 通知客户端切换
          broadcast({ type: 'session', action: 'switched', sessionId });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sessionId }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid session' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // 工作流状态 API
  if (req.url === '/api/workflow-status') {
    (async () => {
      try {
        // 动态加载，避免启动时就崩溃
        let temporalClient;
        try {
          temporalClient = require('@temporalio/client');
        } catch (e) {
          // Temporal client 不可用
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ currentPhase: 'pre-recon', completedAgents: [], status: 'unknown' }));
          return;
        }
        const { Connection, Client } = temporalClient;
        const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS || 'temporal:7233' });
        const client = new Client({ connection });

        // 直接使用 sessionId 查询 workflow
        let workflowStatus = null;
        try {
          const handle = client.workflow.getHandle(sessionId);
          const desc = await handle.describe();
          workflowStatus = desc.status?.name || desc.status;
          console.log('Workflow status:', workflowStatus);
        } catch (e) {
          // workflow 不存在
          console.log('Workflow not found:', e.message);
        }

        if (!workflowStatus) {
          // workflow 不存在，返回默认值
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ currentPhase: 'pre-recon', completedAgents: [], status: 'unknown' }));
          await connection.close();
          return;
        }

        // 查询进度（无论 RUNNING 还是 COMPLETED）
        const handle = client.workflow.getHandle(sessionId);
        const progress = await handle.query('getProgress');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          currentPhase: progress.currentPhase || (progress.status === 'completed' ? 'reporting' : 'pre-recon'),
          completedAgents: progress.completedAgents || [],
          status: progress.status
        }));
        await connection.close();
      } catch (e) {
        console.error('Workflow status error:', e.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ currentPhase: 'pre-recon', completedAgents: [], status: 'unknown' }));
      }
    })();
    return;
  }

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
          const resolvedDir = path.resolve(dirPath);

          for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const relPath = path.join(relativePath, item);
            const stats = fs.statSync(fullPath);

            // 安全检查：防止路径遍历
            const resolvedPath = path.resolve(fullPath);
            if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
              continue; // 跳过 deliverables 目录外的路径
            }

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
        res.end(JSON.stringify({ error: '服务器内部错误' }));
      }
    })();
    return;
  }

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
      res.end(JSON.stringify({ error: '服务器内部错误' }));
    }
    return;
  }

  // 前端页面
  if (req.url === '/' || req.url === '/dashboard.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  if (req.url === '/dashboard.js') {
    fs.readFile(path.join(__dirname, 'client.js'), (err, data) => {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(data);
    });
    return;
  }

  if (req.url === '/dashboard.css') {
    fs.readFile(path.join(__dirname, 'styles.css'), (err, data) => {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket 服务器
const wss = new WebSocketServer({ server });
const clients = new Set();

// 跟踪每个文件的最后位置
const filePositions = new Map();
const chineseLogTimestamps = new Map();  // 跟踪每个中文日志文件的最后修改时间

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected');
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const message = JSON.stringify(data);
  let sentCount = 0;
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
      sentCount++;
    }
  });
  if (sentCount > 0) {
    console.log(`[Broadcast] Sent to ${sentCount} clients: ${data.type}/${data.subtype}`);
  }
}

// 读取中文日志文件的新内容
function checkChineseLogs() {
  let newCount = 0;
  const chineseAgentsDir = path.join(AUDIT_LOGS_DIR, sessionId, CHINESE_AGENTS_DIR);
  if (!fs.existsSync(chineseAgentsDir)) return newCount;

  const files = fs.readdirSync(chineseAgentsDir).filter(f => f.endsWith('.zh.log'));

  files.forEach(file => {
    const filePath = path.join(chineseAgentsDir, file);
    const stats = fs.statSync(filePath);
    const lastMtime = chineseLogTimestamps.get(filePath) || 0;

    // 文件有更新
    if (stats.mtimeMs > lastMtime) {
      chineseLogTimestamps.set(filePath, stats.mtimeMs);

      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      // 找到上次读取的位置
      const lastPosition = filePositions.get(filePath) || 0;

      // 只读取新行
      if (lines.length > lastPosition) {
        const newLines = lines.slice(lastPosition);
        filePositions.set(filePath, lines.length);
        newCount += newLines.length;

        newLines.forEach(line => {
          try {
            const log = JSON.parse(line);
            // 从文件名提取agent名称，如: pre-recon.zh.log -> pre-recon
            if (!log.agent) {
              log.agent = file.replace(/\.zh\.log$/, '');
            }
            broadcast({ type: 'log', subtype: 'chinese', log });
          } catch (e) {
            // 忽略解析错误
          }
        });
      }
    }
  });

  return newCount;
}

// 检查原始日志文件（工具调用）
function checkToolLogs() {
  let newCount = 0;
  const sessionDir = path.join(AUDIT_LOGS_DIR, sessionId);
  if (!fs.existsSync(sessionDir)) return newCount;

  const entries = fs.readdirSync(sessionDir);

  for (const entry of entries) {
    const entryPath = path.join(sessionDir, entry);
    if (fs.statSync(entryPath).isDirectory() && entry !== CHINESE_AGENTS_DIR) {
      const agentDir = path.join(sessionDir, entry);
      if (!fs.existsSync(agentDir)) continue;

      const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.log') && !f.endsWith('.zh.log'));

      for (const file of files) {
        const filePath = path.join(agentDir, file);
        const stats = fs.statSync(filePath);
        const lastMtime = chineseLogTimestamps.get(filePath) || 0;

        if (stats.mtimeMs > lastMtime) {
          chineseLogTimestamps.set(filePath, stats.mtimeMs);

          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          const lastPosition = filePositions.get(filePath) || 0;

          if (lines.length > lastPosition) {
            const newLines = lines.slice(lastPosition);
            filePositions.set(filePath, lines.length);

            newLines.forEach(line => {
              try {
                const log = JSON.parse(line);
                const logType = log.type || '';
                // 支持新格式 (tool_start/tool_end) 和旧格式 (tool_use/tool_result in content)
                const isToolLog = logType === 'tool_start' || logType === 'tool_end' ||
                                  (log.data && log.data.content &&
                                   (log.data.content.includes('"type":"tool_use"') ||
                                    log.data.content.includes('"type":"tool_result"')));
                if (isToolLog) {
                  // 从文件名提取agent名称，如: 1772534884109_xss-exploit_attempt-1.log -> xss-exploit
                  const agentName = file.replace(/^\d+_([^_]+)_attempt.*\.log$/, '$1');
                  broadcast({ type: 'log', subtype: 'tool', log, agent: agentName });
                  newCount++;
                }
              } catch (e) {
                // 忽略解析错误
              }
            });
          }
        }
      }
    }
  }

  return newCount;
}

// 每2秒检查一次文件变化
setInterval(() => {
  const chineseCount = checkChineseLogs();
  const toolCount = checkToolLogs();
  if (chineseCount > 0 || toolCount > 0) {
    console.log(`[Polling] Chinese logs: ${chineseCount}, Tool logs: ${toolCount} new entries`);
  }
}, 2000);

// 初始化文件位置 - 使用行数而不是字节大小
function initFilePositions() {
  const chineseAgentsDir = path.join(AUDIT_LOGS_DIR, sessionId, CHINESE_AGENTS_DIR);
  if (fs.existsSync(chineseAgentsDir)) {
    const files = fs.readdirSync(chineseAgentsDir).filter(f => f.endsWith('.zh.log'));
    files.forEach(file => {
      const filePath = path.join(chineseAgentsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      chineseLogTimestamps.set(filePath, fs.statSync(filePath).mtimeMs);
      filePositions.set(filePath, lines.length);  // 初始化为行数
    });
  }

  const sessionDir = path.join(AUDIT_LOGS_DIR, sessionId);
  if (fs.existsSync(sessionDir)) {
    const entries = fs.readdirSync(sessionDir);
    for (const entry of entries) {
      const entryPath = path.join(sessionDir, entry);
      if (fs.statSync(entryPath).isDirectory() && entry !== CHINESE_AGENTS_DIR) {
        const agentDir = path.join(sessionDir, entry);
        if (fs.existsSync(agentDir)) {
          const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.log') && !f.endsWith('.zh.log'));
          files.forEach(file => {
            const filePath = path.join(agentDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            chineseLogTimestamps.set(filePath, fs.statSync(filePath).mtimeMs);
            filePositions.set(filePath, 0);  // 初始化为0，启动后读取所有现有日志
          });
        }
      }
    }
  }
}

initFilePositions();

server.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
});
