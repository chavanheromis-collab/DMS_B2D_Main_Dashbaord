// ---------------------------------------------------------------------
// A pivot whose rows change with the page
// ---------------------------------------------------------------------
// A pivot's row axis is the question it answers. "Sales by branch" and
// "sales by salesman" are the same table with one column swapped, and
// until now that meant two widgets side by side -- or one widget and a
// trip to the admin panel every time somebody wanted the other view.
//
// So the row axis can be a RULE rather than a setting: "while the
// Region chips are in use, group by salesman; otherwise by branch". The
// admin writes the rules, the reader works the controls they already
// have, and the table re-asks itself.
//
// Three decisions, and the first is the one that keeps this honest:
//
//   THE ADMIN OWNS THE RULES, THE READER OWNS THE CONTROLS. Nobody
//   using the page picks a grouping from a menu of columns -- that is a
//   pivot builder, and a dashboard that turns into one stops being a
//   dashboard. What the reader does is press the buttons that were
//   already there; the grouping follows.
//
//   FIRST MATCH WINS, and the fallback is what the widget already had.
//   A rule list that matches nothing has to leave the table exactly as
//   it was configured, or every pivot on the page breaks the moment
//   somebody writes a rule that is wrong.
//
//   A RULE SAYS SO ON THE CARD. A table that regroups itself silently
//   is a table somebody reads wrong: the same shape, different meaning.
//   The caption names the grouping in force.

import { controlIsActive } from './widgetControls.js'

/** Where the list lives on the widget. */
export const ROW_RULES = 'rowRules'

/** Past this it is a program, not a setting. */
export const MAX_ROW_RULES = 8

/**
 * What a condition can ask about a control.
 *
 * Deliberately small, and every one of them answerable for EVERY kind
 * of control. A test that only means something on a dropdown would have
 * to be hidden for the other nine kinds, and a condition editor that
 * changes shape per control is one nobody can scan.
 */
export const ROW_TESTS = [
  { value: 'on', label: 'is in use', needsValue: false, hint: 'The control is doing something — any value, any chips, the button pressed.' },
  { value: 'off', label: 'is not in use', needsValue: false, hint: 'Left alone.' },
  { value: 'is', label: 'is', needsValue: true, hint: 'Its value is exactly this.' },
  { value: 'not', label: 'is not', needsValue: true, hint: 'Its value is anything but this.' },
  { value: 'has', label: 'includes', needsValue: true, hint: 'One of the chosen values is this. For chips, where there are several.' },
]

export const TEST_VALUES = ROW_TESTS.map((t) => t.value)

export const testNeedsValue = (test) => ROW_TESTS.find((t) => t.value === test)?.needsValue === true

