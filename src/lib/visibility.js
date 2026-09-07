// ---------------------------------------------------------------------
// "Only show this when..."
// ---------------------------------------------------------------------
// A page that shows everything at once shows most of it to nobody. The
// overdue-jobs table matters on the days there are overdue jobs; the
// branch comparison matters once somebody has picked two branches; the
// finance panel matters to the person who pressed the Finance button. The
// rest of the time each of them is a card taking up a screen and teaching
// the reader to scroll past that part of the page.
//
// So anything on the canvas -- a widget, a filter, a button -- can be told
// when it is worth showing. Two kinds of question, because there are two
// kinds of answer people actually want:
//
//   THE DATA. "Only when some row is overdue." Asked of the rows the
//   widget would have drawn, AFTER the page filters, so a table hidden
//   because nothing is overdue reappears the moment somebody filters to a
//   branch where something is.
//
//   THE CONTROLS. "Only when the Branch filter is set", or set to
//   something in particular, or only while a button is on. This is what
//   makes a page that unfolds: three widgets that appear once you have
//   said what you are looking at, rather than nine that are all there
//   before you have said anything.
//
// Two rules hold the whole thing together:
//
//   NOTHING WRITTEN MEANS NOTHING HIDDEN. Every unanswered question is
//   "yes". A half-configured rule that blanked a widget would be
//   indistinguishable from a broken page, and the person who could fix it
//   is the one who can no longer see the widget to click it.
//
//   IT HIDES, IT DOES NOT FILTER. An invisible widget reads no rows and
//   costs nothing, but it also changes no totals anywhere else -- hiding
//   the overdue table does not remove overdue jobs from the KPI beside it.
//   Whoever wants that wants a filter, and the page already has those.

import { filterIsActive, matchesConditions } from './filterEngine.js'

export const VISIBILITY_MODES = [
  { value: 'always', label: 'Always show it' },
  { value: 'rows', label: 'Only when the data says so' },
  { value: 'control', label: 'Only when a filter or button is set' },
]

/** Where the rule lives, on a widget and on a control alike. */
export const VISIBLE_WHEN = 'visibleWhen'

/** The rule, filled out, whatever shape it was left in. */
export function visibilityOf(item) {
  const rule = item?.[VISIBLE_WHEN] || {}
  const mode = rule.mode === 'rows' || rule.mode === 'control' ? rule.mode : 'always'
  return {
    mode,
    // "Show it when" flipped to "hide it when" -- the same sentence, and
    // half the rules people want are the negative one.
    invert: Boolean(rule.invert),
    conditions: rule.conditions || [],
    match: rule.match === 'any' ? 'any' : 'all',
    filterIds: (rule.filterIds || []).filter(Boolean),
    buttonIds: (rule.buttonIds || []).filter(Boolean),
    // filterId -> the values that count. Absent or empty means "set to
    // anything at all".
    values: rule.values || {},
    need: rule.need === 'all' ? 'all' : 'any',
  }
}

/** A blank rule, to start from. */
export function emptyVisibility() {
  return { mode: 'always', invert: false, conditions: [], match: 'all', filterIds: [], buttonIds: [], values: {}, need: 'any' }
}

/** Is anything actually being asked here? */
export function visibilityIsSet(item) {
  const rule = visibilityOf(item)
  if (rule.mode === 'always') return false
  if (rule.mode === 'rows') return rule.conditions.some((c) => c?.column)
  return rule.filterIds.length > 0 || rule.buttonIds.length > 0
}

/** How many tests it makes, for a section button that must say so unopened. */
export function visibilityCount(item) {
  const rule = visibilityOf(item)
  if (rule.mode === 'rows') return rule.conditions.filter((c) => c?.column).length
  if (rule.mode === 'control') return rule.filterIds.length + rule.buttonIds.length
  return 0
}

/**
 * The discrete values a control is currently set to.
 *
 * A range -- a date span, a number between two ends -- has no discrete
 * values to compare against, so it answers with none and falls back to
 * "is it set at all", which is the only question that means anything
 * about a range.
 */
