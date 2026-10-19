// A small dependency-free logic editor: a transparent <textarea> over a
// highlighted <pre>, driven entirely by src/logic.

import {
  analyze,
  choicesOf,
  complete,
  describeType,
  highlight,
  signatureAt,
  FUNCTIONS_BY_NAME,
  SchemaIndex,
  SMART_BY_NAME,
  type Analysis,
  type CompletionItem,
  type CompletionResult,
  type Diagnostic,
  type LogicContext,
  type ValueType,
} from "../src/logic/index.ts";
import { moodStudy } from "./mood-study.ts";

const schema = new SchemaIndex(moodStudy);

const EXAMPLES: { label: string; context: LogicContext; src: string }[] = [
  { label: "Branching with a checkbox mistake", context: "branching", src: "[any_meds] = '1' and [meds] = '3'" },
  { label: "PHQ-9 total", context: "calc", src: "sum([phq9_1], [phq9_2], [phq9_3], [phq9_4], [phq9_5],\n    [phq9_6], [phq9_7], [phq9_8], [phq9_9])" },
  { label: "Severity with @CALCTEXT", context: "calctext", src: "if([phq9_total] >= 20, 'severe',\n  if([phq9_total] >= 10, 'moderate', 'mild'))" },
  { label: "contains() in a calc", context: "calc", src: "contains([med_other_name], 'zoloft')" },
  { label: "Date in the wrong format", context: "branching", src: "[visit_date] > '10-01-2026' and [visit_type] = 'remote'" },
  { label: "Change from baseline", context: "calc", src: "[week_12_arm_1][phq9_total] - [baseline_arm_1][phq9_total]" },
  { label: "Typos everywhere", context: "calc", src: "rond(datediff([dob], [basline_arm_1][consent_date], \"Y\"), 1)" },
  { label: "Empty", context: "branching", src: "" },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>("input");
const hl = $<HTMLPreElement>("hl");
const editor = $<HTMLDivElement>("editor");
const list = $<HTMLUListElement>("completions");
const sigEl = $<HTMLDivElement>("signature");
const resultEl = $<HTMLDivElement>("result");
const diagEl = $<HTMLUListElement>("diagnostics");
const inspectEl = $<HTMLDivElement>("inspect");
const contextSel = $<HTMLSelectElement>("context");
const exampleSel = $<HTMLSelectElement>("examples");
const announceEl = $<HTMLDivElement>("announce");

let analysis: Analysis;
let popup: { result: CompletionResult; selected: number } | null = null;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const context = () => contextSel.value as LogicContext;

// ---- rendering ----

function update() {
  const src = input.value;
  analysis = analyze(src, { schema, context: context() });
  renderHighlight();
  renderDiagnostics();
  renderResult();
  renderSignature();
  renderInspect();
  scheduleAnnouncement();
}

let announceTimer: ReturnType<typeof setTimeout> | undefined;
let lastAnnounced = "";

/**
 * Tells screen reader users about problems once typing pauses, and only when
 * the summary changes, so the live region doesn't chatter on every key.
 */
function scheduleAnnouncement() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const ds = analysis.diagnostics;
    const text = !input.value.trim() ? "" : ds.length === 0 ? "No problems." : `${ds.length} problem${ds.length === 1 ? "" : "s"}. First: ${ds[0]!.message}`;
    if (text !== lastAnnounced) {
      lastAnnounced = text;
      announceEl.textContent = text;
    }
  }, 900);
}

/**
 * Splits the source at every highlight and diagnostic boundary and wraps
 * each piece in the classes that cover it. A zero-width marker at the caret
 * lets us position the completion list.
 */
