declare module "fast-formula-parser" {
  export interface FormulaPosition {
    row: number;
    col: number;
    sheet?: string;
  }

  export interface FormulaParserConfig {
    onCell?: (coord: FormulaPosition) => unknown;
    onRange?: (ref: {
      sheet?: string;
      from: { row: number; col: number };
      to: { row: number; col: number };
    }) => unknown[][];
    functions?: Record<string, (...args: unknown[]) => unknown>;
  }

  export default class FormulaParser {
    constructor(config?: FormulaParserConfig);
    parse(formula: string, position?: FormulaPosition): unknown;
  }
}
