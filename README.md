# PiDesk — 面向 New-API 的纯本机跨形态三端 Office Agent

**PiDesk** 是一款 **100% 本机运行（零自建后端）**、面向 **New-API / One-API** 中转站的跨形态三端（**Web / Desktop / Mobile**）智能办公工作台。底层采用轻量可扩展的 **Pi (`@earendil-works/pi-agent-core` & `pi-ai`)** 作为 Agent 内核，内置 Linear 风格双主题交互界面与客户端纯 JS Office 处理、排版和实时预览引擎，开箱支持 Word、Excel、PPT（HTML-First 幻灯片设计与 `.pptx` 导出）及 PDF 的读取、生成、编辑与可视化演示。

## 核心特性

- **零后端纯本机运行**：对话历史、工作区文件、自定义 Skill 与 API Key 均保存在本地设备（IndexedDB / 本地磁盘），直连你的 New-API 中转站。
- **Linear 风格极简工作台**：深/浅双主题自适应（Dark-First）、44px 极简顶栏、可折叠侧栏与可拖拽分屏预览面板，内置全局 `Cmd/Ctrl + K` 命令面板与 Activity Timeline 工具调用折叠视图。
- **New-API 全流程鉴权与同步**：
  - 支持**账号密码直登**，自动读取站点元信息（CNY/USD 费率与余额展示）、拉取明文 API Key（无可用 Key 时自动创建 `PiDesk` 令牌）并同步可用模型列表（默认智能匹配站点主流模型）；
  - 支持同源部署（如挂在 `https://your-newapi-domain.com/agent/`）自动复用站点登录 Cookie 免二次登录，或通过 URL Hash 参数（`#key={key}&address={address}`）一键免登直达并自动擦除地址栏参数；
  - 支持一键拉取 `/v1/models` 并按厂商自动分组，`compatible` 与原生多协议 `auto` 自动路由（`openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai`）。
- **Pi 原生 Agent 内核**：完整支持多轮工具调用、Thinking 思考深度调节、流式中断、运行中 `steer` 插话纠偏、会话分支回溯与单次/累计 Token 统计。
- **内置 Office 全家桶与专业 PPT 设计引擎（纯 JS 零 Python/Office 依赖）**：
  - **PPT 专业幻灯片 (`slides` / `.html` / `.pptx`)**：采用 **HTML-First 设计引擎 + `dom-to-pptx` 客户端高保真导出**，内置 5 套专业设计主题（Dark Executive / Clean Light / Ocean Slate / Warm Editorial / Tech Violet）、16:9 定寸排版、DOM 溢出与 CSS 白名单自动校验；右侧支持 16:9 舞台缩略图导航、全屏演讲模式、文本内联编辑、实时切换主题及导出标准 `.pptx` 文件。
  - **Excel (`.xlsx` / `.csv`)**：多 Sheet 建表、公式计算、样式与冻结首行、单元格增量修改；右侧内置类表格视图，支持 `fx` 公式栏、双击编辑、筛选并写回导出。
  - **Word (`.docx`)**：结构化文档读取、带多级标题/页眉页脚/列表/表格的文档生成；右侧 `docx-preview` 高保真渲染预览。
  - **PDF (`.pdf`)**：文本提取、中英文混排生成与 PDF 合并；右侧基于 `pdfjs-dist` 逐页渲染。
- **三端内置增强**：
  - **Web / PWA**：桌面三栏 / 移动底栏响应式双形态，支持 File System Access API 导出及 JSON 整库备份；
  - **Desktop (Tauri v2)**：无 CORS 原生 HTTP（支持 Cookie 会话）、本地目录挂载同步、受人工审批保护的工作区 Shell 工具；
  - **Mobile (Capacitor 8)**：自适应底部导航、无 CORS 原生 HTTP 与系统原生文件分享。

## 目录结构

```text
pi-office-agent/
├── packages/
│   └── app/         # 核心应用（React 19 + Pi SDK + Office 引擎 + 三端 UI，可直接构建为 Web/PWA）
├── apps/
│   ├── desktop/     # Tauri v2 桌面壳（Windows / macOS / Linux）
│   └── mobile/      # Capacitor 8 移动壳（Android / iOS）
└── .github/workflows/
```

## 快速开始

### 1. 安装依赖

要求 Node.js `>= 22.19` 与 pnpm `>= 10`（构建桌面端需 Rust 工具链）。

```bash
pnpm install
```

### 2. 白标与私有站点预置（可选，仅限本地 `.env.local`）

复制 `packages/app/.env.example` 为 `packages/app/.env.local`（已被 `.gitignore` 忽略，**不会提交至 Git**），即可预置白标名称、默认 New-API 地址与默认模型；在本地 `pnpm dev` 时若配置了 `VITE_DEFAULT_NEWAPI_URL`，Vite 会自动开启 `/api`、`/v1`、`/v1beta` 开发代理（带 Cookie 重写）：

```env
VITE_APP_BRAND_NAME=PiDesk
VITE_DEFAULT_NEWAPI_URL=https://your-newapi-domain.com
VITE_DEFAULT_MODEL=
```

### 3. 本地开发与验证

```bash
# 启动 Web 版开发服务器
pnpm dev

# 类型检查
pnpm typecheck

# 运行单元测试（New-API 路由与鉴权 / Office 读写闭环 / Slides 排版校验 / Agent 工具）
pnpm test

# 构建生产 Web 静态包（产物位于 packages/app/dist）
pnpm build
```

### 4. 三端构建

```bash
# 桌面端开发与打包（Tauri v2）
pnpm dev:desktop
pnpm build:desktop

# 移动端同步（Capacitor 8，先构建 Web 产物再同步至原生工程）
pnpm sync:mobile
```

> 更多移动端打包说明请查看 [apps/mobile/README.md](apps/mobile/README.md)。

## Web 端同源部署与 CORS 提示

- **Desktop (Tauri)** 与 **Mobile (Capacitor)** 均通过原生 HTTP 插件请求 New-API，**不受浏览器 CORS 限制**。
- **推荐 Web 部署方式（免 CORS & 同源免登）**：直接将 `packages/app/dist` 托管在你的 New-API 站点同域名子路径下（如 `/agent/`），可自动复用浏览器登录态 Cookie；也可通过 New-API 后台快捷聊天入口跳转 `https://your-newapi-domain.com/agent/#key={key}&address={address}`。
- **独立域名纯 Web 部署**：需确保你的 New-API 反向代理允许前端域名跨域（放行 `Authorization`、`Content-Type`、`x-api-key`、`anthropic-version`、`New-Api-User` 等请求头）。

## 开源协议

[MIT](LICENSE)
