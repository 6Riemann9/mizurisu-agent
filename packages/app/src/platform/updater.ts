export const APP_VERSION = "0.1.0";
export const GITHUB_REPO = "6Riemann9/mizurisu-agent";

export interface ReleaseUpdateResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  downloadUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
  message: string;
}

export function normalizeSemver(raw: string): [number, number, number] {
  const clean = raw.trim().replace(/^v/i, "").split("-")[0];
  const parts = clean.split(".").map((n) => parseInt(n, 10));
  return [
    Number.isFinite(parts[0]) ? parts[0] : 0,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ];
}

/** 比较版本号：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = normalizeSemver(a);
  const pb = normalizeSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function detectClientOs(): "windows" | "macos" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

function pickMatchingAssetUrl(
  assets: Array<{ name?: string; browser_download_url?: string }>,
  os: "windows" | "macos" | "linux" | "unknown"
): string | undefined {
  if (os === "windows") {
    return (
      assets.find((a) => /-setup\.exe$/i.test(a.name || ""))?.browser_download_url ||
      assets.find((a) => /\.msi$/i.test(a.name || ""))?.browser_download_url
    );
  }
  if (os === "macos") {
    return assets.find((a) => /\.dmg$/i.test(a.name || ""))?.browser_download_url;
  }
  if (os === "linux") {
    return (
      assets.find((a) => /\.deb$/i.test(a.name || ""))?.browser_download_url ||
      assets.find((a) => /\.appimage$/i.test(a.name || ""))?.browser_download_url
    );
  }
  return assets[0]?.browser_download_url;
}

export async function checkLatestRelease(
  fetchImpl: typeof fetch,
  currentVersion = APP_VERSION
): Promise<ReleaseUpdateResult> {
  const fallbackReleaseUrl = `https://github.com/${GITHUB_REPO}/releases`;
  const res = await fetchImpl(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (res.status === 404) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: fallbackReleaseUrl,
      message: `当前版本 v${currentVersion}（仓库尚无正式 Release 发版，可通过打 v* Tag 自动发布）`,
    };
  }

  if (!res.ok) {
    throw new Error(`检查更新失败：GitHub API 返回 HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    published_at?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };

  const latestRaw = (data.tag_name || currentVersion).replace(/^v/i, "");
  const hasUpdate = compareSemver(latestRaw, currentVersion) === 1;
  const downloadUrl = pickMatchingAssetUrl(data.assets || [], detectClientOs());

  return {
    currentVersion,
    latestVersion: latestRaw,
    hasUpdate,
    releaseUrl: data.html_url || fallbackReleaseUrl,
    downloadUrl,
    releaseNotes: data.body?.slice(0, 600),
    publishedAt: data.published_at,
    message: hasUpdate
      ? `发现新版本 v${latestRaw}（当前 v${currentVersion}）`
      : `当前已为最新版本 v${currentVersion}`,
  };
}
