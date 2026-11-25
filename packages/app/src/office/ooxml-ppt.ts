import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";
import JSZip from "jszip";

const DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

export interface PptSlideInPlaceUpdate {
  /** 幻灯片页码（从 1 开始） */
  slideIndex: number;
  replacements?: Array<{ find: string; replace: string; replaceAll?: boolean }>;
  tableUpdates?: Array<{
    tableIndex?: number;
    rowIndex: number;
    colIndex: number;
    text: string;
  }>;
  notes?: string;
}

export interface UpdatePptInPlaceSpec {
  variables?: Record<string, string>;
  slideUpdates?: PptSlideInPlaceUpdate[];
}

export interface UpdatePptInPlaceResult {
  bytes: Uint8Array;
  modifiedSlides: number[];
  replacedCount: number;
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

function getDirectChildrenByLocal(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1) {
      const el = child as Element;
      const name = el.localName || el.tagName?.split(":").pop();
      if (name === localName) out.push(el);
    }
  }
  return out;
}

function replaceInDrawingParagraph(
  paragraph: Element,
  find: string,
  replace: string,
  replaceAll: boolean
): number {
  if (!find) return 0;
  let count = 0;
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

    count++;
    if (!replaceAll) break;
  }
  return count;
}

function setDrawingParagraphText(doc: Document, paragraph: Element, text: string): void {
  const runs = getDirectChildrenByLocal(paragraph, "r");
  if (runs.length > 0) {
    let t = getDirectChildrenByLocal(runs[0], "t")[0];
    if (!t) {
      t = doc.createElementNS(DML_NS, "a:t");
      runs[0].appendChild(t);
    }
    t.textContent = text;
    for (let i = 1; i < runs.length; i++) {
      for (const extraT of getElementsByTagLocal(runs[i], "t")) {
        extraT.textContent = "";
      }
    }
    return;
  }
  const r = doc.createElementNS(DML_NS, "a:r");
  const t = doc.createElementNS(DML_NS, "a:t");
  t.textContent = text;
  r.appendChild(t);
  paragraph.appendChild(r);
}

/**
 * 纯 JS OOXML 原地更新既有 `.pptx` 演示文稿，完整保留企业母版、主题、背景、图形与动画。
 */
