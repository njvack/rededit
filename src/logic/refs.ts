// Structure inside one bracket group: [name], [name(code)], [smart-var:p1:p2],
// [2]. Offsets are absolute positions in the source string.

import type { Token } from "./lexer.ts";

export interface Span {
  from: number;
  to: number;
}

export type BracketKind = "name" | "smart" | "number" | "invalid";

export interface Bracket {
  kind: BracketKind;
  span: Span;
  /** Field, event or smart-variable name. Empty for numbers and invalid groups. */
  name: string;
  nameSpan: Span;
  /** Checkbox choice code inside parentheses, if any. */
  code?: string;
  codeSpan?: Span;
  /** Colon-separated parameters after the name (`:label`, `:instrument`). */
  params: string[];
  /** Instance number for `[2]`. */
  number?: number;
  unterminated: boolean;
}

const HEAD = /^([A-Za-z0-9_-]*)(?:\(([^)]*)\)?)?$/;

export function parseBracket(tok: Token): Bracket {
  const unterminated = !!tok.unterminated;
  const innerStart = tok.start + 1;
  const inner = tok.text.slice(1, unterminated ? undefined : -1);
  const span = { from: tok.start, to: tok.end };
  const base = { span, params: [] as string[], unterminated };

  if (/^\d+$/.test(inner)) {
    return { ...base, kind: "number", name: "", nameSpan: { from: innerStart, to: innerStart }, number: Number(inner) };
  }

  const [head = "", ...params] = inner.split(":");
  const m = HEAD.exec(head);
  if (!m) {
    return { ...base, kind: "invalid", name: "", nameSpan: { from: innerStart, to: innerStart + inner.length }, params };
  }
  const name = m[1]!;
  const out: Bracket = {
    ...base,
    kind: name.includes("-") ? "smart" : "name",
    name,
    nameSpan: { from: innerStart, to: innerStart + name.length },
    params,
  };
  if (m[2] !== undefined) {
    const codeFrom = innerStart + name.length + 1;
    out.code = m[2];
    out.codeSpan = { from: codeFrom, to: codeFrom + m[2].length };
  }
  return out;
}
