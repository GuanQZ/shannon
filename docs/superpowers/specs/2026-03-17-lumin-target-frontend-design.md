# lumin-target 前后端分离设计方案

## 概述

将 lumin-target 项目从单体应用拆分为前后端分离架构。

## 项目结构

```
VSCodeWorkspace/
├── lumin/repos/lumin-target/        # 后端 (Spring Boot) - 端口 8080
│
└── lumin/lumin-target-frontend/     # 前端 (Vue 3 + Vite) - 端口 5173 [新建]
```

## 修改内容

### 1. 前端 (lumin-target-frontend)

- **技术栈**: Vue 3 + TypeScript + Vite
- **端口**: 5173
- **修改**:
  - 新建 Vue 3 + Vite 项目
  - 从原 `index.html` 迁移 UI 到 Vue 组件
  - **移除** "使用认证绕过" 勾选框 (原 HTML 第 205-208 行)
  - **移除** 勾选相关的 JS 逻辑 (原 JS 第 382-392 行)
  - 保留正常登录功能 (admin/password123)

### 2. 后端 (lumin-target)

- **技术栈**: Spring Boot 3.2.0 + Java 17
- **端口**: 8080 (保持不变)
- **修改**:
  - 删除 `src/main/resources/static/index.html`
  - 配置 CORS 允许 `http://localhost:5173` 访问
  - **保留** AuthController 中的认证绕过漏洞代码（X-Admin-Header、bypass_cookie）

## 通信方式

- 前端通过 Axios 调用后端 API
- 后端配置 CORS 跨域资源共享

## 启动方式

| 组件 | 命令 | 端口 |
|------|------|------|
| 前端 | `cd lumin-target-frontend && npm run dev` | 5173 |
| 后端 | `cd repos/lumin-target && mvn spring-boot:run` | 8080 |

## 安全说明

认证绕过漏洞在后端代码中保留，可通过手动构造请求利用：
- Header: `X-Admin-Header: any-value`
- Cookie: `bypass_auth=any-value`
