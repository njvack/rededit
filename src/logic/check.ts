// Semantic checks: resolve references against the project, infer a type for
// every subexpression, and report problems with fixes where we can.

import type { BinaryNode, CallNode, Diagnostic, Edit, Node, RefNode, Severity, Span } from "./ast.ts";
import { DATEDIFF_UNITS, FUNCTIONS, FUNCTIONS_BY_NAME, SMART_BY_NAME, SMART_VARIABLES, type ValueType } from "./catalog.ts";
import { parse, type ParseResult } from "./parser.ts";
import { SchemaIndex, choicesOf, dateOrder, valueTypeOf, type FieldDef, type Schema } from "./schema.ts";
import { closest } from "./suggest.ts";

/**
 * Where the logic lives, which decides what the whole expression must
 * produce: a number for calc fields, true/false for branching and other
 * conditions, anything for @CALCTEXT.
 */
export type LogicContext = "branching" | "calc" | "calctext" | "condition";

export interface AnalyzeOptions {
  schema?: Schema | SchemaIndex;
  context?: LogicContext;
  /** Name of the field this logic belongs to, to catch self-references. */
  self?: string;
}

export interface RefInfo {
  field?: FieldDef;
  /** A checkbox field referenced without a choice code. */
  codeless?: boolean;
  smart?: boolean;
}

export interface Analysis extends ParseResult {
  /** Type of the whole expression. */
  type: ValueType;
  types: Map<Node, ValueType>;
  refInfo: Map<RefNode, RefInfo>;
}

