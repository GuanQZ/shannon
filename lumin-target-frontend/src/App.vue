<script setup lang="ts">
import { ref } from 'vue'
import axios from 'axios'

const API_BASE = '/'

// State
const isLoggedIn = ref(false)
const currentUser = ref('')
const activeTab = ref('network')

// Login state
const username = ref('')
const password = ref('')
const loginResult = ref('')
const loginResultType = ref<'success' | 'error' | ''>('')

// Form state
const pingHost = ref('127.0.0.1')
const pingResult = ref('')
const tracerouteTarget = ref('')
const tracerouteResult = ref('')
const nslookupDomain = ref('')
const nslookupResult = ref('')
const searchUsername = ref('')
const userSearchResult = ref('')
const lookupId = ref('1')
const userLookupResult = ref('')
const commentContent = ref('')
const commentResult = ref('')
const commentFilter = ref('')
const commentListResult = ref('')
const searchQuery = ref('')
const searchResult = ref('')
const profileName = ref('')
const profileBio = ref('')
const profileResult = ref('')
const fetchUrl = ref('')
const fetchResult = ref('')

async function handleLogin() {
  try {
    const response = await axios.post(`${API_BASE}/login`, null, {
      params: { username: username.value, password: password.value },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    const data = response.data
    loginResult.value = JSON.stringify(data, null, 2)
    loginResultType.value = data.success ? 'success' : 'error'

    if (data.success) {
      currentUser.value = data.user || username.value
      isLoggedIn.value = true
    }
  } catch (error: any) {
    loginResult.value = '请求失败: ' + error.message
    loginResultType.value = 'error'
  }
}

function logout() {
  isLoggedIn.value = false
  username.value = ''
  password.value = ''
  loginResult.value = ''
  loginResultType.value = ''
}

function switchTab(tab: string) {
  activeTab.value = tab
}

// Network Tools
async function handlePing(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.get(`${API_BASE}/ping?host=${encodeURIComponent(pingHost.value)}`)
    pingResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    pingResult.value = '请求失败: ' + error.message
  }
}

async function handleTraceroute(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.get(`${API_BASE}/traceroute?target=${encodeURIComponent(tracerouteTarget.value)}`)
    tracerouteResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    tracerouteResult.value = '请求失败: ' + error.message
  }
}

async function handleNslookup(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.get(`${API_BASE}/nslookup?domain=${encodeURIComponent(nslookupDomain.value)}`)
    nslookupResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    nslookupResult.value = '请求失败: ' + error.message
  }
}

// User Management
async function handleUserSearch(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.get(`${API_BASE}/user/search?username=${encodeURIComponent(searchUsername.value)}`)
    userSearchResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    userSearchResult.value = '请求失败: ' + error.message
  }
}

async function handleUserLookup(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.get(`${API_BASE}/user/lookup?id=${encodeURIComponent(lookupId.value)}`)
    userLookupResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    userLookupResult.value = '请求失败: ' + error.message
  }
}

// Comments
async function handleComment(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.post(`${API_BASE}/comment?content=${encodeURIComponent(commentContent.value)}`)
    commentResult.value = JSON.stringify(response.data, null, 2)
    commentContent.value = ''
  } catch (error: any) {
    commentResult.value = '请求失败: ' + error.message
  }
}

async function handleCommentList(e: Event) {
  e.preventDefault()
  try {
    const url = commentFilter.value
      ? `${API_BASE}/comment?filter=${encodeURIComponent(commentFilter.value)}`
      : `${API_BASE}/comment`
    const response = await axios.get(url)
    commentListResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    commentListResult.value = '请求失败: ' + error.message
  }
}

async function handleSearch(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.get(`${API_BASE}/search?q=${encodeURIComponent(searchQuery.value)}`)
    searchResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    searchResult.value = '请求失败: ' + error.message
  }
}

// Profile
async function handleProfile(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.post(`${API_BASE}/profile?name=${encodeURIComponent(profileName.value)}&bio=${encodeURIComponent(profileBio.value)}`)
    profileResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    profileResult.value = '请求失败: ' + error.message
  }
}

