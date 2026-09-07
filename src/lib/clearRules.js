// ---------------------------------------------------------------------
// Fields that stop applying when a record changes state
// ---------------------------------------------------------------------
// A record that becomes Cancelled still carries its delivery date, its
// finance company and the name of whoever was going to hand over the keys.
// None of that is true any more, and every one of those cells will be read
// later by somebody who does not know it was left behind: it appears in the
// counts, in the filters, and on the sheet a manager exports on Friday.
//
// So a table can be told: when this column reaches this value, these other
// fields no longer apply -- and they are cleared on the row that changed.
//
// Four rules keep it from being a footgun, and each of them is about the
// same thing, which is that this WRITES TO THE SPREADSHEET:
//
//   IT FIRES ON AN EDIT, and only on an edit. Never on load, never on a
//   filter, never in the background. A rule added today does not go through
//   four thousand old rows tonight; it acts when somebody changes a status
//   and it acts on the row in front of them.
//
//   IT CLEARS ONLY WHAT THE EDITOR MAY EDIT. A rule naming a column this
//   person cannot write is skipped, not attempted -- the server would
//   refuse it anyway, and a failed write in the middle of a cascade is a
//   half-applied rule nobody can see.
//
//   IT CLEARS ONLY WHAT HAS SOMETHING IN IT. Writing "" over "" is a round
//   trip to Google for nothing.
//
//   IT NEVER CLEARS THE CELL THAT TRIGGERED IT. Setting Status to Cancelled
//   and having Status wiped is not a rule, it is a bug that would look like
//   a rule for about a week.
//
// The MATCH is `testCondition` -- the same one the page filters and the
// button conditions use. A second dialect of "equals" is how a rule comes
// to fire in the table and not in the filter that was meant to find it.

import { testCondition } from './filterEngine.js'
import { isBlank } from './dataUtils.js'
import { operatorMeta } from './config.js'

export function newClearRule(id) {
  return { id, column: '', operator: 'equals', value: '', value2: '', clear: [] }
}

/**
 * A rule that can actually do something.
 *
 * How many values an operator needs is the operator's own business
 * (`arity`), asked here rather than restated: a hand-written list of the
 * value-less ones is a list that will not have `today` on it the week after
 * `today` is added, and the rule would then be dropped as unfinished by the
 * one function that decides whether it runs.
 */
export function ruleIsComplete(rule) {
  if (!rule?.column) return false
  // Clearing its own condition column IS something to do, so a rule that
  // does only that is finished.
  if (!rule.clearTrigger && !(rule.clear || []).filter(Boolean).length) return false
  const { arity } = operatorMeta(rule.operator)
  if (arity >= 1 && String(rule.value ?? '').trim() === '') return false
  if (arity === 2 && String(rule.value2 ?? '').trim() === '') return false
  return true
}

/** The rules a widget carries, ignoring the half-written ones. */
export function clearRulesOf(widget) {
  return (widget?.clearRules || []).filter(ruleIsComplete)
}

/** Does this widget do anything at all on an edit? */
export function hasClearRules(widget) {
  return clearRulesOf(widget).length > 0
}

/**
 * What to clear on this row, given the edit that has just been made.
 *
 * `row` is the row as it was BEFORE the edit, so the change is applied here
 * rather than read back from state that has not caught up -- the same
 * reason a cell commits with its value passed in.
 *
 * Returns the column names, in the widget's own order, with nothing in the
 * list that is already empty, forbidden, or the cell that was just typed
 * into.
 */
export function columnsToClear(
  widget,
  row,
  { column, value, changes, editable = [], dateOrder = 'DMY' } = {}
) {
  const rules = clearRulesOf(widget)
  if (rules.length === 0 || !row) return []

  // One cell or a whole form saved at once -- the same question either
  // way. A form is not several independent edits: three fields saved
  // together have to be judged against the row as it will be with all
  // three on it, or a rule that needs two of them never fires and one that
  // needs neither fires twice.
  const edited = changes || (column ? { [column]: value } : {})
  const editedColumns = Object.keys(edited)

  // The row as it will be once this edit lands. A rule about the column
  // being edited has to see the new value, not the old one -- that is the
  // whole moment it exists for.
  const after = editedColumns.length > 0 ? { ...row, ...edited } : row

  const out = []
  for (const rule of rules) {
    if (!testCondition(after, rule, dateOrder)) continue
    // A value that is an ACTION rather than a state: "Return to PDI" is
    // not something a job stays in, it is something done to it -- reset
    // the fields that no longer hold, and put the status back to blank so
    // the job re-enters the queue. Off by default and named on the rule,
    // because a status that erases itself is astonishing anywhere it was
    // not deliberately asked for.
    const selfClears = rule.clearTrigger ? rule.column : ''
    const targets = selfClears ? [...(rule.clear || []), selfClears] : rule.clear || []
    for (const target of targets) {
      // A cell just typed into is never cleared -- unless this rule exists
      // precisely to clear it.
      if (!target || (editedColumns.includes(target) && target !== selfClears)) continue
      if (!editable.includes(target)) continue
      if (isBlank(after[target])) continue
      if (!out.includes(target)) out.push(target)
    }
  }
  return out
}

/**
 * Why this rule will not do what it looks like it does -- or null.
 *
 * Said in the editor, at the moment the rule is written, because the only
 * other way to find out is to change a status on the live sheet and watch
 * whether anything happens. `columnsToClear` skips a broken rule in
 * silence, which is right at runtime and useless at design time, so the
 * explaining lives here next to the deciding rather than in the panel.
 */
export function ruleProblem(rule, cols = []) {
  const known = (name) => cols.length === 0 || cols.includes(name)
  if (!rule?.column) return 'Pick the column that triggers this.'
  if (!known(rule.column)) return `“${rule.column}” is not a column on this tab.`

  const { arity } = operatorMeta(rule.operator)
  if (arity >= 1 && String(rule.value ?? '').trim() === '') return 'Set the value it has to match.'
  if (arity === 2 && String(rule.value2 ?? '').trim() === '') return 'Set the second value.'

  const targets = (rule.clear || []).filter(Boolean)
  if (targets.length === 0 && !rule.clearTrigger) return 'Pick at least one field to clear.'
  const missing = targets.find((t) => !known(t))
  if (missing) return `“${missing}” is not a column on this tab.`
  // Allowed, and quietly ignored -- so it has to be said, or an admin reads
  // the rule as clearing the status it is triggered by. Unless they have
  // ticked the box that makes exactly that happen, which is the one case
  // where naming it means something.
  if (!rule.clearTrigger && targets.includes(rule.column)) {
    return `“${rule.column}” triggers this rule, so it is never cleared by it.`
  }
  return null
}

/** What to tell somebody afterwards, in their own words. */
export function clearedNote(columns) {
  const list = (columns || []).filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return `Cleared ${list[0]} — it no longer applies`
  const last = list[list.length - 1]
  return `Cleared ${list.slice(0, -1).join(', ')} and ${last} — they no longer apply`
}