function renderHighlight() {
  const src = input.value;
  const caret = input.selectionStart;
  const spans = highlight(analysis, schema);
  const diags = analysis.diagnostics.map((d) => (d.to > d.from ? d : { ...d, to: Math.min(src.length, d.from + 1), from: d.to === src.length ? Math.max(0, d.from - 1) : d.from }));
  const cuts = new Set([0, src.length, caret]);
  for (const s of spans) cuts.add(s.from).add(s.to);
  for (const d of diags) cuts.add(d.from).add(d.to);
  const points = [...cuts].filter((p) => p >= 0 && p <= src.length).sort((a, b) => a - b);

  let html = "";
  for (let i = 0; i < points.length; i++) {
    const from = points[i]!;
    if (from === caret) html += '<span class="caret-mark" id="caret-mark"></span>';
    const to = points[i + 1];
    if (to === undefined || to === from) continue;
    const cls: string[] = [];
    const tok = spans.find((s) => s.from <= from && s.to >= to);
    if (tok) cls.push(`t-${tok.cls}`);
    const worst = ["error", "warning", "info"].find((sev) => diags.some((d) => d.severity === sev && d.from <= from && d.to >= to));
    if (worst) cls.push(`d-${worst}`);
    const text = escapeHtml(src.slice(from, to));
    html += cls.length ? `<span class="${cls.join(" ")}">${text}</span>` : text;
  }
  // A trailing newline in a <pre> collapses; keep the last line's height.
  hl.innerHTML = html + (src.endsWith("\n") || src === "" ? " " : "");
}

function renderDiagnostics() {
  const src = input.value;
  diagEl.innerHTML = "";
  if (src.trim() && analysis.diagnostics.length === 0) {
    diagEl.innerHTML = '<li class="clean">No problems found.</li>';
    return;
  }
  for (const d of analysis.diagnostics) {
    const li = document.createElement("li");
    li.className = d.severity;
    const snippet = src.slice(d.from, d.to);
    li.innerHTML = `<span class="sev">${d.severity[0]!.toUpperCase()}${d.severity.slice(1)}</span><button type="button" class="msg" title="Select this in the editor">${escapeHtml(d.message)}</button>${snippet.trim() ? `<span class="where" aria-hidden="true">${escapeHtml(snippet.length > 40 ? snippet.slice(0, 40) + "…" : snippet)}</span>` : ""}`;
    li.querySelector(".msg")!.addEventListener("click", () => {
      input.focus();
      input.setSelectionRange(d.from, d.to);
      update();
    });
    if (d.fix) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = d.fix.label;
      b.addEventListener("click", () => applyFix(d));
      li.append(b);
    }
    diagEl.append(li);
  }
}

const TYPE_WORDS: Record<ValueType, string> = { number: "a number", string: "text", boolean: "true/false", date: "a date", datetime: "a date and time", time: "a time", any: "a value of unknown type" };

function renderResult() {
  if (!input.value.trim()) {
    resultEl.textContent = "";
    return;
  }
  const t = analysis.type;
  const ctx = context();
  const fits = ctx === "calctext" || t === "any" || (ctx === "calc" ? t === "number" : t === "boolean");
  const want = ctx === "calc" ? "a calculated field needs a number" : ctx === "calctext" ? "@CALCTEXT takes anything" : "branching needs true/false";
  resultEl.innerHTML = `Produces <b>${TYPE_WORDS[t]}</b>. <span class="${fits ? "ok" : "bad"}">${fits ? "✓" : "✗"} ${want}.</span>`;
}

function renderSignature() {
  const sig = signatureAt(input.value, input.selectionStart);
  if (!sig) {
    sigEl.innerHTML = "";
    return;
  }
  const params = sig.fn.params.map((p, i) => {
    const active = i === sig.active || (p === "..." && sig.active >= i) || (i === sig.fn.params.length - 1 && sig.fn.params[i] === "..." && sig.active > i);
    return active ? `<b>${escapeHtml(p)}</b>` : escapeHtml(p);
  });
  sigEl.innerHTML = `${sig.fn.name}(${params.join(", ")}) <span class="doc">${escapeHtml(sig.fn.doc)}</span>`;
}

