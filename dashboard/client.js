// 阶段配置
const PHASES = [
  { id: 'pre-recon', name: '信息收集前置' },
  { id: 'recon', name: '侦察' },
  { id: 'vulnerability-analysis', name: '漏洞分析' },
  { id: 'exploitation', name: '漏洞利用' },
  { id: 'reporting', name: '报告生成' }
];

// Agent分组 - 使用实际的agent名称格式
const AGENT_GROUPS = [
  { phase: 'pre-recon', name: '信息收集前置', agents: ['pre-recon'] },
  { phase: 'recon', name: '侦察', agents: ['recon'] },
  { phase: 'vulnerability-analysis', name: '漏洞分析', agents: ['injection-vuln', 'xss-vuln', 'auth-vuln', 'authz-vuln', 'ssrf-vuln'] },
  { phase: 'exploitation', name: '漏洞利用', agents: ['injection-exploit', 'xss-exploit', 'auth-exploit', 'authz-exploit', 'ssrf-exploit'] },
  { phase: 'reporting', name: '报告生成', agents: ['report'] }
];

// Agent名称中文翻译 - 实际名称格式
const AGENT_NAMES_CN = {
  'pre-recon': '信息收集前置',
  'recon': '侦察',
  'injection-vuln': '注入漏洞分析',
  'xss-vuln': 'XSS漏洞分析',
  'auth-vuln': '认证漏洞分析',
  'authz-vuln': '授权漏洞分析',
  'ssrf-vuln': 'SSRF漏洞分析',
  'injection-exploit': '注入漏洞利用',
  'xss-exploit': 'XSS漏洞利用',
  'auth-exploit': '认证漏洞利用',
  'authz-exploit': '授权漏洞利用',
  'ssrf-exploit': 'SSRF漏洞利用',
  'report': '报告生成'
};

// 状态
let ws = null;
let completedAgents = new Set();
let showToolLogs = false;
let toolLogs = [];  // 存储工具调用日志
let selectedAgents = new Set();  // 当前筛选的agent集合，空表示显示全部

// 连接WebSocket
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById('connection-status').textContent = '已连接';
    document.getElementById('connection-status').className = 'status connected';
    loadSessions();  // 加载工作流列表
  };

  ws.onclose = () => {
    document.getElementById('connection-status').textContent = '未连接';
    document.getElementById('connection-status').className = 'status disconnected';
    setTimeout(connect, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {}
  };
}

// 处理WebSocket消息
function handleMessage(data) {
  // 处理session切换消息
  if (data.type === 'session' && data.action === 'switched') {
    // 清除现有日志并重新加载
    document.getElementById('log-container').innerHTML = '<div class="log-empty">等待日志...</div>';
    toolLogs = [];
    completedAgents.clear();
    return;
  }

  if (data.type === 'log') {
    if (data.subtype === 'chinese') {
      // 中文日志直接显示 - 现在数据在 data.log 中
      addChineseLog(data.log);
    } else if (data.subtype === 'tool') {
      // 工具调用日志存储起来 - 数据在 data.log 中
      toolLogs.push(data.log);
      // 如果当前显示工具日志，立即渲染
      if (showToolLogs) {
        addToolLog(data.log);
      }
    }
  }
}

