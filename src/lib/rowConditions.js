import { matchesConditions } from './filterEngine.js'

// ---------------------------------------------------------------------
// "Only the rows where..." -- on anything
// ---------------------------------------------------------------------
// A few widgets could already be told to count only some rows: a KPI, a
// gauge, a leaderboard, a pipeline stage. Each of them applied its own
// conditions in its own component, in its own field, at its own point in
// the chain -- so the same sentence meant four slightly different things
// and the other eleven widgets could not say it at all.
//
// This is that sentence, once, for every widget and every control. It runs
// in ONE place (the page, where a widget's rows are assembled) rather than
// inside fifteen components, which is what makes it available to all of
// them without any of them learning anything.
//
// It is a separate field from the `conditions` a KPI already had. Reusing
// that name would have applied the old rule twice on the widgets that have
// it -- once in the component and once here -- and a filter that silently
// runs twice is only harmless while every operator is idempotent.
//
// Pure: rows in, rows out.

/** Where a widget's rule is written, and where a control's is. */
export const ROW_CONDITIONS = 'rowConditions'
export const ROW_MATCH = 'rowMatch'

/**
 * The conditions that can actually be evaluated against one tab's rows.
 *
 * A condition naming a different tab is dropped rather than failed: rows of
 * one tab cannot answer a question about another, and treating an
 * unanswerable question as "no" would empty the widget.
 */
export function usableConditions(owner, tab) {
  return (owner?.[ROW_CONDITIONS] || []).filter((c) => c?.column && (!c.tab || !tab || c.tab === tab))
}

/** Has anybody written a rule here? */
export function hasRowConditions(owner) {
  return (owner?.[ROW_CONDITIONS] || []).some((c) => c?.column)
}

/** How many, for a section button that has to say so without being opened. */
export function conditionCount(owner) {
  return (owner?.[ROW_CONDITIONS] || []).filter((c) => c?.column).length
}

/**
 * Rows, narrowed by the owner's own rule.
 *
 * No rule means the rows exactly as they came -- not a copy, not a filtered
 * clone: the same array, so a widget nobody has written a rule for costs
 * nothing at all.
 */
export function applyRowConditions(rows, owner, tab, dateOrder = 'DMY') {
  const conds = usableConditions(owner, tab)
  if (conds.length === 0) return rows || []
  const match = owner?.[ROW_MATCH] === 'any' ? 'any' : 'all'
  return (rows || []).filter((row) => matchesConditions(row, conds, match, dateOrder))
}

/** A blank condition to add, already pointed at the tab it will be read on. */
export function emptyRowCondition(tab) {
  return { tab: tab || '', column: '', operator: 'is_not_empty', value: '', value2: '' }
}
