import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function rewriteProxyCookies(proxyRes: { headers: Record<string, unknown> }) {
  const raw = proxyRes.headers["set-cookie"];
  if (!raw) return;
  const list = Array.isArray(raw) ? raw : [String(raw)];
  proxyRes.headers["set-cookie"] = list.map((cookie) =>
    String(cookie)
      .replace(/;\s*Domain=[^;]+/gi, "")
      .replace(/;\s*Secure/gi, "")
      .replace(/;\s*SameSite=Strict/gi, "; SameSite=Lax")
  );
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const defaultProxyTarget = (
    env.VITE_DEFAULT_NEWAPI_URL ||
    process.env.VITE_DEFAULT_NEWAPI_URL ||
    "https://www.mizurisu.com"
  ).trim();

  const sharedProxy = defaultProxyTarget
    ? {
        target: defaultProxyTarget,
        changeOrigin: true,
        secure: true,
        configure: (proxy: {
          on: (
            event: string,
            cb: (proxyRes: { headers: Record<string, unknown> }) => void
          ) => void;
        }) => {
          proxy.on("proxyRes", rewriteProxyCookies);
        },
      }
    : undefined;

  return {
    base: "./",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    server: sharedProxy
      ? {
          proxy: {
            "/api": sharedProxy,
            "/v1": sharedProxy,
            "/v1beta": sharedProxy,
          },
        }
      : undefined,
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 2500,
    },
  };
});
