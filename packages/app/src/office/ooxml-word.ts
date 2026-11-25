import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";
import JSZip from "jszip";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface WordInPlaceReplacement {
  find: string;
  replace: string;
  replaceAll?: boolean;
}

export interface WordTableCellUpdate {
  /** 表格序号（从 0 开始） */
  tableIndex: number;
  /** 行序号（从 0 开始） */
  rowIndex: number;
  /** 列序号（从 0 开始） */
  colIndex: number;
  text: string;
}

export interface WordAppendParagraph {
  text: string;
  headingLevel?: 1 | 2 | 3;
}

export interface UpdateWordInPlaceSpec {
  replacements?: WordInPlaceReplacement[];
  variables?: Record<string, string>;
  tableUpdates?: WordTableCellUpdate[];
  appendParagraphs?: WordAppendParagraph[];
}

export interface UpdateWordInPlaceResult {
  bytes: Uint8Array;
  replacedCount: number;
  tableCellsUpdated: number;
  appendedCount: number;
  diffSummary: string;
  details: string[];
}

function getElementsByTagLocal(parent: Element | Document, localName: string): Element[] {
  const result: Element[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 1) {
      const el = node as Element;
      const name = el.localName || el.tagName?.split(":").pop();
      if (name === localName) {
        result.push(el);
      }
    }
    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        walk(children[i]);
      }
    }
  };
  walk(parent);
  return result;
}

function getDirectChildByLocal(parent: Element, localName: string): Element | null {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1) {
      const el = child as Element;
      const name = el.localName || el.tagName?.split(":").pop();
      if (name === localName) return el;
    }
  }
  return null;
}

/**
 * 在单个 Word `<w:p>` 段落内执行跨 `<w:r>/<w:t>` 的文本替换，
 * 保留首个匹配 run 的样式（`<w:rPr>`）而不破坏原有字体、字号和公章等周边 XML。
 */
function replaceInParagraph(
  doc: Document,
  paragraph: Element,
  find: string,
  replace: string,
  replaceAll: boolean
): number {
  if (!find) return 0;

  let count = 0;
  // 为保持跨 run 索引同步，每次替换后重算文本节点映射
  while (true) {
    const tNodes = getElementsByTagLocal(paragraph, "t");
    if (tNodes.length === 0) break;

    const segments: Array<{ node: Element; start: number; end: number; text: string }> = [];
    let full = "";
    for (const t of tNodes) {
      const str = t.textContent || "";
      const start = full.length;
      full += str;
      segments.push({ node: t, start, end: full.length, text: str });
    }

    const hitIdx = full.indexOf(find);
    if (hitIdx < 0) break;

    const hitEnd = hitIdx + find.length;
    const touched = segments.filter((s) => s.end > hitIdx && s.start < hitEnd);
    if (touched.length === 0) break;

    const first = touched[0];
    const last = touched[touched.length - 1];

    const prefix = first.text.slice(0, hitIdx - first.start);
    const suffix = last.text.slice(hitEnd - last.start);

    if (first === last) {
      first.node.textContent = `${prefix}${replace}${suffix}`;
    } else {
      first.node.textContent = `${prefix}${replace}`;
      for (let i = 1; i < touched.length - 1; i++) {
        touched[i].node.textContent = "";
      }
      last.node.textContent = suffix;
    }

    // 保留首尾空白
    if (
      (first.node.textContent || "").startsWith(" ") ||
      (first.node.textContent || "").endsWith(" ")
    ) {
      first.node.setAttribute("xml:space", "preserve");
    }

    // 避免空 run 遗留占位异常
    void doc;
    count++;
    if (!replaceAll) break;
  }

  return count;
}

function setParagraphPlainTextPreservingFirstRunStyle(
  doc: Document,
  paragraph: Element,
  nextText: string
): void {
  const runs = getElementsByTagLocal(paragraph, "r");
  if (runs.length > 0) {
    const firstRun = runs[0];
    let t = getDirectChildByLocal(firstRun, "t");
    if (!t) {
      t = doc.createElementNS(WORD_NS, "w:t");
      firstRun.appendChild(t);
    }
    t.textContent = nextText;
    if (nextText.startsWith(" ") || nextText.endsWith(" ")) {
      t.setAttribute("xml:space", "preserve");
    }
    for (let i = 1; i < runs.length; i++) {
      for (const extraT of getElementsByTagLocal(runs[i], "t")) {
        extraT.textContent = "";
      }
    }
    return;
  }

  const r = doc.createElementNS(WORD_NS, "w:r");
  const t = doc.createElementNS(WORD_NS, "w:t");
  t.textContent = nextText;
  r.appendChild(t);
  paragraph.appendChild(r);
}

/**
 * 纯 JS OOXML 原地更新既有 `.docx` 文件，100% 保留原有页眉页脚、公章图片、表格边框与段落样式。
 */
