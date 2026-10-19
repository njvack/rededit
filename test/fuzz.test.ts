import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, complete, highlight, lex, signatureAt } from "../src/logic/index.ts";
import { moodStudy } from "../demo/mood-study.ts";

const FRAGMENTS = ["[", "]", "(", ")", ",", "'", '"', " ", "=", "<>", "and", "or", "if", "sum", "datediff", "[meds", "[sex]", "[baseline_arm_1]", "(3)", "1", "2.5", "-", "^", "x", ":label", "\n", "&&", "@", "today"];

// Small deterministic PRNG so failures reproduce.
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

test("random input never throws, and every position completes", () => {
  const rand = rng(42);
  for (let n = 0; n < 2000; n++) {
    const len = Math.floor(rand() * 12);
    let src = "";
    for (let i = 0; i < len; i++) src += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)];
    assert.equal(lex(src).map((t) => t.text).join(""), src);
    const a = analyze(src, { schema: moodStudy, context: "calc" });
    for (const d of a.diagnostics) assert.ok(d.from >= 0 && d.to <= src.length && d.from <= d.to, `bad span in ${JSON.stringify(src)}`);
    for (const h of highlight(a, moodStudy)) assert.ok(h.from >= 0 && h.to <= src.length && h.from < h.to);
    for (let pos = 0; pos <= src.length; pos++) {
      complete(src, pos, { schema: moodStudy, explicit: true });
      signatureAt(src, pos);
    }
  }
});
