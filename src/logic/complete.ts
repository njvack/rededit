// Completion and signature help. Works from the tokens around the cursor
// rather than a full parse, so it copes with half-typed input.

import { DATEDIFF_UNITS, FUNCTIONS, FUNCTIONS_BY_NAME, SMART_VARIABLES, type FunctionDef } from "./catalog.ts";
import { lex, type Token } from "./lexer.ts";
import { parseBracket } from "./refs.ts";
import { SchemaIndex, choicesOf, describeType, type Choice, type FieldDef, type Schema } from "./schema.ts";

export type CompletionKind = "field" | "event" | "smart" | "function" | "choice" | "keyword" | "unit";

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
  /** Text that replaces the result's from..to range. */
  insert: string;
  /** Cursor offset within `insert` after applying; defaults to its end. */
  caret?: number;
  /** Ask for completions again right after applying (e.g. after `[meds(`). */
  reopen?: boolean;
}

export interface CompletionResult {
  from: number;
  to: number;
  items: CompletionItem[];
}

export interface CompleteOptions {
  schema?: Schema | SchemaIndex;
  /** The form the logic is on; its fields are listed first. */
  form?: string;
  /** True when the user asked for completion (Ctrl+Space) rather than typed. */
  explicit?: boolean;
}

export interface SignatureHelp {
  fn: FunctionDef;
  /** Index of the argument the cursor is in. */
  active: number;
}

const COMPARE = new Set(["=", "<>", "!=", "=="]);
const ENDS_VALUE = new Set(["number", "string", "bracket", "rparen"]);

export function complete(src: string, pos: number, opts: CompleteOptions = {}): CompletionResult | null {
  const idx = opts.schema ? SchemaIndex.from(opts.schema) : undefined;
  const tokens = lex(src);
  const cur = tokens.find((t) => t.start < pos && pos <= t.end && t.kind !== "ws");
  const before = significantBefore(tokens, cur ? cur.start : pos);

  if (cur?.kind === "bracket" && (cur.unterminated || pos < cur.end)) {
    return idx ? bracketItems(src, pos, cur, tokens, idx, opts) : null;
  }

  if (cur?.kind === "string" || !cur) {
    const strPrefix = cur ? src.slice(cur.start + 1, pos) : "";
    const range = cur ? { from: cur.start, to: cur.end } : { from: pos, to: pos };

    const sig = signatureAt(src, pos);
    if (sig?.fn.name === "datediff" && sig.active === 2) {
      const items = Object.entries(DATEDIFF_UNITS)
        .filter(([u]) => u.startsWith(strPrefix) || strPrefix === "")
        .map(([u, label]): CompletionItem => ({ label: `"${u}"`, kind: "unit", detail: label, insert: `"${u}"` }));
      return items.length ? { ...range, items } : null;
    }

    const choices = idx ? comparedChoices(before, idx) : undefined;
    if (choices) {
      const items = choices
        .filter((c) => c.code.startsWith(strPrefix) || c.label.toLowerCase().includes(strPrefix.toLowerCase()))
        .map((c): CompletionItem => ({ label: c.code, kind: "choice", detail: c.label, insert: `'${c.code}'` }));
      return items.length ? { ...range, items } : null;
    }
    if (cur || !opts.explicit) return null;
    return idx ? openItems(pos, before, idx, opts) : null;
  }

  if (cur.kind === "ident") {
    const prefix = src.slice(cur.start, pos).toLowerCase();
    const prev = before[before.length - 1];
    const infix = prev && ENDS_VALUE.has(prev.kind);
    const items: CompletionItem[] = infix
      ? ["and", "or"].filter((k) => k.startsWith(prefix)).map((k) => ({ label: k, kind: "keyword", insert: `${k} ` }))
      : functionItems(prefix);
    return items.length ? { from: cur.start, to: cur.end, items } : null;
  }

  return null;
}

export function signatureAt(src: string, pos: number): SignatureHelp | null {
  const toks = lex(src).filter((t) => t.kind !== "ws" && t.end <= pos);
  let depth = 0;
  let active = 0;
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]!;
    if (t.kind === "rparen") depth++;
    else if (t.kind === "comma" && depth === 0) active++;
    else if (t.kind === "lparen") {
      if (depth === 0) {
        const name = toks[i - 1];
        const fn = name?.kind === "ident" ? FUNCTIONS_BY_NAME.get(name.text.toLowerCase()) : undefined;
        return fn ? { fn, active } : null;
      }
      depth--;
    }
  }
  return null;
}

function significantBefore(tokens: Token[], pos: number): Token[] {
  return tokens.filter((t) => t.kind !== "ws" && t.end <= pos);
}

function functionItems(prefix: string): CompletionItem[] {
  return FUNCTIONS.filter((f) => f.name.startsWith(prefix)).map((f) => ({
    label: `${f.name}(${f.params.join(", ")})`,
    kind: "function",
    detail: f.doc,
    insert: `${f.name}(`,
  }));
}

