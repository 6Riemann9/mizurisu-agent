import { exportToPptx } from "dom-to-pptx";
import { sanitizeSlideHtml } from "./slides-sanitize";

export { sanitizeSlideHtml } from "./slides-sanitize";

export type SlideThemeId =
  | "linear-dark"
  | "apple-keynote"
  | "consulting-exec"
  | "swiss-editorial"
  | "warm-founder";

export interface SlideThemeMeta {
  id: SlideThemeId;
  name: string;
  subtitle: string;
  bgHex: string;
  accentHex: string;
  isDark: boolean;
}

export const SLIDE_THEMES: SlideThemeMeta[] = [
  {
    id: "linear-dark",
    name: "Linear 深空",
    subtitle: "极暗石墨画布 · 靛蓝微光质感",
    bgHex: "#0B0C10",
    accentHex: "#5E6AD2",
    isDark: true,
  },
  {
    id: "apple-keynote",
    name: "Keynote 极夜",
    subtitle: "纯黑舞台 · 苹果式大留白与净白字",
    bgHex: "#050507",
    accentHex: "#2997FF",
    isDark: true,
  },
  {
    id: "consulting-exec",
    name: "麦肯锡战略",
    subtitle: "象牙白纸面 · 深海蓝专业决策风格",
    bgHex: "#F8FAFC",
    accentHex: "#1D4ED8",
    isDark: false,
  },
  {
    id: "swiss-editorial",
    name: "瑞士刊物",
    subtitle: "暖白版面 · 黑墨排印与朱红焦点",
    bgHex: "#FAF9F6",
    accentHex: "#D9381E",
    isDark: false,
  },
  {
    id: "warm-founder",
    name: "暖金创投",
    subtitle: "深咖暮色 · 琥珀金与叙事张力",
    bgHex: "#14110F",
    accentHex: "#E59A3E",
    isDark: true,
  },
];

export interface SlidePageSpec {
  title: string;
  notes?: string;
  html: string;
}

export interface SlideDeckSpec {
  title: string;
  theme: SlideThemeId;
  customCss?: string;
  slides: SlidePageSpec[];
}