export async function updatePptDocumentInPlace(
  bytes: Uint8Array,
  spec: UpdatePptInPlaceSpec
): Promise<UpdatePptInPlaceResult> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const globalVarReps = Object.entries(spec.variables || {}).map(([k, v]) => ({
    find: k.startsWith("{{") && k.endsWith("}}") ? k : `{{${k}}}`,
    replace: v,
    replaceAll: true,
  }));

  const slideUpdateMap = new Map<number, PptSlideInPlaceUpdate>();
  for (const su of spec.slideUpdates || []) {
    slideUpdateMap.set(su.slideIndex, su);
  }

  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)\.xml$/)?.[1] || 0);
      const nb = Number(b.match(/(\d+)\.xml$/)?.[1] || 0);
      return na - nb;
    });

  const modifiedSlideSet = new Set<number>();
  let replacedCount = 0;
  const details: string[] = [];

  for (const slidePath of slidePaths) {
    const slideIdx = Number(slidePath.match(/(\d+)\.xml$/)?.[1] || 0);
    const perSlide = slideUpdateMap.get(slideIdx);
    const reps = [...globalVarReps, ...(perSlide?.replacements || [])];
    if (reps.length === 0 && !perSlide?.tableUpdates?.length && perSlide?.notes === undefined) {
      continue;
    }

    const file = zip.file(slidePath);
    if (!file) continue;
    const rawXml = await file.async("string");
    const doc = parser.parseFromString(rawXml, "application/xml");
    let modifiedThisSlide = false;

    if (reps.length > 0) {
      const paragraphs = getElementsByTagLocal(doc, "p");
      for (const rep of reps) {
        let repHits = 0;
        for (const p of paragraphs) {
          const hit = replaceInDrawingParagraph(
            p,
            rep.find,
            rep.replace,
            rep.replaceAll !== false
          );
          if (hit > 0) {
            repHits += hit;
            modifiedThisSlide = true;
            if (rep.replaceAll === false) break;
          }
        }
        if (repHits > 0) {
          replacedCount += repHits;
          details.push(`第 ${slideIdx} 页替换「${rep.find}」→「${rep.replace}」（${repHits} 处）`);
        }
      }
    }

    if (perSlide?.tableUpdates?.length) {
      const tables = getElementsByTagLocal(doc, "tbl");
      for (const tu of perSlide.tableUpdates) {
        const tblIdx = tu.tableIndex ?? 0;
        const tbl = tables[tblIdx];
        if (!tbl) {
          throw new Error(`第 ${slideIdx} 页未找到第 ${tblIdx + 1} 个表格`);
        }
        const rows = getDirectChildrenByLocal(tbl, "tr");
        const row = rows[tu.rowIndex];
        if (!row) {
          throw new Error(`第 ${slideIdx} 页表格不存在第 ${tu.rowIndex + 1} 行`);
        }
        const cells = getDirectChildrenByLocal(row, "tc");
        const cell = cells[tu.colIndex];
        if (!cell) {
          throw new Error(`第 ${slideIdx} 页表格第 ${tu.rowIndex + 1} 行不存在第 ${tu.colIndex + 1} 列`);
        }
        const cellParas = getElementsByTagLocal(cell, "p");
        if (cellParas.length > 0) {
          setDrawingParagraphText(doc, cellParas[0], tu.text);
          modifiedThisSlide = true;
          details.push(`第 ${slideIdx} 页更新表单元格 (${tu.rowIndex + 1},${tu.colIndex + 1})`);
        }
      }
    }

    if (modifiedThisSlide) {
      zip.file(slidePath, serializer.serializeToString(doc));
      modifiedSlideSet.add(slideIdx);
    }

    // 如有 notesSlides 则同步更新对应页备注
    if (perSlide?.notes !== undefined) {
      const relPath = `ppt/slides/_rels/slide${slideIdx}.xml.rels`;
      const relFile = zip.file(relPath);
      if (relFile) {
        const relXml = await relFile.async("string");
        const m = relXml.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/i);
        if (m) {
          const notePath = `ppt/notesSlides/${m[1]}`;
          const noteFile = zip.file(notePath);
          if (noteFile) {
            const noteXml = await noteFile.async("string");
            const noteDoc = parser.parseFromString(noteXml, "application/xml");
            const txBodies = getElementsByTagLocal(noteDoc, "txBody");
            const targetBody = txBodies[1] || txBodies[0];
            if (targetBody) {
              const paras = getDirectChildrenByLocal(targetBody, "p");
              if (paras.length > 0) {
                setDrawingParagraphText(noteDoc, paras[0], perSlide.notes);
                for (let i = 1; i < paras.length; i++) {
                  for (const t of getElementsByTagLocal(paras[i], "t")) {
                    t.textContent = "";
                  }
                }
                zip.file(notePath, serializer.serializeToString(noteDoc));
                modifiedSlideSet.add(slideIdx);
                details.push(`更新第 ${slideIdx} 页演讲者备注`);
              }
            }
          }
        }
      }
    }
  }

  const outBytes = await zip.generateAsync({ type: "uint8array" });
  const modifiedSlides = [...modifiedSlideSet].sort((a, b) => a - b);

  return {
    bytes: outBytes,
    modifiedSlides,
    replacedCount,
    diffSummary:
      modifiedSlides.length > 0
        ? `已修改第 ${modifiedSlides.join("、")} 页（替换 ${replacedCount} 处文本）`
        : "未命中需要修改的幻灯片内容",
    details,
  };
}