export async function updateWordDocumentInPlace(
  bytes: Uint8Array,
  spec: UpdateWordInPlaceSpec
): Promise<UpdateWordInPlaceResult> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const allReps: WordInPlaceReplacement[] = [
    ...Object.entries(spec.variables || {}).map(([k, v]) => ({
      find: k.startsWith("{{") && k.endsWith("}}") ? k : `{{${k}}}`,
      replace: v,
      replaceAll: true,
    })),
    ...(spec.replacements || []),
  ];

  let replacedCount = 0;
  let tableCellsUpdated = 0;
  let appendedCount = 0;
  const details: string[] = [];

  const xmlTargets = Object.keys(zip.files).filter(
    (p) =>
      p === "word/document.xml" ||
      /^word\/header\d*\.xml$/i.test(p) ||
      /^word\/footer\d*\.xml$/i.test(p)
  );

  for (const xmlPath of xmlTargets) {
    const file = zip.file(xmlPath);
    if (!file) continue;
    const rawXml = await file.async("string");
    const doc = parser.parseFromString(rawXml, "application/xml");
    let modifiedThisXml = false;

    if (allReps.length > 0) {
      const paragraphs = getElementsByTagLocal(doc, "p");
      for (const rep of allReps) {
        let repHits = 0;
        for (const p of paragraphs) {
          const hit = replaceInParagraph(
            doc,
            p,
            rep.find,
            rep.replace,
            rep.replaceAll !== false
          );
          if (hit > 0) {
            repHits += hit;
            modifiedThisXml = true;
            if (rep.replaceAll === false) break;
          }
        }
        if (repHits > 0) {
          replacedCount += repHits;
          details.push(`替换「${rep.find}」→「${rep.replace}」（${repHits} 处）`);
        }
      }
    }

    if (xmlPath === "word/document.xml") {
      if (spec.tableUpdates?.length) {
        const tables = getElementsByTagLocal(doc, "tbl");
        for (const tu of spec.tableUpdates) {
          const tbl = tables[tu.tableIndex];
          if (!tbl) {
            throw new Error(`未找到第 ${tu.tableIndex + 1} 个表格`);
          }
          const rows = tbl.childNodes
            ? Array.from(tbl.childNodes).filter(
                (n): n is Element =>
                  n.nodeType === 1 &&
                  ((n as Element).localName || (n as Element).tagName?.split(":").pop()) === "tr"
              )
            : [];
          const row = rows[tu.rowIndex];
          if (!row) {
            throw new Error(`表格 ${tu.tableIndex + 1} 不存在第 ${tu.rowIndex + 1} 行`);
          }
          const cells = Array.from(row.childNodes).filter(
            (n): n is Element =>
              n.nodeType === 1 &&
              ((n as Element).localName || (n as Element).tagName?.split(":").pop()) === "tc"
          );
          const cell = cells[tu.colIndex];
          if (!cell) {
            throw new Error(
              `表格 ${tu.tableIndex + 1} 第 ${tu.rowIndex + 1} 行不存在第 ${tu.colIndex + 1} 列`
            );
          }
          const cellParas = getElementsByTagLocal(cell, "p");
          if (cellParas.length > 0) {
            setParagraphPlainTextPreservingFirstRunStyle(doc, cellParas[0], tu.text);
            for (let i = 1; i < cellParas.length; i++) {
              for (const extraT of getElementsByTagLocal(cellParas[i], "t")) {
                extraT.textContent = "";
              }
            }
          } else {
            const p = doc.createElementNS(WORD_NS, "w:p");
            setParagraphPlainTextPreservingFirstRunStyle(doc, p, tu.text);
            cell.appendChild(p);
          }
          tableCellsUpdated++;
          modifiedThisXml = true;
          details.push(`更新表 ${tu.tableIndex + 1} (${tu.rowIndex + 1},${tu.colIndex + 1}) → ${tu.text}`);
        }
      }

      if (spec.appendParagraphs?.length) {
        const body = getElementsByTagLocal(doc, "body")[0];
        if (body) {
          const sectPr = getDirectChildByLocal(body, "sectPr");
          for (const item of spec.appendParagraphs) {
            const p = doc.createElementNS(WORD_NS, "w:p");
            if (item.headingLevel) {
              const pPr = doc.createElementNS(WORD_NS, "w:pPr");
              const pStyle = doc.createElementNS(WORD_NS, "w:pStyle");
              pStyle.setAttribute("w:val", `Heading${item.headingLevel}`);
              pPr.appendChild(pStyle);
              p.appendChild(pPr);
            }
            const r = doc.createElementNS(WORD_NS, "w:r");
            const t = doc.createElementNS(WORD_NS, "w:t");
            t.textContent = item.text;
            if (item.text.startsWith(" ") || item.text.endsWith(" ")) {
              t.setAttribute("xml:space", "preserve");
            }
            r.appendChild(t);
            p.appendChild(r);
            if (sectPr) {
              body.insertBefore(p, sectPr);
            } else {
              body.appendChild(p);
            }
            appendedCount++;
            modifiedThisXml = true;
          }
          details.push(`末尾追加 ${spec.appendParagraphs.length} 个段落`);
        }
      }
    }

    if (modifiedThisXml) {
      zip.file(xmlPath, serializer.serializeToString(doc));
    }
  }

  const outBytes = await zip.generateAsync({ type: "uint8array" });
  const diffParts: string[] = [];
  if (replacedCount > 0) diffParts.push(`替换 ${replacedCount} 处文本`);
  if (tableCellsUpdated > 0) diffParts.push(`更新 ${tableCellsUpdated} 个单元格`);
  if (appendedCount > 0) diffParts.push(`追加 ${appendedCount} 段`);

  return {
    bytes: outBytes,
    replacedCount,
    tableCellsUpdated,
    appendedCount,
    diffSummary: diffParts.length > 0 ? diffParts.join("，") : "无实际改动（未命中匹配内容）",
    details,
  };
}