/** Describes whatever reference or function the caret is on. */
function renderInspect() {
  const pos = input.selectionStart;
  for (const ref of analysis.refs) {
    if (pos < ref.span.from || pos > ref.span.to) continue;
    const info = analysis.refInfo.get(ref);
    const f = info?.field;
    if (f) {
      const choices = choicesOf(f);
      const logicForm = f.type === "checkbox" ? `[${f.name}(${choices?.[0]?.code ?? "1"})] = '1'` : `[${f.name}]`;
      const exports = f.type === "checkbox" ? (choices ?? []).map((c) => `${f.name}___${c.code}`).join(", ") : f.name;
      const stored = f.type === "checkbox" ? "One 0/1 value per choice" : /^date/.test(f.validation ?? "") ? "Y-M-D, whatever the display format" : TYPE_WORDS[analysis.types.get(ref) ?? "any"];
      inspectEl.className = "inspect";
      inspectEl.innerHTML = `<div class="name">${escapeHtml(f.name)}</div><dl>
        <dt>Label</dt><dd>${escapeHtml(f.label ?? "")}</dd>
        <dt>Type</dt><dd>${escapeHtml(describeType(f))}</dd>
        <dt>Form</dt><dd>${escapeHtml(f.form)}</dd>
        <dt>Stored</dt><dd>${escapeHtml(stored)}</dd>
        <dt>In logic</dt><dd><code>${escapeHtml(logicForm)}</code></dd>
        <dt>Exports</dt><dd><code>${escapeHtml(exports)}</code></dd>
        ${choices ? `<dt>Choices</dt><dd>${choices.map((c) => `<code>${escapeHtml(c.code)}</code> ${escapeHtml(c.label)}`).join("<br>")}</dd>` : ""}
      </dl>`;
      return;
    }
    const smart = ref.target && SMART_BY_NAME.get(ref.target.name);
    if (smart) {
      inspectEl.className = "inspect";
      inspectEl.innerHTML = `<div class="name">[${escapeHtml(smart.name)}]</div><div>Smart variable. ${escapeHtml(smart.doc)}</div>`;
      return;
    }
  }
  const tok = analysis.tokens.find((t) => t.kind === "ident" && t.start <= pos && pos <= t.end);
  const fn = tok && FUNCTIONS_BY_NAME.get(tok.text.toLowerCase());
  if (fn) {
    inspectEl.className = "inspect";
    inspectEl.innerHTML = `<div class="name">${fn.name}(${fn.params.join(", ")})</div><div>${escapeHtml(fn.doc)}</div>`;
    return;
  }
  inspectEl.className = "inspect muted";
  inspectEl.textContent = "Put the cursor on a field or function.";
}

// ---- completion ----

const KIND_MARK: Record<CompletionItem["kind"], string> = { field: "F", event: "E", smart: "S", function: "ƒ", choice: "#", keyword: "K", unit: "u" };

function openCompletion(explicit: boolean) {
  const result = complete(input.value, input.selectionStart, { schema, explicit });
  if (!result || result.items.length === 0) return closeCompletion();
  const wasOpen = popup !== null;
  popup = { result, selected: 0 };
  renderCompletion();
  if (!wasOpen) {
    lastAnnounced = "";
    announceEl.textContent = `${result.items.length} suggestion${result.items.length === 1 ? "" : "s"}.`;
  }
}

function closeCompletion() {
  popup = null;
  list.hidden = true;
  input.removeAttribute("aria-activedescendant");
}

