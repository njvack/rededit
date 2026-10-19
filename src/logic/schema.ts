// The slice of a REDCap project that logic checking needs: fields with
// their types and choices, and events with the forms assigned to them.

import type { ValueType } from "./catalog.ts";

export type FieldType =
  | "text"
  | "notes"
  | "calc"
  | "dropdown"
  | "radio"
  | "checkbox"
  | "yesno"
  | "truefalse"
  | "file"
  | "slider"
  | "descriptive"
  | "sql";

export interface Choice {
  code: string;
  label: string;
}

export interface FieldDef {
  name: string;
  form: string;
  type: FieldType;
  label?: string;
  /** Text Validation Type column, e.g. "date_mdy" or "integer". */
  validation?: string;
  choices?: Choice[];
  annotation?: string;
}

export interface EventDef {
  name: string;
  label?: string;
  forms: string[];
}

export interface Schema {
  fields: FieldDef[];
  /** Present only for longitudinal projects. */
  events?: EventDef[];
}

const YESNO: Choice[] = [
  { code: "1", label: "Yes" },
  { code: "0", label: "No" },
];
const TRUEFALSE: Choice[] = [
  { code: "1", label: "True" },
  { code: "0", label: "False" },
];

export class SchemaIndex {
  readonly fields: ReadonlyMap<string, FieldDef>;
  readonly events: ReadonlyMap<string, EventDef>;
  readonly longitudinal: boolean;
  readonly schema: Schema;

  constructor(schema: Schema) {
    this.schema = schema;
    this.fields = new Map(schema.fields.map((f) => [f.name, f]));
    this.events = new Map((schema.events ?? []).map((e) => [e.name, e]));
    this.longitudinal = (schema.events?.length ?? 0) > 0;
  }

  static from(s: Schema | SchemaIndex): SchemaIndex {
    return s instanceof SchemaIndex ? s : new SchemaIndex(s);
  }
}

/** Choices a field's value can take, including the implicit ones for yes/no and true/false. */
export function choicesOf(f: FieldDef): Choice[] | undefined {
  if (f.type === "yesno") return YESNO;
  if (f.type === "truefalse") return TRUEFALSE;
  if (f.type === "radio" || f.type === "dropdown" || f.type === "checkbox") return f.choices ?? [];
  return undefined;
}

export function isCalcText(f: FieldDef): boolean {
  return /@CALCTEXT\s*\(/i.test(f.annotation ?? "");
}

/** Date part order of a date or datetime validation, or undefined for anything else. */
export function dateOrder(f: FieldDef): "ymd" | "mdy" | "dmy" | undefined {
  const m = /^(?:date|datetime|datetime_seconds)_(ymd|mdy|dmy)$/.exec(f.validation ?? "");
  return m ? (m[1] as "ymd" | "mdy" | "dmy") : undefined;
}

/** What logic sees when it reads this field (without a checkbox code). */
export function valueTypeOf(f: FieldDef): ValueType {
  switch (f.type) {
    case "calc":
    case "slider":
      return "number";
    case "radio":
    case "dropdown":
    case "yesno":
    case "truefalse": {
      const codes = choicesOf(f) ?? [];
      return codes.length > 0 && codes.every((c) => /^-?\d+(\.\d+)?$/.test(c.code)) ? "number" : "string";
    }
    case "checkbox":
      return "any";
    case "text": {
      const v = f.validation ?? "";
      if (/^(integer|number)/.test(v)) return "number";
      if (/^date_/.test(v)) return "date";
      if (/^datetime_/.test(v)) return "datetime";
      if (/^time/.test(v)) return "time";
      return isCalcText(f) ? "any" : "string";
    }
    default:
      return "string";
  }
}

/** A short human description of a field's type, for hovers and completion details. */
export function describeType(f: FieldDef): string {
  const v = f.validation;
  switch (f.type) {
    case "text": {
      if (isCalcText(f)) return "Text · @CALCTEXT";
      const order = dateOrder(f);
      if (order) return `${v!.startsWith("date_") ? "Date" : "Date and time"} · shown ${order.toUpperCase().split("").join("-")}`;
      if (v === "integer") return "Text · integer";
      if (v?.startsWith("number")) return "Text · number";
      if (v) return `Text · ${v}`;
      return "Text";
    }
    case "notes":
      return "Notes";
    case "calc":
      return "Calculated";
    case "dropdown":
      return "Dropdown";
    case "radio":
      return "Radio";
    case "checkbox":
      return "Checkbox";
    case "yesno":
      return "Yes / No";
    case "truefalse":
      return "True / False";
    case "file":
      return v === "signature" ? "Signature" : "File upload";
    case "slider":
      return "Slider";
    case "descriptive":
      return "Descriptive text";
    case "sql":
      return "SQL dropdown";
  }
}
