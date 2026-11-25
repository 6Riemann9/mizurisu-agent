import type { AgentTool } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeRateLimitOrCaptcha(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("cf-turnstile") ||
    lower.includes("g-recaptcha") ||
    lower.includes("hcaptcha") ||
    lower.includes("unusual traffic") ||
    lower.includes("please complete the captcha") ||
    lower.includes("verify you are human") ||
    lower.includes("anomaly.js")
  );
}

/** 将网页 HTML 清洗为结构清晰且可控长度的 Markdown/纯文本 */
export function htmlToReadableMarkdown(html: string, maxChars = 12000): string {
  if (!html || !html.trim()) return "";

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? stripHtmlTags(titleMatch[1]) : "";

  let cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  cleaned = cleaned
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, c) => `\n# ${stripHtmlTags(c)}\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, c) => `\n## ${stripHtmlTags(c)}\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_m, c) => `\n### ${stripHtmlTags(c)}\n`)
    .replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_m, c) => `\n#### ${stripHtmlTags(c)}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, c) => `\n- ${stripHtmlTags(c)}`)
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row) => {
      const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
        stripHtmlTags(c[1])
      );
      return cells.length > 0 ? `\n| ${cells.join(" | ")} |` : "\n";
    })
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const label = stripHtmlTags(text);
      if (!label) return "";
      if (/^(javascript:|#)/i.test(href.trim())) return label;
      return `[${label}](${href.trim()})`;
    })
    .replace(/<(p|div|section|article|br|hr)\b[^>]*\/?>/gi, "\n");

  const plain = decodeHtmlEntities(cleaned.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const full = pageTitle && !plain.startsWith(`# ${pageTitle}`) ? `# ${pageTitle}\n\n${plain}` : plain;
  if (full.length <= maxChars) return full;
  return `${full.slice(0, maxChars)}\n\n...(正文已截断，共 ${full.length} 字)`;
}

export function parseDuckDuckGoHtmlResults(html: string, limit = 8): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const linkRegex = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/gi;

  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];

  for (let i = 0; i < links.length && results.length < limit; i++) {
    let href = decodeHtmlEntities(links[i][1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        // 保留原始链接
      }
    }
    const title = stripHtmlTags(links[i][2]);
    const snippet = snippets[i] ? stripHtmlTags(snippets[i][1]) : "";
    if (title && /^https?:\/\//i.test(href)) {
      results.push({ title, url: href, snippet, source: "DuckDuckGo" });
    }
  }
  return results;
}

