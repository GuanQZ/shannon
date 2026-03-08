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
            logs.forEach(log => { if (log && !log.agent) log.agent = entry; });
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
        const connection = await Connection.connect({ address: 'localhost:7233' });
        const client = new Client({ connection });

        // 直接使用 sessionId 查询 workflow
        let workflowHandle = null;
        try {
          const handle = client.workflow.getHandle(sessionId);
          const desc = await handle.describe();
          const status = desc.status?.name || desc.status;
          if (status === 'RUNNING') {
            workflowHandle = { workflowId: sessionId };
          }
        } catch (e) {
          // workflow 不存在或已结束
        }

        if (!workflowHandle) {
          // 没有找到运行中的 workflow
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ currentPhase: 'pre-recon', completedAgents: [], status: 'unknown' }));
          await connection.close();
          return;
        }

        const handle = client.workflow.getHandle(workflowHandle.workflowId);
        const progress = await handle.query('getProgress');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          currentPhase: progress.currentPhase || 'pre-recon',
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
                const logContent = (log.data && log.data.content) || '';
                if (logContent.includes('"type":"tool_use"') || logContent.includes('"type":"tool_result"')) {
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
            filePositions.set(filePath, lines.length);  // 初始化为行数
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
