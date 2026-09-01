// ---------------------------------------------------------------------
// A column that is a dropdown, filled from another tab
// ---------------------------------------------------------------------
// An editable cell is a free-text box, which is right for a note and wrong
// for a status. Typed by hand, "Delivered", "delivered" and "Deliverd" are
// three statuses, and the chart counting them says so.
//
// So an admin can point a column at a LIST that lives somewhere else -- a
// Salesmen tab, a Status tab, a Branches tab -- and the cell becomes a
// dropdown of whatever is in that column today. Add a salesman to the sheet
// and he is in the dropdown; nobody edits the dashboard.
//
// Two decisions worth stating:
//
//   THE LIST IS A TAB, NOT A SETTING. Typing the options into the widget
//   editor would mean maintaining the same list in two places, and the
//   spreadsheet is where the business already keeps it.
//
//   THE CURRENT VALUE IS ALWAYS OFFERED. A cell holding something the list
//   no longer contains -- a salesman who left, a status since renamed --
//   must still show what it says. A dropdown that silently cannot represent
//   its own cell is a dropdown that blanks the cell the moment somebody
//   opens it.
//
// The source tab is stored under the key `tab`, which is not decoration:
// Dashboard rewrites every `tab` field from a ref to a display label before
// the widgets see it (see lib/refs.js), so naming it anything else would
// mean this one lookup silently failing on a multi-source page.
//
// Pure: config and rows in, options out.

/** How many options a dropdown can offer before it stops being one. */
export const MAX_OPTIONS = 500

/** The choices an admin has configured on this table. */
export function choicesOf(widget) {
  return Array.isArray(widget?.columnChoices) ? widget.columnChoices : []
}

/** Is this one usable, or half-filled-in? */
export function choiceIsComplete(choice) {
  return Boolean(choice?.column && choice?.tab && choice?.valueColumn)
}

/**
 * `{ [column]: choice }`, for the columns that are actually set up.
 *
 * Later entries win, so a column configured twice behaves as the one the
 * admin edited last rather than as whichever the loop happened to see
 * first.
 */
export function choiceMap(widget) {
  const out = {}
  for (const choice of choicesOf(widget)) {
    if (choiceIsComplete(choice)) out[choice.column] = choice
  }
  return out
}

/**
 * The distinct values in one column of some rows.
 *
 * Trimmed and de-duplicated case-insensitively -- a source tab with both
 * "Nashik" and "nashik " in it is one place, and offering both is offering
 * somebody the chance to split the data again. The FIRST spelling wins,
 * because that is the one the sheet's own list put first.
 */
export function optionsFrom(rows, column, limit = MAX_OPTIONS) {
  // No guard for a blank `column`: `row[undefined]` is undefined, which the
  // loop already skips, so an early return would be a line nothing can
  // reach and nothing can break.
  const seen = new Set()
  const out = []
  for (const row of rows || []) {
    const value = String(row?.[column] ?? '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= limit) break
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/**
 * Every dropdown this table needs: `{ [column]: string[] }`.
 *
 * `rowsByTab` is keyed by the same labels the widget's own `tab` fields
 * carry by the time it is rendered, so this is looked up exactly the way
 * every other cross-tab feature looks things up.
 */
export function buildChoices(widget, rowsByTab = {}) {
  const out = {}
  for (const [column, choice] of Object.entries(choiceMap(widget))) {
    // `|| {}` as well as the default: a default parameter only fires for
    // `undefined`, and a caller with nothing loaded yet passes null.
    out[column] = optionsFrom((rowsByTab || {})[choice.tab] || [], choice.valueColumn)
  }
  return out
}

/**
 * What one cell may be set to.
 *
 * The list, plus whatever the cell already holds if the list has lost it.
 * The odd one out is put FIRST rather than sorted into the middle, because
 * somebody opening the dropdown needs to see that the current value is not
 * one of the offered ones.
 */
export function optionsForCell(options, current) {
  const list = Array.isArray(options) ? options : []
  const value = String(current ?? '').trim()
  if (!value) return list
  const known = list.some((o) => o.toLowerCase() === value.toLowerCase())
  return known ? list : [value, ...list]
}

/** Is this cell's current value missing from the list it is chosen from? */
export function isStrayValue(options, current) {
  const value = String(current ?? '').trim()
  if (!value) return false
  return !(Array.isArray(options) ? options : []).some((o) => o.toLowerCase() === value.toLowerCase())
}

/**
 * Why this choice cannot be saved, or '' if it can.
 *
 * Said in the editor, at the moment it is set up -- a dropdown that turns
 * out to be empty is discovered by whoever tries to use the table, which is
 * a week later and somebody else.
 */
export function choiceProblem(choice, columns = [], sourceColumns = []) {
  if (!choice?.column) return 'Pick the column this applies to'
  if (columns.length && !columns.includes(choice.column)) return `${choice.column} is not on this table`
  if (!choice.tab) return 'Pick the tab the values come from'
  if (!choice.valueColumn) return 'Pick the column to read the values from'
  if (sourceColumns.length && !sourceColumns.includes(choice.valueColumn)) {
    return `${choice.valueColumn} is not on that tab`
  }
  return ''
}

/** A new, empty choice for the editor to fill in. */
export function blankChoice(column = '') {
  return { column, tab: '', valueColumn: '' }
}
