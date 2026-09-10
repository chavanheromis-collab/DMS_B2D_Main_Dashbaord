// ---------------------------------------------------------------------
// Fields that cannot be left empty
// ---------------------------------------------------------------------
// The other half of the clearing rules. Those say what stops applying when
// a record changes state; this says what has to be there at all. A job with
// no salesman on it is a job nobody owns, and it is found six weeks later
// by whoever is reconciling the month.
//
// It is a rule about EDITING, not about the sheet. Nothing here goes near a
// row somebody is only reading, and nothing here goes back over the four
// thousand rows that were entered before the rule existed. It applies at
// the moment somebody is filling a form in, which is the only moment they
// can do anything about it.
//
// Three things keep it from becoming a trap, and every one of them is the
// same idea: NEVER BLOCK SOMEBODY ON A FIELD THEY CANNOT FILL.
//
//   IT BINDS ONLY WHERE THE READER MAY EDIT. A column required of everyone
//   but granted to three people would stop the other forty saving anything
//   at all, on a field they are not allowed to touch.
//
//   IT BINDS ONLY WHERE THE FIELD IS ON SCREEN. An admin who shortens the
//   detail form does not mean to lock it; a rule about a field nobody can
//   see is a Save button that refuses with no visible reason.
//
//   IT IS ONLY EVER ABOUT EMPTYING. Filling something in is always allowed,
//   and so is leaving it as it was found. What is refused is the specific
//   act of taking a value out of a field that has to have one.

import { isBlank } from './dataUtils.js'

/** Where the list lives on the widget. */
export const REQUIRED_COLUMNS = 'requiredColumns'

/** The columns an admin has marked. */
export function requiredColumnsOf(widget) {
  return (widget?.[REQUIRED_COLUMNS] || []).filter(Boolean)
}

/**
 * Does this column have to have something in it, for THIS reader?
 *
 * `editable` is their own grant. A column they cannot write cannot be
 * required of them -- there would be nothing they could do about it.
 */
export function isRequired(widget, column, editable = []) {
  if (!widget?.editable) return false
  if (!requiredColumnsOf(widget).includes(column)) return false
  return (editable || []).includes(column)
}

/** Does this table require anything this reader could actually supply? */
export function requiresAnything(widget, editable = []) {
  return requiredColumnsOf(widget).some((col) => isRequired(widget, col, editable))
}

/**
 * The required fields this row is missing, among the ones on screen.
 *
 * `columns` is what the form is showing. Anything outside it is left out:
 * a Save that refuses because of a field the admin took off the form is a
 * Save that refuses for no visible reason.
 */
export function missingRequired(widget, row, { columns = [], editable = [] } = {}) {
  if (!row) return []
  return columns.filter((col) => isRequired(widget, col, editable) && isBlank(row[col]))
}

/**
 * Which required fields a set of changes would EMPTY.
 *
 * The row as it will be, not as it is: a field that was already blank is
 * not being emptied by this edit, and refusing the edit because of it would
 * make an old record impossible to correct one field at a time.
 */
export function emptiedRequired(widget, row, changes, editable = []) {
  const out = []
  for (const [column, next] of Object.entries(changes || {})) {
    if (!isRequired(widget, column, editable)) continue
    // Already empty, and staying empty. Nothing is being taken away.
    if (isBlank(row?.[column])) continue
    if (isBlank(next)) out.push(column)
  }
  return out
}

/** The changes with the emptying ones taken back out. */
export function withoutEmptied(changes, emptied) {
  if (!emptied?.length) return changes
  const out = {}
  for (const [column, next] of Object.entries(changes || {})) {
    if (emptied.includes(column)) continue
    out[column] = next
  }
  return out
}

/** Said when a save is being held back. */
export function missingNote(columns) {
  const list = (columns || []).filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return `${list[0]} is required`
  const last = list[list.length - 1]
  return `${list.slice(0, -1).join(', ')} and ${last} are required`
}

/** Said when something was kept that would otherwise have gone. */
export function keptNote(columns) {
  const list = (columns || []).filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return `${list[0]} was kept — it cannot be left empty`
  const last = list[list.length - 1]
  return `${list.slice(0, -1).join(', ')} and ${last} were kept — they cannot be left empty`
}
