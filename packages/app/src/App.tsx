import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { PiMark } from "./components/common/FileBadge";
import { AppShell } from "./components/layout/AppShell";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const { initialized, init } = useAppStore();

  useEffect(() => {
    init().catch((err) => {
      console.error("PiDesk init failed:", err);
    });
  }, [init]);

  if (!initialized) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
        <div className="w-8 h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-primary)]">
          <PiMark className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" />
          <span>正在初始化本机工作区与 Pi Office 内核...</span>
        </div>
      </div>
    );
  }

  return <AppShell />;
}
