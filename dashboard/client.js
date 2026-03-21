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
      // 注意：agent 在 data.agent 中（WebSocket 推送时），不在 data.log 中
      const toolLog = { ...data.log, agent: data.agent };
      toolLogs.push(toolLog);
      // 如果当前显示工具日志，立即渲染
      if (showToolLogs) {
        addToolLog(toolLog);
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

  // 处理不同类型的日志内容 - 支持两种格式：
  // 1. chinese-agents 格式: log.content
  // 2. agents 格式: log.data.content
  let content = log.content || log.data?.content || '';

  // agent_start: 显示 "Agent xxx 已启动"
  if (log.type === 'agent_start') {
    const agentName = log.data?.agentName || log.agent || 'Unknown';
    content = `Agent ${agentName} 已启动`;
  }
  // agent_end: 显示 "Agent xxx 已完成"
  else if (log.type === 'agent_end') {
    const agentName = log.data?.agentName || log.agent || 'Unknown';
    const status = log.data?.status || 'completed';
    content = `Agent ${agentName} 已完成 (${status})`;
  }
  // error: 显示错误信息
  else if (log.type === 'error') {
    const errorMsg = log.data?.message || log.data?.error || JSON.stringify(log.data) || '未知错误';
    content = `❌ 错误: ${errorMsg}`;
  }
  // tool_error: 显示工具错误
  else if (log.type === 'tool_error') {
    const toolName = log.data?.toolName || 'unknown';
    const errorMsg = log.data?.error || JSON.stringify(log.data) || '';
    content = `❌ 工具错误 (${toolName}): ${errorMsg}`;
  }
  // llm_response: 支持两种格式 - chinese-agents (content在顶层) 和 agents (content在data中)
  else if (log.type === 'llm_response') {
    content = log.content || log.data?.content || '';
    // 如果有 turn 信息，添加到显示
    const turn = log.data?.turn || log.turn;
    if (turn) {
      div.dataset.turn = turn;
    }
  }
  // 其他类型: 尝试从 data 中获取内容
  else if (!content && log.data) {
    content = log.data.content || log.data.message || log.data.text || '';
  }

  const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
  const agentNameCn = AGENT_NAMES_CN[log.agent] || log.agent;
  // 获取 turn 信息 (llm_response 类型)
  const turn = log.data?.turn || log.turn;
  const turnInfo = turn ? ` (Turn ${turn})` : '';

  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-agent">[${agentNameCn}]${turnInfo}</span>
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
    // 当 agent 完成时，重新获取工作流状态以更新阶段进度
    fetchWorkflowStatus();
  }
}

// 添加工具日志
function addToolLog(log) {
  const container = document.getElementById('log-container');

  // Support new format (tool_start/tool_end) and old format (tool_use/tool_result in content)
  const type = log.type || '';
  let displayContent = '';

  if (type === 'tool_start') {
    const toolName = log.data?.toolName || 'unknown';
    const parameters = log.data?.parameters || {};
    displayContent = `🔧 调用工具: ${toolName}`;
    if (parameters.raw) {
      displayContent += `\n   输入: ${JSON.stringify(parameters.raw).substring(0, 200)}...`;
    }
  } else if (type === 'tool_end') {
    const result = log.data?.result || '';
    displayContent = `✅ 工具结果: ${result.substring(0, 200)}`;
  } else {
    // Old format: content contains tool_use/tool_result JSON string
    const content = log.data?.content || '';
    displayContent = content;

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
        const toolName = parsed.name || 'unknown';
        displayContent = `✅ 工具结果 (${toolName}): ${(parsed.output || '').substring(0, 200)}`;
      } catch {}
    }
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

  // 添加报告下载按钮
  html += '<div class="download-section">';
  html += '<button class="download-btn" onclick="showDeliverablesModal()">';
  html += '<span class="download-icon">📁</span> 查看报告';
  html += '</button>';
  html += '</div>';

  container.innerHTML = html;
}

// 弹窗状态
let isModalOpen = false;

// 显示 deliverables 弹窗
async function showDeliverablesModal() {
  const modal = document.getElementById('deliverables-modal');
  if (!modal) {
    createModalHTML();
  }
  const modalEl = document.getElementById('deliverables-modal');
  modalEl.style.display = 'flex';
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
      container.innerHTML = '<div class="error">' + escapeHtml(data.error) + '</div>';
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
      '<div class="error">加载失败: ' + e.message + '</div>';
  }
}