export function chosenValues(value) {
  if (Array.isArray(value)) return value.map((v) => String(v))
  if (value === null || value === undefined || value === '') return []
  if (typeof value === 'object') return []
  return [String(value)]
}

function dataSays(rule, rows, dateOrder) {
  const conds = rule.conditions.filter((c) => c?.column)
  if (conds.length === 0) return true
  return (rows || []).some((row) => matchesConditions(row, conds, rule.match, dateOrder))
}

function controlsSay(rule, { filters = [], values = {}, activeButtonIds = [] }) {
  const answers = []

  for (const id of rule.filterIds) {
    const filter = filters.find((f) => f?.id === id)
    // A filter that has been deleted since the rule was written cannot be
    // set, so it answers no -- and the editor says so, rather than the
    // widget silently never appearing again.
    if (!filter) {
      answers.push(false)
      continue
    }
    const wanted = (rule.values[id] || []).filter(Boolean)
    if (wanted.length === 0) {
      answers.push(filterIsActive(filter, values[id]))
      continue
    }
    const chosen = chosenValues(values[id])
    answers.push(chosen.some((v) => wanted.includes(v)))
  }

  for (const id of rule.buttonIds) answers.push(activeButtonIds.includes(id))

  if (answers.length === 0) return true
  return rule.need === 'all' ? answers.every(Boolean) : answers.some(Boolean)
}

/**
 * Should this be on the page right now?
 *
 * `rows` are the rows this item would have drawn, already narrowed by the
 * page filters -- so "only when something is overdue" is answered about
 * what the reader is actually looking at, not about the whole sheet.
 */
export function isVisible(item, { rows, filters, values, activeButtonIds, dateOrder = 'DMY' } = {}) {
  const rule = visibilityOf(item)
  if (rule.mode === 'always') return true
  const met =
    rule.mode === 'rows'
      ? dataSays(rule, rows, dateOrder)
      : controlsSay(rule, { filters, values, activeButtonIds })
  return rule.invert ? !met : met
}

/**
 * Everything an editor needs to warn about -- or null.
 *
 * A rule that can never be true is worse than no rule: the thing it
 * governs is simply gone, and the only way to find out why is to remember
 * that this panel exists.
 */
export function visibilityProblem(item, { filters = [], buttons = [] } = {}) {
  const rule = visibilityOf(item)
  if (rule.mode === 'always') return null

  if (rule.mode === 'rows') {
    if (!rule.conditions.some((c) => c?.column)) return 'Add a condition, or it will always be shown.'
    return null
  }

  if (rule.filterIds.length === 0 && rule.buttonIds.length === 0) {
    return 'Pick a filter or a button, or it will always be shown.'
  }
  const missingFilter = rule.filterIds.find((id) => !filters.some((f) => f?.id === id))
  if (missingFilter) return 'One of the filters it waits for has been deleted, so it will never appear.'
  const missingButton = rule.buttonIds.find((id) => !buttons.some((b) => b?.id === id))
  if (missingButton) return 'One of the buttons it waits for has been deleted, so it will never appear.'
  return null
}

/** Plain English, for the line under the editor. */
export function visibilitySummary(item, { filters = [], buttons = [] } = {}) {
  const rule = visibilityOf(item)
  if (rule.mode === 'always') return 'Always on the page.'

  const verb = rule.invert ? 'Hidden' : 'Shown'
  if (rule.mode === 'rows') {
    const n = rule.conditions.filter((c) => c?.column).length
    if (n === 0) return 'Always on the page.'
    const how = rule.match === 'any' ? 'any of' : 'all of'
    return `${verb} when a row matches ${how} ${n} condition${n === 1 ? '' : 's'}.`
  }

  const names = [
    ...rule.filterIds.map((id) => filters.find((f) => f?.id === id)?.label || 'a deleted filter'),
    ...rule.buttonIds.map((id) => buttons.find((b) => b?.id === id)?.label || 'a deleted button'),
  ]
  if (names.length === 0) return 'Always on the page.'
  const join = rule.need === 'all' ? ' and ' : ' or '
  return `${verb} when ${names.join(join)} ${names.length === 1 ? 'is' : 'are'} set.`
}
