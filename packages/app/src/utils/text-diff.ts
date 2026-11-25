export interface DiffLine {
  type: "context" | "add" | "del";
  oldLineNo?: number;
  newLineNo?: number;
  text: string;
}

export interface TextDiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  truncated?: boolean;
}

const TEXT_DIFFABLE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "json",
  "csv",
  "tsv",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "yml",
  "yaml",
  "xml",
  "sql",
  "sh",
  "toml",
  "ini",
  "log",
]);

/** 判断文件路径是否适合进行文本逐行 Diff 对比 */
export function isTextDiffablePath(path: string): boolean {
  const lower = path.trim().toLowerCase();
  if (lower.endsWith(".slides.html")) return true;
  const lastDot = lower.lastIndexOf(".");
  if (lastDot < 0) return false;
  const ext = lower.slice(lastDot + 1);
  return TEXT_DIFFABLE_EXTENSIONS.has(ext);
}

const MAX_LCS_CELLS = 160_000;

/**
 * 零依赖轻量逐行 Diff 计算：
 * - 先裁剪首尾相同行，尽量缩小 LCS 动态规划矩阵
 * - 若中间差异行列乘积超过 160,000，安全降级为块级删旧增新以保障 UI 流畅
 */
export function computeLineDiff(beforeText: string, afterText: string): TextDiffResult {
  const normalizedBefore = beforeText.replace(/\r\n/g, "\n");
  const normalizedAfter = afterText.replace(/\r\n/g, "\n");

  if (normalizedBefore === normalizedAfter) {
    const rawLines = normalizedAfter === "" ? [] : normalizedAfter.split("\n");
    return {
      lines: rawLines.map((text, idx) => ({
        type: "context",
        oldLineNo: idx + 1,
        newLineNo: idx + 1,
        text,
      })),
      additions: 0,
      deletions: 0,
    };
  }

  const a = normalizedBefore === "" ? [] : normalizedBefore.split("\n");
  const b = normalizedAfter === "" ? [] : normalizedAfter.split("\n");

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  const lines: DiffLine[] = [];
  for (let i = 0; i < prefix; i++) {
    lines.push({
      type: "context",
      oldLineNo: i + 1,
      newLineNo: i + 1,
      text: a[i],
    });
  }

  let additions = 0;
  let deletions = 0;
  let truncated = false;

  if (midA.length * midB.length <= MAX_LCS_CELLS) {
    const m = midA.length;
    const n = midB.length;
    const cols = n + 1;
    // 使用扁平 Uint32Array 降低 GC 压力
    const dp = new Uint32Array((m + 1) * cols);

    for (let i = m - 1; i >= 0; i--) {
      const rowOffset = i * cols;
      const nextRowOffset = (i + 1) * cols;
      for (let j = n - 1; j >= 0; j--) {
        if (midA[i] === midB[j]) {
          dp[rowOffset + j] = dp[nextRowOffset + (j + 1)] + 1;
        } else {
          const down = dp[nextRowOffset + j];
          const right = dp[rowOffset + (j + 1)];
          dp[rowOffset + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && midA[i] === midB[j]) {
        lines.push({
          type: "context",
          oldLineNo: prefix + i + 1,
          newLineNo: prefix + j + 1,
          text: midA[i],
        });
        i += 1;
        j += 1;
      } else if (j < n && (i === m || dp[i * cols + (j + 1)] >= dp[(i + 1) * cols + j])) {
        lines.push({
          type: "add",
          newLineNo: prefix + j + 1,
          text: midB[j],
        });
        additions += 1;
        j += 1;
      } else {
        lines.push({
          type: "del",
          oldLineNo: prefix + i + 1,
          text: midA[i],
        });
        deletions += 1;
        i += 1;
      }
    }
  } else {
    truncated = true;
    for (let i = 0; i < midA.length; i++) {
      lines.push({
        type: "del",
        oldLineNo: prefix + i + 1,
        text: midA[i],
      });
      deletions += 1;
    }
    for (let j = 0; j < midB.length; j++) {
      lines.push({
        type: "add",
        newLineNo: prefix + j + 1,
        text: midB[j],
      });
      additions += 1;
    }
  }

  for (let s = 0; s < suffix; s++) {
    const oldIdx = a.length - suffix + s;
    const newIdx = b.length - suffix + s;
    lines.push({
      type: "context",
      oldLineNo: oldIdx + 1,
      newLineNo: newIdx + 1,
      text: a[oldIdx],
    });
  }

  return {
    lines,
    additions,
    deletions,
    ...(truncated ? { truncated: true } : {}),
  };
}
