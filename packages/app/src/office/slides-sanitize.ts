/**
 * 幻灯片 HTML/SVG 与 CSS 安全清洗器（零外部依赖，兼容浏览器 DOM 与纯 Node/Vitest 环境）。
 * 用于在解析、构建、渲染预览及内联编辑保存前拦截 XSS、HTML5 解析差异绕过、危险协议与危险 CSS 注入。
 */

// 成对危险容器标签：移除标签本身及其全部内部内容（孤立开/闭标签同样移除）
// 注：包含 textarea/title/xmp/noembed/noframes/plaintext 等 RCDATA/RAWTEXT 上下文标签，
// 以及 SVG 危险动画标签 animate/set/animateMotion/animateTransform。
const DANGEROUS_CONTAINER_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "form",
  "foreignobject",
  "applet",
  "frame",
  "frameset",
  "noscript",
  "template",
  "textarea",
  "title",
  "xmp",
  "noembed",
  "noframes",
  "plaintext",
  "animate",
  "set",
  "animatemotion",
  "animatetransform",
]);

// 空危险标签（HTML Void Elements）：仅移除标签自身，不吞噬后续正常内容
const DANGEROUS_VOID_TAGS = new Set(["base", "meta", "link", "embed"]);

// 任意出现在闭合位置的危险标签名集合
const DANGEROUS_ALL_TAGS = new Set([
  ...DANGEROUS_CONTAINER_TAGS,
  ...DANGEROUS_VOID_TAGS,
]);

// HTML5 中内部按 RAWTEXT/RCDATA 解析、不按嵌套计数而在首个闭合标签处立即退出的标签
const RAWTEXT_CONTAINER_TAGS = new Set([
  "script",
  "noscript",
  "style",
  "textarea",
  "title",
  "xmp",
  "noembed",
  "noframes",
]);

// 仅允许 # 内部片段引用的 SVG 外部引用高风险标签
const HASH_ONLY_REF_TAGS = new Set([
  "use",
  "feimage",
  "mpath",
  "textpath",
  "tref",
]);

// 携带 URL 的属性集合（忽略大小写）
const URL_ATTRS = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "background",
  "cite",
]);

// 仅允许安全图片 Data URI（禁止 data:text/html、data:image/svg+xml 等）
const SAFE_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i;

// RFC 3986 URL Scheme 匹配（需位于第一个 / ? # 之前）
const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

// 危险 CSS 特征关键字（在剥离注释、解码转义与空白压缩后的小写文本中匹配）
const DANGEROUS_CSS_TOKENS = [
  "expression(",
  "javascript:",
  "vbscript:",
  "data:text/html",
  "data:image/svg",
  "@import",
  "behavior:",
  "-moz-binding",
];

interface ParsedAttr {
  name: string;
  rawValue: string;
  decodedValue: string;
  hasValue: boolean;
  quote: '"' | "'" | "";
}

function isAsciiAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    ch === "-" ||
    ch === "_" ||
    ch === ":"
  );
}

/**
 * 解码 HTML 字符实体（含数字十进制、十六进制及常见命名实体，兼容省略分号形式），
 * 用于安全检测前还原 `&#x6a;avascript:` 或 `java&#9;script:` 等混淆载荷。
 */
function decodeHtmlEntitiesForCheck(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);?/gi, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);?/g, (_m, dec: string) => {
      const cp = parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(
      /&(colon|tab|newline|amp|lt|gt|quot|apos|nbsp|lpar|rpar);?/gi,
      (_m, name: string) => {
        switch (name.toLowerCase()) {
          case "colon":
            return ":";
          case "tab":
            return "\t";
          case "newline":
            return "\n";
          case "amp":
            return "&";
          case "lt":
            return "<";
          case "gt":
            return ">";
          case "quot":
            return '"';
          case "apos":
            return "'";
          case "nbsp":
            return " ";
          case "lpar":
            return "(";
          case "rpar":
            return ")";
          default:
            return "";
        }
      }
    );
}

