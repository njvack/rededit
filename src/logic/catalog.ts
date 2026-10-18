// What REDCap logic knows about: functions and smart variables.
// Sources: WashU REDCap docs on special functions and smart variables
// (REDCap 14.x). Corrections from real use win over these docs.

export type ValueType = "number" | "string" | "boolean" | "date" | "datetime" | "time" | "any";

export interface FunctionDef {
  name: string;
  params: string[];
  /** Minimum and maximum argument counts; max Infinity for variadic. */
  min: number;
  max: number;
  /** Return type, or "branches" for if(), whose type comes from its branches. */
  returns: ValueType | "branches";
  doc: string;
}

const fn = (
  name: string,
  params: string[],
  min: number,
  max: number,
  returns: FunctionDef["returns"],
  doc: string,
): FunctionDef => ({ name, params, min, max, returns, doc });

const N = Infinity;

export const FUNCTIONS: readonly FunctionDef[] = [
  fn("if", ["condition", "value_if_true", "value_if_false"], 3, 3, "branches", "Returns one of two values depending on a condition."),
  fn("datediff", ["date1", "date2", "units", "signed"], 3, 5, "number", 'Difference between two dates. Units: "y", "M", "d", "h", "m", "s". Absolute unless signed is true.'),
  fn("round", ["number", "decimals"], 1, 2, "number", "Rounds to the given decimal places (default 0)."),
  fn("roundup", ["number", "decimals"], 1, 2, "number", "Rounds up to the given decimal places (default 0)."),
  fn("rounddown", ["number", "decimals"], 1, 2, "number", "Rounds down to the given decimal places (default 0)."),
  fn("sqrt", ["number"], 1, 1, "number", "Square root."),
  fn("abs", ["number"], 1, 1, "number", "Absolute value."),
  fn("exponential", ["number"], 1, 1, "number", "e raised to the given power."),
  fn("log", ["number", "base"], 1, 2, "number", "Logarithm. Natural log when base is missing."),
  fn("mod", ["dividend", "divisor"], 2, 2, "number", "Integer remainder."),
  fn("min", ["number", "..."], 1, N, "number", "Lowest value. Blanks are ignored."),
  fn("max", ["number", "..."], 1, N, "number", "Highest value. Blanks are ignored."),
  fn("mean", ["number", "..."], 1, N, "number", "Average. Blanks are ignored."),
  fn("median", ["number", "..."], 1, N, "number", "Median. Blanks are ignored."),
  fn("sum", ["number", "..."], 1, N, "number", "Total. Blanks are ignored."),
  fn("stdev", ["number", "..."], 1, N, "number", "Standard deviation. Blanks are ignored."),
  fn("isnumber", ["value"], 1, 1, "boolean", "True for integers and decimals."),
  fn("isinteger", ["value"], 1, 1, "boolean", "True for whole numbers."),
  fn("isblankormissingcode", ["value"], 1, 1, "boolean", "True for blanks and missing data codes."),
  fn("year", ["date"], 1, 1, "number", "Year of a date."),
  fn("month", ["date"], 1, 1, "number", "Month of a date."),
  fn("day", ["date"], 1, 1, "number", "Day of a date."),
  fn("contains", ["haystack", "needle"], 2, 2, "boolean", "Case-insensitive substring test."),
  fn("not_contain", ["haystack", "needle"], 2, 2, "boolean", "Opposite of contains()."),
  fn("starts_with", ["haystack", "needle"], 2, 2, "boolean", "Case-insensitive prefix test."),
  fn("ends_with", ["haystack", "needle"], 2, 2, "boolean", "Case-insensitive suffix test."),
  fn("left", ["text", "count"], 2, 2, "string", "Leftmost characters."),
  fn("right", ["text", "count"], 2, 2, "string", "Rightmost characters."),
  fn("mid", ["text", "start", "count"], 3, 3, "string", "Substring from a 1-based start position."),
  fn("length", ["text"], 1, 1, "number", "Number of characters."),
  fn("find", ["needle", "haystack"], 2, 2, "number", "Position of needle in haystack, case-insensitive; 0 if absent."),
  fn("replace_text", ["haystack", "search", "replace"], 3, 3, "string", "Case-sensitive replacement."),
  fn("concat", ["text", "..."], 1, N, "string", "Joins values."),
  fn("concat_ws", ["separator", "text", "..."], 2, N, "string", "Joins values with a separator."),
  fn("upper", ["text"], 1, 1, "string", "Uppercase."),
  fn("lower", ["text"], 1, 1, "string", "Lowercase."),
  fn("trim", ["text"], 1, 1, "string", "Removes leading and trailing spaces."),
];