const COMPARISON = new Set(["=", "<>", "<", ">", "<=", ">="]);
const ARITHMETIC = new Set(["+", "-", "*", "/", "^"]);
const TEXT_FUNCTIONS = new Set(["contains", "not_contain", "starts_with", "ends_with", "left", "right", "mid", "length", "find", "replace_text", "upper", "lower", "trim"]);
const NUMERIC_SMART = new Set(["is-form", "is-survey", "event-id", "event-number", "arm-number", "project-id", "current-instance", "previous-instance", "next-instance", "first-instance", "last-instance"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
const NUMERIC = /^\s*-?\d+(\.\d+)?\s*$/;

export function analyze(src: string, opts: AnalyzeOptions = {}): Analysis {
  const parsed = parse(src);
  const checker = new Checker(src, parsed, opts);
  return checker.run();
}

class Checker {
  private readonly schema: SchemaIndex | undefined;
  private readonly context: LogicContext;
  private readonly diagnostics: Diagnostic[];
  private readonly types = new Map<Node, ValueType>();
  private readonly refInfo = new Map<RefNode, RefInfo>();
  private readonly src: string;
  private readonly parsed: ParseResult;
  private readonly opts: AnalyzeOptions;

  constructor(src: string, parsed: ParseResult, opts: AnalyzeOptions) {
    this.src = src;
    this.parsed = parsed;
    this.opts = opts;
    this.schema = opts.schema ? SchemaIndex.from(opts.schema) : undefined;
    this.context = opts.context ?? "branching";
    this.diagnostics = [...parsed.diagnostics];
  }

  run(): Analysis {
    const empty = this.src.trim() === "";
    const type = empty ? "any" : this.infer(this.parsed.ast);
    // Result-type complaints are noise while the syntax is still broken.
    const syntaxOk = !this.parsed.diagnostics.some((d) => d.severity === "error");
    if (!empty && syntaxOk) this.checkResult(type);
    this.diagnostics.sort((a, b) => a.from - b.from || a.to - b.to);
    return { ...this.parsed, diagnostics: this.diagnostics, type, types: this.types, refInfo: this.refInfo };
  }

  private report(span: Span, severity: Severity, code: string, message: string, fix?: Diagnostic["fix"]) {
    const d: Diagnostic = { from: span.from, to: span.to, severity, code, message };
    if (fix) d.fix = fix;
    this.diagnostics.push(d);
  }

  private infer(node: Node): ValueType {
    const t = this.inferInner(node);
    this.types.set(node, t);
    return t;
  }

  private inferInner(node: Node): ValueType {
    switch (node.type) {
      case "num":
        return "number";
      case "str":
        return "string";
      case "missing":
        return "any";
      case "group":
        return this.infer(node.expr);
      case "unary": {
        const t = this.infer(node.operand);
        if (t === "string" && !isNumericLiteral(node.operand)) this.report(node.span, "warning", "text-arithmetic", "Negating a text value.");
        return "number";
      }
      case "ident":
        return this.ident(node.name, node.span);
      case "ref":
        return this.ref(node);
      case "call":
        return this.call(node);
      case "binary":
        return this.binary(node);
    }
  }

  private ident(name: string, span: Span): ValueType {
    const lower = name.toLowerCase();
    if (lower === "true" || lower === "false") return "boolean";
    const field = this.schema?.fields.get(name);
    const hint = field ? ` Field references need brackets: [${name}].` : " Text needs quotes.";
    const fix = field ? { label: `Use [${name}]`, edits: [{ from: span.from, to: span.to, insert: `[${name}]` }] } : undefined;
    this.report(span, "error", "bare-word", `"${name}" isn't a function or keyword.${hint}`, fix);
    return "any";
  }

  // ---- references ----

  private ref(node: RefNode): ValueType {
    const info: RefInfo = {};
    this.refInfo.set(node, info);
    const target = node.target;
    if (!target || target.kind === "invalid" || target.kind === "number") return "any";

    if (node.event) this.eventPart(node);

    if (target.kind === "smart") {
      info.smart = true;
      const def = SMART_BY_NAME.get(target.name);
      if (!def) {
        const s = closest(target.name, SMART_VARIABLES.map((v) => v.name));
        this.report(target.nameSpan, "error", "unknown-smart-variable", `Unknown smart variable "${target.name}".${s ? ` Did you mean [${s}]?` : ""}`, s ? replaceFix(target.nameSpan, s) : undefined);
        return "any";
      }
      return target.name.startsWith("aggregate-") || NUMERIC_SMART.has(target.name) ? "number" : "string";
    }

    if (!this.schema) return "any";
    const field = this.schema.fields.get(target.name);
    if (!field) {
      if (!node.event && this.schema.events.has(target.name)) {
        this.report(target.span, "error", "event-without-field", `"${target.name}" is an event. Add the field after it, like [${target.name}][field].`);
        return "any";
      }
      const s = closest(target.name, [...this.schema.fields.keys()]);
      this.report(target.nameSpan, "error", "unknown-field", `No field named "${target.name}".${s ? ` Did you mean ${s}?` : ""}`, s ? replaceFix(target.nameSpan, s) : undefined);
      return "any";
    }
    info.field = field;

    if (this.opts.self && field.name === this.opts.self) {
      const sev = this.context === "calc" || this.context === "calctext" ? "error" : "warning";
      this.report(target.nameSpan, sev, "self-reference", `This logic belongs to ${field.name} and refers to itself.`);
    }

    for (const p of target.params) {
      if (p !== "value") this.report(target.span, "warning", "piping-param", `":${p}" is a piping option. Logic always uses the stored value.`);
    }

    if (target.code !== undefined) {
      if (field.type !== "checkbox") {
        this.report(target.codeSpan ?? target.span, "error", "code-on-non-checkbox", `Only checkbox fields take a choice code in parentheses; ${field.name} is ${article(field.type)}.`);
        return valueTypeOf(field);
      }
      const codes = choicesOf(field) ?? [];
      if (!codes.some((c) => c.code === target.code) && !(target.code === "" && target.unterminated)) {
        this.report(target.codeSpan && target.code !== "" ? target.codeSpan : target.span, "error", "unknown-choice-code", `${field.name} has no choice "${target.code}". Choices: ${listChoices(codes)}.`);
      }
      return "number";
    }
    if (field.type === "checkbox") info.codeless = true;
    if (field.type === "descriptive") this.report(target.span, "warning", "descriptive-value", `${field.name} is descriptive text and never has a value.`);
    return valueTypeOf(field);
  }

  private eventPart(node: RefNode) {
    const ev = node.event!;
    if (ev.kind === "smart") {
      const def = SMART_BY_NAME.get(ev.name);
      if (!def || def.role !== "event") this.report(ev.span, "error", "bad-event-prefix", `[${ev.name}] can't come before a field. Use an event name or an event smart variable like [previous-event-name].`);
      return;
    }
    if (ev.kind !== "name" || !this.schema) return;
    if (!this.schema.longitudinal) {
      this.report(ev.span, "warning", "event-not-longitudinal", "This project has no events, so event prefixes do nothing.");
      return;
    }
    const event = this.schema.events.get(ev.name);
    if (!event) {
      const s = closest(ev.name, [...this.schema.events.keys()]);
      this.report(ev.nameSpan, "error", "unknown-event", `No event named "${ev.name}".${s ? ` Did you mean ${s}?` : ""}`, s ? replaceFix(ev.nameSpan, s) : undefined);
      return;
    }
    const field = node.target?.kind === "name" ? this.schema.fields.get(node.target.name) : undefined;
    if (field && !event.forms.includes(field.form)) {
      this.report(node.span, "warning", "form-not-on-event", `${field.name} is on form ${field.form}, which isn't assigned to event ${event.name}.`);
    }
  }

  // ---- operators ----

  private binary(node: BinaryNode): ValueType {
    const lt = this.infer(node.left);
    const rt = this.infer(node.right);
    if (node.op === "?") return "any";

    if (node.op === "and" || node.op === "or") {
      const other = node.op === "or" ? "and" : "or";
      for (const side of [node.left, node.right]) {
        if (side.type === "binary" && side.op === other) {
          this.report(node.opSpan, "info", "mixed-and-or", '"and" binds tighter than "or". Add parentheses to make the grouping explicit.');
          break;
        }
      }
      return "boolean";
    }

    if (COMPARISON.has(node.op)) {
      if (node.left.type === "binary" && COMPARISON.has(node.left.op)) {
        this.report(node.opSpan, "warning", "chained-comparison", "Comparisons don't chain. Use two comparisons joined by and.");
      }
      this.comparison(node, lt, rt);
      return "boolean";
    }

    if (ARITHMETIC.has(node.op)) {
      for (const [side, t] of [[node.left, lt], [node.right, rt]] as const) {
        if (t === "string" && !isNumericLiteral(side)) {
          this.report(side.span, "warning", "text-arithmetic", "Arithmetic on a text value.");
        } else if (t === "date" || t === "datetime") {
          this.report(side.span, "warning", "date-arithmetic", "Arithmetic on a date. Use datediff() to compare dates.");
        } else if (t === "boolean") {
          this.report(side.span, "warning", "boolean-arithmetic", "Arithmetic on true/false. Wrap it: if(…, 1, 0).");
        }
      }
      if (node.op === "^") {
        for (const side of [node.left, node.right]) {
          if (side.type !== "group") this.report(side.span, "info", "power-parens", "REDCap expects both sides of ^ in parentheses, like (x)^(2).");
        }
      }
      return "number";
    }
    return "any";
  }

  private comparison(node: BinaryNode, lt: ValueType, rt: ValueType) {
    const pairs: [Node, Node][] = [
      [node.left, node.right],
      [node.right, node.left],
    ];
    for (const [refSide, litSide] of pairs) {
      if (refSide.type !== "ref") continue;
      const info = this.refInfo.get(refSide);
      const field = info?.field;
      const lit = literalValue(litSide);
      if (!field || lit === undefined) continue;

      if (info.codeless) {
        const codes = choicesOf(field) ?? [];
        const match = codes.find((c) => c.code === lit);
        const target = refSide.target!;
        const fix = match
          ? { label: `Use [${field.name}(${match.code})] = '1'`, edits: [{ from: target.nameSpan.to, to: target.nameSpan.to, insert: `(${match.code})` }, { from: litSide.span.from, to: litSide.span.to, insert: "'1'" }] }
          : undefined;
        this.report(refSide.span, "error", "checkbox-without-code", `${field.name} is a checkbox; each choice is its own 0/1 value. Compare one choice, like [${field.name}(${match?.code ?? codes[0]?.code ?? "1"})] = '1'.`, fix);
        continue;
      }

      const target = refSide.target!;
      const codes = target.code !== undefined ? [{ code: "1", label: "checked" }, { code: "0", label: "unchecked" }] : choicesOf(field);
      if (codes && lit !== "" && COMPARISON.has(node.op) && (node.op === "=" || node.op === "<>")) {
        if (!codes.some((c) => c.code === lit)) {
          this.report(litSide.span, "warning", "not-a-choice", `"${lit}" isn't a choice of ${field.name}${target.code !== undefined ? `(${target.code})` : ""}. Choices: ${listChoices(codes)}.`);
        }
        continue;
      }

      const order = dateOrder(field);
      if (order && lit !== "" && !ISO_DATE.test(lit) && !/^(today|now)$/i.test(lit)) {
        const iso = toIso(lit, order === "ymd" ? "mdy" : order);
        const fix = iso ? { label: `Use '${iso}'`, edits: [{ from: litSide.span.from, to: litSide.span.to, insert: `'${iso}'` }] } : undefined;
        this.report(litSide.span, "warning", "date-format", `${field.name} is stored as Y-M-D whatever its display format, so compare it to a Y-M-D value${iso ? ` like '${iso}'` : ""}.`, fix);
        continue;
      }

      if (valueTypeOf(field) === "number" && lit !== "" && !NUMERIC.test(lit)) {
        this.report(litSide.span, "warning", "number-vs-text", `${field.name} holds a number, but is compared to "${lit}".`);
      }
    }

    const dateLike = (t: ValueType) => t === "date" || t === "datetime";
    if ((dateLike(lt) && rt === "number") || (lt === "number" && dateLike(rt))) {
      this.report(node.opSpan, "warning", "date-vs-number", "Comparing a date to a number. Use datediff() to get a number of days, months or years.");
    }
  }

  // ---- functions ----

  private call(node: CallNode): ValueType {
    const name = node.name.toLowerCase();
    const def = FUNCTIONS_BY_NAME.get(name);
    const argTypes = node.args.map((a) => this.infer(a));
    if (!def) {
      const s = closest(name, FUNCTIONS.map((f) => f.name));
      this.report(node.nameSpan, "error", "unknown-function", `Unknown function "${node.name}".${s ? ` Did you mean ${s}()?` : ""}`, s ? replaceFix(node.nameSpan, s) : undefined);
      return "any";
    }
    const n = node.args.length;
    if (!node.unclosed && (n < def.min || n > def.max)) {
      const want = def.min === def.max ? `${def.min}` : def.max === Infinity ? `at least ${def.min}` : `${def.min} to ${def.max}`;
      this.report(node.nameSpan, "error", "arity", `${def.name}() takes ${want} argument${want === "1" ? "" : "s"}; found ${n}.`);
    }

    if (name === "datediff") this.datediff(node, argTypes);
    if (TEXT_FUNCTIONS.has(name)) {
      for (const arg of node.args) {
        const f = arg.type === "ref" ? this.refInfo.get(arg)?.field : undefined;
        const order = f && dateOrder(f);
        if (order && order !== "ymd") this.report(arg.span, "warning", "text-function-on-date", `Text functions on ${order.toUpperCase()} date fields behave unpredictably.`);
      }
    }
    if (name === "if") {
      const cond = argTypes[0];
      if (cond === "number" || cond === "string") {
        this.report(node.args[0]!.span, "info", "if-condition", "This condition is a plain value, not a comparison.");
      }
      const a = argTypes[1] ?? "any";
      const b = argTypes[2] ?? "any";
      if (a === b) return a;
      if (a === "any" || b === "any") return a === "any" ? b : a;
      return "any";
    }
    return def.returns === "branches" ? "any" : def.returns;
  }

  private datediff(node: CallNode, argTypes: ValueType[]) {
    for (const i of [0, 1]) {
      const arg = node.args[i];
      const t = argTypes[i];
      if (!arg || !t) continue;
      const lit = literalValue(arg);
      if (lit !== undefined) {
        if (!/^(today|now)$/i.test(lit) && !ISO_DATE.test(lit)) this.report(arg.span, "warning", "datediff-arg", `datediff() needs a date, 'today' or 'now'; got "${lit}".`);
      } else if (t !== "date" && t !== "datetime" && t !== "any" && t !== "string") {
        this.report(arg.span, "warning", "datediff-arg", "datediff() needs a date or datetime here.");
      }
    }
    const unit = node.args[2];
    if (unit) {
      const lit = literalValue(unit);
      if (lit !== undefined && !(lit in DATEDIFF_UNITS)) {
        const ci = Object.keys(DATEDIFF_UNITS).filter((u) => u.toLowerCase() === lit.toLowerCase());
        this.report(unit.span, "error", "datediff-unit", `"${lit}" isn't a datediff unit. Units: y (years), M (months), d (days), h (hours), m (minutes), s (seconds); case matters.${ci.length ? ` Did you mean ${ci.map((u) => `"${u}"`).join(" or ")}?` : ""}`);
      }
    }
    const fourth = node.args[3];
    const fourthLit = fourth && literalValue(fourth);
    if (fourthLit !== undefined && /^(ymd|mdy|dmy)$/.test(fourthLit)) {
      this.report(fourth!.span, "info", "datediff-format", "The date format argument is no longer needed; REDCap knows each field's format.");
    }
  }

  // ---- whole expression ----

  private checkResult(type: ValueType) {
    const ast = this.parsed.ast;
    const span = ast.span;
    if (this.context === "calc") {
      if (type === "boolean") {
        this.report(span, "error", "calc-result", "A calculated field must produce a number, but this produces true/false.", {
          label: "Wrap in if(…, 1, 0)",
          edits: wrap(span, "if(", ", 1, 0)"),
        });
      } else if (type === "string") {
        this.report(span, "error", "calc-result", "A calculated field must produce a number, but this produces text. For text results, use @CALCTEXT on a text field.");
      } else if (type === "date" || type === "datetime") {
        this.report(span, "error", "calc-result", "A calculated field must produce a number, but this produces a date. Use datediff() for a number, or @CALCDATE for a date.");
      }
    } else if (this.context === "branching" || this.context === "condition") {
      if (type === "number" || type === "string" || type === "date" || type === "datetime") {
        this.report(span, "warning", "condition-result", "This is a plain value, not a true/false condition. Compare it to something.");
      }
    }
  }
}

function isNumericLiteral(n: Node): boolean {
  if (n.type === "num") return true;
  if (n.type === "str") return NUMERIC.test(n.value);
  if (n.type === "unary") return isNumericLiteral(n.operand);
  if (n.type === "group") return isNumericLiteral(n.expr);
  return false;
}

/** The value of a literal string or number (including a negated number), as text. */
function literalValue(n: Node): string | undefined {
  if (n.type === "str") return n.value;
  if (n.type === "num") return n.raw;
  if (n.type === "unary" && n.op === "-" && n.operand.type === "num") return `-${n.operand.raw}`;
  return undefined;
}

function toIso(lit: string, order: "mdy" | "dmy"): string | undefined {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(lit.trim());
  if (!m) return undefined;
  const [a, b, y] = [m[1]!, m[2]!, m[3]!];
  const [mo, d] = order === "mdy" ? [a, b] : [b, a];
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return undefined;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function listChoices(codes: { code: string; label: string }[]): string {
  if (codes.length === 0) return "none defined";
  const shown = codes.slice(0, 8).map((c) => `${c.code} = ${c.label}`);
  return shown.join(", ") + (codes.length > 8 ? `, … (${codes.length} total)` : "");
}

function article(type: string): string {
  return `${/^[aeiouy]/.test(type) ? "an" : "a"} ${type} field`;
}

function replaceFix(span: Span, insert: string): Diagnostic["fix"] {
  return { label: `Change to ${insert}`, edits: [{ from: span.from, to: span.to, insert }] };
}

function wrap(span: Span, before: string, after: string): Edit[] {
  return [
    { from: span.from, to: span.from, insert: before },
    { from: span.to, to: span.to, insert: after },
  ];
}