function escapeAttrDoubleQuoted(value: string): string {
  return value.replace(/"/g, "&quot;");
}

/**
 * 校验幻灯片 URL 属性是否安全：
 * 仅允许 http:、https:、data:image/(png|jpeg|jpg|gif|webp);base64,...、#... 与相对路径；
 * 拦截 javascript:、vbscript:、data:text/html 等危险协议及其大小写/空白/控制符/实体混淆。
 */
export function isSafeSlideUrl(rawValue: string): boolean {
  const decoded = decodeHtmlEntitiesForCheck(rawValue);
  // 剥离所有空白符与控制符（含 \0、\t、\n、\r 等），防止协议词拆分绕过
  const compact = decoded.replace(/[\u0000-\u0020\u007f-\u009f\s]+/g, "");
  if (!compact) return true;
  if (compact.startsWith("#")) return true;
  // 禁止协议相对 URL（//evil.com）
  if (compact.startsWith("//")) return false;

  const schemeMatch = compact.match(URL_SCHEME_RE);
  if (!schemeMatch) {
    // 不含协议前缀，属于合法相对路径（如 ./a.png、images/b.jpg、/assets/c.webp）
    return true;
  }

  const scheme = schemeMatch[1].toLowerCase();
  if (scheme === "http" || scheme === "https") {
    return true;
  }
  if (scheme === "data") {
    return SAFE_DATA_IMAGE_RE.test(compact);
  }
  return false;
}

/**
 * 校验是否为合法的 `#id` 内部引用（用于 <use> 等 SVG 引用元素，禁止外部 URL 加载）。
 */
function isSafeHashOnlyRef(rawValue: string): boolean {
  const decoded = decodeHtmlEntitiesForCheck(rawValue);
  const compact = decoded.replace(/[\u0000-\u0020\u007f-\u009f\s]+/g, "");
  return compact.startsWith("#") && compact.length > 1;
}

/**
 * 归一化 CSS 片段用于安全检测（解码 HTML 实体、剥离 CSS 注释、还原反斜杠转义并压缩空白）。
 */
function normalizeCssForSecurityCheck(rawCss: string): string {
  let s = decodeHtmlEntitiesForCheck(rawCss);
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => {
    const cp = parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
  s = s.replace(/\\([^\n\r0-9a-fA-F])/g, "$1");
  return s.replace(/[\u0000-\u0020\u007f-\u009f\s]+/g, "").toLowerCase();
}

function containsDangerousCss(rawCss: string): boolean {
  const normalized = normalizeCssForSecurityCheck(rawCss);
  return DANGEROUS_CSS_TOKENS.some((token) => normalized.includes(token));
}

/**
 * 按顶级分号拆分 CSS 声明（忽略引号内和括号内的分号，防止 expression(1;2) 拆分漏网）。
 */
function splitCssDeclarations(rawStyle: string): string[] {
  const result: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let quote: '"' | "'" | "" = "";

  for (let i = 0; i < rawStyle.length; i++) {
    const ch = rawStyle[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      parenDepth += 1;
    } else if (ch === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (ch === ";" && parenDepth === 0) {
      result.push(rawStyle.slice(start, i));
      start = i + 1;
    }
  }
  if (start < rawStyle.length) {
    result.push(rawStyle.slice(start));
  }
  return result;
}

/**
 * 清洗 style 属性值；若未命中任何危险片段返回 null（保留原格式），否则返回清洗后的字符串。
 */
function sanitizeStyleAttrValue(rawStyle: string): string | null {
  if (!containsDangerousCss(rawStyle)) {
    return null;
  }

  const declarations = splitCssDeclarations(rawStyle);
  const kept: string[] = [];
  for (const decl of declarations) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    if (containsDangerousCss(trimmed)) {
      continue;
    }
    kept.push(trimmed);
  }

  const rebuilt = kept.join("; ");
  if (!rebuilt || containsDangerousCss(rebuilt)) {
    return "";
  }
  return rebuilt;
}

/**
 * 递归清洗 CSS 规则块树：剔除所有 `@import`（含注释/转义混淆）及含危险构造的声明，
 * 同时保留合法的自定义类、`@keyframes` 等结构以便白名单校验器准确识别。
 */
function sanitizeCssBlockTree(cssText: string): string {
  let out = "";
  let i = 0;
  const len = cssText.length;

  while (i < len) {
    // 扫描到下一个 `{` 或 `;` 或闭合 `}`
    const segmentStart = i;
    let quote: '"' | "'" | "" = "";
    let parenDepth = 0;
    let foundDelim: "{" | ";" | "" = "";

    while (i < len) {
      const ch = cssText[i];
      if (quote) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) quote = "";
        i += 1;
        continue;
      }
      if (ch === "/" && i + 1 < len && cssText[i + 1] === "*") {
        const endComment = cssText.indexOf("*/", i + 2);
        i = endComment === -1 ? len : endComment + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "(") {
        parenDepth += 1;
      } else if (ch === ")" && parenDepth > 0) {
        parenDepth -= 1;
      } else if (parenDepth === 0 && (ch === "{" || ch === ";")) {
        foundDelim = ch;
        break;
      }
      i += 1;
    }

    if (foundDelim === ";") {
      const stmt = cssText.slice(segmentStart, i + 1);
      if (!containsDangerousCss(stmt)) {
        out += stmt;
      }
      i += 1;
      continue;
    }

    if (foundDelim === "{") {
      const header = cssText.slice(segmentStart, i);
      const bodyStart = i + 1;
      let depth = 1;
      let j = bodyStart;
      let bQuote: '"' | "'" | "" = "";

      while (j < len && depth > 0) {
        const ch = cssText[j];
        if (bQuote) {
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === bQuote) bQuote = "";
          j += 1;
          continue;
        }
        if (ch === "/" && j + 1 < len && cssText[j + 1] === "*") {
          const endComment = cssText.indexOf("*/", j + 2);
          j = endComment === -1 ? len : endComment + 2;
          continue;
        }
        if (ch === '"' || ch === "'") {
          bQuote = ch;
        } else if (ch === "{") {
          depth += 1;
        } else if (ch === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
        j += 1;
      }

      const bodyEnd = j;
      const body = cssText.slice(bodyStart, bodyEnd);
      i = bodyEnd < len ? bodyEnd + 1 : len;

      // 若块头本身包含危险构造（如 @import），整块丢弃
      if (containsDangerousCss(header)) {
        continue;
      }

      const cleanBody = sanitizeCssBlockTree(body);
      out += `${header}{${cleanBody}}`;
      continue;
    }

    // 末尾无分号声明或空白
    const tail = cssText.slice(segmentStart);
    if (!containsDangerousCss(tail)) {
      out += tail;
    }
    break;
  }

  return out;
}

