import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { BrandLogo } from "./components/common/FileBadge";
import { ToastHost } from "./components/common/ToastHost";
import { AppShell } from "./components/layout/AppShell";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const { initialized, init } = useAppStore();

  useEffect(() => {
    init().catch((err) => {
      console.error("Mizurisu Agent init failed:", err);
    });
  }, [init]);

  return (
    <ErrorBoundary scope="app">
      {!initialized ? (
        <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
          <BrandLogo className="w-9 h-9 rounded-lg" />
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" />
            <span>正在初始化本机工作区与 Mizurisu Agent 内核...</span>
          </div>
        </div>
      ) : (
        <AppShell />
      )}
      <ToastHost />
    </ErrorBoundary>
  );
}
