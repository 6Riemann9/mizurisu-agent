declare module "dom-to-pptx" {
  export interface DomToPptxFontConfig {
    name: string;
    url: string;
  }

  export interface DomToPptxOptions {
    fileName?: string;
    skipDownload?: boolean;
    width?: number;
    height?: number;
    layout?: "LAYOUT_16x9" | "LAYOUT_16x10" | "LAYOUT_4x3" | "LAYOUT_WIDE" | string;
    autoEmbedFonts?: boolean;
    fonts?: DomToPptxFontConfig[];
    skipNormalize?: boolean;
  }

  export function exportToPptx(
    target: HTMLElement | HTMLElement[] | string,
    options?: DomToPptxOptions
  ): Promise<Blob>;
}