/**
 * 清洗幻灯片 `<style>` 块与 `customCss` 文本：
 * 1. 移除任何嵌套 HTML 标签片段及 `<` / `>`（彻底封堵 `<style>` 跳出注入）；
 * 2. 过滤 `@import`、`expression(`、`behavior:`、`-moz-binding` 及危险 `url(javascript:/vbscript:/data:text/html)`。
 */
export function sanitizeSlideCss(cssText: string): string {
  if (!cssText) return "";

  // 先剥离完整或残留 HTML 标签片段与所有 `<` `>`，阻断 HTML5/SVG 解析上下文逃逸
  let cleaned = cssText
    .replace(/<\/?[a-zA-Z][^<>]*>/g, "")
    .replace(/[<>]/g, "");

  if (!containsDangerousCss(cleaned)) {
    return cleaned;
  }

  // 剔除未带分号的行内 @import（允许 /*...*/ 注释或转义写法）
  cleaned = sanitizeCssBlockTree(cleaned);

  // 若仍残留无分号换行分隔的危险语句（例如 `@import "x.css"\n.ok { color: red }`），逐行兜底清洗
  if (containsDangerousCss(cleaned)) {
    cleaned = cleaned
      .split(/\r?\n/)
      .filter((line) => !containsDangerousCss(line))
      .join("\n");
  }

  if (containsDangerousCss(cleaned)) {
    return "";
  }
  return cleaned;
}

function sanitizeSrcsetValue(rawSrcset: string): string {
  const candidates = rawSrcset.split(",");
  const safeCandidates: string[] = [];
  for (const item of candidates) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const firstSpace = trimmed.search(/\s/);
    const urlPart = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    if (isSafeSlideUrl(urlPart)) {
      safeCandidates.push(trimmed);
    }
  }
  return safeCandidates.join(", ");
}

/**
 * 查找闭合标签 `>` 位置（跳过引号属性内部）。
 */