export interface SlideValidationIssue {
  slideIndex: number;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface SlideValidationReport {
  ok: boolean;
  slideCount: number;
  issues: SlideValidationIssue[];
}

interface ThemePaletteTokens {
  slideBg: string;
  slideBgSolid: string;
  surface: string;
  surfaceElevated: string;
  accentSurface: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSecondary: string;
  accentSoft: string;
  accentText: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  tableStripeBg: string;
  shadowCard: string;
}

const THEME_PALETTES: Record<SlideThemeId, ThemePaletteTokens> = {
  "linear-dark": {
    slideBg: "linear-gradient(155deg, #0b0c10 0%, #12151f 100%)",
    slideBgSolid: "#0b0c10",
    surface: "#14161e",
    surfaceElevated: "#1a1d28",
    accentSurface: "linear-gradient(135deg, #171a2b 0%, #1d2238 100%)",
    border: "rgba(255, 255, 255, 0.09)",
    borderStrong: "rgba(255, 255, 255, 0.16)",
    textPrimary: "#f7f8f8",
    textSecondary: "#a2a9b8",
    textMuted: "#6c7383",
    accent: "#5e6ad2",
    accentSecondary: "#38bdf8",
    accentSoft: "rgba(94, 106, 210, 0.16)",
    accentText: "#9aa5ff",
    success: "#34d399",
    successSoft: "rgba(52, 211, 153, 0.14)",
    warning: "#fbbf24",
    warningSoft: "rgba(251, 191, 36, 0.14)",
    tableHeaderBg: "#1b1f2e",
    tableHeaderText: "#f7f8f8",
    tableStripeBg: "rgba(255, 255, 255, 0.025)",
    shadowCard: "0 10px 28px rgba(0, 0, 0, 0.28)",
  },
  "apple-keynote": {
    slideBg: "linear-gradient(180deg, #050507 0%, #0f1117 100%)",
    slideBgSolid: "#050507",
    surface: "#14151a",
    surfaceElevated: "#1c1e26",
    accentSurface: "linear-gradient(135deg, #101926 0%, #162338 100%)",
    border: "rgba(255, 255, 255, 0.1)",
    borderStrong: "rgba(255, 255, 255, 0.18)",
    textPrimary: "#f5f5f7",
    textSecondary: "#a1a1a6",
    textMuted: "#6e6e73",
    accent: "#2997ff",
    accentSecondary: "#64d2ff",
    accentSoft: "rgba(41, 151, 255, 0.16)",
    accentText: "#64b5ff",
    success: "#30d158",
    successSoft: "rgba(48, 209, 88, 0.14)",
    warning: "#ffd60a",
    warningSoft: "rgba(255, 214, 10, 0.14)",
    tableHeaderBg: "#1a1c24",
    tableHeaderText: "#f5f5f7",
    tableStripeBg: "rgba(255, 255, 255, 0.03)",
    shadowCard: "0 12px 32px rgba(0, 0, 0, 0.36)",
  },
  "consulting-exec": {
    slideBg: "linear-gradient(180deg, #ffffff 0%, #f3f6fb 100%)",
    slideBgSolid: "#f8fafc",
    surface: "#ffffff",
    surfaceElevated: "#eef2f9",
    accentSurface: "linear-gradient(135deg, #eff6ff 0%, #e0ecff 100%)",
    border: "rgba(15, 23, 42, 0.1)",
    borderStrong: "rgba(15, 23, 42, 0.18)",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#64748b",
    accent: "#1d4ed8",
    accentSecondary: "#0284c7",
    accentSoft: "rgba(29, 78, 216, 0.1)",
    accentText: "#1d4ed8",
    success: "#059669",
    successSoft: "rgba(5, 150, 105, 0.1)",
    warning: "#d97706",
    warningSoft: "rgba(217, 119, 6, 0.12)",
    tableHeaderBg: "#0f172a",
    tableHeaderText: "#ffffff",
    tableStripeBg: "#f8fafc",
    shadowCard: "0 6px 20px rgba(15, 23, 42, 0.06)",
  },
  "swiss-editorial": {
    slideBg: "linear-gradient(180deg, #faf9f6 0%, #f3f0e8 100%)",
    slideBgSolid: "#faf9f6",
    surface: "#ffffff",
    surfaceElevated: "#f1ede4",
    accentSurface: "linear-gradient(135deg, #fff5f3 0%, #fde8e3 100%)",
    border: "rgba(20, 20, 19, 0.12)",
    borderStrong: "rgba(20, 20, 19, 0.24)",
    textPrimary: "#141413",
    textSecondary: "#4b4a46",
    textMuted: "#78766f",
    accent: "#d9381e",
    accentSecondary: "#141413",
    accentSoft: "rgba(217, 56, 30, 0.1)",
    accentText: "#c22e16",
    success: "#15803d",
    successSoft: "rgba(21, 128, 61, 0.1)",
    warning: "#b45309",
    warningSoft: "rgba(180, 83, 9, 0.12)",
    tableHeaderBg: "#141413",
    tableHeaderText: "#faf9f6",
    tableStripeBg: "#f7f5f0",
    shadowCard: "0 4px 16px rgba(20, 20, 19, 0.05)",
  },
  "warm-founder": {
    slideBg: "linear-gradient(160deg, #14110f 0%, #1f1915 100%)",
    slideBgSolid: "#14110f",
    surface: "#211b17",
    surfaceElevated: "#2a221d",
    accentSurface: "linear-gradient(135deg, #292018 0%, #36291c 100%)",
    border: "rgba(245, 226, 200, 0.11)",
    borderStrong: "rgba(245, 226, 200, 0.2)",
    textPrimary: "#faf5ef",
    textSecondary: "#cbbba9",
    textMuted: "#8d7e6f",
    accent: "#e59a3e",
    accentSecondary: "#f5c16c",
    accentSoft: "rgba(229, 154, 62, 0.16)",
    accentText: "#f5b867",
    success: "#4ade80",
    successSoft: "rgba(74, 222, 128, 0.14)",
    warning: "#fbbf24",
    warningSoft: "rgba(251, 191, 36, 0.14)",
    tableHeaderBg: "#2c231c",
    tableHeaderText: "#faf5ef",
    tableStripeBg: "rgba(245, 226, 200, 0.03)",
    shadowCard: "0 10px 28px rgba(0, 0, 0, 0.34)",
  },
};

export function normalizeSlideThemeId(theme?: string): SlideThemeId {
  if (theme && theme in THEME_PALETTES) {
    return theme as SlideThemeId;
  }
  return "linear-dark";
}

export function getSlideThemeStyles(theme: SlideThemeId): string {
  const safeTheme = normalizeSlideThemeId(theme);
  const p = THEME_PALETTES[safeTheme];
  const fontStack =
    '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  return `
.mizurisu-slide-scope {
  --slide-w: 1280px;
  --slide-h: 720px;
  --slide-bg: ${p.slideBgSolid};
  --slide-surface: ${p.surface};
  --slide-elevated: ${p.surfaceElevated};
  --slide-border: ${p.border};
  --slide-border-strong: ${p.borderStrong};
  --slide-text: ${p.textPrimary};
  --slide-text-secondary: ${p.textSecondary};
  --slide-text-muted: ${p.textMuted};
  --slide-accent: ${p.accent};
  --slide-accent-2: ${p.accentSecondary};
  --slide-accent-soft: ${p.accentSoft};
  --slide-accent-text: ${p.accentText};
  --slide-success: ${p.success};
  --slide-success-soft: ${p.successSoft};
  --slide-warning: ${p.warning};
  --slide-warning-soft: ${p.warningSoft};
  font-family: ${fontStack};
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .slide {
  width: 1280px;
  height: 720px;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  padding: 46px 56px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background-color: ${p.slideBgSolid};
  background-image: ${p.slideBg};
  color: ${p.textPrimary};
  font-family: ${fontStack};
  -webkit-font-smoothing: antialiased;
}

.mizurisu-slide-scope .slide *,
.mizurisu-slide-scope .slide *::before,
.mizurisu-slide-scope .slide *::after {
  box-sizing: border-box;
}

.mizurisu-slide-scope .slide p,
.mizurisu-slide-scope .slide h1,
.mizurisu-slide-scope .slide h2,
.mizurisu-slide-scope .slide h3,
.mizurisu-slide-scope .slide h4,
.mizurisu-slide-scope .slide ul,
.mizurisu-slide-scope .slide ol {
  margin: 0;
}

.mizurisu-slide-scope .slide ul,
.mizurisu-slide-scope .slide ol {
  padding-left: 20px;
}

.mizurisu-slide-scope .slide li {
  margin-bottom: 8px;
  line-height: 1.5;
  color: ${p.textSecondary};
}

.mizurisu-slide-scope .slide strong {
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .slide-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.mizurisu-slide-scope .slide-header-main {
  flex: 1;
  min-width: 0;
}

.mizurisu-slide-scope .slide-kicker {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${p.accentText};
  margin-bottom: 8px;
}

.mizurisu-slide-scope .slide-h1 {
  font-size: 54px;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.025em;
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .slide-h2 {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .slide-h3 {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .slide-subtitle,
.mizurisu-slide-scope .slide-lead {
  font-size: 18px;
  font-weight: 400;
  line-height: 1.55;
  color: ${p.textSecondary};
  margin-top: 10px;
}

.mizurisu-slide-scope .slide-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
}

.mizurisu-slide-scope .cover-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 0;
}

.mizurisu-slide-scope .cover-hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 980px;
}

.mizurisu-slide-scope .cover-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.mizurisu-slide-scope .cover-meta-card {
  background-color: ${p.surface};
  border: 1px solid ${p.border};
  border-radius: 14px;
  padding: 18px 22px;
  box-shadow: ${p.shadowCard};
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mizurisu-slide-scope .cover-meta-value {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .cover-meta-value.is-success {
  color: ${p.success};
}

.mizurisu-slide-scope .cover-meta-value.is-accent {
  color: ${p.accentText};
}

.mizurisu-slide-scope .kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.mizurisu-slide-scope .kpi-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.mizurisu-slide-scope .kpi-grid-4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

.mizurisu-slide-scope .kpi-card {
  background-color: ${p.surface};
  border: 1px solid ${p.border};
  border-radius: 16px;
  padding: 24px 26px;
  box-shadow: ${p.shadowCard};
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}

.mizurisu-slide-scope .kpi-card.is-accent {
  background-color: ${p.surfaceElevated};
  background-image: ${p.accentSurface};
  border-color: ${p.borderStrong};
}

.mizurisu-slide-scope .kpi-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: ${p.textSecondary};
}

.mizurisu-slide-scope .kpi-num {
  font-size: 64px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .kpi-unit {
  font-size: 26px;
  font-weight: 600;
  color: ${p.textSecondary};
  margin-left: 4px;
}

.mizurisu-slide-scope .kpi-delta {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${p.success};
}

.mizurisu-slide-scope .kpi-delta.is-down {
  color: ${p.warning};
}

.mizurisu-slide-scope .kpi-delta.is-accent {
  color: ${p.accentText};
}

.mizurisu-slide-scope .kpi-sub {
  font-size: 13px;
  line-height: 1.45;
  color: ${p.textMuted};
}

.mizurisu-slide-scope .bento-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 18px;
}

.mizurisu-slide-scope .span-4 {
  grid-column: span 4 / span 4;
}

.mizurisu-slide-scope .span-5 {
  grid-column: span 5 / span 5;
}

.mizurisu-slide-scope .span-6 {
  grid-column: span 6 / span 6;
}

.mizurisu-slide-scope .span-7 {
  grid-column: span 7 / span 7;
}

.mizurisu-slide-scope .span-8 {
  grid-column: span 8 / span 8;
}

.mizurisu-slide-scope .span-12 {
  grid-column: span 12 / span 12;
}

.mizurisu-slide-scope .bento-card {
  background-color: ${p.surface};
  border: 1px solid ${p.border};
  border-radius: 16px;
  padding: 22px 24px;
  box-shadow: ${p.shadowCard};
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
}

.mizurisu-slide-scope .bento-card.is-accent {
  background-color: ${p.surfaceElevated};
  background-image: ${p.accentSurface};
  border-color: ${p.borderStrong};
}

.mizurisu-slide-scope .cols-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}

.mizurisu-slide-scope .cols-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.mizurisu-slide-scope .card-title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .card-desc {
  font-size: 14px;
  line-height: 1.55;
  color: ${p.textSecondary};
}

.mizurisu-slide-scope .timeline-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.mizurisu-slide-scope .timeline-step {
  background-color: ${p.surface};
  border: 1px solid ${p.border};
  border-radius: 14px;
  padding: 20px;
  box-shadow: ${p.shadowCard};
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mizurisu-slide-scope .timeline-num {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
  color: ${p.accentText};
}

.mizurisu-slide-scope .timeline-title {
  font-size: 16px;
  font-weight: 600;
  color: ${p.textPrimary};
}

.mizurisu-slide-scope .timeline-desc {
  font-size: 13px;
  line-height: 1.5;
  color: ${p.textSecondary};
}

.mizurisu-slide-scope .slide-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  background-color: ${p.surface};
  border: 1px solid ${p.border};
  border-radius: 12px;
  overflow: hidden;
}

.mizurisu-slide-scope .slide-table th {
  background-color: ${p.tableHeaderBg};
  color: ${p.tableHeaderText};
  font-weight: 600;
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid ${p.borderStrong};
}

.mizurisu-slide-scope .slide-table td {
  padding: 11px 16px;
  color: ${p.textPrimary};
  border-bottom: 1px solid ${p.border};
}

.mizurisu-slide-scope .slide-table tbody tr:nth-child(even) td {
  background-color: ${p.tableStripeBg};
}

.mizurisu-slide-scope .slide-table tbody tr:last-child td {
  border-bottom: 0;
}

.mizurisu-slide-scope .badge-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.mizurisu-slide-scope .badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  background-color: ${p.surfaceElevated};
  border: 1px solid ${p.borderStrong};
  color: ${p.textSecondary};
  white-space: nowrap;
}

.mizurisu-slide-scope .badge.is-accent {
  background-color: ${p.accentSoft};
  border-color: ${p.accent};
  color: ${p.accentText};
}

.mizurisu-slide-scope .badge.is-success {
  background-color: ${p.successSoft};
  border-color: ${p.success};
  color: ${p.success};
}

.mizurisu-slide-scope .badge.is-warning {
  background-color: ${p.warningSoft};
  border-color: ${p.warning};
  color: ${p.warning};
}

.mizurisu-slide-scope .callout-strip {
  background-color: ${p.surfaceElevated};
  border: 1px solid ${p.borderStrong};
  border-radius: 12px;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 14px;
  line-height: 1.5;
  color: ${p.textSecondary};
}

.mizurisu-slide-scope .action-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mizurisu-slide-scope .action-item {
  background-color: ${p.surfaceElevated};
  border: 1px solid ${p.border};
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.mizurisu-slide-scope .action-index {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 4px 8px;
  border-radius: 6px;
  background-color: ${p.accentSoft};
  color: ${p.accentText};
  flex-shrink: 0;
}

.mizurisu-slide-scope .action-title {
  font-size: 14px;
  font-weight: 600;
  color: ${p.textPrimary};
  margin-bottom: 3px;
}

.mizurisu-slide-scope .action-desc {
  font-size: 13px;
  color: ${p.textSecondary};
  line-height: 1.45;
}

.mizurisu-slide-scope .chart-frame {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mizurisu-slide-scope .chart-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: ${p.textSecondary};
}

.mizurisu-slide-scope .chart-legend-accent {
  color: ${p.accentText};
  font-weight: 600;
}

.mizurisu-slide-scope .chart-grid-line {
  stroke: ${p.border};
}

.mizurisu-slide-scope .chart-axis-line {
  stroke: ${p.borderStrong};
}

.mizurisu-slide-scope .chart-axis-text {
  fill: ${p.textMuted};
}

.mizurisu-slide-scope .chart-val-text {
  fill: ${p.textSecondary};
}

.mizurisu-slide-scope .chart-val-strong {
  fill: ${p.textPrimary};
}

.mizurisu-slide-scope .chart-label-text {
  fill: ${p.textPrimary};
}

.mizurisu-slide-scope .chart-bar-base {
  fill: ${p.textMuted};
  opacity: 0.45;
}

.mizurisu-slide-scope .chart-bar-accent {
  fill: ${p.accent};
}

.mizurisu-slide-scope .chart-bar-secondary {
  fill: ${p.accentSecondary};
}

.mizurisu-slide-scope .chart-bar-success {
  fill: ${p.success};
}

.mizurisu-slide-scope .slide-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid ${p.border};
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: ${p.textMuted};
}
`.trim();
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function sanitizeSlideHtmlForDom(html: string): string {
  return sanitizeSlideHtml(html);
}

function stripClosingStyleTag(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

function extractInnerSlideMarkup(rawHtml: string): string {
  const trimmed = rawHtml.trim();
  const match = trimmed.match(
    /^<section\b[^>]*class=["'][^"']*\bslide\b[^"']*["'][^>]*>([\s\S]*)<\/section>$/i
  );
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

export function buildSlidesHtmlDocument(spec: SlideDeckSpec): string {
  const theme = normalizeSlideThemeId(spec.theme);
  const themeMeta =
    SLIDE_THEMES.find((t) => t.id === theme) ?? SLIDE_THEMES[0];
  const deckTitle = spec.title?.trim() || "未命名演示文稿";
  const themeCss = stripClosingStyleTag(getSlideThemeStyles(theme));
  const customCss = stripClosingStyleTag((spec.customCss || "").trim());
  const metaJson = JSON.stringify({
    version: 1,
    title: deckTitle,
    theme,
  });

  const sections = spec.slides
    .map((slide, idx) => {
      const slideNum = idx + 1;
      const slideTitle = slide.title?.trim() || `第 ${slideNum} 页`;
      const notesAttr = slide.notes
        ? ` data-notes="${escapeHtmlAttr(slide.notes)}"`
        : ` data-notes=""`;
      const inner = sanitizeSlideHtml(extractInnerSlideMarkup(slide.html || ""));
      return [
        `    <section class="slide" data-slide-index="${slideNum}" data-title="${escapeHtmlAttr(slideTitle)}"${notesAttr} style="width: 1280px; height: 720px; position: relative; overflow: hidden;">`,
        inner,
        `    </section>`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `<!DOCTYPE html>`,
    `<html lang="zh-CN" data-theme="${theme}">`,
    `<head>`,
    `  <meta charset="UTF-8" />`,
    `  <meta name="viewport" content="width=1280, initial-scale=1.0" />`,
    `  <meta name="mizurisu-deck" content="${escapeHtmlAttr(metaJson)}" />`,
    `  <title>${escapeHtmlText(deckTitle)}</title>`,
    `  <style data-mizurisu-host>`,
    `    html, body { margin: 0; padding: 0; background-color: ${themeMeta.bgHex}; }`,
    `    .mizurisu-slide-scope { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px 0; }`,
    `  </style>`,
    `  <style data-mizurisu-theme>`,
    themeCss,
    `  </style>`,
    `  <style data-mizurisu-custom>`,
    customCss,
    `  </style>`,
    `</head>`,
    `<body data-theme="${theme}">`,
    `  <div class="mizurisu-slide-scope" data-theme="${theme}">`,
    sections,
    `  </div>`,
    `</body>`,
    `</html>`,
  ].join("\n");
}

function readTagAttr(tagSource: string, attrName: string): string | undefined {
  const re = new RegExp(
    `\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = tagSource.match(re);
  if (!m) return undefined;
  return decodeHtmlEntities(m[1] ?? m[2] ?? "");
}

function extractBalancedSectionBlocks(
  html: string
): Array<{ openTag: string; innerHtml: string }> {
  const results: Array<{ openTag: string; innerHtml: string }> = [];
  const openRe = /<section\b[^>]*\bclass\s*=\s*(?:"[^"]*\bslide\b[^"]*"|'[^']*\bslide\b[^']*')[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openRe.exec(html)) !== null) {
    const openTag = match[0];
    const startIdx = match.index + openTag.length;
    let depth = 1;
    let cursor = startIdx;
    const tagRe = /<\/?section\b[^>]*>/gi;
    tagRe.lastIndex = startIdx;

    let closeStart = -1;
    let closeEnd = -1;
    let innerMatch: RegExpExecArray | null;
    while ((innerMatch = tagRe.exec(html)) !== null) {
      const token = innerMatch[0];
      if (token.startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          closeStart = innerMatch.index;
          closeEnd = tagRe.lastIndex;
          break;
        }
      } else if (!token.endsWith("/>")) {
        depth += 1;
      }
      cursor = tagRe.lastIndex;
    }

    if (closeStart >= 0) {
      results.push({
        openTag,
        innerHtml: html.slice(startIdx, closeStart).trim(),
      });
      openRe.lastIndex = closeEnd;
    } else {
      results.push({
        openTag,
        innerHtml: html.slice(cursor).trim(),
      });
      break;
    }
  }

