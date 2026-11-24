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
- **Linear 风格客户工作台与键盘优先交互**：
  - **OKLCH 感知色板与高对比度模式**：内置 Dark / Light 双主题与一键切换的高对比度模式（`.high-contrast`），离线加载 `@fontsource-variable/inter` 与 `@fontsource-variable/jetbrains-mono` 配合 OpenType 排印特性（`cv01`/`ss03`/`cv02`/`cv11`）及精密中间字重（510 / 590）；
  - **静谧面包屑顶栏与克制侧栏**：44px 极简面包屑顶栏、可折叠侧栏（紧凑 28px 行高、工作区文件搜索、行内重命名、会话重命名与默认折叠低频技能抽屉）及可拖拽/全屏 Office 分屏工作台（配备面板级错误边界兜底）；
  - **底部集成模型中心的 Composer**：将模型搜索切换与 Thinking 强度下沉至输入底栏，支持 `@` 实时引用工作区文件与 `/` 唤起内置及自定义办公技能，`Ctrl+V` 直接粘贴剪贴板图片、纯图片/纯附件发送、消息「编辑重发」与「重新生成」、代码块一键复制及客户首次使用三步引导；支持自定义全局办公指令（System Prompt 补充）以适配企业固定输出口径；
  - **两级命令面板、键盘优先流与可逆删除**：支持两级 `Cmd/Ctrl + K` 命令面板（工作区文件支持 `→` 进入预览/导出/转换/删除二级子菜单），提供 `[`（侧栏）、`]`（文档台）、`\`（全屏文档）、`C`（新会话）、`/`（聚焦输入）、`?`（快捷键速查）单键工作流与 `Mod + ,` 设置快捷键（自动避让 Word `.ProseMirror` 与 Excel `.univer-host-container` 编辑态焦点），并为删除会话与工作区文件提供 **6 秒「撤销」Toast** 安全反馈。
- **高可靠性 Agent 内核**：
  - 支持多轮工具调用文本与 Token 用量精准累加、上下文预算自动裁剪、工具审批中止防死锁、流式中断、运行中 `steer` 插话纠偏与会话分支回溯。
- **原生级 Office 套件与一键交付流（纯 JS 零 Python/Office 依赖）**：
  - **Excel 原生级电子表格 (`.xlsx` / `.csv`)**：基于 **Univer Sheets** 与 ExcelJS 双向无损桥接，支持多 Sheet、400+ 公式引擎、`fx` 编辑栏、筛选、排序、查找替换、条件格式、行列冻结、样式写回与自动防抖保存；支持全屏「展开编辑」（ResizeObserver 自适应铺满）与隔离 JS 沙箱多表联合分析 (`dataPaths`)。
  - **Word 原生级富文本编辑 (`.docx`)**：集成 **Tiptap** A4 纸张编辑器与多页高保真排版双模式切换，支持 H1-H3 标题、加粗/斜体/下划线/高亮、文字对齐、项目/编号列表、可增删行列表格操作与实时 `.docx` 双向保存导出；亦支持缩放与一键打印。
  - **PPT 专业幻灯片 (`slides` / `.html` / `.pptx`)**：采用 **HTML-First 设计引擎 + 客户端矢量导出引擎**，内置 5 套主题与 16:9 排版；`.pptx` 预览优先视觉还原并支持全屏演示及「转为可编辑 Slides (`.slides.html`)」一键迁移精修。
  - **PDF 专业阅读与可搜索中文导出 (`.pdf`)**：基于 `pdfjs-dist` 渲染缩略图侧栏、真实 `TextLayer` 文本划选与复制、工具栏全文搜索高亮、90° 旋转、适配页宽/缩放到页与打印；Canvas 渲染的中文 PDF 内嵌零外部依赖 `ToUnicode` 隐形文本层，开箱支持全文检索与划选；支持多份 PDF 合并 (`pdf_merge`)。
  - **侧栏一键新建与一键交付**：工作区侧栏 `+ 新建` 一键创建空白/模板 Word (`.docx`)、Excel (`.xlsx`)、演示文稿 (`.slides.html`) 与 Markdown (`.md`)；右侧默认 600px 舒展分栏并支持 Markdown 一键转存正式 Word/PDF、`.zip` 整包交付与 9 套办公技能。
- **三端内置增强**：
  - **Web / PWA**：桌面三栏 / 移动底栏响应式双形态，支持 File System Access API 导出及脱敏 JSON 整库备份；
  - **Desktop (Tauri v2)**：无 CORS 原生 HTTP（校验仅放行 HTTP/HTTPS 会话请求）、本地目录挂载同步、受人工审批及超时保护的工作区 Shell 工具；
  - **Mobile (Capacitor 8)**：自适应底部导航、无 CORS 原生 HTTP 与系统原生文件分享。

## 目录结构

```text
mizurisu-agent/
├── docs/
│   └── DESIGN_SYSTEM.md   # 设计系统单一事实源（OKLCH 令牌、UI 原语铁律、快捷键与无障碍门槛）
├── packages/
│   └── app/               # 核心应用（React 19 + Pi SDK + Office 引擎 + 三端 UI，可直接构建为 Web/PWA）
├── apps/
│   ├── desktop/           # Tauri v2 桌面壳（Windows / macOS / Linux）
│   └── mobile/            # Capacitor 8 移动壳（Android / iOS）
└── .github/workflows/
```

## 设计体系与 UI 规范

项目采用沉淀于 [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) 的工程化 Linear 设计系统作为单一事实源，涵盖 OKLCH 三态对比度色板（Dark / Light / High Contrast）、`Inter Variable` 与 `JetBrains Mono Variable` 离线排印、`packages/app/src/components/ui` 强制复用原语（`Button`、`Tooltip`、`Kbd`、`Dialog`、`cn`）、键盘优先焦点避让机制以及可逆删除/无障碍量化门槛。

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

# 运行单元测试（New-API 鉴权与诊断 / 安全沙箱 / 运行时恢复 / Office 与 PDF 升级 / Slides 校验 / Linear UI 与可逆交互 / Agent 工具）
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