// URL Fetch
async function handleFetch(e: Event) {
  e.preventDefault()
  try {
    const response = await axios.get(`${API_BASE}/fetch?url=${encodeURIComponent(fetchUrl.value)}`)
    fetchResult.value = JSON.stringify(response.data, null, 2)
  } catch (error: any) {
    fetchResult.value = '请求失败: ' + error.message
  }
}
</script>

<template>
  <div class="container">
    <!-- Login Section -->
    <div v-if="!isLoggedIn">
      <div class="card login-form">
        <h2>系统登录</h2>
        <form @submit.prevent="handleLogin">
          <div class="form-group">
            <label>用户名</label>
            <input type="text" v-model="username" placeholder="请输入用户名" required>
          </div>
          <div class="form-group">
            <label>密码</label>
            <input type="password" v-model="password" placeholder="请输入密码" required>
          </div>
          <!-- REMOVED: Authentication bypass checkbox -->
          <button type="submit" class="btn btn-primary" style="width: 100%;">登录</button>
        </form>
        <div v-if="loginResult" :class="['result', loginResultType]">{{ loginResult }}</div>
      </div>
    </div>

    <!-- Dashboard Section -->
    <div v-else>
      <div class="header">
        <h1>Shannon Target 管理后台</h1>
        <div class="user-info active">
          <span>{{ currentUser }}</span>
          <button class="btn btn-danger" @click="logout">退出登录</button>
        </div>
      </div>

      <div class="tabs">
        <button :class="['tab-btn', { active: activeTab === 'network' }]" @click="switchTab('network')">网络工具</button>
        <button :class="['tab-btn', { active: activeTab === 'user' }]" @click="switchTab('user')">用户管理</button>
        <button :class="['tab-btn', { active: activeTab === 'comment' }]" @click="switchTab('comment')">评论管理</button>
        <button :class="['tab-btn', { active: activeTab === 'profile' }]" @click="switchTab('profile')">个人资料</button>
        <button :class="['tab-btn', { active: activeTab === 'fetch' }]" @click="switchTab('fetch')">URL抓取</button>
      </div>

      <!-- Network Tools Tab -->
      <div v-if="activeTab === 'network'">
        <div class="card">
          <h2>Ping 测试</h2>
          <form @submit.prevent="handlePing">
            <div class="form-group">
              <label>主机地址</label>
              <input type="text" v-model="pingHost" placeholder="例如: 127.0.0.1">
            </div>
            <button type="submit" class="btn btn-primary">执行 Ping</button>
          </form>
          <div v-if="pingResult" class="result info">{{ pingResult }}</div>
        </div>

        <div class="card">
          <h2>Traceroute 路由追踪</h2>
          <form @submit.prevent="handleTraceroute">
            <div class="form-group">
              <label>目标地址</label>
              <input type="text" v-model="tracerouteTarget" placeholder="例如: 8.8.8.8" required>
            </div>
            <button type="submit" class="btn btn-primary">开始追踪</button>
          </form>
          <div v-if="tracerouteResult" class="result info">{{ tracerouteResult }}</div>
        </div>

        <div class="card">
          <h2>DNS 查询</h2>
          <form @submit.prevent="handleNslookup">
            <div class="form-group">
              <label>域名</label>
              <input type="text" v-model="nslookupDomain" placeholder="例如: example.com" required>
            </div>
            <button type="submit" class="btn btn-primary">查询 DNS</button>
          </form>
          <div v-if="nslookupResult" class="result info">{{ nslookupResult }}</div>
        </div>
      </div>

      <!-- User Management Tab -->
      <div v-if="activeTab === 'user'">
        <div class="card">
          <h2>用户搜索</h2>
          <form @submit.prevent="handleUserSearch">
            <div class="form-group">
              <label>用户名</label>
              <input type="text" v-model="searchUsername" placeholder="输入用户名搜索">
            </div>
            <button type="submit" class="btn btn-primary">搜索</button>
          </form>
          <div v-if="userSearchResult" class="result info">{{ userSearchResult }}</div>
        </div>

        <div class="card">
          <h2>用户ID查询</h2>
          <form @submit.prevent="handleUserLookup">
            <div class="form-group">
              <label>用户ID</label>
              <input type="text" v-model="lookupId" placeholder="输入用户ID">
            </div>
            <button type="submit" class="btn btn-primary">查询</button>
          </form>
          <div v-if="userLookupResult" class="result info">{{ userLookupResult }}</div>
        </div>
      </div>

      <!-- Comment Management Tab -->
      <div v-if="activeTab === 'comment'">
        <div class="card">
          <h2>发表评论</h2>
          <form @submit.prevent="handleComment">
            <div class="form-group">
              <label>评论内容</label>
              <textarea v-model="commentContent" rows="3" placeholder="请输入评论内容" required></textarea>
            </div>
            <button type="submit" class="btn btn-primary">提交评论</button>
          </form>
          <div v-if="commentResult" class="result success">{{ commentResult }}</div>
        </div>

        <div class="card">
          <h2>评论列表</h2>
          <form @submit.prevent="handleCommentList">
            <div class="form-group">
              <label>筛选（可选）</label>
              <input type="text" v-model="commentFilter" placeholder="输入关键词筛选">
            </div>
            <button type="submit" class="btn btn-primary">查看评论</button>
          </form>
          <div v-if="commentListResult" class="result info">{{ commentListResult }}</div>
        </div>

        <div class="card">
          <h2>搜索</h2>
          <form @submit.prevent="handleSearch">
            <div class="form-group">
              <label>搜索关键词</label>
              <input type="text" v-model="searchQuery" placeholder="输入搜索内容" required>
            </div>
            <button type="submit" class="btn btn-primary">搜索</button>
          </form>
          <div v-if="searchResult" class="result info">{{ searchResult }}</div>
        </div>
      </div>

      <!-- Profile Tab -->
      <div v-if="activeTab === 'profile'">
        <div class="card">
          <h2>更新个人资料</h2>
          <form @submit.prevent="handleProfile">
            <div class="form-group">
              <label>姓名</label>
              <input type="text" v-model="profileName" placeholder="请输入姓名" required>
            </div>
            <div class="form-group">
              <label>个人简介</label>
              <textarea v-model="profileBio" rows="4" placeholder="请输入个人简介"></textarea>
            </div>
            <button type="submit" class="btn btn-primary">保存</button>
          </form>
          <div v-if="profileResult" class="result success">{{ profileResult }}</div>
        </div>
      </div>

      <!-- URL Fetch Tab -->
      <div v-if="activeTab === 'fetch'">
        <div class="card">
          <h2>URL 抓取工具</h2>
          <form @submit.prevent="handleFetch">
            <div class="form-group">
              <label>目标 URL</label>
              <input type="text" v-model="fetchUrl" placeholder="例如: https://example.com" required>
            </div>
            <button type="submit" class="btn btn-primary">抓取</button>
          </form>
          <div v-if="fetchResult" class="result info">{{ fetchResult }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  padding: 20px;
}
.container {
  max-width: 1200px;
  margin: 0 auto;
}
.header {
  background: white;
  border-radius: 12px;
  padding: 20px 30px;
  margin-bottom: 20px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header h1 {
  color: #333;
  font-size: 24px;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 15px;
}
.user-info span {
  color: #666;
}
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s;
  margin-top: 10px;
}
.btn-primary {
  background: #667eea;
  color: white;
}
.btn-primary:hover {
  background: #5568d3;
}
.btn-danger {
  background: #e53e3e;
  color: white;
}
.btn-danger:hover {
  background: #c53030;
}
.card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}
.card h2 {
  color: #333;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid #667eea;
}
.form-group {
  margin-bottom: 15px;
}
.form-group label {
  display: block;
  margin-bottom: 5px;
  color: #555;
  font-weight: 500;
}
.form-group input, .form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.3s;
}
.form-group input:focus, .form-group textarea:focus {
  outline: none;
  border-color: #667eea;
}
.result {
  margin-top: 15px;
  padding: 15px;
  border-radius: 6px;
  background: #f7fafc;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}
.result.success {
  background: #c6f6d5;
  border: 1px solid #68d391;
}
.result.error {
  background: #fed7d7;
  border: 1px solid #fc8181;
}
.result.info {
  background: #bee3f8;
  border: 1px solid #63b3ed;
}
.tabs {
  display: flex;
  gap: 5px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 10px 20px;
  border: none;
  background: #e2e8f0;
  color: #4a5568;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: all 0.3s;
}
.tab-btn.active {
  background: white;
  color: #667eea;
  font-weight: 600;
}
.login-form {
  max-width: 400px;
  margin: 100px auto;
}
@media (max-width: 768px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
