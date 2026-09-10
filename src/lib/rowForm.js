// ---------------------------------------------------------------------
// A form is filled in, and then saved
// ---------------------------------------------------------------------
// The detail panel used to write every field the moment it lost focus.
// That is right for a cell in a grid, where the gesture is "change this
// one thing", and wrong for a form, where the gesture is "go through this
// record and put it right". Field-at-a-time meant six writes and six full
// page reloads to correct six fields, no way to change your mind about the
// third one, and a rule firing on a half-corrected row -- clearing a
// delivery date because the status had been updated but the new date had
// not been typed yet.
//
// So the panel holds the changes and sends them together. What that needs
// is a draft: the fields somebody has touched, kept apart from the row
// underneath so that
//
//   the row can keep moving. It is re-read live from the sheet (see
//   lib/openRow.js), and somebody else's edit to a field this person has
//   not touched should still appear;
//
//   and a field can be drafted back to what it already was. `'' vs
//   undefined` is a real distinction here -- "emptied" is a change,
//   "untouched" is not, and a draft holding `''` for both cannot tell them
//   apart.

/** Nothing typed yet. */
export const NO_DRAFT = {}

/** The value a field should SHOW: the draft if it has one, else the sheet. */
export function fieldValue(row, draft, column) {
  if (draft && Object.prototype.hasOwnProperty.call(draft, column)) return draft[column]
  return row?.[column] ?? ''
}

/** Note a field as typed into. */
export function draftField(draft, column, value) {
  return { ...(draft || {}), [column]: value }
}

/**
 * What has actually MOVED, against the row as it stands now.
 *
 * A field typed back to its original value is not a change, and neither is
 * one somebody else has meanwhile saved the same value into. Both would
 * otherwise be written for nothing -- and each write is a round trip and a
 * rule evaluation.
 */
export function changedFields(row, draft) {
  const out = {}
  for (const [column, value] of Object.entries(draft || {})) {
    if (value === (row?.[column] ?? '')) continue
    out[column] = value
  }
  return out
}

/** How many fields are waiting to be saved. */
export function changeCount(row, draft) {
  return Object.keys(changedFields(row, draft)).length
}

export function hasChanges(row, draft) {
  return changeCount(row, draft) > 0
}

/**
 * Empty every field this person is allowed to edit.
 *
 * Drafted, not written: it fills the form with blanks and leaves Save to
 * be pressed, so a mis-click is undone by closing the panel rather than by
 * retyping a record. Fields that are already empty are left out, since
 * "clear" has nothing to say about them and including them would make the
 * unsaved count claim work that does not exist.
 *
 * Only what is BOTH on the form and editable by this reader: clearing a
 * column somebody cannot write would be refused by the server, and
 * clearing one that is not on screen would be a change nobody could see
 * before pressing Save.
 */
export function clearedDraft(row, columns, editableColumns, required = []) {
  const out = {}
  for (const column of columns || []) {
    if (!(editableColumns || []).includes(column)) continue
    if (String(row?.[column] ?? '') === '') continue
    // A field that has to have something in it is not something Clear can
    // take out. The alternative -- blank it and let Save refuse -- turns
    // one press into a form nobody can save until they have retyped a
    // value they never meant to lose.
    if ((required || []).includes(column)) continue
    out[column] = ''
  }
  return out
}

/** What the unsaved bar should say. */
export function unsavedNote(count) {
  if (count <= 0) return ''
  return `${count} unsaved change${count === 1 ? '' : 's'}`
}
