import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, type AnalyzeOptions, type Edit } from "../src/logic/index.ts";
import { moodStudy } from "../demo/mood-study.ts";

const run = (src: string, opts: Partial<AnalyzeOptions> = {}) => analyze(src, { schema: moodStudy, ...opts });
const codes = (src: string, opts: Partial<AnalyzeOptions> = {}) => run(src, opts).diagnostics.map((d) => d.code);

function applyEdits(src: string, edits: Edit[]): string {
  return [...edits].sort((a, b) => b.from - a.from).reduce((s, e) => s.slice(0, e.from) + e.insert + s.slice(e.to), src);
}

function fixed(src: string, code: string, opts: Partial<AnalyzeOptions> = {}): string {
  const d = run(src, opts).diagnostics.find((d) => d.code === code);
  assert.ok(d?.fix, `expected a fix for ${code}`);
  return applyEdits(src, d.fix.edits);
}

test("clean expressions have no diagnostics", () => {
  for (const [src, context] of [
    ["[phq9_1] = '2' and [sex] <> '3'", "branching"],
    ["sum([phq9_1], [phq9_2], [phq9_3])", "calc"],
    ["datediff([dob], [consent_date], \"y\")", "calc"],
    ["if(contains([med_other_name], 'zoloft'), 1, 0)", "calc"],
    ["[meds(3)] = '1'", "branching"],
    ["[week_6_arm_1][phq9_total] - [baseline_arm_1][phq9_total]", "calc"],
    ["[visit_date] > '2026-10-01'", "branching"],
    ["if([phq9_total] >= 20, 'severe', 'mild')", "calctext"],
    ["[visit_type] = 'remote'", "branching"],
    ["[user-role-name] = 'coordinator'", "branching"],
  ] as const) {
    assert.deepEqual(codes(src, { context }), [], src);
  }
});

test("unknown field suggests the closest name", () => {
  assert.equal(fixed("[phq9_totl] > 10", "unknown-field"), "[phq9_total] > 10");
});

test("unknown event and function suggest fixes", () => {
  assert.equal(fixed("[basline_arm_1][age] > 18", "unknown-event"), "[baseline_arm_1][age] > 18");
  assert.equal(fixed("roud([age])", "unknown-function", { context: "calc" }), "round([age])");
});

test("checkbox compared without a code", () => {
  assert.equal(fixed("[meds] = '3'", "checkbox-without-code"), "[meds(3)] = '1'");
});

test("choice code that doesn't exist", () => {
  assert.deepEqual(codes("[meds(4)] = '1'"), ["unknown-choice-code"]);
  assert.deepEqual(codes("[sex] = '4'"), ["not-a-choice"]);
  assert.deepEqual(codes("[meds(1)] = '2'"), ["not-a-choice"]);
  assert.deepEqual(codes("[eligible] = 'yes'"), ["not-a-choice"]);
});

test("code on a non-checkbox field", () => {
  assert.deepEqual(codes("[sex(1)] = '1'"), ["code-on-non-checkbox"]);
});

test("date compared to a non-Y-M-D literal, with a fix in the field's order", () => {
  assert.equal(fixed("[visit_date] > '10-01-2026'", "date-format"), "[visit_date] > '2026-10-01'");
});

test("calc must produce a number", () => {
  assert.equal(fixed("contains([med_other_name], 'zoloft')", "calc-result", { context: "calc" }), "if(contains([med_other_name], 'zoloft'), 1, 0)");
  assert.deepEqual(codes("concat([sex], 'x')", { context: "calc" }), ["calc-result"]);
  assert.deepEqual(codes("concat([sex], 'x')", { context: "calctext" }), []);
});

test("branching should be a condition", () => {
  assert.deepEqual(codes("[age]", { context: "branching" }), ["condition-result"]);
});

test("datediff units are case-sensitive", () => {
  const d = run("datediff([dob], 'today', \"Y\")", { context: "calc" }).diagnostics;
  assert.equal(d[0]?.code, "datediff-unit");
  assert.match(d[0]!.message, /Did you mean "y"/);
  assert.deepEqual(codes("datediff([dob], 'today', \"M\")", { context: "calc" }), []);
});

test("arity", () => {
  assert.deepEqual(codes("if([age] > 1, 2)", { context: "calc" }), ["arity"]);
  assert.deepEqual(codes("round()", { context: "calc" }), ["arity"]);
});

test("form not assigned to event", () => {
  assert.deepEqual(codes("[week_6_arm_1][dob] <> ''"), ["form-not-on-event"]);
});

test("self-reference in a calc", () => {
  assert.deepEqual(codes("[phq9_total] + 1", { context: "calc", self: "phq9_total" }), ["self-reference"]);
});

test("bare word that is a field gets a bracket fix", () => {
  assert.equal(fixed("age > 18", "bare-word"), "[age] > 18");
});

test("types flow through if()", () => {
  assert.equal(run("if([age] > 18, 1, 0)").type, "number");
  assert.equal(run("if([age] > 18, 'a', 'b')").type, "string");
  assert.equal(run("[age] > 18 and [sex] = '1'").type, "boolean");
});

test("works without a schema", () => {
  const a = analyze("[anything] = '1' and sum([a], [b]) > 3");
  assert.deepEqual(a.diagnostics, []);
});
