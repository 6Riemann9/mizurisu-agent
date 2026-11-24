import type { SkillTemplate } from "../types";

export const BUILTIN_SKILLS: SkillTemplate[] = [
  {
    id: "skill-excel-analysis",
    name: "表格分析与建表",
    description: "深度分析已有 Excel/CSV 并生成汇总表、动态公式与关键业务指标",
    category: "excel",
    builtin: true,
    systemHint:
      "优先使用 excel_inspect 和 excel_read_sheet 查看表结构与数据，再结合 run_js_analysis 做聚合统计，最后用 excel_create 或 excel_update 生成带公式（SUM/AVERAGE等）和样式的规范报表。",
    prompt:
      "请分析当前工作区中的表格文件，梳理核心指标与异常值，并生成一份包含汇总表与自动计算公式的新报表。",
  },
  {
    id: "skill-word-report",
    name: "正式 Word 报告",
    description: "生成排版规范的项目方案、分析报告或商业文书 (.docx)",
    category: "word",
    builtin: true,
    systemHint:
      "使用 word_create 生成结构化 Word 文档，务必包含清晰的标题层级（H1/H2/H3）、要点列表、关键数据表格及页眉页脚。",
    prompt:
      "请结合工作区现有资料，撰写一份排版正式、结构清晰的 Word 报告（.docx），包含背景摘要、核心分析、数据对照表与后续行动建议。",
  },
  {
    id: "skill-ppt-deck",
    name: "商务演示文稿",
    description: "制作高颜值商务演示文稿 (.slides.html)，含 KPI 指标卡、对比矩阵、图表与一键导出 PPTX",
    category: "ppt",
    builtin: true,
    systemHint: [
      "制作演示文稿时务必优先调用 `slides_create` 生成 `.slides.html`（禁止默认退回简陋的 `ppt_create`，仅当用户明确要求直接生成旧版二进制 `.pptx` 时才用 `ppt_create`）。如需同步输出 `.pptx`，可传 `alsoExportPptx: true` 或提示用户在右侧预览台点击「导出 PPTX」。",
      "严格遵循高水准演示视觉与排版规范：",
      "1) 禁区清单：严禁在标题下画细彩线/装饰底边；严禁连续两页同版式或满页纯 bullet 列表；严禁在每张卡片左侧堆砌重复色条。",
      "2) 密度与结构：每页正文严格 <= 60 字，留足呼吸感；采用「三明治结构」（核心主张 → 数据/可视化证据 → 一句话行动结论），每页必写精炼 `notes` 演讲者备注；有 Excel/CSV 数据源时先调用 `excel_inspect`/`excel_read_sheet`/`run_js_analysis` 核算真值。",
      "3) 高审美原子排版与矢量图表：灵活组合内置原子类 `.cover-stage`/`.slide-h1`（封面）、`.kpi-grid` + `.kpi-num`（64px `tabular-nums` 巨字）、`.bento-grid`/`.bento-card`（Bento 非对称矩阵）、`.cols-2`（对比）、`.timeline-row`（路线图）、`.slide-table`（高对比表格）、`.badge`（标签）与内联 `<svg viewBox=\"...\">` 图表（显式宽高与 hex 配色）。",
      "4) PPTX 导出样式兼容性白名单：仅使用 Flex / Grid / `px` / `%` / `linear-gradient` / 圆角 / 柔和 `box-shadow` / SVG；严禁 `backdrop-filter`、`radial-gradient`、`conic-gradient`、`transform: translate/scale/skew`、`vh`/`vw`、`@keyframes`。",
      "5) 自检闭环：检查 `slides_create` 返回的体检报告，若有任意样式违规或 `1280×720` 溢出提示，立即调用 `slides_update_slide` 精简修复直到 0 issues！",
    ].join("\n"),
    prompt:
      "请结合工作区现有数据与文档，制作一套 6-8 页高颜值商务演示文稿，包含主封面、核心 KPI 指标看板、双栏对比分析、可视化数据图表、行动路线图及每页演讲者备注。",
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
    description: "对表格数据自动执行去重、缺失值清洗与多维度分组汇总",
    category: "analysis",
    builtin: true,
    systemHint:
      "使用 run_js_analysis 在安全本地计算环境中编写数据处理脚本，对 Excel/CSV 数据进行去重、归一化、分组求和与同比环比计算，并将清洗结果保存为新的 .xlsx 文件。",
    prompt:
      "请检查工作区内的表格数据，执行去重、异常值标注和按维度分组统计，并导出清洗后的新 Excel 文件。",
  },
  {
    id: "skill-weekly-digest",
    name: "周报与纪要整理",
    description: "将零散笔记或业务数据快速整理成规范周报/会议纪要",
    category: "word",
    builtin: true,
    systemHint:
      "先读取工作区相关笔记或模板，再提炼成结构清晰的 Markdown 或 Word 文档（本周进展、核心产出、风险阻塞、下周计划）；如客户需要 Word 或 PDF，可结合 markdown_export 一键转换。",
    prompt:
      "请根据工作区里的记录与数据，帮我整理一份重点突出、条理清晰的本周工作周报（并支持一键导出 Word）。",
  },
  {
    id: "skill-contract-review",
    name: "合同与协议风险审查",
    description: "提取核心条款并排查付款、违约、知识产权与终止风险，输出 Word 审查报告",
    category: "word",
    builtin: true,
    systemHint:
      "先使用 word_read、pdf_read 或 read_text_file 完整读取合同与协议文本，逐条核查主体资格、标的金额、付款节点、违约责任、赔偿上限、知识产权归属、保密与单方解约条款；随后使用 word_create 输出结构化《合同风险审查报告.docx》，包含风险等级汇总表、条款原文摘录、风险解析与具体修改建议文案。",
    prompt:
      "请全面审查工作区中的合同/协议文件，提炼核心商业条款与潜在法律风险点（重点关注付款、违约、知识产权与解约条款），并生成一份包含风险评级清单与逐条修改建议的 Word 审查报告。",
  },
  {
    id: "skill-finance-reconcile",
    name: "多表财务对账与差异核查",
    description: "联合比对流水表与业务台账，自动定位金额/单号差异并生成带公式 Excel 对账单",
    category: "excel",
    builtin: true,
    systemHint:
      "先使用 excel_inspect 查看工作区中多张财务表（如银行/支付流水与业务订单台账）的列名和字段格式，再调用 run_js_analysis 的多表参数 dataPaths 并行载入多张数据表（通过全局变量 datasets[path] 访问），完成精确主键匹配、金额差异核算与状态分类（已平账/金额不符/单边账）；最后用 excel_create 输出含汇总统计页（带 SUM/COUNTIF 等公式）与差异明细页的对账 Excel。",
    prompt:
      "请核对工作区中的财务流水表与业务台账，自动排查单边账、重复入账及金额差异，并生成一份包含对账汇总指标公式与差异明细清单的新 Excel 文件。",
  },
  {
    id: "skill-meeting-action",
    name: "会议纪要转行动清单",
    description: "从会议记录提炼决策结论、负责人、截止时间与优先级，输出跟踪台账与纪要",
    category: "analysis",
    builtin: true,
    systemHint:
      "先读取工作区中的会议录音转写文本、笔记或文档，提取三大核心要素：1) 已达成决策与待定议题；2) 行动项（任务描述、唯一负责人、截止日期、优先级 P0/P1/P2、当前状态）；3) 跨团队依赖与风险提醒。随后分别调用 write_text_file 生成结构化 Markdown 会议纪要，并调用 excel_create 生成可直接推进跟踪的《会议行动项跟踪台账.xlsx》（含按负责人/优先级汇总公式）。",
    prompt:
      "请整理工作区中的会议记录，提炼明确决策结论与可执行行动项（含负责人、截止时间与优先级），同时输出一份规范的 Markdown 会议纪要与一份 Excel 行动跟踪台账。",
  },
];
