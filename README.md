# Mizurisu Agent (`mizurisu-agent`)

**Mizurisu Agent** 是一款 **100% 本机运行（零自建后端）**、深度适配 **Mizurisu API (`https://www.mizurisu.com`)** 及兼容 **New-API / One-API** 中转站的跨形态三端（**Web / Desktop / Mobile**）智能办公工作台。底层采用轻量可扩展的 **Pi (`@earendil-works/pi-agent-core` & `pi-ai`)** 作为 Agent 内核，内置 Linear 风格深/浅双主题界面与客户端纯 JS Office 处理、排版和实时预览引擎，开箱支持 Word、Excel、PPT（HTML-First 幻灯片设计与 `.pptx` 导出）及 PDF 的读取、生成、编辑与可视化演示。

## 核心特性

- **开箱直连 Mizurisu 与任意兼容中转站点**：
  - 默认预置 [Mizurisu API](https://www.mizurisu.com) 站点配置，亦可在登录页或设置中一键切换至任意自建或第三方 OpenAI / New-API / One-API 中转站，并直达控制台获取 Key、充值额度与查看调用日志；
  - 支持**账号密码直登**，自动读取站点元信息（CNY/USD 费率与余额展示）、拉取明文 API Key（无可用 Key 时自动创建 `Mizurisu Agent` 令牌）并同步可用模型列表（自动智能匹配主流模型）；
  - 支持同源部署（如挂在 `https://www.mizurisu.com/agent/`）自动复用站点登录 Cookie 免二次登录，或通过 URL Hash 参数（`#key={key}&address={address}`）一键免登直达并自动擦除地址栏参数；
  - **智能模型中心 & 中文错误诊断**：自动识别并默认隐藏非对话模型（向量、语音、生图等，可随时切换显示），支持常用模型星标收藏、能力微标（推荐/推理/视觉/长文本）与多协议路由（`compatible` / `auto`）；请求异常（鉴权失效、额度耗尽、限流、跨域、上下文超限等）实时输出中文诊断建议与快捷恢复入口。
- **零后端纯本机运行与安全防线**：
  - 对话历史、工作区文件、自定义 Skill 与凭据均保存在本地设备（IndexedDB / 本地磁盘），不经由任何第三方服务器；
  - **安全加固**：HTML 幻灯片与自定义 CSS 全链路 XSS 消毒（拦截危险标签、事件属性、协议与表达式注入，完整保留矢量 SVG 与 Bento 布局）；Web Worker 数据沙箱阻断外部网络请求与模块逃逸；整库备份默认开启安全脱敏（不含明文 API Key）；桌面端 Shell 工具配备 60 秒超时强杀、256KB 输出截断及严格路径穿越校验。
- **Linear 风格客户工作台与高效交互**：
  - 深/浅双主题自适应、44px 极简顶栏、可折叠侧栏（支持工作区文件搜索、防误删二次确认、行内重命名与会话重命名）、可拖拽分屏预览面板（配备面板级错误边界兜底）与 `Cmd/Ctrl + K` 命令面板；
  - 支持 `Ctrl+V` 直接粘贴剪贴板图片、纯图片/纯附件发送、消息「编辑重发」与「重新生成」、代码块一键复制及客户首次使用三步引导；支持自定义全局办公指令（System Prompt 补充）以适配企业固定输出口径。
- **高可靠性 Agent 内核**：
  - 支持多轮工具调用文本与 Token 用量精准累加、上下文预算自动裁剪、工具审批中止防死锁、流式中断、运行中 `steer` 插话纠偏与会话分支回溯。
- **内置 Office 全家桶与一键交付流（纯 JS 零 Python/Office 依赖）**：
  - **PPT 专业幻灯片 (`slides` / `.html` / `.pptx`)**：采用 **HTML-First 设计引擎 + 客户端矢量导出引擎**，内置 5 套专业设计主题、16:9 定寸排版、DOM 溢出与 CSS 白名单自动校验；右侧支持缩略图导航、全屏演讲模式、文本内联编辑、实时切换主题及导出标准 `.pptx` 文件。
  - **Excel (`.xlsx` / `.csv`)**：多 Sheet 建表、公式计算、样式与冻结首行、单元格增量修改；支持通过隔离 JS 沙箱执行多表联合分析 (`dataPaths`)；右侧内置 `fx` 公式栏、双击编辑与写回导出。
  - **Word (`.docx`)**：结构化文档读取、带多级标题/页眉页脚/列表/表格的文档生成；右侧高保真渲染预览。
  - **PDF (`.pdf`)**：文本提取、结构化章节/要点/表格与页码生成、多份 PDF 合并 (`pdf_merge`)；右侧基于 `pdfjs-dist` 逐页渲染。
  - **一键交付打包与 9 套办公技能**：支持一键打包整个工作区为 `.zip` 交付包、会话记录导出为 `.md`、Markdown 一键转存正式 Word/PDF（预览顶栏及 Agent 工具 `markdown_export`），内置涵盖表格分析、Word 报告、演示 PPT、合同风险审查、多表财务对账与会议行动清单的 9 套办公技能。
- **三端内置增强**：
  - **Web / PWA**：桌面三栏 / 移动底栏响应式双形态，支持 File System Access API 导出及脱敏 JSON 整库备份；
  - **Desktop (Tauri v2)**：无 CORS 原生 HTTP（校验仅放行 HTTP/HTTPS 会话请求）、本地目录挂载同步、受人工审批及超时保护的工作区 Shell 工具；
  - **Mobile (Capacitor 8)**：自适应底部导航、无 CORS 原生 HTTP 与系统原生文件分享。

## 目录结构

```text
mizurisu-agent/
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

### 2. 白标与站点定制（可选）

项目默认已指向 `Mizurisu Agent` 与 `https://www.mizurisu.com`。如需打包为其他 New-API 站点白标版，可复制 `packages/app/.env.example` 为 `packages/app/.env.local`（已被 `.gitignore` 忽略，不会提交至 Git）覆盖以下环境变量：

```env
VITE_APP_BRAND_NAME=Mizurisu Agent
VITE_DEFAULT_NEWAPI_URL=https://www.mizurisu.com
VITE_DEFAULT_MODEL=
```

在本地 `pnpm dev` 时，Vite 会自动对 `VITE_DEFAULT_NEWAPI_URL`（默认 `https://www.mizurisu.com`）开启 `/api`、`/v1`、`/v1beta` 开发代理并重写 Cookie，避免 `localhost` CORS 拦截。

### 3. 本地开发与验证

```bash
# 启动 Web 版开发服务器
pnpm dev

# 类型检查
pnpm typecheck

# 运行单元测试（New-API 鉴权与诊断 / 安全沙箱 / 运行时恢复 / Office 与 PDF 升级 / Slides 校验 / Agent 工具）
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

- **Desktop (Tauri)** 与 **Mobile (Capacitor)** 均通过原生 HTTP 插件请求中转站，**不受浏览器 CORS 限制**。
- **推荐 Web 部署方式（免 CORS & 同源免登）**：直接将 `packages/app/dist` 托管在站点同域名子路径下（如 `https://www.mizurisu.com/agent/`），可自动复用浏览器登录态 Cookie；也可通过后台快捷聊天入口跳转 `https://www.mizurisu.com/agent/#key={key}&address={address}`。
- **独立域名纯 Web 部署**：需确保中转站反向代理允许前端域名跨域（放行 `Authorization`、`Content-Type`、`x-api-key`、`anthropic-version`、`New-Api-User` 等请求头）。

## 开源协议

[MIT](LICENSE)
