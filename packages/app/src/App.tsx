import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { BrandLogo } from "./components/common/FileBadge";
import { AppShell } from "./components/layout/AppShell";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const { initialized, init } = useAppStore();

  useEffect(() => {
    init().catch((err) => {
      console.error("Mizurisu Agent init failed:", err);
    });
  }, [init]);

  if (!initialized) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
        <BrandLogo className="w-9 h-9 rounded-lg" />
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" />
          <span>正在初始化本机工作区与 Mizurisu Agent 内核...</span>
        </div>
      </div>
    );
  }

  return <AppShell />;
}
