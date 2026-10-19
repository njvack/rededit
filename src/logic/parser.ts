// Pratt parser for REDCap logic. Never throws: malformed input produces
// Missing nodes and diagnostics, so half-typed expressions still parse.

import type { BinaryNode, Diagnostic, Node, RefNode, Span } from "./ast.ts";
import { SMART_BY_NAME } from "./catalog.ts";
import { lex, type Token } from "./lexer.ts";
import { parseBracket, type Bracket } from "./refs.ts";

export interface ParseResult {
  tokens: Token[];
  ast: Node;
  refs: RefNode[];
  diagnostics: Diagnostic[];
}

const BINARY_POWER: Record<string, [number, number]> = {
  or: [10, 11],
  and: [20, 21],
  "=": [30, 31],
  "<>": [30, 31],
  "<": [30, 31],
  ">": [30, 31],
  "<=": [30, 31],
  ">=": [30, 31],
  "+": [40, 41],
  "-": [40, 41],
  "*": [50, 51],
  "/": [50, 51],
  "^": [61, 60], // right-associative
};
const UNARY_POWER = 70;
const STARTS_VALUE = new Set(["number", "string", "bracket", "ident", "lparen"]);

const OP_ALIASES: Record<string, string> = { "==": "=", "!=": "<>", "&&": "and", "||": "or" };

export function parse(src: string): ParseResult {
  return new Parser(src).run();
}

class Parser {
  private readonly tokens: Token[];
  /** Tokens without whitespace. */
  private readonly toks: Token[];
  private pos = 0;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly refs: RefNode[] = [];

  private readonly src: string;

  constructor(src: string) {
    this.src = src;
    this.tokens = lex(src);
    this.toks = this.tokens.filter((t) => t.kind !== "ws");
  }

  run(): ParseResult {
    for (const t of this.toks) {
      if (t.kind === "unknown") this.diag(t, "error", "unexpected-char", `Unexpected character "${t.text}".`);
    }
    let ast = this.expr(0);
    while (this.peek()) {
      const t = this.peek()!;
      if (STARTS_VALUE.has(t.kind)) {
        this.diag(t, "error", "missing-operator", `Expected an operator such as "and" or "=" before "${t.text}".`);
      } else {
        this.next();
        if (t.kind !== "unknown") this.diag(t, "error", "unexpected-token", `Unexpected "${t.text}".`);
      }
      if (this.peek()) {
        // Keep going so later references still get checked and highlighted.
        const before = this.pos;
        const rest = this.expr(0);
        if (this.pos === before) this.next();
        ast = { type: "binary", op: "?", opText: "", opSpan: { from: t.start, to: t.end }, left: ast, right: rest, span: { from: ast.span.from, to: rest.span.to } };
      }
    }
    if (this.src.trim() === "") {
      this.diagnostics.length = 0;
    }
    return { tokens: this.tokens, ast, refs: this.refs, diagnostics: this.diagnostics };
  }

  private peek(offset = 0): Token | undefined {
    return this.toks[this.pos + offset];
  }

  private next(): Token | undefined {
    return this.toks[this.pos++];
  }

  private diag(span: { start: number; end: number } | Span, severity: Diagnostic["severity"], code: string, message: string) {
    const from = "start" in span ? span.start : span.from;
    const to = "start" in span ? span.end : span.to;
    this.diagnostics.push({ from, to, severity, code, message });
  }

  private here(): number {
    const t = this.peek();
    if (t) return t.start;
    const last = this.toks[this.toks.length - 1];
    return last ? last.end : 0;
  }

  private missing(): Node {
    const at = this.here();
    const t = this.peek();
    this.diag({ from: at, to: t ? t.end : at }, "error", "expected-value", t ? `Expected a value before "${t.text}".` : "Expected a value.");
    return { type: "missing", span: { from: at, to: at } };
  }

  private binaryOp(t: Token | undefined): string | undefined {
    if (!t) return undefined;
    if (t.kind === "op") return OP_ALIASES[t.text] ?? t.text;
    if (t.kind === "ident") {
      const w = t.text.toLowerCase();
      if (w === "and" || w === "or") return w;
    }
    return undefined;
  }

  private expr(minPower: number): Node {
    let left = this.prefix();
    for (;;) {
      const t = this.peek();
      const op = this.binaryOp(t);
      if (!t || !op) break;
      const power = BINARY_POWER[op];
      if (!power || power[0] < minPower) break;
      this.next();
      this.noteOperatorStyle(t, op);
      const right = this.expr(power[1]);
      const node: BinaryNode = { type: "binary", op, opText: t.text, opSpan: { from: t.start, to: t.end }, left, right, span: { from: left.span.from, to: Math.max(right.span.to, t.end) } };
      left = node;
    }
    return left;
  }

  private noteOperatorStyle(t: Token, op: string) {
    if (t.text === "&&" || t.text === "||") {
      this.diag(t, "warning", "c-style-operator", `REDCap logic uses "${op}"; "${t.text}" may not be accepted.`);
      this.diagnostics[this.diagnostics.length - 1]!.fix = { label: `Replace with "${op}"`, edits: [{ from: t.start, to: t.end, insert: op }] };
    } else if (t.text === "==") {
      this.diag(t, "info", "double-equals", 'REDCap compares with a single "=".');
      this.diagnostics[this.diagnostics.length - 1]!.fix = { label: 'Replace with "="', edits: [{ from: t.start, to: t.end, insert: "=" }] };
    }
  }