  return results;
}

export function parseSlidesHtmlWithRegex(html: string): SlideDeckSpec {
  let title = "";
  let themeRaw: string | undefined;

  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const name = readTagAttr(tag, "name");
    if (name === "mizurisu-deck" || name === "pidesk-deck") {
      const content = readTagAttr(tag, "content");
      if (content) {
        try {
          const parsed = JSON.parse(content) as {
            title?: string;
            theme?: string;
          };
          if (parsed.title) title = parsed.title;
          if (parsed.theme) themeRaw = parsed.theme;
        } catch {
          // 忽略损坏的 meta JSON，走其余属性兜底
        }
      }
    }
  }

  if (!themeRaw) {
    const themeMatch = html.match(/\bdata-theme\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (themeMatch) {
      themeRaw = decodeHtmlEntities(themeMatch[1] ?? themeMatch[2] ?? "");
    }
  }

  if (!title) {
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = decodeHtmlEntities(titleMatch[1]).trim();
    }
  }

  let customCss: string | undefined;
  const customStyleMatch = html.match(
    /<style\b[^>]*(?:data-mizurisu-custom|data-pidesk-custom)[^>]*>([\s\S]*?)<\/style>/i
  );
  if (customStyleMatch) {
    const cssText = customStyleMatch[1].trim();
    if (cssText) customCss = cssText;
  }

  const blocks = extractBalancedSectionBlocks(html);
  const slides: SlidePageSpec[] = blocks.map((blk, idx) => {
    const slideTitle =
      readTagAttr(blk.openTag, "data-title")?.trim() || `第 ${idx + 1} 页`;
    const notesRaw = readTagAttr(blk.openTag, "data-notes");
    return {
      title: slideTitle,
      notes: notesRaw && notesRaw.length > 0 ? notesRaw : undefined,
      html: sanitizeSlideHtml(blk.innerHtml),
    };
  });

  return {
    title: title || "未命名演示文稿",
    theme: normalizeSlideThemeId(themeRaw),
    customCss,
    slides,
  };
}