// 渲染文件树（递归）
function renderFileTree(items, level) {
  if (level === undefined) level = 0;
  let html = '<ul class="file-tree" style="margin-left:' + (level * 16) + 'px">';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === 'dir') {
      html +=
        '<li class="tree-dir">' +
        '<span class="tree-toggle" onclick="toggleDir(this)">▶</span>' +
        '<span class="tree-folder" onclick="toggleDir(this)">📁 ' + escapeHtml(item.name) + '</span>' +
        '<div class="tree-children" style="display:none">' +
        renderFileTree(item.children || [], level + 1) +
        '</div>' +
        '</li>';
    } else {
      html +=
        '<li class="tree-file">' +
        '<span class="tree-file-icon">📄</span>' +
        '<a href="#" onclick="downloadFile(\'' + encodeURIComponent(item.path) + '\'); return false;">' +
        escapeHtml(item.name) +
        '</a>' +
        '</li>';
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
    // 显示所有日志（中文+工具），按时间排序
    reRenderAllLogs();
  } else {
    btn.textContent = '显示工具调用';
    btn.classList.remove('active');
    // 只显示中文日志
    renderChineseLogsOnly();
  }
}

// 只渲染中文日志（不含工具调用）
async function renderChineseLogsOnly() {
  try {
    // 使用 /api/logs 获取 chinese-agents 目录的日志
    const response = await fetch('/api/logs');
    const data = await response.json();

    const container = document.getElementById('log-container');
    container.innerHTML = ''; // 清空容器

    if (data.logs && data.logs.length > 0) {
      // 按时间排序
      const sortedLogs = data.logs.sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      sortedLogs.forEach(log => addChineseLog(log));
    }
  } catch (e) {
    console.error('Failed to render Chinese logs:', e);
  }
}

// 重新渲染所有日志（中文+工具），按时间排序
async function reRenderAllLogs() {
  try {
    // 合并 chinese-agents 日志 (/api/logs) 和 agents 日志 (/api/all-logs)
    const [chineseResp, agentsResp] = await Promise.all([
      fetch('/api/logs'),
      fetch('/api/all-logs')
    ]);
    const chineseData = await chineseResp.json();
    const agentsData = await agentsResp.json();

    const container = document.getElementById('log-container');
    container.innerHTML = ''; // 清空容器

    // 合并所有日志
    const allLogs = [
      ...(chineseData.logs || []),
      ...(agentsData.logs || [])
    ];

    if (allLogs.length > 0) {
      // 去重：基于 timestamp + content 组合去重，优先保留有 turn 的版本
      const seen = new Map();
      allLogs.forEach(log => {
        // 获取 content 用于去重
        const content = log.content || log.data?.content || '';
        const key = `${log.timestamp}-${log.type}-${content.slice(0, 100)}`;

        // 如果已经存在，优先保留有 turn 信息的版本
        if (!seen.has(key)) {
          seen.set(key, log);
        } else {
          const existing = seen.get(key);
          // 如果新版本有 turn 但旧版本没有，则替换
          const newHasTurn = log.data?.turn || log.turn;
          const existingHasTurn = existing.data?.turn || existing.turn;
          if (newHasTurn && !existingHasTurn) {
            seen.set(key, log);
          }
        }
      });

      // 获取去重后的日志
      const uniqueLogs = Array.from(seen.values());

      // 排序所有日志
      const sortedLogs = uniqueLogs.sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      sortedLogs.forEach(log => {
        const type = log.type || '';
        if (type === 'tool_start' || type === 'tool_end') {
          addToolLog(log);
        } else {
          addChineseLog(log);
        }
      });
    }
  } catch (e) {
    console.error('Failed to re-render logs:', e);
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
    // 使用 /api/logs 获取 chinese-agents 目录的日志
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
      // Filter tool logs and sort by timestamp
      toolLogs = data.logs
        .filter(log => {
          const type = log.type || '';
          // Support both old format (tool_use/tool_result in content) and new format (tool_start/tool_end)
          const content = log.data?.content || '';
          return type === 'tool_start' || type === 'tool_end' ||
                 content.includes('"type":"tool_use"') || content.includes('"type":"tool_result"');
        })
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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
