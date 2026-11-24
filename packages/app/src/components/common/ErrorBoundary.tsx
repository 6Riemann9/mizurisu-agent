import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  scope?: "app" | "panel";
  title?: string;
  fallbackActions?: ReactNode;
  children: ReactNode;
  resetKey?: string | number;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 通用异常边界组件：支持应用级与面板级降级卡片，并随 resetKey 变化自动恢复
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] 捕获到界面渲染异常:", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const scope = this.props.scope ?? "panel";
    const heading =
      this.props.title ??
      (scope === "app" ? "应用界面遇到意外错误" : "当前面板渲染异常");
    const errorDetail = this.state.error?.message?.trim() || "未知渲染异常";

    const containerClass =
      scope === "app"
        ? "min-h-screen w-full bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-4"
        : "h-full w-full min-h-[200px] bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-4";

    return (
      <div className={containerClass} role="alert">
        <div className="w-full max-w-md rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 space-y-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[var(--status-danger)] shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                {heading}
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                界面渲染时发生异常，你的本地文档与对话记录仍已安全保留，可点击重试恢复。
              </p>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-[11.5px] font-mono text-[var(--text-muted)] break-words max-h-32 overflow-y-auto">
            {errorDetail}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={this.handleReset}
              className="h-8 px-3 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重试恢复</span>
            </button>

            {scope === "app" && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>刷新页面</span>
              </button>
            )}

            {this.props.fallbackActions}
          </div>
        </div>
      </div>
    );
  }
}
