# Mizurisu Agent 设计系统规范 (`DESIGN_SYSTEM.md`)

> **工程单一事实源（Single Source of Truth）**：本文档既是 Mizurisu Agent 三端工作台（Web / Desktop / Mobile）的视觉与交互契约，也是后续人类开发者与 AI Agent 迭代 UI 时**必须遵守的组件与 Token 铁律**。任何界面改动均不得绕开本文档定义的 CSS Token、排印类与 `packages/app/src/components/ui` 原语自行另起炉灶。

---

## 1. 设计哲学与参考边界

Mizurisu Agent 的界面融合了 Linear 官方工程与设计实践（*How we redesigned the Linear UI*、*A calmer interface*、*Design for the AI age*）以及以下四条核心产品判断：

1. **Work content dominates, navigation recedes（内容主导，导航退隐）**
   - 对话消息流与右侧原生 Office 文档工作台（Excel / Word / PPT / PDF）占据绝对视觉主体；44px 静谧面包屑顶栏与可折叠 240px 侧栏退居外围，文件图标采用单色极简渲染（[FileBadge.tsx](../packages/app/src/components/common/FileBadge.tsx) 中 `FileIcon` 使用 `strokeWidth={1.6}` 与 `--text-secondary`）。
2. **Workbench not chatbox（工作台而非聊天框）**
   - 采用桌面三栏协同架构（可折叠资源与会话侧栏 + 对话与 Composer 工作区 + 可拖拽/全屏的原生文档编辑台）。模型选择器与 Thinking 强度下沉至底部 Composer 控制条，顶栏仅保留位置面包屑与高频导航入口，彻底解放顶栏纵向空间。
3. **Color is signal, not decoration（色彩即信号，而非装饰）**
   - 全局界面以中性微距灰阶为基底，通过感知均匀的 OKLCH 明度阶梯和 `1px` 发丝边建立层级；仅将品牌强调色（`--accent`）与状态语义色（`--status-success` / `--status-warning` / `--status-danger`）用于焦点、激活、连接态及异常反馈等明确信号。
4. **Reversible by default（默认可逆）**
   - 所有高成本或破坏性动作均优先可恢复：删除会话与删除工作区文件触发 **6 秒「撤销」Toast**；工作区文件覆写、删除与重命名自动留存 `WorkspaceVFS` 历史快照支持版本回滚；敏感工具调用（如文件删除、本地命令行）强制经 `ApprovalDialog` 人工确认。

### 参考边界：官网营销页规范严禁照搬至三栏工作台

| 维度 | 官网营销页（严禁引入工作台） | Mizurisu 三栏生产力工作台（强制执行） |
| --- | --- | --- |
| 字号尺度 | 64px 展示级巨字、大段装饰副标题 | 正文 `14px`（`0.875rem`），控件 `11px–13px`，紧凑明确的信息层级 |
| 留白节奏 | 96px 超大区块垂直间距 | 4px 空间栅格，顶栏 `44px`（`h-11`）、侧栏列表行高 `28px`（`h-7`）、时间轴单行 `26px` |
| 背景与光效 | 多层彩色弥散光斑、全屏炫技视差动效 | 沉静纯色表面阶梯 + `1px` 发丝边，交互微过渡 `120ms–160ms` |
| 主按钮视觉 | 大尺寸荧光渐变按钮 | 克制主 CTA（`--btn-primary-*` 近白/近黑高对比微阴影按钮，常规高度 `28px`/`32px`） |

> **唯一领域例外**：`.slides.html` 演示文稿画布（16:9 独立舞台）与 Word `.word-editor-paper` A4 纸张编辑区属于**文档内容仿真域**，允许遵循演示/印刷规范（如幻灯片封面/KPI 巨字、白纸黑字），不得将工作台控件规则强加于文档内部，也不得将幻灯片展示型巨字泄漏到工作台 Chrome。

---

## 2. OKLCH 色彩系统与三态对比度规范