function renderCompletion() {
  if (!popup) return;
  list.innerHTML = "";
  popup.result.items.slice(0, 100).forEach((item, i) => {
    const li = document.createElement("li");
    li.id = `cmp-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === popup!.selected));
    li.innerHTML = `<span class="kind" aria-hidden="true">${KIND_MARK[item.kind]}</span><span class="label">${escapeHtml(item.label)}</span><span class="detail">${escapeHtml(item.detail ?? "")}</span>`;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      accept(i);
    });
    list.append(li);
  });
  input.setAttribute("aria-activedescendant", `cmp-${popup.selected}`);

  const mark = document.getElementById("caret-mark");
  const box = editor.getBoundingClientRect();
  if (mark) {
    const r = mark.getBoundingClientRect();
    const left = Math.min(r.left - box.left, Math.max(0, box.width - 280));
    list.style.left = `${Math.max(8, left)}px`;
    list.style.top = `${r.bottom - box.top + 4}px`;
  }
  list.hidden = false;
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function accept(i: number) {
  if (!popup) return;
  const { result } = popup;
  const item = result.items[i];
  if (!item) return;
  replace(result.from, result.to, item.insert, item.caret);
  closeCompletion();
  if (item.reopen) openCompletion(false);
}

/** Replaces a range, keeping the browser's undo history where it can. */
function replace(from: number, to: number, text: string, caret?: number) {
  input.focus();
  input.setSelectionRange(from, to);
  if (!document.execCommand("insertText", false, text)) {
    input.setRangeText(text, from, to, "end");
  }
  const at = from + (caret ?? text.length);
  input.setSelectionRange(at, at);
  update();
}

function applyFix(d: Diagnostic) {
  if (!d.fix) return;
  // Apply from the end so earlier offsets stay valid.
  const edits = [...d.fix.edits].sort((a, b) => b.from - a.from);
  let src = input.value;
  for (const e of edits) src = src.slice(0, e.from) + e.insert + src.slice(e.to);
  replace(0, input.value.length, src);
}

// ---- events ----

input.addEventListener("input", (e) => {
  update();
  const typed = (e as InputEvent).data ?? "";
  if ((e as InputEvent).inputType?.startsWith("delete")) {
    if (popup) openCompletion(false);
    return;
  }
  if (/[\[\w(:'"= ]/.test(typed) || popup) openCompletion(false);
});

input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === " ") {
    e.preventDefault();
    openCompletion(true);
    return;
  }
  if (!popup) return;
  const n = Math.min(popup.result.items.length, 100);
  if (e.key === "ArrowDown") {
    popup.selected = (popup.selected + 1) % n;
  } else if (e.key === "ArrowUp") {
    popup.selected = (popup.selected - 1 + n) % n;
  } else if (e.key === "Enter" || e.key === "Tab") {
    accept(popup.selected);
  } else if (e.key === "Escape") {
    closeCompletion();
  } else {
    return;
  }
  e.preventDefault();
  renderCompletion();
});

for (const ev of ["click", "keyup", "select"]) {
  input.addEventListener(ev, (e) => {
    if (e.type === "keyup" && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes((e as KeyboardEvent).key) && popup) return;
    if (e.type === "click") closeCompletion();
    renderHighlight();
    renderSignature();
    renderInspect();
  });
}
input.addEventListener("blur", () => setTimeout(closeCompletion, 100));
contextSel.addEventListener("change", update);

EXAMPLES.forEach((ex, i) => exampleSel.add(new Option(ex.label, String(i))));
exampleSel.addEventListener("change", () => {
  const ex = EXAMPLES[Number(exampleSel.value)]!;
  contextSel.value = ex.context;
  input.value = ex.src;
  input.focus();
  input.setSelectionRange(ex.src.length, ex.src.length);
  closeCompletion();
  update();
});

// Field list, grouped by form; clicking inserts a reference at the cursor.
const byForm = new Map<string, typeof moodStudy.fields>();
for (const f of moodStudy.fields) byForm.set(f.form, [...(byForm.get(f.form) ?? []), f]);
const fieldsEl = $<HTMLDivElement>("fields");
for (const [form, fields] of byForm) {
  const group = document.createElement("div");
  group.innerHTML = `<div class="form">${escapeHtml(form)}</div>`;
  const row = document.createElement("div");
  row.className = "list";
  for (const f of fields) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = f.name;
    b.title = `${describeType(f)} · ${f.label ?? ""}`;
    b.addEventListener("click", () => {
      const ref = f.type === "checkbox" ? `[${f.name}(` : `[${f.name}]`;
      replace(input.selectionStart, input.selectionEnd, ref);
      if (f.type === "checkbox") openCompletion(false);
    });
    row.append(b);
  }
  group.append(row);
  fieldsEl.append(group);
}

const first = EXAMPLES[0]!;
contextSel.value = first.context;
input.value = first.src;
update();
