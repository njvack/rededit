import type { Bracket, Span } from "./refs.ts";

export type { Span };

export type Severity = "error" | "warning" | "info";

export interface Edit {
  from: number;
  to: number;
  insert: string;
}

export interface Diagnostic {
  from: number;
  to: number;
  severity: Severity;
  code: string;
  message: string;
  fix?: { label: string; edits: Edit[] };
}

/**
 * A reference made of one or more adjacent bracket groups, with each group's
 * role worked out: `[event][field(code)][instance]`, or a standalone smart
 * variable such as `[record-name]`.
 */
export interface RefNode {
  type: "ref";
  span: Span;
  brackets: Bracket[];
  event?: Bracket;
  target?: Bracket;
  instance?: Bracket;
}

export interface NumNode {
  type: "num";
  span: Span;
  value: number;
  raw: string;
}

export interface StrNode {
  type: "str";
  span: Span;
  value: string;
  unterminated: boolean;
}

export interface CallNode {
  type: "call";
  span: Span;
  name: string;
  nameSpan: Span;
  args: Node[];
  unclosed: boolean;
}

export interface BinaryNode {
  type: "binary";
  span: Span;
  /** Normalized operator: `=`, `<>`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`, `^`, `and`, `or`. */
  op: string;
  opText: string;
  opSpan: Span;
  left: Node;
  right: Node;
}

export interface UnaryNode {
  type: "unary";
  span: Span;
  op: "-" | "+";
  operand: Node;
}

export interface GroupNode {
  type: "group";
  span: Span;
  expr: Node;
  unclosed: boolean;
}

/** A bare word that is not a function call, such as `true`. */
export interface IdentNode {
  type: "ident";
  span: Span;
  name: string;
}

/** Placeholder where a value was expected but absent. Zero width. */
export interface MissingNode {
  type: "missing";
  span: Span;
}

export type Node =
  | RefNode
  | NumNode
  | StrNode
  | CallNode
  | BinaryNode
  | UnaryNode
  | GroupNode
  | IdentNode
  | MissingNode;

export function walk(node: Node, visit: (n: Node, parent: Node | undefined) => void, parent?: Node): void {
  visit(node, parent);
  switch (node.type) {
    case "call":
      for (const a of node.args) walk(a, visit, node);
      break;
    case "binary":
      walk(node.left, visit, node);
      walk(node.right, visit, node);
      break;
    case "unary":
      walk(node.operand, visit, node);
      break;
    case "group":
      walk(node.expr, visit, node);
      break;
  }
}
