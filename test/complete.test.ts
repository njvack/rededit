import assert from "node:assert/strict";
import { test } from "node:test";
import { complete, signatureAt } from "../src/logic/index.ts";
import { moodStudy } from "../demo/mood-study.ts";

const at = (srcWithCaret: string, explicit = false) => {
  const pos = srcWithCaret.indexOf("|");
  const src = srcWithCaret.replace("|", "");
  return complete(src, pos, { schema: moodStudy, explicit });
};
const labels = (s: string, explicit = false) => at(s, explicit)?.items.map((i) => i.label) ?? [];

test("field names after [", () => {
  const r = at("[phq9_t|")!;
  assert.equal(r.items[0]!.label, "phq9_total");
  assert.equal(r.items[0]!.insert, "[phq9_total]");
  assert.deepEqual([r.from, r.to], [0, 7]);
});

test("replaces the whole bracket when the cursor is inside a closed one", () => {
  const r = at("[phq|9_total] > 1")!;
  assert.deepEqual([r.from, r.to], [0, 12]);
});

test("checkbox field inserts an open code and reopens", () => {
  const item = at("[med|")!.items.find((i) => i.label === "meds")!;
  assert.equal(item.insert, "[meds(");
  assert.equal(item.reopen, true);
});

test("checkbox codes after [meds(", () => {
  const r = at("[meds(|")!;
  assert.deepEqual(r.items.map((i) => [i.label, i.detail]), [["1", "Sertraline"], ["2", "Fluoxetine"], ["3", "Other"]]);
  assert.equal(r.items[2]!.insert, "3)]");
});

test("choice values after a comparison", () => {
  assert.deepEqual(labels("[sex] = |"), ["1", "2", "3"]);
  assert.deepEqual(labels("[sex] = 'F|"), ["1"]);
  assert.deepEqual(labels("[meds(2)] <> |"), ["1", "0"]);
  assert.deepEqual(labels("[baseline_arm_1][eligible] = |"), ["1", "0"]);
  assert.deepEqual(labels("[meds] = |"), []);
});

test("events and fields on that event", () => {
  assert.ok(labels("[week|").includes("week_6_arm_1"));
  const onWeek6 = labels("[week_6_arm_1][|");
  assert.ok(onWeek6.includes("visit_date"));
  assert.ok(!onWeek6.includes("dob"));
});

test("instance smart variables after a field", () => {
  assert.ok(labels("[visit_date][|").includes("previous-instance"));
});

test("functions and keywords by position", () => {
  assert.ok(labels("dat|").some((l) => l.startsWith("datediff(")));
  assert.deepEqual(labels("[age] > 1 a|"), ["and"]);
});

test("datediff units", () => {
  assert.deepEqual(labels('datediff([dob], "today", "|'), ['"y"', '"M"', '"d"', '"h"', '"m"', '"s"']);
});

test("signature help tracks the active argument", () => {
  const sig = signatureAt("if([a] = 1, sum(1, 2), ", 23)!;
  assert.equal(sig.fn.name, "if");
  assert.equal(sig.active, 2);
  assert.equal(signatureAt("sum(1, ", 7)!.active, 1);
});
