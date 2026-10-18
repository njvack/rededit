import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, type Node } from "../src/logic/index.ts";

/** Compact s-expression form of an AST, for readable assertions. */
function show(n: Node): string {
  switch (n.type) {
    case "num":
      return n.raw;
    case "str":
      return JSON.stringify(n.value);
    case "ident":
      return n.name;
    case "missing":
      return "?";
    case "group":
      return show(n.expr);
    case "unary":
      return `(${n.op} ${show(n.operand)})`;
    case "binary":
      return `(${n.op} ${show(n.left)} ${show(n.right)})`;
    case "call":
      return `(${n.name} ${n.args.map(show).join(" ")})`.replace(/ \)$/, ")");
    case "ref": {
      const parts = [n.event && `ev:${n.event.name}`, n.target && (n.target.code !== undefined ? `${n.target.name}(${n.target.code})` : n.target.name), n.instance && `#${n.instance.number ?? n.instance.name}`];
      return `[${parts.filter(Boolean).join(" ")}]`;
    }
  }
}

const cases: [string, string][] = [
  ["1 + 2 * 3", "(+ 1 (* 2 3))"],
  ["(1 + 2) * 3", "(* (+ 1 2) 3)"],
  ["(2)^(3)^(2)", "(^ 2 (^ 3 2))"],
  ["-[x] + 1", "(+ (- [x]) 1)"],
  ["[a] = '1' or [b] = '2' and [c] = '3'", "(or (= [a] \"1\") (and (= [b] \"2\") (= [c] \"3\")))"],
  ["[a] = 1 AND [b] <> 2", "(and (= [a] 1) (<> [b] 2))"],
  ["[a] != 1", "(<> [a] 1)"],
  ["sum([a], [b], 3) > 10", "(> (sum [a] [b] 3) 10)"],
  ["if([x] >= 20, 'severe', 'mild')", "(if (>= [x] 20) \"severe\" \"mild\")"],
  ["[baseline_arm_1][phq9_total]", "[ev:baseline_arm_1 phq9_total]"],
  ["[meds(3)] = '1'", "(= [meds(3)] \"1\")"],
  ["[weight][2]", "[weight #2]"],
  ["[visit][weight][previous-instance]", "[ev:visit weight #previous-instance]"],
  ["[previous-event-name][weight]", "[ev:previous-event-name weight]"],
  ["[record-name]", "[record-name]"],
  ["now()", "(now)"],
];

for (const [src, want] of cases) {
  test(`parses ${src}`, () => {
    const r = parse(src);
    assert.equal(show(r.ast), want);
    assert.deepEqual(r.diagnostics, []);
  });
}

test("brackets separated by a space are two references", () => {
  const r = parse("[a] [b]");
  assert.equal(r.refs.length, 2);
  assert.ok(r.diagnostics.some((d) => d.code === "missing-operator"));
});

test("half-typed input parses with diagnostics instead of throwing", () => {
  for (const src of ["[a] =", "if([a] = 1, ", "sum(", "(", "[meds(", "'abc", "= 3", "[a] = = 3", "))", "and", "@#$"]) {
    const r = parse(src);
    assert.ok(r.diagnostics.length > 0, src);
  }
});

test("missing operand is reported at the right place", () => {
  const r = parse("[a] = ");
  assert.equal(r.diagnostics[0]!.code, "expected-value");
  assert.equal(r.diagnostics[0]!.from, 5);
});

test("unclosed call keeps its arguments", () => {
  const r = parse("if([a] = 1, 2");
  assert.equal(r.ast.type, "call");
  assert.equal(r.ast.type === "call" && r.ast.args.length, 2);
  assert.ok(r.diagnostics.some((d) => d.code === "unclosed-call"));
});

test("C-style operators parse, with a warning and a fix", () => {
  const r = parse("[a] = 1 && [b] = 2");
  assert.equal(show(r.ast), "(and (= [a] 1) (= [b] 2))");
  const d = r.diagnostics.find((d) => d.code === "c-style-operator")!;
  assert.equal(d.fix?.edits[0]?.insert, "and");
});

test("empty input has no diagnostics", () => {
  assert.deepEqual(parse("   ").diagnostics, []);
});