/** Choices for the field on the left of a trailing `=` or `<>`. */
function comparedChoices(before: Token[], idx: SchemaIndex): Choice[] | undefined {
  const op = before[before.length - 1];
  if (!op || op.kind !== "op" || !COMPARE.has(op.text)) return undefined;
  const chain: Token[] = [];
  for (let i = before.length - 2; i >= 0; i--) {
    const t = before[i]!;
    const next = chain[0];
    if (t.kind !== "bracket" || (next && t.end !== next.start)) break;
    chain.unshift(t);
  }
  if (chain.length === 0) return undefined;
  const brackets = chain.map(parseBracket);
  const last = brackets[brackets.length - 1]!;
  const target = (last.kind === "number" || last.name.endsWith("-instance")) && brackets.length > 1 ? brackets[brackets.length - 2]! : last;
  const field = idx.fields.get(target.name);
  if (!field) return undefined;
  if (target.code !== undefined) return [{ code: "1", label: "checked" }, { code: "0", label: "unchecked" }];
  if (field.type === "checkbox") return undefined;
  return choicesOf(field);
}

function bracketItems(src: string, pos: number, cur: Token, tokens: Token[], idx: SchemaIndex, opts: CompleteOptions): CompletionResult | null {
  const inner = src.slice(cur.start + 1, pos);
  const to = cur.end;

  const code = /^([A-Za-z0-9_]+)\(([^)]*)$/.exec(inner);
  if (code) {
    const field = idx.fields.get(code[1]!);
    if (!field || field.type !== "checkbox") return null;
    const items = (field.choices ?? [])
      .filter((c) => c.code.startsWith(code[2]!) || c.label.toLowerCase().includes(code[2]!.toLowerCase()))
      .map((c): CompletionItem => ({ label: c.code, kind: "choice", detail: c.label, insert: `${c.code})]` }));
    return items.length ? { from: cur.start + 1 + code[1]!.length + 1, to, items } : null;
  }
  if (inner.includes(":")) return null;

  const prefix = inner.toLowerCase();
  const prevTok = [...tokens].reverse().find((t) => t.end <= cur.start && t.kind !== "ws");
  const prev = prevTok && prevTok.kind === "bracket" && prevTok.end === cur.start ? parseBracket(prevTok) : undefined;
  const prevEvent = prev && (idx.events.has(prev.name) || prev.name.endsWith("-event-name")) ? prev : undefined;
  const prevField = prev && idx.fields.has(prev.name) ? prev : undefined;

  const items: CompletionItem[] = [];
  const matches = (s: string) => s.toLowerCase().includes(prefix);

  if (prevField) {
    for (const s of SMART_VARIABLES.filter((v) => v.role === "instance" && matches(v.name))) {
      items.push({ label: s.name, kind: "smart", detail: s.doc, insert: `[${s.name}]` });
    }
    return items.length ? { from: cur.start, to, items } : null;
  }

  const eventForms = prevEvent && idx.events.get(prevEvent.name)?.forms;
  const fields = [...idx.fields.values()].filter((f) => (!eventForms || eventForms.includes(f.form)) && (matches(f.name) || matches(f.label ?? "")));
  const rank = (f: FieldDef) => (f.name.toLowerCase().startsWith(prefix) ? 0 : f.name.toLowerCase().includes(prefix) ? 1 : 2) * 2 + (opts.form && f.form !== opts.form ? 1 : 0);
  fields.sort((a, b) => rank(a) - rank(b));
  for (const f of fields) items.push(fieldItem(f));

  if (!prev) {
    if (idx.longitudinal) {
      for (const e of idx.events.values()) {
        if (matches(e.name) || matches(e.label ?? "")) items.push({ label: e.name, kind: "event", detail: `Event${e.label ? ` · ${e.label}` : ""}`, insert: `[${e.name}][`, reopen: true });
      }
    }
    for (const s of SMART_VARIABLES.filter((v) => matches(v.name))) {
      if (s.role === "event") items.push({ label: s.name, kind: "smart", detail: s.doc, insert: `[${s.name}][`, reopen: true });
      if (s.role !== "instance" || prefix) items.push({ label: s.name, kind: "smart", detail: s.doc, insert: `[${s.name}]` });
    }
  }
  return items.length ? { from: cur.start, to, items } : null;
}

function fieldItem(f: FieldDef): CompletionItem {
  const detail = `${describeType(f)} · ${f.form}${f.label ? ` · ${f.label}` : ""}`;
  return f.type === "checkbox"
    ? { label: f.name, kind: "field", detail, insert: `[${f.name}(`, reopen: true }
    : { label: f.name, kind: "field", detail, insert: `[${f.name}]` };
}

/** Explicit completion with nothing typed yet. */
function openItems(pos: number, before: Token[], idx: SchemaIndex, opts: CompleteOptions): CompletionResult | null {
  const prev = before[before.length - 1];
  if (prev && ENDS_VALUE.has(prev.kind)) {
    return { from: pos, to: pos, items: ["and", "or"].map((k) => ({ label: k, kind: "keyword", insert: `${k} ` })) };
  }
  const fields = [...idx.fields.values()].sort((a, b) => (opts.form && a.form !== opts.form ? 1 : 0) - (opts.form && b.form !== opts.form ? 1 : 0));
  return { from: pos, to: pos, items: [...fields.map(fieldItem), ...functionItems("")] };
}