export function parseBingSearchResults(html: string, limit = 8): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const blockRegex = /<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  for (const m of html.matchAll(blockRegex)) {
    if (results.length >= limit) break;
    const block = m[1];
    const linkMatch = block.match(/<h2[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const href = decodeHtmlEntities(linkMatch[1]);
    const title = stripHtmlTags(linkMatch[2]);
    const snipMatch =
      block.match(/<div\b[^>]*class=["'][^"']*b_caption[^"']*["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snipMatch ? stripHtmlTags(snipMatch[1]) : "";
    if (title && /^https?:\/\//i.test(href)) {
      results.push({ title, url: href, snippet, source: "Bing" });
    }
  }
  return results;
}

export function parseSearxngJsonResults(rawJson: string, limit = 8): WebSearchResultItem[] {
  const parsed = JSON.parse(rawJson) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (parsed.results || [])
    .filter((r) => r.title && r.url && /^https?:\/\//i.test(r.url))
    .slice(0, limit)
    .map((r) => ({
      title: String(r.title).trim(),
      url: String(r.url).trim(),
      snippet: String(r.content || "").trim(),
      source: "SearXNG",
    }));
}

async function performRawFetch(
  url: string,
  runtimeCtx?: ExtensionRuntimeContext
): Promise<{ ok: boolean; status: number; text: string }> {
  const proxyBase = runtimeCtx?.settings.webProxyUrl?.trim();
  const targetUrl =
    runtimeCtx?.platform.kind === "web" && proxyBase
      ? `${proxyBase.replace(/\/+$/, "")}/?url=${encodeURIComponent(url)}`
      : url;

  if (runtimeCtx?.platform.fetchWebUrl && !(runtimeCtx.platform.kind === "web" && proxyBase)) {
    return await runtimeCtx.platform.fetchWebUrl(targetUrl);
  }
  const fetchImpl = runtimeCtx?.platform.getFetch() ?? globalThis.fetch;
  const res = await fetchImpl(targetUrl);
  return {
    ok: res.ok,
    status: res.status,
    text: await res.text(),
  };
}

const webSearchParams = obj({
  query: str({ description: "搜索关键词（支持中英文检索）" }),
  maxResults: opt(int({ description: "返回条数，默认 6", minimum: 1, maximum: 12 })),
});

const fetchUrlParams = obj({
  url: str({ description: "需要读取正文的完整 HTTP/HTTPS 网页地址" }),
  maxChars: opt(int({ description: "最大返回字符数，默认 12000", minimum: 1000, maximum: 30000 })),
});

export const webAccessExtension: MizurisuExtension = {
  id: "pi-web-access",
  name: "本机免费联网检索 (Web Access)",
  description: "免付费 API Key：通过桌面/移动端原生 HTTP 提供免费联网搜索与网页正文提取。",
  category: "ecosystem",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    const webSearchTool: AgentTool<typeof webSearchParams> = {
      name: "web_search",
      label: "免费联网搜索",
      description:
        "搜索互联网公开资料与实时信息（桌面端与移动端原生免 CORS；支持在设置配置自定义 SearXNG 实例）。",
      parameters: webSearchParams,
      execute: async (_id, params) => {
        const query = params.query.trim();
        if (!query) throw new Error("搜索关键词不能为空");
        const limit = params.maxResults ?? 6;

        const searxBase = runtimeCtx?.settings.customSearxngUrl?.trim();
        const attempts: Array<{ name: string; run: () => Promise<WebSearchResultItem[]> }> = [];

        if (searxBase) {
          attempts.push({
            name: "SearXNG",
            run: async () => {
              const endpoint = `${searxBase.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
              const res = await performRawFetch(endpoint, runtimeCtx);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return parseSearxngJsonResults(res.text, limit);
            },
          });
        }

        attempts.push({
          name: "Bing",
          run: async () => {
            const res = await performRawFetch(
              `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
              runtimeCtx
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (looksLikeRateLimitOrCaptcha(res.text)) {
              throw new Error("触发搜索限流或人机验证");
            }
            return parseBingSearchResults(res.text, limit);
          },
        });

        attempts.push({
          name: "DuckDuckGo",
          run: async () => {
            const res = await performRawFetch(
              `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
              runtimeCtx
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (looksLikeRateLimitOrCaptcha(res.text)) {
              throw new Error("触发搜索限流或人机验证");
            }
            return parseDuckDuckGoHtmlResults(res.text, limit);
          },
        });

        const errors: string[] = [];
        for (const source of attempts) {
          try {
            const items = await source.run();
            if (items.length > 0) {
              const formatted = items
                .map(
                  (it, idx) =>
                    `${idx + 1}. **${it.title}**\n   链接：${it.url}\n   摘要：${it.snippet || "（无摘要）"}`
                )
                .join("\n\n");
              return {
                content: [
                  {
                    type: "text",
                    text: `通过 ${source.name} 搜索「${query}」返回 ${items.length} 条结果：\n\n${formatted}`,
                  },
                ],
                details: { source: source.name, count: items.length, results: items },
              };
            }
            errors.push(`${source.name}: 未解析到结果`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${source.name}: ${msg}`);
          }
        }

        const corsHint =
          runtimeCtx?.platform.kind === "web" && !runtimeCtx?.settings.webProxyUrl
            ? "（提示：当前处于纯浏览器环境，直连外部搜索引擎常受浏览器 CORS 限制；建议改用桌面客户端或在设置 → 插件中心填入同域网页抓取代理 / SearXNG 地址。）"
            : "";

        return {
          content: [
            {
              type: "text",
              text: `未能完成免费联网搜索（${errors.join("；")}）${corsHint}`,
            },
          ],
          details: { errors },
          isError: true,
        };
      },
    };

    const fetchUrlTool: AgentTool<typeof fetchUrlParams> = {
      name: "fetch_url",
      label: "抓取网页正文",
      description: "抓取指定 HTTP/HTTPS 网页并清洗为结构化 Markdown 文本。",
      parameters: fetchUrlParams,
      execute: async (_id, params) => {
        const url = params.url.trim();
        if (!/^https?:\/\//i.test(url)) {
          throw new Error("仅支持抓取 HTTP/HTTPS 协议网址");
        }
        try {
          const res = await performRawFetch(url, runtimeCtx);
          if (!res.ok) {
            return {
              content: [{ type: "text", text: `抓取失败：目标站点返回 HTTP ${res.status}` }],
              details: { url, status: res.status },
              isError: true,
            };
          }
          if (looksLikeRateLimitOrCaptcha(res.text)) {
            return {
              content: [{ type: "text", text: `目标网页返回人机验证/反爬拦截页，无法直接提取正文：${url}` }],
              details: { url, captcha: true },
              isError: true,
            };
          }
          const markdown = htmlToReadableMarkdown(res.text, params.maxChars ?? 12000);
          return {
            content: [{ type: "text", text: markdown || "网页正文为空。" }],
            details: { url, chars: markdown.length },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const hint =
            runtimeCtx?.platform.kind === "web"
              ? "（浏览器直连跨域受限，可改用桌面客户端或在设置配置抓取代理）"
              : "";
          return {
            content: [{ type: "text", text: `抓取网页失败：${msg} ${hint}` }],
            details: { url, error: msg },
            isError: true,
          };
        }
      },
    };

    api.registerTool(webSearchTool);
    api.registerTool(fetchUrlTool);
    api.injectSystemPrompt(
      "- 当需要最新行业数据、政策条文或外部公开事实而本地工作区缺少依据时，可先调用 `web_search` 检索并用 `fetch_url` 核验正文。"
    );
  },
};