全部色彩令牌单一定义于 [index.css](../packages/app/src/index.css#L6-L141)。界面支持 **Dark（默认）**、**Light** 及在任一主题上叠加的 **High Contrast（`.high-contrast`）** 三态增强。

### 2.1 核心背景、边框、文本与信号令牌对照表

| Token | `:root, .dark` | `.dark.high-contrast`（覆写项） | `.light` | `.light.high-contrast`（覆写项） | 语义与用途 |
| --- | --- | --- | --- | --- | --- |
| `--bg-canvas` | `oklch(0.14 0.006 264)` | `oklch(0.105 0.004 264)` | `oklch(0.995 0.002 264)` | `oklch(1 0 0)` | 主工作台最底层画布 |
| `--bg-sidebar` | `oklch(0.165 0.007 264)` | `oklch(0.145 0.006 264)` | `oklch(0.974 0.004 264)` | `oklch(0.962 0.005 264)` | 左侧边栏与底栏容器底色 |
| `--bg-surface` | `oklch(0.188 0.008 264)` | `oklch(0.175 0.008 264)` | `oklch(1 0 0)` | *(继承 `.light`)* | 卡片、输入框、面板、弹窗底色 |
| `--bg-elevated` | `oklch(0.218 0.009 264)` | `oklch(0.22 0.01 264)` | `oklch(0.952 0.005 264)` | `oklch(0.935 0.006 264)` | 浮层、气泡、键盘帽、嵌套胶囊 |
| `--surface-subtle` | `rgba(255, 255, 255, 0.025)` | `rgba(255, 255, 255, 0.045)` | `rgba(0, 0, 0, 0.02)` | `rgba(0, 0, 0, 0.038)` | 启动台场景卡等极克制微衬底 |
| `--surface-paper` | `oklch(0.155 0.007 264)` | *(继承 `.dark`)* | `oklch(0.968 0.004 264)` | *(继承 `.light`)* | 预览舞台/纸张托盘背景 |
| `--bg-hover` | `rgba(255, 255, 255, 0.05)` | `rgba(255, 255, 255, 0.09)` | `rgba(0, 0, 0, 0.042)` | `rgba(0, 0, 0, 0.075)` | 交互项悬停填充 |
| `--bg-active` | `rgba(255, 255, 255, 0.088)` | `rgba(255, 255, 255, 0.15)` | `rgba(0, 0, 0, 0.075)` | `rgba(0, 0, 0, 0.12)` | 选中项、按下态背景 |
| `--border-hairline` | `rgba(255, 255, 255, 0.075)` | `rgba(255, 255, 255, 0.16)` | `rgba(0, 0, 0, 0.085)` | `rgba(0, 0, 0, 0.18)` | 常规区域分割线与静态控件描边 |
| `--border-strong` | `rgba(255, 255, 255, 0.15)` | `rgba(255, 255, 255, 0.28)` | `rgba(0, 0, 0, 0.17)` | `rgba(0, 0, 0, 0.34)` | 悬停/聚焦边框、弹层与弹窗外框 |
| `--text-primary` | `oklch(0.975 0.003 264)` | `oklch(0.992 0.002 264)` | `oklch(0.18 0.008 264)` | `oklch(0.12 0.006 264)` | 主标题、正文与选中文字 |
| `--text-heading-sub` | `oklch(0.88 0.012 258)` | `oklch(0.94 0.008 258)` | `oklch(0.28 0.012 262)` | `oklch(0.2 0.01 262)` | 次级标题（如 Markdown `h3`） |
| `--text-secondary` | `oklch(0.72 0.012 260)` | `oklch(0.84 0.01 260)` | `oklch(0.46 0.014 260)` | `oklch(0.32 0.012 260)` | 说明文、图标与默认按钮文字 |
| `--text-muted` | `oklch(0.56 0.012 260)` | `oklch(0.7 0.012 260)` | `oklch(0.56 0.014 260)` | `oklch(0.42 0.012 260)` | 占位符、分组标题、快捷键帽 |
| `--text-dim` | `oklch(0.47 0.01 260)` | `oklch(0.62 0.01 260)` | `oklch(0.64 0.01 260)` | `oklch(0.48 0.01 260)` | 极弱辅助信息 |
| `--accent` | `oklch(0.565 0.165 272)` | `oklch(0.635 0.185 272)` | `oklch(0.535 0.17 272)` | `oklch(0.46 0.195 272)` | 焦点环、选中标识、链接与激活态 |
| `--accent-hover` | `oklch(0.62 0.165 272)` | `oklch(0.685 0.185 272)` | `oklch(0.475 0.175 272)` | `oklch(0.41 0.195 272)` | `--accent` 悬停态 |
| `--accent-soft` | `color-mix(in oklch, var(--accent) 16%, transparent)` | *(基于 `--accent` 自动推导)* | `color-mix(in oklch, var(--accent) 12%, transparent)` | *(基于 `--accent` 自动推导)* | 技能标签、微弱高亮底色 |

### 2.2 克制主 CTA、状态信号色与层次阴影

| Token | Dark 值 | Light 值 | 用途说明 |
| --- | --- | --- | --- |
| `--btn-primary-bg` | `oklch(0.928 0.004 264)` | `oklch(0.19 0.01 264)` | 主 CTA 背景（近白/近黑高对比） |
| `--btn-primary-hover` | `oklch(0.975 0.003 264)` | `oklch(0.26 0.012 264)` | 主 CTA 悬停背景 |
| `--btn-primary-text` | `oklch(0.14 0.006 264)` | `oklch(0.985 0.002 264)` | 主 CTA 文字颜色 |
| `--btn-primary-shadow` | `0 1px 1px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.28)` | `0 1px 2px rgba(15,23,42,0.18), 0 0 0 1px rgba(15,23,42,0.12)` | 多层微阴影建立精密按键触感 |
| `--status-success` | `oklch(0.67 0.15 152)` | `oklch(0.54 0.15 152)` | 成功连接、操作完成状态点 |
| `--status-warning` | `oklch(0.76 0.16 78)` | `oklch(0.64 0.16 74)` | 离线提示、待注意/收藏星标 |
| `--status-danger` | `oklch(0.63 0.19 24)` | `oklch(0.56 0.19 24)` | 错误诊断、停止生成与高危操作 |
| `--shadow-popover` | `0 12px 32px rgba(0,0,0,0.48), 0 0 0 1px var(--border-hairline)` | `0 12px 32px rgba(15,23,42,0.12), 0 0 0 1px var(--border-hairline)` | `Tooltip`、浮层菜单、`ToastHost` 阴影 |
| `--shadow-modal` | `0 24px 64px rgba(0,0,0,0.62), 0 0 0 1px var(--border-strong)` | `0 24px 60px rgba(15,23,42,0.18), 0 0 0 1px var(--border-strong)` | `Dialog` 模态容器阴影 |
| `--ring-focus` | `0 0 0 2px color-mix(in oklch, var(--accent) 48%, transparent)` | 继承 `:root` | `.linear-focus-ring:focus-visible` 聚焦环 |
| `--ease-linear` / `--dur-*` | `cubic-bezier(0.22, 1, 0.36, 1)` / `120ms` (`fast`) / `160ms` (`base`) | 继承 `:root` | 标准 Linear 微交互缓动与时长 |

- **发丝边与切换规则**：
  - 静态边界一律用 `1px solid var(--border-hairline)`；仅在 `:hover`、`:focus-within`、弹出面板与模态框升级为 `var(--border-strong)`。
  - 高对比度状态由 `useAppStore.getState().toggleHighContrast()` 切换 `settings.highContrast`，并在 `document.documentElement.classList` 同步增删 `high-contrast`，**同时严格保留 `.dark` 或 `.light` 类**（依赖 `.dark.high-contrast` 与 `.light.high-contrast` 复合选择器生效）。
  - `index.css` 内的 `--bg-app` / `--bg-panel` / `--bg-subtle` / `--border-subtle` 仅为过渡期兼容别名，**新代码禁止使用**。

---

## 3. 排印 DNA、字体与 4px 空间栅格

### 3.1 离线可变字体与 OpenType 特性

在 [main.tsx](../packages/app/src/main.tsx#L1-L2) 入口直接加载本地 NPM 可变字体包，**严禁请求外网 Google Fonts CDN**：

- 正文可变字体：`@fontsource-variable/inter`（`font-family: "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`）
- 等宽可变字体：`@fontsource-variable/jetbrains-mono`（`font-family: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`）
- 全局 OpenType 特性（[index.css](../packages/app/src/index.css#L151)）：`font-feature-settings: "cv01", "ss03", "cv02", "cv11";`（优化数字 `1`、字母 `r`/`4` 与单层 `a` 等技术排印细节），并开启 `-webkit-font-smoothing: antialiased`。

### 3.2 精密字重与数字对齐类

- `.font-linear-medium`：`font-weight: 510`（用于按钮、顶栏面包屑、激活列表项与 `Tooltip` 文案，替代过重的 `600` 或过弱的 `500`）
- `.font-linear-semibold`：`font-weight: 590`（用于启动台标题、弹窗标题、Markdown `.prose-chat` `h1–h3`）
- `.tabular-nums`：`font-variant-numeric: tabular-nums`（强制用于 Token 计数、文件大小、耗时毫秒、页码、快捷键计数与表格数字；注意 `.univer-host-container` 显式重置为 `font-variant-numeric: normal` 以兼容电子表格内部排版）
- `.linear-focus-ring:focus-visible`：去除默认粗黑外轮廓，统一渲染 `box-shadow: var(--ring-focus)`

### 3.3 4px 空间栅格与视口契约

- **高度阶梯**：`24px` (`h-6`, xs) → `28px` (`h-7`, sm / 侧栏行高 / 顶栏控件) → `32px` (`h-8`, md) → `44px` (`h-11`, 桌面顶栏与搜索栏)。
- **圆角阶梯**：快捷键帽 `4px` (`rounded-[4px]`)、超小按钮 `5px` (`rounded-[5px]`)、标准按钮与提示条 `6px` (`rounded-[6px]`)、卡片/Toast `8px` (`rounded-lg`)、模态弹窗 `12px` (`rounded-xl`)。
- **动态视口约定（`h-dvh`）**：应用根壳层（`App.tsx` 初始化屏与 `AppShell.tsx` 主框架）使用 `h-dvh` 替代 `h-screen`/`100vh`，避免移动端软键盘或动态地址栏裁切底部导航；移动端底栏结合 `--safe-bottom: env(safe-area-inset-bottom, 0px)` 留出安全区。

---

## 4. 内部 UI 原语强制复用规范（`packages/app/src/components/ui`）

统一导出入口为 [index.ts](../packages/app/src/components/ui/index.ts)：

### 4.1 `cn` ([cn.ts](../packages/app/src/components/ui/cn.ts))

- **签名**：`cn(...inputs: ClassValue[]): string`
- **用途**：合并条件类名并通过 `tailwind-merge` 自动消解 Tailwind 样式冲突。所有 UI 组件外部 `className` 透传均应经过 `cn()`。

### 4.2 `Button` ([Button.tsx](../packages/app/src/components/ui/Button.tsx))

- **接口**：`ButtonProps extends ComponentPropsWithoutRef<"button">`
  - `variant?: "primary" | "accent" | "secondary" | "ghost" | "danger"`（默认 `"secondary"`）
  - `size?: "xs" | "sm" | "md" | "icon" | "icon-sm"`（默认 `"sm"`）
  - `type` 默认 `"button"`（防止表单内意外提交），支持 React 19 `ref` 透传
- **规格**：
  - `primary`：`--btn-primary-bg` / `--btn-primary-text` / `--btn-primary-shadow`（用于主发送、主登录、确认提交 CTA）
  - `accent`：`--accent` 白字（高意图品牌动作）
  - `secondary`：`1px var(--border-hairline)` + `--bg-surface`
  - `ghost`：透明背景 + 悬停 `--bg-hover`（顶栏、工具栏、行内动作）
  - `danger`：`--bg-elevated` + `--status-danger`（停止生成、确认删除等高危操作）
  - 尺寸：`xs (h-6 px-2 11px)`、`sm (h-7 px-2.5 12px)`、`md (h-8 px-3 13px)`、`icon (size-7)`、`icon-sm (size-6)`
- **内建保证**：`.font-linear-medium`、`.linear-focus-ring`、`duration-150` 过渡与 `disabled:opacity-40 disabled:pointer-events-none`。

### 4.3 `Kbd` 与 `formatShortcutKey` ([Kbd.tsx](../packages/app/src/components/ui/Kbd.tsx))

- **接口**：
  - `KbdProps`：`{ keys: string | string[]; className?: string; keyClassName?: string }`
  - `formatShortcutKey(key: string): string`
- **行为**：按当前平台（`navigator.platform` / `navigator.userAgent`）自动映射别名：`Mod` → `⌘` (macOS) / `Ctrl` (Win/Linux)、`Shift` → `⇧`/`Shift`、`Alt` → `⌥`/`Alt`、`Enter` → `↵`、`Escape` → `Esc`；渲染最小 `18px × 18px` 等宽单色键帽。

### 4.4 `Tooltip` ([Tooltip.tsx](../packages/app/src/components/ui/Tooltip.tsx))

- **接口**：`TooltipProps`
  - `content?: string`（为空时原样透传 `children`）
  - `shortcut?: string | string[]`（悬停时右侧自动渲染 `<Kbd keys={shortcut} />`，实现快捷键自然习得）
  - `side?: "top" | "bottom" | "left" | "right"`（默认 `"top"`，接近视口边缘自动镜像翻转并限幅 `pad = 8px`）
  - `delayMs?: number`（默认 `200`，`:focus-visible` 键盘聚焦时立即展示）
  - `disabled?: boolean`、`className?: string`、`children: ReactElement<Record<string, unknown>>`
- **行为**：通过 `createPortal(..., document.body)` 脱离局部裁剪容器；自动关联 `aria-describedby` 与 `role="tooltip"`；滚动、窗口尺寸变更或 `onPointerDown` 立即关闭。

### 4.5 `Dialog` ([Dialog.tsx](../packages/app/src/components/ui/Dialog.tsx))

- **接口**：`DialogProps`
  - `open: boolean`、`onClose: () => void`
  - `ariaLabel?: string`、`ariaLabelledBy?: string`
  - `closeOnBackdrop?: boolean`（默认 `true`）、`closeOnEscape?: boolean`（默认 `true`）
  - `initialFocusRef?: RefObject<HTMLElement | null>`
  - `className?: string`、`overlayClassName?: string`、`children: ReactNode`
- **行为**：
  - 打开时通过 `createPortal(..., document.body)` 渲染 `role="dialog"` 与 `aria-modal="true"`；
  - 记录打开前 `document.activeElement`，异步聚焦 `initialFocusRef`（或面板内首个可聚焦控件，无则聚焦面板本身 `tabIndex={-1}`）；
  - 在窗口捕获阶段监听 `Tab` / `Shift+Tab` 实施 **Focus Trap** 焦点闭环，监听 `Escape` 调用 `onClose` 并阻断冒泡；
  - 关闭或组件卸载时若原触发元素仍在文档树中（`target.isConnected`），自动调用 `target.focus()` 还原焦点。

### 4.6 明确禁止事项（Iron Rules）

1. **禁止手写原生 `title` 替代 `Tooltip`**：所有可点击图标按钮、快捷操作按钮必须使用 `<Tooltip content="..." shortcut={...}>`（原生 `title` 仅允许作为超长文件名文本截断时的纯文本补充）。
2. **禁止弹窗不经过 `Dialog`**：任何模态弹窗、命令面板、审批框或快捷键指南，严禁手写 `fixed inset-0` 遮罩和独立 `Escape` 监听，必须统一基于 `<Dialog>` 实现 Focus Trap 与焦点还原。
3. **禁止擅自硬编码色彩跳过 Token**：工作台 UI 组件（除 `.word-editor-paper` / 幻灯片画布等文档模拟区）严禁硬编码 `#xxxxxx`、`rgb(...)` 颜色值，必须使用 `index.css` 语义 CSS 变量。
4. **禁止绕开 `Button` 手搓散装按钮样式**：标准交互按钮必须优先使用 `<Button variant="..." size="..." />` 保持字重、高度、禁用态与 `.linear-focus-ring` 一致。

---

## 5. 键盘优先交互与焦点避让规范

### 5.1 全局与工作台快捷键映射

全局快捷键引擎定义于 [useGlobalShortcuts.ts](../packages/app/src/hooks/useGlobalShortcuts.ts)，命令面板补充 `Mod+K`：

| 快捷键 | 触发条件 / 作用域 | 行为描述 |
| --- | --- | --- |
| `Mod + K` | 全局（`Cmd/Ctrl + K`） | 打开/关闭两级命令面板；选中工作区文件项按 `→` 进入预览/导出/MD转换/删除二级动作，`←` 或空搜索框 `Backspace` 返回 |
| `Mod + ,` | 全局（避让 `.univer-host-container` 内部） | 打开工作台设置弹窗 |
| `[` | 非弹窗、非编辑态单键 | 折叠/展开左侧边栏（若文档台处于全屏展开态则协同还原） |
| `]` | 非弹窗、非编辑态单键 | 打开/关闭右侧 Office 文档台（无预览文件时默认打开首个工作区文件） |
| `\` | 非弹窗、非编辑态单键 | 全屏展开/还原右侧文档台 |
| `C` / `c` | 非 Shift、非弹窗、非编辑态单键 | 新建空白对话会话并自动聚焦 Composer 输入框 |
| `/` | 非 Shift、非弹窗、非编辑态单键 | 聚焦底部 Composer 对话输入框 |
| `?` | 非弹窗、非编辑态单键 | 打开/关闭键盘快捷键速查弹窗（`shortcutHelpOpen`） |
| `Escape` | 浮层 / 弹窗打开时 | 依次关闭当前顶层命令菜单、`@`/`/` 补全浮层或 `<Dialog>` 模态窗 |

### 5.2 Composer 内 `@` 与 `/` 触发规则

- **`@` 引用工作区文件**：当输入框光标前文本匹配 `@[^\s@]*` 时，在 Composer 上方弹出工作区文件列表；支持 `ArrowUp` / `ArrowDown` 移动高亮，`Enter` / `Tab` 将文件追加至 `attachedPaths`（自动去重）并清除 `@查询片段`，`Esc` 关闭。
- **`/` 唤起办公技能**：当输入处于首词命令形态 `/[^\s]*` 时，上方悬浮展示内置及自定义办公技能列表；`ArrowUp` / `ArrowDown` 移动选中，`Enter` / `Tab` 调用 `setActiveSkill(skill.id)` 并清空已输入的 `/查询片段`，`Esc` 关闭。
- **防误发送保护**：当 `@` 或 `/` 补全浮层处于激活状态时，按下 `Enter` 仅触发浮层选项确认并调用 `e.preventDefault()`，**绝对不允许误发送半截消息**。

### 5.3 `isEditableTarget` 焦点避让机制

[useGlobalShortcuts.ts](../packages/app/src/hooks/useGlobalShortcuts.ts#L7-L28) 导出的 `isEditableTarget(target: EventTarget | null)` 是防快捷键劫持打字的核心守门员：

- **返回 `false`（允许触发单键快捷键）**：`null`、非 `Element` 对象、常规布局节点（如 `<div>`、`document.body`、`<span>`）。
- **返回 `true`（严格拦截单键快捷键，保障正常输入）**：
  1. 原生表单控件：`INPUT`、`TEXTAREA`、`SELECT`；
  2. 任意 `el.isContentEditable === true` 节点；
  3. 通过 `el.closest(...)` 命中以下任意祖先或自身选择器：
     - `[contenteditable="true"]`、`[contenteditable=""]`
     - `.ProseMirror`（Tiptap Word 富文本编辑器内部全部子节点）
     - `.univer-host-container`（Univer 电子表格内部单元格编辑框与菜单子节点）
     - `[data-shortcut-ignore="true"]`（业务组件显式声明豁免的区域）
- **额外安全守卫**：当 `e.defaultPrevented`、`e.isComposing`（中文等输入法组合选词中）、任意修饰键按下（`metaKey || ctrlKey || altKey`）或 `modalOpen` 为 `true` 时，单键全局快捷键一律静默跳过。

---

## 6. 可逆操作与无障碍量化门槛

| 指标类别 | 量化标准 | 代码落地依据 |
| --- | --- | --- |
| **焦点陷阱与还原** | 100% 模态窗闭环 `Tab`/`Shift+Tab`，`Esc` 可关闭，关闭后将焦点归还原触发器（`target.isConnected`） | [Dialog.tsx](../packages/app/src/components/ui/Dialog.tsx#L55-L148) |
| **焦点可见性** | 禁止全局移除 `:focus-visible`；所有交互控件接入 `.linear-focus-ring` 呈现 `2px` `--ring-focus` | [index.css](../packages/app/src/index.css#L172-L175) |
| **最小可点击热区** | 桌面紧凑图标最小 `24px × 24px`（`icon-sm: size-6`），常规图标/行控件 `28px`（`size-7` / `h-7`）；移动端底部主导航触控高度 `>= 44px` 并适配 `--safe-bottom` | [Button.tsx](../packages/app/src/components/ui/Button.tsx#L25-L31)、[AppShell.tsx](../packages/app/src/components/layout/AppShell.tsx#L243-L246) |
| **动态降噪无障碍** | 响应 `@media (prefers-reduced-motion: reduce)`，将动画/过渡压降至 `0.01ms !important` 且关闭 `scroll-behavior` 平滑滚动 | [index.css](../packages/app/src/index.css#L177-L186) |
| **6 秒可撤销删除** | 删除会话 (`deleteSession`) 与删除工作区文件 (`deleteWorkspaceFile`) 均推送 `durationMs: 6000` 且带 `action: { label: "撤销" }` 的 Toast；Toast 队列最多保留 4 条并带 `aria-live="polite"` + `role="status"` | [useAppStore.ts](../packages/app/src/store/useAppStore.ts#L646-L676)、[ToastHost.tsx](../packages/app/src/components/common/ToastHost.tsx#L45-L89) |

---

## 7. UI 变更自检清单

每次新增或修改前端界面后，提交前请逐条核对以下项目：

- [ ] **Token 合规**：是否全部采用 `index.css` 中的 OKLCH / 语义 CSS 变量，无硬编码色值或已废弃别名（`--bg-app` / `--bg-panel`）？
- [ ] **三态适配**：是否在 **Dark**、**Light** 及 **High Contrast (`.high-contrast`)** 模式下均具备清晰边框与文本对比度？
- [ ] **原语复用**：交互按钮是否复用 `<Button>`，图标提示是否改用 `<Tooltip>`（并尽量附带 `shortcut` 键帽），弹窗是否基于 `<Dialog>`？
- [ ] **排印一致性**：强调文本是否采用 `.font-linear-medium` (510) / `.font-linear-semibold` (590)，统计数值与时间戳是否添加 `.tabular-nums`？
- [ ] **键盘与编辑器共存**：新增单键快捷键是否挂入 `useGlobalShortcuts` 并受 `isEditableTarget` 与 `modalOpen` 保护，不干扰 Word (`.ProseMirror`) 与 Excel (`.univer-host-container`) 编辑？
- [ ] **可逆与容错**：删除或覆写操作是否保留 6 秒撤销 Toast 或版本快照，复杂预览面板是否包裹于 `<ErrorBoundary scope="panel">`？
- [ ] **移动端与减动效**：全屏壳层是否使用 `h-dvh`，移动端是否无横向溢出（`min-w-0 overflow-hidden`）且尊重 `prefers-reduced-motion`？
- [ ] **测试验证**：是否运行 `pnpm --filter @mizurisu-agent/app typecheck` 与 `pnpm --filter @mizurisu-agent/app test` 确认全部用例通过？
