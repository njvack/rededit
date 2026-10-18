// A made-up longitudinal project used by the demo and the tests.

import type { Choice, FieldDef, Schema } from "../src/logic/index.ts";

const phqChoices: Choice[] = [
  { code: "0", label: "Not at all" },
  { code: "1", label: "Several days" },
  { code: "2", label: "More than half the days" },
  { code: "3", label: "Nearly every day" },
];

const phqItems = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself",
  "Trouble concentrating on things",
  "Moving or speaking slowly, or being fidgety or restless",
  "Thoughts that you would be better off dead",
];

const fields: FieldDef[] = [
  { name: "record_id", form: "enrollment", type: "text", label: "Record ID" },
  { name: "consent_date", form: "enrollment", type: "text", validation: "date_mdy", label: "Date of consent" },
  { name: "dob", form: "enrollment", type: "text", validation: "date_ymd", label: "Date of birth" },
  { name: "age", form: "enrollment", type: "calc", label: "Age at consent" },
  { name: "sex", form: "enrollment", type: "radio", label: "Sex assigned at birth", choices: [{ code: "1", label: "Female" }, { code: "2", label: "Male" }, { code: "3", label: "Intersex" }] },
  { name: "email", form: "enrollment", type: "text", validation: "email", label: "Email" },
  { name: "eligible", form: "enrollment", type: "yesno", label: "Eligible?" },
  ...phqItems.map((label, i): FieldDef => ({ name: `phq9_${i + 1}`, form: "phq9", type: "radio", label, choices: phqChoices })),
  { name: "phq9_total", form: "phq9", type: "calc", label: "PHQ-9 total score" },
  { name: "phq9_severity", form: "phq9", type: "text", label: "Severity", annotation: "@CALCTEXT(if([phq9_total] >= 20, 'severe', if([phq9_total] >= 10, 'moderate', 'mild')))" },
  { name: "phq9_safety", form: "phq9", type: "yesno", label: "Did you talk with the participant about safety?" },
  { name: "any_meds", form: "medications", type: "yesno", label: "Taking any medication for mood or anxiety?" },
  { name: "meds", form: "medications", type: "checkbox", label: "Which ones?", choices: [{ code: "1", label: "Sertraline" }, { code: "2", label: "Fluoxetine" }, { code: "3", label: "Other" }] },
  { name: "sert_dose", form: "medications", type: "text", validation: "integer", label: "Sertraline dose (mg)" },
  { name: "fluox_dose", form: "medications", type: "text", validation: "integer", label: "Fluoxetine dose (mg)" },
  { name: "med_other_name", form: "medications", type: "text", label: "Name of other medication" },
  { name: "meds_intro", form: "medications", type: "descriptive", label: "The next questions ask about side effects." },
  { name: "visit_date", form: "visit_log", type: "text", validation: "date_mdy", label: "Visit date" },
  { name: "visit_time", form: "visit_log", type: "text", validation: "time", label: "Visit start time" },
  { name: "visit_type", form: "visit_log", type: "dropdown", label: "Visit type", choices: [{ code: "inperson", label: "In person" }, { code: "remote", label: "Remote" }] },
  { name: "late_visit_reason", form: "visit_log", type: "notes", label: "Why was this visit late?" },
  { name: "visit_notes", form: "visit_log", type: "notes", label: "Notes" },
];

export const moodStudy: Schema = {
  fields,
  events: [
    { name: "baseline_arm_1", label: "Baseline", forms: ["enrollment", "phq9", "medications"] },
    { name: "week_6_arm_1", label: "Week 6", forms: ["phq9", "medications", "visit_log"] },
    { name: "week_12_arm_1", label: "Week 12", forms: ["phq9", "medications", "visit_log"] },
  ],
};