  private prefix(): Node {
    const t = this.peek();
    if (!t) return this.missing();
    switch (t.kind) {
      case "number":
        this.next();
        return { type: "num", value: Number(t.text), raw: t.text, span: { from: t.start, to: t.end } };
      case "string": {
        this.next();
        if (t.unterminated) this.diag(t, "error", "unterminated-string", "This string is missing its closing quote.");
        const value = t.unterminated ? t.text.slice(1) : t.text.slice(1, -1);
        return { type: "str", value, unterminated: !!t.unterminated, span: { from: t.start, to: t.end } };
      }
      case "bracket":
        return this.ref();
      case "lparen": {
        this.next();
        const expr = this.expr(0);
        const close = this.peek();
        if (close?.kind === "rparen") {
          this.next();
          return { type: "group", expr, unclosed: false, span: { from: t.start, to: close.end } };
        }
        this.diag(t, "error", "unclosed-paren", 'This "(" is never closed.');
        return { type: "group", expr, unclosed: true, span: { from: t.start, to: expr.span.to } };
      }
      case "op":
        if (t.text === "-" || t.text === "+") {
          this.next();
          const operand = this.expr(UNARY_POWER);
          return { type: "unary", op: t.text, operand, span: { from: t.start, to: operand.span.to } };
        }
        return this.missing();
      case "ident": {
        const w = t.text.toLowerCase();
        if (w === "and" || w === "or") return this.missing();
        this.next();
        if (this.peek()?.kind === "lparen") return this.call(t);
        return { type: "ident", name: t.text, span: { from: t.start, to: t.end } };
      }
      default:
        return this.missing();
    }
  }

  private call(nameTok: Token): Node {
    const open = this.next()!;
    const args: Node[] = [];
    if (this.peek()?.kind === "rparen") {
      const close = this.next()!;
      return { type: "call", name: nameTok.text, nameSpan: { from: nameTok.start, to: nameTok.end }, args, unclosed: false, span: { from: nameTok.start, to: close.end } };
    }
    for (;;) {
      args.push(this.expr(0));
      const t = this.peek();
      if (t?.kind === "comma") {
        this.next();
        continue;
      }
      if (t?.kind === "rparen") {
        this.next();
        return { type: "call", name: nameTok.text, nameSpan: { from: nameTok.start, to: nameTok.end }, args, unclosed: false, span: { from: nameTok.start, to: t.end } };
      }
      if (!t) {
        this.diag(open, "error", "unclosed-call", `"${nameTok.text}(" is never closed.`);
        const end = args[args.length - 1]?.span.to ?? open.end;
        return { type: "call", name: nameTok.text, nameSpan: { from: nameTok.start, to: nameTok.end }, args, unclosed: true, span: { from: nameTok.start, to: Math.max(end, open.end) } };
      }
      // Something that can't continue an argument: report it, skip it, and
      // try to carry on with the next argument.
      this.next();
      if (t.kind !== "unknown") this.diag(t, "error", "unexpected-token", `Unexpected "${t.text}" in arguments to ${nameTok.text}().`);
      if (this.peek()?.kind === "comma") this.next();
    }
  }

  private ref(): RefNode {
    const first = this.next()!;
    const group: Token[] = [first];
    // Adjacent brackets with no space between them form one reference.
    while (this.peek()?.kind === "bracket" && this.peek()!.start === group[group.length - 1]!.end) {
      group.push(this.next()!);
    }
    const brackets = group.map(parseBracket);
    const node: RefNode = { type: "ref", brackets, span: { from: first.start, to: group[group.length - 1]!.end } };
    for (const b of brackets) {
      if (b.unterminated) this.diag(b.span, "error", "unclosed-bracket", 'This "[" is never closed.');
      if (b.kind === "invalid") this.diag(b.span, "error", "invalid-bracket", "This isn't a valid field, event or smart variable reference.");
    }
    assignRoles(node, (b, msg) => this.diag(b.span, "error", "bad-reference", msg));
    this.refs.push(node);
    return node;
  }
}

function isInstance(b: Bracket): boolean {
  return b.kind === "number" || (b.kind === "smart" && SMART_BY_NAME.get(b.name)?.role === "instance");
}

/** Works out which bracket is the event, the target and the instance. */
function assignRoles(node: RefNode, report: (b: Bracket, msg: string) => void) {
  const parts = [...node.brackets];
  if (parts.length === 1) {
    node.target = parts[0];
    if (parts[0]!.kind === "number") report(parts[0]!, "A number in brackets needs a field before it, like [field][2].");
    return;
  }
  const last = parts[parts.length - 1]!;
  if (isInstance(last)) {
    node.instance = parts.pop();
  }
  if (parts.length === 2) {
    node.event = parts[0];
    node.target = parts[1];
  } else if (parts.length === 1) {
    node.target = parts[0];
  } else {
    for (const b of parts.slice(2)) report(b, "Too many bracket groups; expected [event][field][instance] at most.");
    node.event = parts[0];
    node.target = parts[1];
  }
}