function findCloseTagEnd(html: string, startIndex: number): number {
  let quote: '"' | "'" | "" = "";
  for (let i = startIndex; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * 解析开始标签 `<tagName ...>` 及其所有属性并执行属性级安全过滤。
 */
function parseAndFilterOpenTag(
  html: string,
  attrStart: number,
  tagLower: string
): {
  tagEnd: number;
  selfClosing: boolean;
  keptAttrs: ParsedAttr[];
  modified: boolean;
} | null {
  let p = attrStart;
  const len = html.length;
  let selfClosing = false;
  let modified = false;
  const keptAttrs: ParsedAttr[] = [];
  const isHashOnlyTag = HASH_ONLY_REF_TAGS.has(tagLower);

  while (p < len) {
    // 跳过属性间的空白与斜杠分隔符（兼容 <img/src=x/onerror=alert(1)>）
    while (p < len && (/\s/.test(html[p]) || html[p] === "/")) {
      if (html[p] === "/" && p + 1 < len && html[p + 1] === ">") {
        selfClosing = true;
        p += 1;
        break;
      }
      p += 1;
    }

    if (p >= len) {
      return null;
    }
    if (html[p] === ">") {
      return { tagEnd: p, selfClosing, keptAttrs, modified };
    }

    // 读取属性名
    const nameStart = p;
    while (p < len && !/[\s=/>]/.test(html[p])) {
      p += 1;
    }
    const attrName = html.slice(nameStart, p);
    if (!attrName) {
      p += 1;
      continue;
    }

    while (p < len && /\s/.test(html[p])) {
      p += 1;
    }

    let hasValue = false;
    let rawValue = "";
    let quote: '"' | "'" | "" = "";

    if (p < len && html[p] === "=") {
      hasValue = true;
      p += 1;
      while (p < len && /\s/.test(html[p])) {
        p += 1;
      }
      if (p < len && (html[p] === '"' || html[p] === "'")) {
        quote = html[p] as '"' | "'";
        p += 1;
        const valStart = p;
        while (p < len && html[p] !== quote) {
          p += 1;
        }
        rawValue = html.slice(valStart, p);
        if (p < len && html[p] === quote) {
          p += 1;
        }
      } else {
        const valStart = p;
        while (p < len && !/[\s>]/.test(html[p])) {
          p += 1;
        }
        rawValue = html.slice(valStart, p);
      }
    }

    const attrLower = attrName.toLowerCase();
    const decodedValue = hasValue ? decodeHtmlEntitiesForCheck(rawValue) : "";

    // 1. 移除所有 on* 事件属性与 srcdoc
    if (/^on[a-z]/i.test(attrLower) || attrLower === "srcdoc") {
      modified = true;
      continue;
    }

    // 2. 对 <use> 等 SVG 引用标签强制仅允许 # 内部锚点引用
    if (isHashOnlyTag && (attrLower === "href" || attrLower === "xlink:href")) {
      if (!hasValue || !isSafeHashOnlyRef(rawValue)) {
        modified = true;
        continue;
      }
    }

    // 3. 过滤 URL 属性中的危险协议
    if (URL_ATTRS.has(attrLower)) {
      if (!hasValue || !isSafeSlideUrl(rawValue)) {
        modified = true;
        continue;
      }
    }

    // 4. 过滤 srcset 中的危险候选 URL
    if (attrLower === "srcset" && hasValue) {
      const cleanedSrcset = sanitizeSrcsetValue(rawValue);
      if (cleanedSrcset !== rawValue.trim()) {
        modified = true;
        if (!cleanedSrcset) continue;
        keptAttrs.push({
          name: attrName,
          rawValue: cleanedSrcset,
          decodedValue: cleanedSrcset,
          hasValue: true,
          quote: quote || '"',
        });
        continue;
      }
    }

    // 5. 清洗 style 属性中的危险 CSS 构造
    if (attrLower === "style" && hasValue) {
      const cleanedStyle = sanitizeStyleAttrValue(rawValue);
      if (cleanedStyle !== null) {
        modified = true;
        if (!cleanedStyle) continue;
        keptAttrs.push({
          name: attrName,
          rawValue: cleanedStyle,
          decodedValue: cleanedStyle,
          hasValue: true,
          quote: '"',
        });
        continue;
      }
    }

    keptAttrs.push({
      name: attrName,
      rawValue,
      decodedValue,
      hasValue,
      quote,
    });
  }

  return null;
}

/**
 * 从 startIdx 开始查找指定标签的闭合标签范围 `[closeTagStart, closeTagEnd)`。
 * 对 RAWTEXT/RCDATA 标签（script/noscript/style/textarea/title/xmp/noembed/noframes）
 * 严格按 HTML5 规则在首个 `</tag...>` 的首个 `>` 处退出（不跳过引号，不按嵌套深度计数）。
 */
function findMatchingClosingTagRange(
  html: string,
  tagLower: string,
  startIdx: number
): { closeStart: number; closeEnd: number } | null {
  const isRawText = RAWTEXT_CONTAINER_TAGS.has(tagLower);
  const tagRe = new RegExp(`<(\\/)?${tagLower}(?=[\\s/>])`, "gi");
  tagRe.lastIndex = startIdx;

  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const isClose = Boolean(match[1]);

    if (isRawText) {
      if (!isClose) {
        // RAWTEXT/RCDATA 内部出现的同名开标签（如 `<style><style>`）在 HTML5 中均作为纯文本忽略
        continue;
      }
      const closeGt = html.indexOf(">", tagRe.lastIndex);
      if (closeGt === -1) return null;
      return { closeStart: match.index, closeEnd: closeGt + 1 };
    }

    const closePos = findCloseTagEnd(html, tagRe.lastIndex);
    if (closePos === -1) {
      return null;
    }

    if (isClose) {
      depth -= 1;
      if (depth === 0) {
        return { closeStart: match.index, closeEnd: closePos + 1 };
      }
    } else {
      const openSlice = html.slice(match.index, closePos + 1);
      if (!/\/\s*>$/.test(openSlice)) {
        depth += 1;
      }
    }
    tagRe.lastIndex = closePos + 1;
  }

  return null;
}

function serializeOpenTag(
  tagName: string,
  keptAttrs: ParsedAttr[],
  selfClosing: boolean
): string {
  const attrParts = keptAttrs.map((attr) => {
    if (!attr.hasValue) {
      return ` ${attr.name}`;
    }
    if (attr.quote === '"' || attr.quote === "'") {
      return ` ${attr.name}=${attr.quote}${attr.rawValue}${attr.quote}`;
    }
    return ` ${attr.name}="${escapeAttrDoubleQuoted(attr.rawValue)}"`;
  });
  return `<${tagName}${attrParts.join("")}${selfClosing ? " />" : ">"}`;
}

/**
 * 单轮扫描清洗 HTML/SVG 字符串。
 */
function sanitizePass(html: string): string {
  let out = "";
  let i = 0;
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    if (lt > i) {
      out += html.slice(i, lt);
      i = lt;
    }

    if (i + 1 >= len) {
      out += "<";
      break;
    }

    const nextCh = html[i + 1];

    // 处理 HTML 注释与 <!...> / <?...> 声明，消除注释走私与条件注释歧义
    if (nextCh === "!") {
      if (html.startsWith("<!--", i)) {
        if (html.startsWith("<!-->", i)) {
          i += 5;
          continue;
        }
        if (html.startsWith("<!--->", i)) {
          i += 6;
          continue;
        }
        const closeComment = html.indexOf("-->", i + 4);
        if (closeComment === -1) {
          break;
        }
        i = closeComment + 3;
        continue;
      }
      const closeDecl = html.indexOf(">", i + 2);
      if (closeDecl === -1) {
        break;
      }
      i = closeDecl + 1;
      continue;
    }

    if (nextCh === "?") {
      const closePi = html.indexOf(">", i + 2);
      if (closePi === -1) {
        break;
      }
      i = closePi + 1;
      continue;
    }

    // 处理闭合标签 </tag>
    if (nextCh === "/") {
      const nameStart = i + 2;
      if (nameStart >= len || !isAsciiAlpha(html[nameStart])) {
        out += "<";
        i += 1;
        continue;
      }
      let nameEnd = nameStart + 1;
      while (nameEnd < len && isTagNameChar(html[nameEnd])) {
        nameEnd += 1;
      }
      const tagName = html.slice(nameStart, nameEnd);
      const tagLower = tagName.toLowerCase();
      const closePos = findCloseTagEnd(html, nameEnd);
      if (closePos === -1) {
        if (DANGEROUS_ALL_TAGS.has(tagLower) || tagLower === "style") {
          break;
        }
        out += "&lt;";
        i += 1;
        continue;
      }
      i = closePos + 1;
      if (DANGEROUS_ALL_TAGS.has(tagLower)) {
        continue;
      }
      out += `</${tagName}>`;
      continue;
    }

    // 非法标签起始（例如 `<<script>` 或数学符号 `a < b`）：保留 `<` 并推进 1 字节
    if (!isAsciiAlpha(nextCh)) {
      out += "<";
      i += 1;
      continue;
    }

    let nameEnd = i + 2;
    while (nameEnd < len && isTagNameChar(html[nameEnd])) {
      nameEnd += 1;
    }
    const tagName = html.slice(i + 1, nameEnd);
    const tagLower = tagName.toLowerCase();

    // 若标签名后紧跟 `<` 等非法边界字符（如 `<scr<script>`），视为非完整标签头并向前推进
    if (nameEnd < len && !/[\s/>]/.test(html[nameEnd])) {
      out += "<";
      i += 1;
      continue;
    }

    const parsed = parseAndFilterOpenTag(html, nameEnd, tagLower);
    if (!parsed) {
      if (DANGEROUS_ALL_TAGS.has(tagLower) || tagLower === "style") {
        break;
      }
      out += "&lt;";
      i += 1;
      continue;
    }

    const { tagEnd, selfClosing, keptAttrs, modified } = parsed;

    // 1. 移除空危险标签（base / meta / link / embed）
    if (DANGEROUS_VOID_TAGS.has(tagLower)) {
      i = tagEnd + 1;
      continue;
    }

    // 2. plaintext 在 HTML5 中永不闭合，直接丢弃其及其后全部内容；其余危险容器移除匹配块或孤立开标签
    if (tagLower === "plaintext") {
      break;
    }

    if (DANGEROUS_CONTAINER_TAGS.has(tagLower)) {
      if (selfClosing) {
        i = tagEnd + 1;
        continue;
      }
      const range = findMatchingClosingTagRange(html, tagLower, tagEnd + 1);
      i = range ? range.closeEnd : tagEnd + 1;
      continue;
    }

    // 3. style 标签：按首个 </style> 精确截取，并以 sanitizeSlideCss 彻底清除内部 HTML 标签与危险 CSS
    if (tagLower === "style") {
      if (selfClosing) {
        i = tagEnd + 1;
        continue;
      }
      const range = findMatchingClosingTagRange(html, "style", tagEnd + 1);
      if (range) {
        const cssBody = html.slice(tagEnd + 1, range.closeStart);
        const safeCssBody = sanitizeSlideCss(cssBody);
        const openTagStr = modified
          ? serializeOpenTag(tagName, keptAttrs, false)
          : html.slice(i, tagEnd + 1);
        out += `${openTagStr}${safeCssBody}</style>`;
        i = range.closeEnd;
        continue;
      }
      // 孤立未闭合 <style>：直接移除开标签以防吞并后续文档，后续内容继续正常消毒
      i = tagEnd + 1;
      continue;
    }

    // 4. 合法幻灯片 HTML/SVG 标签：未修改则原样透传，有属性清洗则重建安全开标签
    out += modified
      ? serializeOpenTag(tagName, keptAttrs, selfClosing)
      : html.slice(i, tagEnd + 1);
    i = tagEnd + 1;
  }

  return out;
}

/**
 * 对幻灯片 HTML/SVG 进行多轮幂等安全清洗，拦截嵌套拆字绕过、HTML5 解析上下文差异与各类 XSS 载荷，
 * 同时完整保留合法语义布局元素、Bento 类名、data-* 与矢量 SVG 图表标签。
 */
export function sanitizeSlideHtml(html: string): string {
  if (!html) return "";
  let current = html;
  for (let pass = 0; pass < 32; pass++) {
    const next = sanitizePass(current);
    if (next === current) {
      return next;
    }
    current = next;
  }
  return current;
}
