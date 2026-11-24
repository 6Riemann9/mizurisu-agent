import type { SkillTemplate } from "../types";

export const BUILTIN_SKILLS: SkillTemplate[] = [
  {
    id: "skill-excel-analysis",
    name: "表格分析与建表",
    description: "深度分析已有 Excel/CSV 并生成汇总表、公式与可视化统计指标",
    category: "excel",
    builtin: true,
    systemHint:
      "优先使用 excel_inspect 和 excel_read_sheet 查看表结构与数据，再结合 run_js_analysis 做聚合统计，最后用 excel_create 或 excel_update 生成带公式（SUM/AVERAGE等）和样式的规范报表。",
    prompt:
      "请分析当前工作区中的表格文件，梳理核心指标与异常值，并生成一份包含汇总 Sheet 与 Excel 公式的新报表。",
  },
  {
    id: "skill-word-report",
    name: "正式 Word 报告",
    description: "生成排版规范的项目方案、分析报告或合同文档 (.docx)",
    category: "word",
    builtin: true,
    systemHint:
      "使用 word_create 生成结构化 Word 文档，务必包含清晰的标题层级（H1/H2/H3）、要点列表、关键数据表格及页眉页脚。",
    prompt:
      "请结合工作区现有资料，撰写一份排版正式、结构清晰的 Word 报告（.docx），包含背景摘要、核心分析、数据对照表与后续行动建议。",
  },
  {
    id: "skill-ppt-deck",
    name: "高颜值 HTML 演示 PPT",
    description: "基于 1280×720 HTML-First 引擎生成高颜值演示文稿 (.slides.html)，含 64px KPI 巨字、Bento 卡、SVG 图表与一键原生 PPTX 导出",
    category: "ppt",
    builtin: true,
    systemHint: [
      "制作演示文稿时务必优先调用 `slides_create` 生成 `.slides.html`（禁止默认退回简陋的 `ppt_create`，仅当用户明确要求直接生成旧版二进制 `.pptx` 时才用 `ppt_create`）。如需同步输出 `.pptx`，可传 `alsoExportPptx: true` 或提示用户在右侧预览台点击「导出 PPTX」。",
      "严格遵循 Pro PPT 视觉与反模式规范：",
      "1) 禁区清单：严禁在标题下画细彩线/装饰底边；严禁连续两页同版式或满页纯 bullet 列表；严禁在每张卡片左侧堆砌重复色条。",
      "2) 密度与结构：每页正文严格 <= 60 字，留足呼吸感；采用「三明治结构」（核心主张 → 数据/可视化证据 → 一句话行动结论），每页必写精炼 `notes` 演讲者备注；有 Excel/CSV 数据源时先调用 `excel_inspect`/`excel_read_sheet`/`run_js_analysis` 核算真值。",
      "3) 高审美原子排版与矢量图表：灵活组合内置原子类 `.cover-stage`/`.slide-h1`（封面）、`.kpi-grid` + `.kpi-num`（64px `tabular-nums` 巨字）、`.bento-grid`/`.bento-card`（Bento 非对称矩阵）、`.cols-2`（对比）、`.timeline-row`（路线图）、`.slide-table`（高对比表格）、`.badge`（标签）与内联 `<svg viewBox=\"...\">` 图表（显式宽高与 hex 配色）。",
      "4) dom-to-pptx CSS 白名单：仅使用 Flex / Grid / `px` / `%` / `linear-gradient` / 圆角 / 柔和 `box-shadow` / SVG；严禁 `backdrop-filter`、`radial-gradient`、`conic-gradient`、`transform: translate/scale/skew`、`vh`/`vw`、`@keyframes`。",
      "5) 自检闭环：检查 `slides_create` 返回的体检报告，若有任意 CSS 违规或 `1280×720` 溢出提示，立即调用 `slides_update_slide` 精简修复直到 0 issues！",
    ].join("\n"),
    prompt:
      "请结合工作区现有数据与文档，使用 slides_create 制作一套 6-8 页高颜值商务演示文稿（.slides.html），包含深空封面、64px KPI 巨字看板、Bento 双栏对比、内联矢量 SVG 数据图、行动路线与每页演讲者备注，并自检确保 0 溢出、0 黑名单违规。",
  },
  {
    id: "skill-multi-doc-summary",
    name: "多文档对比汇总",
    description: "跨 Word / Excel / PPT / PDF 提取关键信息并输出对比台账",
    category: "analysis",
    builtin: true,
    systemHint:
      "依次调用对应的 read 工具读取工作区多份不同格式文档，提取关键差异与指标后，用 excel_create 输出统一对比台账。",
    prompt:
      "请扫描工作区内的所有文档，提取核心数据、进度与差异点，生成一份横向对比 Excel 汇总表。",
  },
  {
    id: "skill-data-cleaning",
    name: "数据清洗与透视",
    description: "利用本地 JS 沙箱去重、缺失值处理与分维度统计",
    category: "analysis",
    builtin: true,
    systemHint:
      "使用 run_js_analysis 在安全 Web Worker 中编写数据处理脚本，对 Excel/CSV 数据进行去重、归一化、分组求和与同比环比计算，并将清洗结果保存为新的 .xlsx 文件。",
    prompt:
      "请检查工作区内的表格数据，执行去重、异常值标注和按维度分组统计，并导出清洗后的新 Excel 文件。",
  },
  {
    id: "skill-weekly-digest",
    name: "周报与纪要整理",
    description: "将零散笔记或数据快速整理成规范周报/会议纪要",
    category: "word",
    builtin: true,
    systemHint:
      "先读取工作区相关笔记或模板，再提炼成结构清晰的 Markdown 或 Word 文档（本周进展、核心产出、风险阻塞、下周计划）。",
    prompt:
      "请根据工作区里的记录与数据，帮我整理一份重点突出、条理清晰的本周工作周报（同时支持导出 Word）。",
  },
];