export const FUNCTIONS_BY_NAME: ReadonlyMap<string, FunctionDef> = new Map(FUNCTIONS.map((f) => [f.name, f]));

export const DATEDIFF_UNITS: Readonly<Record<string, string>> = {
  y: "years",
  M: "months",
  d: "days",
  h: "hours",
  m: "minutes",
  s: "seconds",
};

export type SmartRole = "value" | "event" | "instance";

export interface SmartVarDef {
  name: string;
  /** "event" vars can prefix a field; "instance" vars can follow one. */
  role: SmartRole;
  doc: string;
}

const sv = (name: string, role: SmartRole, doc: string): SmartVarDef => ({ name, role, doc });

export const SMART_VARIABLES: readonly SmartVarDef[] = [
  sv("user-name", "value", "Username of the current user."),
  sv("user-fullname", "value", "Full name of the current user."),
  sv("user-email", "value", "Email of the current user."),
  sv("user-dag-name", "value", "Unique name of the user's DAG."),
  sv("user-dag-id", "value", "ID of the user's DAG."),
  sv("user-dag-label", "value", "Label of the user's DAG."),
  sv("user-role-id", "value", "ID of the user's role."),
  sv("user-role-name", "value", "Unique name of the user's role."),
  sv("user-role-label", "value", "Label of the user's role."),
  sv("record-name", "value", "The current record's name."),
  sv("record-dag-id", "value", "ID of the record's DAG."),
  sv("record-dag-name", "value", "Unique name of the record's DAG."),
  sv("record-dag-label", "value", "Label of the record's DAG."),
  sv("is-form", "value", "1 on a data entry form, else 0."),
  sv("is-survey", "value", "1 on a survey, else 0."),
  sv("instrument-name", "value", "Unique name of the current instrument."),
  sv("instrument-label", "value", "Label of the current instrument."),
  sv("project-id", "value", "Project ID."),
  sv("event-id", "value", "ID of the current event."),
  sv("event-number", "value", "Number of the current event."),
  sv("event-name", "event", "Unique name of the current event."),
  sv("event-label", "value", "Label of the current event."),
  sv("previous-event-name", "event", "The previous event; before a field, the closest earlier event that has it."),
  sv("previous-event-label", "value", "Label of the previous event."),
  sv("next-event-name", "event", "The next event; before a field, the closest later event that has it."),
  sv("next-event-label", "value", "Label of the next event."),
  sv("first-event-name", "event", "The first event."),
  sv("first-event-label", "value", "Label of the first event."),
  sv("last-event-name", "event", "The last event."),
  sv("last-event-label", "value", "Label of the last event."),
  sv("arm-number", "value", "Number of the current arm."),
  sv("arm-label", "value", "Label of the current arm."),
  sv("current-instance", "instance", "The current repeat instance."),
  sv("previous-instance", "instance", "The previous repeat instance."),
  sv("next-instance", "instance", "The next repeat instance."),
  sv("first-instance", "instance", "The first repeat instance."),
  sv("last-instance", "instance", "The last repeat instance."),
  sv("survey-time-started", "value", "When the survey was started."),
  sv("survey-date-started", "value", "Date the survey was started."),
  sv("survey-time-completed", "value", "When the survey was completed."),
  sv("survey-date-completed", "value", "Date the survey was completed."),
  sv("survey-duration", "value", "Time spent on the survey so far."),
  sv("survey-duration-completed", "value", "Time taken to complete the survey."),
  sv("aggregate-min", "value", "Minimum of a field across records."),
  sv("aggregate-max", "value", "Maximum of a field across records."),
  sv("aggregate-mean", "value", "Mean of a field across records."),
  sv("aggregate-median", "value", "Median of a field across records."),
  sv("aggregate-sum", "value", "Sum of a field across records."),
  sv("aggregate-count", "value", "Count of a field across records."),
  sv("aggregate-stdev", "value", "Standard deviation of a field across records."),
  sv("aggregate-unique", "value", "Count of unique values across records."),
];

export const SMART_BY_NAME: ReadonlyMap<string, SmartVarDef> = new Map(SMART_VARIABLES.map((s) => [s.name, s]));
