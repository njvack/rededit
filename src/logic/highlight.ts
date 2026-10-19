// Colored spans for an analyzed expression. The editor and read-only
// snippets both use this, so they always agree.

import type { RefNode } from "./ast.ts";
import { FUNCTIONS_BY_NAME, SMART_BY_NAME } from "./catalog.ts";
import type { Analysis } from "./check.ts";
import type { Bracket } from "./refs.ts";
import { SchemaIndex, type Schema } from "./schema.ts";

export type HighlightClass =
  | "num"
  | "str"
  | "op"
  | "kw"
  | "fn"
  | "fn-unknown"
  | "punct"
  | "field"
  | "field-unknown"
  | "event"
  | "smart"
  | "code"
  | "instance"
  | "ident"
  | "invalid";

export interface HighlightSpan {
  from: number;
  to: number;
  cls: HighlightClass;
}

export function highlight(analysis: Analysis, schema?: Schema | SchemaIndex): HighlightSpan[] {
  const idx = schema ? SchemaIndex.from(schema) : undefined;
  const roles = new Map<number, { b: Bracket; role: "event" | "target" | "instance"; ref: RefNode }>();
  for (const ref of analysis.refs) {
    for (const b of ref.brackets) {
      const role = b === ref.event ? "event" : b === ref.instance ? "instance" : "target";
      roles.set(b.span.from, { b, role, ref });
    }
  }

  const out: HighlightSpan[] = [];
  const add = (from: number, to: number, cls: HighlightClass) => {
    if (to > from) out.push({ from, to, cls });
  };

  for (const t of analysis.tokens) {
    switch (t.kind) {
      case "ws":
        break;
      case "number":
        add(t.start, t.end, "num");
        break;
      case "string":
        add(t.start, t.end, "str");
        break;
      case "op":
        add(t.start, t.end, "op");
        break;
      case "lparen":
      case "rparen":
      case "comma":
        add(t.start, t.end, "punct");
        break;
      case "unknown":
        add(t.start, t.end, "invalid");
        break;
      case "ident": {
        const w = t.text.toLowerCase();
        if (w === "and" || w === "or") add(t.start, t.end, "kw");
        else if (isCallee(analysis, t.start)) add(t.start, t.end, FUNCTIONS_BY_NAME.has(w) ? "fn" : "fn-unknown");
        else add(t.start, t.end, "ident");
        break;
      }
      case "bracket": {
        const r = roles.get(t.start);
        if (!r) {
          add(t.start, t.end, "invalid");
          break;
        }
        const { b, role, ref } = r;
        add(t.start, t.start + 1, "punct");
        add(b.nameSpan.from, b.nameSpan.to, bracketClass(b, role, ref, analysis, idx));
        if (b.codeSpan) {
          add(b.nameSpan.to, b.codeSpan.from, "punct");
          add(b.codeSpan.from, b.codeSpan.to, "code");
          add(b.codeSpan.to, t.end - (t.unterminated ? 0 : 1), "punct");
        } else {
          add(b.nameSpan.to, t.end - (t.unterminated ? 0 : 1), b.kind === "smart" ? "smart" : "punct");
        }
        if (!t.unterminated) add(t.end - 1, t.end, "punct");
        break;
      }
    }
  }
  return out;
}

function isCallee(analysis: Analysis, start: number): boolean {
  const toks = analysis.tokens;
  const i = toks.findIndex((t) => t.start === start);
  for (let j = i + 1; j < toks.length; j++) {
    if (toks[j]!.kind === "ws") continue;
    return toks[j]!.kind === "lparen";
  }
  return false;
}

function bracketClass(b: Bracket, role: "event" | "target" | "instance", ref: RefNode, analysis: Analysis, idx: SchemaIndex | undefined): HighlightClass {
  if (b.kind === "invalid") return "invalid";
  if (b.kind === "number") return "instance";
  if (b.kind === "smart") return SMART_BY_NAME.has(b.name) ? (role === "instance" ? "instance" : "smart") : "field-unknown";
  if (role === "event") return !idx || idx.events.has(b.name) ? "event" : "field-unknown";
  if (!idx) return "field";
  return analysis.refInfo.get(ref)?.field ? "field" : "field-unknown";
}
