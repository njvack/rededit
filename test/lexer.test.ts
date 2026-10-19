import assert from "node:assert/strict";
import { test } from "node:test";
import { lex } from "../src/logic/index.ts";

const samples = [
  "[phq9_1] = '1'",
  "sum([phq9_1], [phq9_2]) >= 10 and [baseline_arm_1][meds(3)] = \"1\"",
  "if([x] <> '', datediff([dob], 'today', \"y\"), '')",
  "[meds( and [x",
  "'unterminated",
  "  \n\t[a][b][2] ^ (3) # ? ",
  "",
];

test("joining tokens reproduces the source", () => {
  for (const s of samples) {
    assert.equal(lex(s).map((t) => t.text).join(""), s);
  }
});

test("tokens are contiguous", () => {
  for (const s of samples) {
    let at = 0;
    for (const t of lex(s)) {
      assert.equal(t.start, at);
      at = t.end;
    }
    assert.equal(at, s.length);
  }
});

test("operators lex longest first", () => {
  const ops = lex("a <= b <> c != d == e && f || g").filter((t) => t.kind === "op").map((t) => t.text);
  assert.deepEqual(ops, ["<=", "<>", "!=", "==", "&&", "||"]);
});

test("an unclosed bracket stops at whitespace so the rest still lexes", () => {
  const toks = lex("[meds( and [x]").filter((t) => t.kind !== "ws");
  assert.deepEqual(toks.map((t) => [t.kind, t.text]), [
    ["bracket", "[meds("],
    ["ident", "and"],
    ["bracket", "[x]"],
  ]);
  assert.equal(toks[0]!.unterminated, true);
});