export function parseSlidesHtmlDocument(html: string): SlideDeckSpec {
  if (typeof DOMParser === "undefined") {
    return parseSlidesHtmlWithRegex(html);
  }

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let title = "";
    let themeRaw: string | undefined;

    const metaEl = doc.querySelector(
      'meta[name="mizurisu-deck"], meta[name="pidesk-deck"]'
    );
    const metaContent = metaEl?.getAttribute("content");
    if (metaContent) {
      try {
        const parsed = JSON.parse(metaContent) as {
          title?: string;
          theme?: string;
        };
        if (parsed.title) title = parsed.title;
        if (parsed.theme) themeRaw = parsed.theme;
      } catch {
        // 忽略无效 JSON
      }
    }

    if (!themeRaw) {
      themeRaw =
        doc
          .querySelector(
            ".mizurisu-slide-scope[data-theme], .pidesk-slide-scope[data-theme]"
          )
          ?.getAttribute("data-theme") ||
        doc.body?.getAttribute("data-theme") ||
        doc.documentElement?.getAttribute("data-theme") ||
        undefined;
    }

    if (!title) {
      title = doc.querySelector("title")?.textContent?.trim() || "";
    }

    const customStyleEl = doc.querySelector(
      "style[data-mizurisu-custom], style[data-pidesk-custom]"
    );
    const customCssRaw = customStyleEl?.textContent?.trim();
    const customCss = customCssRaw ? customCssRaw : undefined;

    const rawSlideEls = Array.from(doc.querySelectorAll("section.slide"));
    const candidateEls =
      rawSlideEls.length > 0
        ? rawSlideEls
        : Array.from(doc.querySelectorAll(".slide")).filter(
            (el) => !el.parentElement?.closest(".slide")
          );

    const slides: SlidePageSpec[] = candidateEls.map((el, idx) => {
      const attrTitle = el.getAttribute("data-title")?.trim();
      const headingTitle = el
        .querySelector(".slide-h1, .slide-h2, h1, h2")
        ?.textContent?.trim();
      const notesAttr = el.getAttribute("data-notes");
      return {
        title: attrTitle || headingTitle || `第 ${idx + 1} 页`,
        notes: notesAttr && notesAttr.length > 0 ? notesAttr : undefined,
        html: sanitizeSlideHtml(el.innerHTML.trim()),
      };
    });

    if (slides.length === 0) {
      const regexFallback = parseSlidesHtmlWithRegex(html);
      if (regexFallback.slides.length > 0) {
        return regexFallback;
      }
    }

    return {
      title: title || "未命名演示文稿",
      theme: normalizeSlideThemeId(themeRaw),
      customCss,
      slides,
    };
  } catch {
    return parseSlidesHtmlWithRegex(html);
  }
}