export function newRowRule() {
  return {
    id: `rr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    columns: [],
    match: 'all',
    when: [],
  }
}

export function newRowCondition() {
  return { control: '', test: 'on', value: '' }
}

/** The rules an admin has written, repaired on the way in. */
export function rowRulesOf(widget) {
  const list = widget?.[ROW_RULES]
  if (!Array.isArray(list)) return []
  return list
    .filter((rule) => rule && typeof rule === 'object')
    .slice(0, MAX_ROW_RULES)
    .map((rule) => ({
      id: String(rule.id || ''),
      label: String(rule.label || ''),
      // `Array.isArray`, not `|| []`. A field holding a STRING is
      // truthy and has no `.filter`, so the shorthand would throw --
      // and a document somebody edited by hand would take the whole
      // page down rather than losing one rule.
      columns: (Array.isArray(rule.columns) ? rule.columns : []).filter(Boolean).map(String),
      match: rule.match === 'any' ? 'any' : 'all',
      when: (Array.isArray(rule.when) ? rule.when : [])
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          control: String(c.control || ''),
          test: TEST_VALUES.includes(c.test) ? c.test : 'on',
          value: String(c.value ?? ''),
        })),
    }))
}

/** The row axis the widget was configured with, before any rule. */
export function defaultRowColumns(widget) {
  return widget?.rowColumns?.length ? widget.rowColumns : [widget?.rowColumn].filter(Boolean)
}

/**
 * One control's value, from wherever it lives.
 *
 * A page's controls and a widget's own controls are two maps that never
 * share an id, so a rule can name either without saying which -- and
 * the admin writing it does not have to remember where they put the
 * control.
 *
 * A BUTTON is the exception worth naming. It has no value of its own;
 * it is on or off, and "on" lives in a list of active ids somewhere
 * else entirely. Reading it here means a rule can say "while the
 * Overdue button is pressed" in the same breath as "while Region is
 * West", which is the whole point of one condition list.
 */
export function controlValue(id, { values = {}, buttons = [] } = {}) {
  if (!id) return undefined
  if ((buttons || []).includes(id)) return true
  return values?.[id]
}

/**
 * Does one condition hold?
 *
 * `control` is the control's own shape, used only to answer "is this in
 * use" -- which means something different for chips, a slider and a
 * button. When the control cannot be found, the condition is FALSE
 * rather than ignored: a rule about a control somebody deleted must not
 * quietly start matching everything.
 */
export function conditionHolds(condition, { values, buttons, byId = {} } = {}) {
  const id = condition?.control
  if (!id) return false
  const control = byId[id]
  if (!control) return false

  const value = controlValue(id, { values, buttons })
  const test = TEST_VALUES.includes(condition.test) ? condition.test : 'on'
  const wanted = String(condition.value ?? '').trim()

  switch (test) {
    case 'on':
      return controlIsActive(control, value)
    case 'off':
      return !controlIsActive(control, value)
    case 'is':
      return sameValue(value, wanted)
    case 'not':
      return !sameValue(value, wanted)
    case 'has':
      return Array.isArray(value)
        ? value.map(String).includes(wanted)
        : sameValue(value, wanted)
    default:
      return false
  }
}

/** Loose equality, because a control's value is text and a number is not. */
function sameValue(value, wanted) {
  if (Array.isArray(value)) return value.map(String).includes(wanted)
  if (value === true) return wanted === 'true' || wanted === ''
  return String(value ?? '').trim() === wanted
}

/**
 * Does a whole rule hold?
 *
 * A rule with no conditions never fires. That is not an oversight: a
 * half-written rule is one somebody is in the middle of typing, and
 * "matches everything" is the worst possible reading of an empty list
 * -- it would take over the table the moment the first row appeared in
 * the editor.
 */
export function ruleHolds(rule, state) {
  const when = (rule?.when || []).filter((c) => c?.control)
  if (when.length === 0) return false
  if ((rule?.columns || []).length === 0) return false
  return rule.match === 'any'
    ? when.some((c) => conditionHolds(c, state))
    : when.every((c) => conditionHolds(c, state))
}

/** The first rule in force, or null. */
export function activeRowRule(widget, state) {
  return rowRulesOf(widget).find((rule) => ruleHolds(rule, state)) || null
}

/**
 * The row axis to actually group by.
 *
 * Falls back to what the widget was configured with, always. A rule
 * list that matches nothing leaves the table exactly as it was.
 */
export function rowColumnsFor(widget, state) {
  const rule = activeRowRule(widget, state)
  return rule ? rule.columns : defaultRowColumns(widget)
}

/** What the card says it is grouped by, when a rule has changed it. */
export function ruleNote(rule) {
  if (!rule) return ''
  return rule.label?.trim() || `by ${rule.columns.join(' › ')}`
}

/**
 * Why this rule cannot fire yet, or ''.
 *
 * Shown in the editor next to the rule rather than discovered on the
 * page, where the only symptom is a table that never changes.
 */
export function ruleProblem(rule, byId = {}) {
  if (!rule) return ''
  if ((rule.columns || []).length === 0) return 'Pick what to group by'
  const when = (rule.when || []).filter((c) => c?.control)
  if (when.length === 0) return 'Add a condition, or this rule never fires'
  const missing = when.find((c) => !byId[c.control])
  if (missing) return 'One condition names a control that is no longer on the page'
  const blank = when.find((c) => testNeedsValue(c.test) && String(c.value ?? '').trim() === '')
  if (blank) return 'One condition needs a value to compare with'
  return ''
}
