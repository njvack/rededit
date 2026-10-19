// Lossless lexer for REDCap logic. Every character of the input belongs to
// exactly one token, so joining token texts reproduces the source.

export type TokenKind =
  | "ws"
  | "number"
  | "string"
  | "bracket"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "unknown";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
  /** Strings and brackets that ran out of input before closing. */
  unterminated?: boolean;
}

const TWO_CHAR_OPS = new Set(["<=", ">=", "<>", "!=", "==", "&&", "||"]);
const ONE_CHAR_OPS = new Set(["=", "<", ">", "+", "-", "*", "/", "^"]);

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
const isSpace = (c: string) => /\s/.test(c);

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, start: number, end: number, unterminated?: boolean) => {
    const tok: Token = { kind, start, end, text: src.slice(start, end) };
    if (unterminated) tok.unterminated = true;
    tokens.push(tok);
  };

  while (i < src.length) {
    const c = src[i]!;
    const start = i;

    if (isSpace(c)) {
      while (i < src.length && isSpace(src[i]!)) i++;
      push("ws", start, i);
    } else if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      while (i < src.length && isDigit(src[i]!)) i++;
      if (src[i] === "." && isDigit(src[i + 1] ?? "")) {
        i++;
        while (i < src.length && isDigit(src[i]!)) i++;
      }
      push("number", start, i);
    } else if (c === "'" || c === '"') {
      // REDCap has no documented escape syntax; a string ends at the next
      // matching quote.
      const close = src.indexOf(c, i + 1);
      if (close === -1) {
        i = src.length;
        push("string", start, i, true);
      } else {
        i = close + 1;
        push("string", start, i);
      }
    } else if (c === "[") {
      i = scanBracket(src, i);
      push("bracket", start, i, src[i - 1] !== "]");
    } else if (isIdentStart(c)) {
      while (i < src.length && isIdentPart(src[i]!)) i++;
      push("ident", start, i);
    } else if (c === "(") {
      i++;
      push("lparen", start, i);
    } else if (c === ")") {
      i++;
      push("rparen", start, i);
    } else if (c === ",") {
      i++;
      push("comma", start, i);
    } else if (TWO_CHAR_OPS.has(src.slice(i, i + 2))) {
      i += 2;
      push("op", start, i);
    } else if (ONE_CHAR_OPS.has(c)) {
      i++;
      push("op", start, i);
    } else {
      i++;
      push("unknown", start, i);
    }
  }
  return tokens;
}

/**
 * Returns the index just past a bracket group starting at `start`. A closed
 * group ends after its `]`. An unclosed one (common while typing) ends at
 * the first whitespace, quote or `[`, so the rest of the expression still
 * lexes normally.
 */
function scanBracket(src: string, start: number): number {
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === "]") return i + 1;
    if (c === "[" || c === "\n" || c === "'" || c === '"') return cutUnclosed(src, start, i);
  }
  return cutUnclosed(src, start, src.length);
}

function cutUnclosed(src: string, start: number, limit: number): number {
  for (let i = start + 1; i < limit; i++) {
    if (isSpace(src[i]!)) return i;
  }
  return limit;
}
