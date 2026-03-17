# lumin-target 前后端分离实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 lumin-target 从单体应用拆分为前后端分离架构，前端使用 Vue 3 + Vite，后端保留 Spring Boot

**Architecture:** 前端独立 Vue 项目，通过 Axios + CORS 与后端通信。后端移除静态前端文件，配置 CORS 允许前端访问

**Tech Stack:** Vue 3 + TypeScript + Vite (前端), Spring Boot 3.2.0 + Java 17 (后端)

---

## 文件结构

```
lumin/
├── repos/lumin-target/                    # 后端 (修改)
│   └── src/main/java/.../config/          # 新增 CORS 配置
│   └── src/main/resources/static/         # 删除 index.html
│
└── lumin-target-frontend/                 # 前端 (新建)
    ├── src/
    │   ├── components/                    # Vue 组件
    │   ├── views/                         # 页面视图
    │   ├── App.vue                        # 根组件
    │   └── main.ts                        # 入口文件
    ├── vite.config.ts                     # Vite 配置
    └── package.json                       # 依赖
```

---

## Chunk 1: 后端修改

### Task 1: 添加 CORS 配置

**Files:**
- Create: `repos/lumin-target/src/main/java/com/example/shannontarget/config/CorsConfig.java`

- [ ] **Step 1: 创建 CORS 配置类**

```java
package com.example.shannontarget.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

@Configuration
public class CorsConfig {

    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        // 允许前端开发服务器访问
        config.addAllowedOrigin("http://localhost:5173");
        // 允许所有请求头
        config.addAllowedHeader("*");
        // 允许所有 HTTP 方法
        config.addAllowedMethod("*");
        // 允许携带凭证
        config.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);

        return new CorsFilter(source);
    }
}
```

- [ ] **Step 2: 验证 CORS 配置**

Run: 检查文件是否创建成功
Expected: 文件存在于 `repos/lumin-target/src/main/java/com/example/shannontarget/config/CorsConfig.java`

- [ ] **Step 3: 提交**

```bash
git add repos/lumin-target/src/main/java/com/example/shannontarget/config/CorsConfig.java
git commit -m "feat(lumin-target): add CORS configuration for frontend separation"
```

---

### Task 2: 删除静态前端文件

**Files:**
- Delete: `repos/lumin-target/src/main/resources/static/index.html`

- [ ] **Step 1: 删除 static/index.html**

Run: `rm repos/lumin-target/src/main/resources/static/index.html`

- [ ] **Step 2: 验证删除**

Run: `ls repos/lumin-target/src/main/resources/static/`
Expected: 目录为空或不存在

- [ ] **Step 3: 提交**

```bash
git add repos/lumin-target/src/main/resources/static/
git commit -m "feat(lumin-target): remove embedded frontend for separation"
```

---

## Chunk 2: 前端项目创建

### Task 3: 创建 Vue 3 + Vite 项目

**Files:**
- Create: `lumin-target-frontend/package.json`
- Create: `lumin-target-frontend/vite.config.ts`
- Create: `lumin-target-frontend/tsconfig.json`
- Create: `lumin-target-frontend/index.html`
- Create: `lumin-target-frontend/src/main.ts`
- Create: `lumin-target-frontend/src/App.vue`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "lumin-target-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "vue-tsc": "^1.8.0"
  }
}
```

- [ ] **Step 2: 创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Shannon Target - 管理后台</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: 创建 src/main.ts**

```typescript
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

- [ ] **Step 6: 提交**

```bash
git add lumin-target-frontend/
git commit -m "feat(lumin-target): scaffold Vue 3 + Vite frontend project"
```

---

### Task 4: 创建 App.vue 主组件

**Files:**
- Modify: `lumin-target-frontend/src/App.vue`

- [ ] **Step 1: 从原 index.html 迁移 UI 到 App.vue**

从 `repos/lumin-target/src/main/resources/static/index.html` 迁移以下内容：
- 样式 (style)
- 登录表单 HTML (移除认证绕过勾选框)
- 仪表盘 HTML
- 所有 JS 逻辑 (移除 bypassAuth 相关代码)

关键修改点：
1. 移除 checkbox-group (第 205-208 行)
2. 移除 JS 中的 bypass 逻辑 (第 382-392 行)
3. 保留正常登录功能

```vue
<script setup lang="ts">
import { ref } from 'vue'
import axios from 'axios'

const API_BASE = '/'

// 状态
const isLoggedIn = ref(false)
const currentUser = ref('')
const activeTab = ref('network')

// 登录
const username = ref('')
const password = ref('')
const loginResult = ref('')
const loginResultType = ref<'success' | 'error' | ''>('')

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

// ... 其他表单处理函数
</script>

<template>
  <!-- 登录表单 -->
  <div v-if="!isLoggedIn" class="card login-form">
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
      <!-- 移除认证绕过勾选框 -->
      <button type="submit" class="btn btn-primary" style="width: 100%;">登录</button>
    </form>
    <div v-if="loginResult" :class="['result', loginResultType]">{{ loginResult }}</div>
  </div>

  <!-- 仪表盘 -->
  <div v-else>
    <!-- header, tabs, tab contents -->
  </div>
</template>

<!-- 样式从原 index.html 迁移 -->
<style>
/* 样式保持不变 */
</style>
```

- [ ] **Step 2: 提交**

```bash
git add lumin-target-frontend/src/App.vue
git commit -m "feat(lumin-target): migrate UI from index.html, remove bypass checkbox"
```

---

## Chunk 3: 验证

### Task 5: 验证前后端独立启动

- [ ] **Step 1: 安装前端依赖并启动**

```bash
cd lumin-target-frontend
npm install
npm run dev
```

Expected: 前端启动在 http://localhost:5173

- [ ] **Step 2: 启动后端**

```bash
cd repos/lumin-target
mvn spring-boot:run
```

Expected: 后端启动在 http://localhost:8080

- [ ] **Step 3: 验证登录功能**

1. 打开 http://localhost:5173
2. 使用 admin / password123 登录
3. 验证登录成功，显示仪表盘

- [ ] **Step 4: 验证认证绕过已移除**

1. 登录页面无"使用认证绕过"勾选框
2. 手动发送带 X-Admin-Header 的请求仍可绕过（后端漏洞保留）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(lumin-target): complete frontend-backend separation"
```

---

## 启动命令汇总

```bash
# 前端 (终端1)
cd lumin-target-frontend
npm install
npm run dev

# 后端 (终端2)
cd repos/lumin-target
mvn spring-boot:run

# 访问
# 前端: http://localhost:5173
# 后端 API: http://localhost:8080
```
