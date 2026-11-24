import type { ServerResponse } from "node:http";
import https from "node:https";
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

  // 本地开发代理禁用 keepAlive 并固定 IPv4，避免 TUN/Cloudflare 复用半开连接触发 TLS 断连
  const proxyAgent = defaultProxyTarget.toLowerCase().startsWith("https://")
    ? new https.Agent({ keepAlive: false, family: 4 })
    : undefined;

  const sharedProxy = defaultProxyTarget
    ? {
        target: defaultProxyTarget,
        changeOrigin: true,
        secure: true,
        agent: proxyAgent,
        proxyTimeout: 30000,
        timeout: 30000,
        configure: (proxy: {
          on: (event: string, cb: (...args: unknown[]) => void) => void;
        }) => {
          proxy.on("proxyRes", (proxyRes) => {
            rewriteProxyCookies(proxyRes as { headers: Record<string, unknown> });
          });
          proxy.on("error", (err, _req, res) => {
            const error = err as Error;
            const serverRes = res as ServerResponse | undefined;
            if (serverRes && !serverRes.headersSent && typeof serverRes.writeHead === "function") {
              serverRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
              serverRes.end(
                JSON.stringify({
                  error: {
                    message: `代理连接上游站点网络/TLS 握手失败（请稍后重试或检查本机代理节点）: ${error?.message || "连接断开"}`,
                  },
                })
              );
            }
          });
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