export function updateSlideInHtmlDocument(
  html: string,
  slideIndex: number,
  patch: Partial<SlidePageSpec> & { html?: string }
): string {
  const deck = parseSlidesHtmlDocument(html);
  if (!Number.isInteger(slideIndex) || slideIndex < 1 || slideIndex > deck.slides.length) {
    throw new Error(
      `幻灯片页码 ${slideIndex} 超出范围（共 ${deck.slides.length} 页，页码从 1 开始）`
    );
  }

  const target = deck.slides[slideIndex - 1];
  deck.slides[slideIndex - 1] = {
    title: patch.title !== undefined ? patch.title : target.title,
    notes: patch.notes !== undefined ? patch.notes : target.notes,
    html: sanitizeSlideHtml(patch.html !== undefined ? patch.html : target.html),
  };

  return buildSlidesHtmlDocument(deck);
}

export function switchSlidesHtmlTheme(
  html: string,
  theme: SlideThemeId
): string {
  const deck = parseSlidesHtmlDocument(html);
  return buildSlidesHtmlDocument({
    ...deck,
    theme: normalizeSlideThemeId(theme),
  });
}

interface CssBlacklistRule {
  code: string;
  pattern: RegExp;
  message: string;
}

const CSS_BLACKLIST_RULES: CssBlacklistRule[] = [
  {
    code: "CSS_FORBIDDEN_BACKDROP_FILTER",
    pattern: /backdrop-filter\b/i,
    message:
      "检测到禁止的 CSS 属性 backdrop-filter（dom-to-pptx 不支持毛玻璃滤镜，请改用纯色或 rgba 半透明背景）",
  },
  {
    code: "CSS_FORBIDDEN_RADIAL_GRADIENT",
    pattern: /radial-gradient\s*\(/i,
    message:
      "检测到禁止的 radial-gradient（dom-to-pptx 仅支持 linear-gradient 与矢量 SVG）",
  },
  {
    code: "CSS_FORBIDDEN_CONIC_GRADIENT",
    pattern: /conic-gradient\s*\(/i,
    message:
      "检测到禁止的 conic-gradient（请改用 linear-gradient 或内联矢量 SVG 圆环图）",
  },
  {
    code: "CSS_FORBIDDEN_TRANSFORM",
    pattern: /(?:translate(?:3d|X|Y|Z)?|scale(?:3d|X|Y|Z)?|skew(?:X|Y)?)\s*\(/i,
    message:
      "检测到禁止的 CSS transform（translate/scale/skew 会导致 PPTX 坐标提取错位，请改用 flex/grid 与 px 布局）",
  },
  {
    code: "CSS_FORBIDDEN_VIEWPORT_UNIT",
    pattern: /(?:^|[:\s,(])-?\d+(?:\.\d+)?v[hw]\b/i,
    message:
      "检测到禁止的视口单位 vh/vw（请使用基于 1280×720 画布的 px 或 % 尺寸）",
  },
  {
    code: "CSS_FORBIDDEN_KEYFRAMES",
    pattern: /@(?:-webkit-|-moz-)?keyframes\b/i,
    message:
      "检测到禁止的 @keyframes 动画规则（幻灯片静态渲染与 PPTX 导出不支持关键帧动画）",
  },
];

function scanCssChunk(
  cssText: string,
  slideIndex: number,
  issues: SlideValidationIssue[],
  seenKeys: Set<string>
): void {
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!stripped.trim()) return;

  for (const rule of CSS_BLACKLIST_RULES) {
    if (rule.pattern.test(stripped)) {
      const dedupeKey = `${slideIndex}::${rule.code}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        issues.push({
          slideIndex,
          severity: "error",
          code: rule.code,
          message:
            slideIndex === 0
              ? `全局样式：${rule.message}`
              : `第 ${slideIndex} 页：${rule.message}`,
        });
      }
    }
  }
}

function scanHtmlStaticCssBlacklist(
  html: string,
  deck: SlideDeckSpec,
  issues: SlideValidationIssue[]
): void {
  const seenKeys = new Set<string>();

  // 1. 扫描所有文档级与自定义 <style> 块（剔除每页内部的 <style>，后者归属对应页码）
  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const slideBlocks = extractBalancedSectionBlocks(html);
  const perSlideStyleSet = new Set<string>();

  slideBlocks.forEach((blk, idx) => {
    const slideNumber = idx + 1;
    let innerMatch: RegExpExecArray | null;
    const innerStyleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    while ((innerMatch = innerStyleRe.exec(blk.innerHtml)) !== null) {
      perSlideStyleSet.add(innerMatch[1]);
      scanCssChunk(innerMatch[1], slideNumber, issues, seenKeys);
    }

    const sectionInlineStyle = readTagAttr(blk.openTag, "style");
    if (sectionInlineStyle) {
      scanCssChunk(sectionInlineStyle, slideNumber, issues, seenKeys);
    }
  });

  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleBlockRe.exec(html)) !== null) {
    if (!perSlideStyleSet.has(styleMatch[1])) {
      scanCssChunk(styleMatch[1], 0, issues, seenKeys);
    }
  }

  // 2. 扫描每页内部元素的 inline style="..." 属性（不误伤正文文本中的英文单词）
  deck.slides.forEach((slide, idx) => {
    const slideNumber = idx + 1;
    const inlineStyleRe = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = inlineStyleRe.exec(slide.html)) !== null) {
      const styleVal = decodeHtmlEntities(attrMatch[1] ?? attrMatch[2] ?? "");
      scanCssChunk(styleVal, slideNumber, issues, seenKeys);
    }
  });
}

function createOffscreenSlideHost(
  deck: SlideDeckSpec,
  mode: "validate" | "export"
): { host: HTMLDivElement; slideEls: HTMLElement[] } {
  const host = document.createElement("div");
  host.className = "mizurisu-slide-scope";
  host.setAttribute("data-theme", deck.theme);
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = "1280px";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-9999";

  // 注意：dom-to-pptx 会跳过 visibility === "hidden" 或 opacity === 0 的节点，
  // 因此导出模式保持 visible + opacity: 1（位于屏幕外 -99999px 不产生视觉闪烁）。
  if (mode === "validate") {
    host.style.visibility = "hidden";
    host.style.opacity = "0";
  } else {
    host.style.visibility = "visible";
    host.style.opacity = "1";
  }

  const styleEl = document.createElement("style");
  styleEl.textContent =
    getSlideThemeStyles(deck.theme) +
    (deck.customCss ? `\n${deck.customCss}` : "");
  host.appendChild(styleEl);

  const slideEls: HTMLElement[] = deck.slides.map((slide, idx) => {
    const section = document.createElement("section");
    section.className = "slide";
    section.setAttribute("data-slide-index", String(idx + 1));
    section.setAttribute("data-title", slide.title);
    if (slide.notes) {
      section.setAttribute("data-notes", slide.notes);
    }
    section.style.width = "1280px";
    section.style.height = "720px";
    section.style.position = "relative";
    section.style.overflow = "hidden";
    section.innerHTML = sanitizeSlideHtmlForDom(slide.html);
    host.appendChild(section);
    return section;
  });

  return { host, slideEls };
}

export function validateSlidesHtml(html: string): SlideValidationReport {
  const deck = parseSlidesHtmlDocument(html);
  const issues: SlideValidationIssue[] = [];

  if (deck.slides.length === 0) {
    issues.push({
      slideIndex: 1,
      severity: "error",
      code: "EMPTY_DECK",
      message: "未解析到任何幻灯片页面（缺少 <section class=\"slide\"> 元素）",
    });
    return { ok: false, slideCount: 0, issues };
  }

  // 1. 静态 CSS 黑名单扫描
  scanHtmlStaticCssBlacklist(html, deck, issues);

  // 2. 浏览器环境下无 transform 离屏 1280×720 溢出体检
  if (typeof document !== "undefined" && document.body) {
    const { host, slideEls } = createOffscreenSlideHost(deck, "validate");
    document.body.appendChild(host);
    try {
      slideEls.forEach((slideEl, idx) => {
        const slideIndex = idx + 1;
        const slideTitle = deck.slides[idx]?.title || `第 ${slideIndex} 页`;
        const scrollHeight = slideEl.scrollHeight;
        const scrollWidth = slideEl.scrollWidth;

        let reportedVertical = false;
        let reportedHorizontal = false;

        if (scrollHeight > 724) {
          reportedVertical = true;
          const excessY = Math.ceil(scrollHeight - 720);
          issues.push({
            slideIndex,
            severity: "error",
            code: "SLIDE_OVERFLOW_Y",
            message: `第 ${slideIndex} 页「${slideTitle}」纵向内容溢出 ${excessY}px（当前 ${Math.ceil(scrollHeight)}px > 720px），建议将本页文案精简至 60 字以内、减小卡片内边距或使用 slides_update_slide 拆分页面。`,
          });
        }

        if (scrollWidth > 1284) {
          reportedHorizontal = true;
          const excessX = Math.ceil(scrollWidth - 1280);
          issues.push({
            slideIndex,
            severity: "error",
            code: "SLIDE_OVERFLOW_X",
            message: `第 ${slideIndex} 页「${slideTitle}」横向内容溢出 ${excessX}px（当前 ${Math.ceil(scrollWidth)}px > 1280px），建议缩短长标签/表格列宽或调整栅格列数。`,
          });
        }

        const slideRect = slideEl.getBoundingClientRect();
        if (slideRect.width > 0 && slideRect.height > 0) {
          for (const child of Array.from(slideEl.children)) {
            const childRect = child.getBoundingClientRect();
            if (childRect.width === 0 && childRect.height === 0) continue;

            const leftExcess = Math.ceil(slideRect.left - 4 - childRect.left);
            const topExcess = Math.ceil(slideRect.top - 4 - childRect.top);
            const rightExcess = Math.ceil(childRect.right - (slideRect.right + 4));
            const bottomExcess = Math.ceil(childRect.bottom - (slideRect.bottom + 4));

            const uncapturedY =
              topExcess > 0 || (!reportedVertical && bottomExcess > 0);
            const uncapturedX =
              leftExcess > 0 || (!reportedHorizontal && rightExcess > 0);

            if (uncapturedY || uncapturedX) {
              const maxExcess = Math.max(
                leftExcess,
                topExcess,
                rightExcess,
                bottomExcess
              );
              issues.push({
                slideIndex,
                severity: "error",
                code: "SLIDE_CHILD_OUT_OF_BOUNDS",
                message: `第 ${slideIndex} 页「${slideTitle}」子元素越出 1280×720 边界 ${maxExcess}px，请检查绝对定位或网格高度并精简内容。`,
              });
              break;
            }
          }
        }
      });
    } finally {
      host.remove();
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    slideCount: deck.slides.length,
    issues,
  };
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }
  const buf = await new Response(blob).arrayBuffer();
  return new Uint8Array(buf);
}

export async function exportHtmlSlidesToPptxBytes(
  html: string,
  filename?: string
): Promise<Uint8Array> {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("exportHtmlSlidesToPptxBytes 需要在浏览器 DOM 环境中执行");
  }

  const deck = parseSlidesHtmlDocument(html);
  if (deck.slides.length === 0) {
    throw new Error("幻灯片为空，无法导出 PPTX");
  }

  const { host, slideEls } = createOffscreenSlideHost(deck, "export");
  document.body.appendChild(host);

  try {
    const targetName =
      filename ||
      `${(deck.title || "presentation").replace(/[\\/:*?"<>|]/g, "_")}.pptx`;
    const blob = await exportToPptx(slideEls, {
      skipDownload: true,
      width: 13.333,
      height: 7.5,
      fileName: targetName,
    });
    return await blobToUint8Array(blob);
  } finally {
    host.remove();
  }
}

export function createStarterDemoSlidesHtml(): string {
  const spec: SlideDeckSpec = {
    title: "示例_产品季度汇报",
    theme: "linear-dark",
    slides: [
      {
        title: "2026 Q2 产品与经营季度汇报",
        notes:
          "开场致谢：本页展示 Q2 整体经营跃迁。围绕本地 Office 引擎与多模型中转网关，半年度总营收达 1,845 万元，同比增速 24.0%。",
        html: `
<div class="cover-stage">
  <div class="badge-row" style="justify-content: space-between; width: 100%;">
    <div class="badge is-accent">2026 Q2 EXECUTIVE BRIEF</div>
    <div class="badge">Mizurisu Agent Intelligence</div>
  </div>

  <div class="cover-hero">
    <div class="slide-kicker">PRODUCT &amp; REVENUE REVIEW</div>
    <h1 class="slide-h1">本地智能办公平台<br />Q2 经营复盘与 Q3 演进</h1>
    <p class="slide-subtitle">以 HTML-First 演示引擎与多模型中转网关为核心，打造零后端高保真办公闭环</p>
  </div>

  <div class="cover-meta-grid">
    <div class="cover-meta-card">
      <span class="kpi-label">半年度总营收</span>
      <span class="cover-meta-value">¥1,845 万</span>
      <span class="kpi-sub">数据源：示例_季度销售数据.xlsx</span>
    </div>
    <div class="cover-meta-card">
      <span class="kpi-label">平均同比增速</span>
      <span class="cover-meta-value is-success">+24.0%</span>
      <span class="kpi-sub">华南与西南区域增长领跑</span>
    </div>
    <div class="cover-meta-card">
      <span class="kpi-label">全本地格式闭环</span>
      <span class="cover-meta-value is-accent">4 大内核</span>
      <span class="kpi-sub">Excel · Word · Slides · PDF</span>
    </div>
  </div>
</div>`,
      },
      {
        title: "核心经营指标达成（KPI 看板）",
        notes:
          "核心结论：Q2 营收环比大涨 21% 至 1,010 万元；API 中转网关以 31% 增速成为第二增长曲线。",
        html: `
<div class="slide-header">
  <div class="slide-header-main">
    <div class="slide-kicker">Q2 KEY PERFORMANCE</div>
    <h2 class="slide-h2">半年度营收突破 ¥1,845 万，Q2 环比提速 21%</h2>
  </div>
  <div class="badge-row">
    <div class="badge is-success">目标达成率 108%</div>
  </div>
</div>

<div class="slide-body">
  <div class="kpi-grid">
    <div class="kpi-card is-accent">
      <div class="kpi-label">半年度累计营收</div>
      <div class="kpi-num">1,845<span class="kpi-unit">万</span></div>
      <div>
        <div class="kpi-delta">+24.0% YoY 平均增速</div>
        <div class="kpi-sub">Q1 ¥835万 → Q2 ¥1,010万</div>
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-label">Q2 单季环比跃升</div>
      <div class="kpi-num">+21.0%</div>
      <div>
        <div class="kpi-delta">+¥175万 净增量</div>
        <div class="kpi-sub">四大战区连续两季正增长</div>
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-label">API 中转网关增速</div>
      <div class="kpi-num">+31.0%</div>
      <div>
        <div class="kpi-delta is-accent">华南区核心引擎</div>
        <div class="kpi-sub">半年贡献 ¥478 万高毛利营收</div>
      </div>
    </div>
  </div>

  <div class="callout-strip">
    <span><strong>经营结论：</strong>华东区企业版 SaaS 贡献 38.2% 营收基本盘，API 网关正加速向华南与西南复制。</span>
    <span class="badge">Q2 审计已校验</span>
  </div>
</div>

<div class="slide-footer">
  <span>Mizurisu Agent 2026 Q2 经营复盘</span>
  <span>02 / 04</span>
</div>`,
      },
      {
        title: "Bento 双栏架构与核心能力矩阵",
        notes:
          "架构亮点：通过 1280×720 HTML-First 渲染引擎 + dom-to-pptx 坐标提取，彻底告别传统模板简陋排版。",
        html: `
<div class="slide-header">
  <div class="slide-header-main">
    <div class="slide-kicker">ARCHITECTURE &amp; CAPABILITIES</div>
    <h2 class="slide-h2">Bento 级多模态工作台与本地引擎矩阵</h2>
  </div>
  <div class="badge-row">
    <div class="badge is-accent">Zero-Backend Local</div>
  </div>
</div>

<div class="slide-body">
  <div class="bento-grid">
    <div class="bento-card is-accent span-7">
      <div class="badge-row">
        <div class="badge is-accent">核心升级</div>
        <div class="badge">5 套主题</div>
        <div class="badge is-success">0 溢出自检</div>
      </div>
      <h3 class="slide-h3">HTML-First 幻灯片引擎与原生 PPTX 导出</h3>
      <p class="card-desc">以 1280×720 精密画布承载 KPI 巨字、Bento 卡与矢量 SVG，通过 dom-to-pptx 一键导出可编辑矢量幻灯片。</p>
    </div>

    <div class="bento-card span-5">
      <div class="badge-row">
        <div class="badge">New-API 鉴权</div>
      </div>
      <h3 class="slide-h3">账号登录自动同步 Key</h3>
      <p class="card-desc">支持站点账号密码一键签发与揭露令牌，自动探测站内真实模型列表，消除手工配置摩擦。</p>
    </div>

    <div class="bento-card span-4">
      <div class="card-title">Excel 公式工作台</div>
      <p class="card-desc">内置 fx 坐标公式栏，支持 SUM / AVERAGE 实时计算与增量修订。</p>
    </div>

    <div class="bento-card span-4">
      <div class="card-title">Word / PDF 双向流</div>
      <p class="card-desc">本地生成排版规范的 docx 与 pdf 文档，支持历史版本一键回滚。</p>
    </div>

    <div class="bento-card span-4">
      <div class="card-title">Web Worker 计算沙箱</div>
      <p class="card-desc">隔离 JS 环境完成数据清洗与透视聚合，杜绝大模型数字幻觉。</p>
    </div>
  </div>
</div>

<div class="slide-footer">
  <span>Mizurisu Agent 2026 Q2 经营复盘</span>
  <span>03 / 04</span>
</div>`,
      },
      {
        title: "区域营收增长对比与 Q3 行动路线",
        notes:
          "收尾行动项：Q3 重点推动华南/西南 API 放量、Tauri 桌面离线闭环及全自动汇报工作流。",
        html: `
<div class="slide-header">
  <div class="slide-header-main">
    <div class="slide-kicker">REGIONAL GROWTH &amp; Q3 ROADMAP</div>
    <h2 class="slide-h2">华东领跑基本盘，Q3 聚焦高增速战区放量</h2>
  </div>
  <div class="badge-row">
    <div class="badge">单位：万元</div>
  </div>
</div>

<div class="slide-body">
  <div class="bento-grid">
    <div class="bento-card span-7">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <div class="card-title">各区域 Q1 vs Q2 营收对比</div>
        <div class="chart-legend">
          <span>■ Q1 营收</span>
          <span class="chart-legend-accent">■ Q2 营收</span>
        </div>
      </div>

      <div class="chart-frame">
        <svg viewBox="0 0 600 280" width="600" height="280" style="width: 100%; height: 270px; display: block;">
          <line class="chart-grid-line" x1="48" y1="36" x2="576" y2="36" stroke="#262a36" stroke-width="1" />
          <line class="chart-grid-line" x1="48" y1="88" x2="576" y2="88" stroke="#262a36" stroke-width="1" />
          <line class="chart-grid-line" x1="48" y1="140" x2="576" y2="140" stroke="#262a36" stroke-width="1" />
          <line class="chart-grid-line" x1="48" y1="192" x2="576" y2="192" stroke="#262a36" stroke-width="1" />
          <line class="chart-axis-line" x1="48" y1="244" x2="576" y2="244" stroke="#363b4c" stroke-width="1.2" />

          <text class="chart-axis-text" x="40" y="40" text-anchor="end" fill="#6c7383" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">400</text>
          <text class="chart-axis-text" x="40" y="92" text-anchor="end" fill="#6c7383" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">300</text>
          <text class="chart-axis-text" x="40" y="144" text-anchor="end" fill="#6c7383" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">200</text>
          <text class="chart-axis-text" x="40" y="196" text-anchor="end" fill="#6c7383" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">100</text>
          <text class="chart-axis-text" x="40" y="248" text-anchor="end" fill="#6c7383" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">0</text>

          <!-- 华东区: 320 / 385 -->
          <rect class="chart-bar-base" x="78" y="77.6" width="38" height="166.4" rx="5" fill="#4b5578" />
          <text class="chart-val-text" x="97" y="70" text-anchor="middle" fill="#a2a9b8" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">320</text>
          <rect class="chart-bar-accent" x="122" y="43.8" width="38" height="200.2" rx="5" fill="#5e6ad2" />
          <text class="chart-val-strong" x="141" y="36" text-anchor="middle" fill="#f7f8f8" font-size="12" font-weight="700" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">385</text>
          <text class="chart-label-text" x="119" y="266" text-anchor="middle" fill="#e2e6ee" font-size="13" font-weight="600" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">华东区</text>

          <!-- 华南区: 210 / 268 -->
          <rect class="chart-bar-base" x="208" y="134.8" width="38" height="109.2" rx="5" fill="#4b5578" />
          <text class="chart-val-text" x="227" y="127" text-anchor="middle" fill="#a2a9b8" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">210</text>
          <rect class="chart-bar-secondary" x="252" y="104.6" width="38" height="139.4" rx="5" fill="#38bdf8" />
          <text class="chart-val-strong" x="271" y="97" text-anchor="middle" fill="#f7f8f8" font-size="12" font-weight="700" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">268</text>
          <text class="chart-label-text" x="249" y="266" text-anchor="middle" fill="#e2e6ee" font-size="13" font-weight="600" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">华南区</text>

          <!-- 华北区: 180 / 195 -->
          <rect class="chart-bar-base" x="338" y="150.4" width="38" height="93.6" rx="5" fill="#4b5578" />
          <text class="chart-val-text" x="357" y="143" text-anchor="middle" fill="#a2a9b8" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">180</text>
          <rect class="chart-bar-accent" x="382" y="142.6" width="38" height="101.4" rx="5" fill="#5e6ad2" />
          <text class="chart-val-strong" x="401" y="135" text-anchor="middle" fill="#f7f8f8" font-size="12" font-weight="700" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">195</text>
          <text class="chart-label-text" x="379" y="266" text-anchor="middle" fill="#e2e6ee" font-size="13" font-weight="600" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">华北区</text>

          <!-- 西南区: 125 / 162 -->
          <rect class="chart-bar-base" x="468" y="179" width="38" height="65" rx="5" fill="#4b5578" />
          <text class="chart-val-text" x="487" y="171" text-anchor="middle" fill="#a2a9b8" font-size="11" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">125</text>
          <rect class="chart-bar-success" x="512" y="159.8" width="38" height="84.2" rx="5" fill="#34d399" />
          <text class="chart-val-strong" x="531" y="152" text-anchor="middle" fill="#f7f8f8" font-size="12" font-weight="700" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">162</text>
          <text class="chart-label-text" x="509" y="266" text-anchor="middle" fill="#e2e6ee" font-size="13" font-weight="600" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">西南区</text>
        </svg>
      </div>
    </div>

    <div class="bento-card span-5">
      <div class="card-title">Q3 三项关键行动</div>
      <div class="action-list">
        <div class="action-item">
          <span class="action-index">01</span>
          <div>
            <div class="action-title">复制华南 +31% 增长模型</div>
            <div class="action-desc">推动 API 中转网关向西南 SaaS 存量客户交叉渗透。</div>
          </div>
        </div>
        <div class="action-item">
          <span class="action-index">02</span>
          <div>
            <div class="action-title">夯实桌面端零配置体验</div>
            <div class="action-desc">完善 Tauri 会话代理与本地目录挂载同步。</div>
          </div>
        </div>
        <div class="action-item">
          <span class="action-index">03</span>
          <div>
            <div class="action-title">打通数据到汇报全自动流</div>
            <div class="action-desc">Excel 分析 → HTML 幻灯片 → 原生 PPTX 一键交付。</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="slide-footer">
  <span>Mizurisu Agent 2026 Q2 经营复盘 · 数据对齐 示例_季度销售数据.xlsx</span>
  <span>04 / 04</span>
</div>`,
      },
    ],
  };

  return buildSlidesHtmlDocument(spec);
}