// 添加中文日志
function addChineseLog(log) {
  const container = document.getElementById('log-container');
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `log-entry ${log.type || ''}`;
  div.dataset.agent = log.agent;

  const content = log.content || '';
  const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
  const agentNameCn = AGENT_NAMES_CN[log.agent] || log.agent;
  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-agent">[${agentNameCn}]</span>
    <span class="log-content">${escapeHtml(content)}</span>
  `;

  // 应用筛选
  const showAll = selectedAgents.size === 0;
  div.style.display = showAll || selectedAgents.has(log.agent) ? 'block' : 'none';

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  if (log.type === 'agent_end') {
    completedAgents.add(log.agent);
    renderAgentList();
  }
}

// 添加工具日志
function addToolLog(log) {
  const container = document.getElementById('log-container');

  const content = log.data?.content || '';
  let displayContent = content;

  if (content.includes('"type":"tool_use"')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.name) {
        displayContent = `🔧 调用工具: ${parsed.name}`;
        if (parsed.input) {
          displayContent += `\n   输入: ${JSON.stringify(parsed.input).substring(0, 200)}...`;
        }
      }
    } catch {}
  } else if (content.includes('"type":"tool_result"')) {
    try {
      const parsed = JSON.parse(content);
      displayContent = `✅ 工具结果: ${(parsed.output || '').substring(0, 200)}`;
    } catch {}
  }

  const div = document.createElement('div');
  div.className = 'log-entry tool';
  div.dataset.agent = log.agent;

  const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
  const agentNameCn = AGENT_NAMES_CN[log.agent] || log.agent;
  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-agent">[${agentNameCn}]</span>
    <span class="log-content">${escapeHtml(displayContent)}</span>
  `;

  // 应用筛选
  const showAll = selectedAgents.size === 0;
  div.style.display = showAll || selectedAgents.has(log.agent) ? 'block' : 'none';

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 渲染阶段进度
function renderPhases(currentPhase) {
  const container = document.getElementById('phase-progress');
  const phaseMap = {
    'pre-recon': 'pre-recon', 'recon': 'recon',
    'vulnerability-analysis': 'vulnerability-analysis',
    'vulnerability-exploitation': 'exploitation', 'reporting': 'reporting'
  };
  const mappedPhase = phaseMap[currentPhase] || currentPhase;

  let html = '<h3>阶段进度</h3>';
  PHASES.forEach(phase => {
    let status = 'pending';
    if (completedAgents.size === 13) status = 'completed';
    else if (phase.id === mappedPhase) status = 'running';

    html += `
      <div class="phase-item">
        <div class="phase-dot ${status}"></div>
        <span class="phase-name">${phase.name}</span>
        ${status === 'running' ? '<span class="phase-status">执行中</span>' : ''}
      </div>`;
  });
  container.innerHTML = html;
}

// 渲染Agent列表
function renderAgentList() {
  const container = document.getElementById('agent-list');
  let html = '<h3>智能体列表</h3>';

  // 添加"全部"选项（清空筛选）
  const allSelected = selectedAgents.size === 0;
  html += `<div class="agent-group">`;
  html += `<div class="agent-item ${allSelected ? 'active' : ''}" onclick="filterByAgent(null)">`;
  html += `<span class="agent-name">全部</span>`;
  html += `</div></div>`;

  AGENT_GROUPS.forEach(group => {
    html += `<div class="agent-group">`;
    html += `<div class="group-header"><span class="group-toggle">▼</span><span class="group-name">${group.name}</span><span class="group-count">(${group.agents.length})</span></div>`;

    group.agents.forEach(agent => {
      const isCompleted = completedAgents.has(agent);
      const agentNameCn = AGENT_NAMES_CN[agent] || agent;
      const isSelected = selectedAgents.has(agent);
      html += `<div class="agent-item ${isSelected ? 'active' : ''}" onclick="filterByAgent('${agent}')">`;
      html += `<span class="agent-name">${agentNameCn}</span>`;
      html += `${isCompleted ? '<span class="agent-check">✓</span>' : ''}</div>`;
    });
    html += `</div>`;
  });
  container.innerHTML = html;
}

// 按Agent筛选日志（多选）
function filterByAgent(agent) {
  if (agent === null) {
    // 清除所有筛选
    selectedAgents.clear();
  } else {
    // 切换选中状态
    if (selectedAgents.has(agent)) {
      selectedAgents.delete(agent);
    } else {
      selectedAgents.add(agent);
    }
  }

  renderAgentList();
  applyFilterToAllLogs();
}

// 对所有日志应用筛选
function applyFilterToAllLogs() {
  const showAll = selectedAgents.size === 0;

  document.querySelectorAll('.log-entry').forEach(el => {
    const logAgent = el.dataset.agent;
    if (showAll) {
      el.style.display = 'block';
    } else {
      el.style.display = selectedAgents.has(logAgent) ? 'block' : 'none';
    }
  });
}

// 加载工作流列表
async function loadSessions() {
  try {
    const resp = await fetch('/api/sessions');
    const data = await resp.json();
    const select = document.getElementById('session-select');
    select.innerHTML = '';
    data.sessions.forEach(session => {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = session.id;
      if (session.id === data.current) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  } catch (e) {
    console.error('Failed to load sessions:', e);
  }
}

// 切换工作流
async function switchSession(sessionId) {
  if (!sessionId) return;
  try {
    const resp = await fetch('/api/switch-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    const data = await resp.json();
    if (data.success) {
      // 清除现有日志
      document.getElementById('log-container').innerHTML = '<div class="log-empty">等待日志...</div>';
      toolLogs = [];
      completedAgents.clear();
      // 立即获取新工作流的历史日志
      fetchChineseLogs();
      fetchToolLogs();
      fetchWorkflowStatus();
      // 重新加载工作流列表
      loadSessions();
    }
  } catch (e) {
    console.error('Failed to switch session:', e);
  }
}

// 切换工具日志显示
function toggleToolLogs() {
  showToolLogs = !showToolLogs;
  const btn = document.getElementById('toggle-filtered');

  if (showToolLogs) {
    btn.textContent = '隐藏工具调用';
    btn.classList.add('active');
    // 重新渲染所有工具日志
    toolLogs.forEach(log => addToolLog(log));
  } else {
    btn.textContent = '显示工具调用';
    btn.classList.remove('active');
    // 移除所有工具日志
    document.querySelectorAll('.log-entry.tool').forEach(el => el.remove());
  }
}

// 获取工作流状态
async function fetchWorkflowStatus() {
  try {
    const response = await fetch('/api/workflow-status');
    const data = await response.json();
    if (data.currentPhase) renderPhases(data.currentPhase);
    if (data.completedAgents) {
      data.completedAgents.forEach(agent => completedAgents.add(agent));
      renderAgentList();
    }
  } catch {
    renderPhases('pre-recon');
  }
}

// 获取初始中文日志
async function fetchChineseLogs() {
  try {
    const response = await fetch('/api/logs');
    const data = await response.json();
    if (data.logs && data.logs.length > 0) {
      const container = document.getElementById('log-container');
      const empty = container.querySelector('.log-empty');
      if (empty) empty.remove();

      data.logs.forEach(log => addChineseLog(log));
    }
  } catch {}
}

// 获取初始工具日志
async function fetchToolLogs() {
  try {
    const response = await fetch('/api/all-logs');
    const data = await response.json();
    if (data.logs && data.logs.length > 0) {
      toolLogs = data.logs.filter(log => {
        const content = log.data?.content || '';
        return content.includes('"type":"tool_use"') || content.includes('"type":"tool_result"');
      });
    }
  } catch {}
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  connect();
  fetchWorkflowStatus();
  fetchChineseLogs();
  fetchToolLogs();
  renderAgentList();
});
