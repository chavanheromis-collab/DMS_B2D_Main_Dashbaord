// ---------------------------------------------------------------------
// Drag one value down a column, the way a spreadsheet does
// ---------------------------------------------------------------------
// Marking forty rows Delivered one cell at a time is forty clicks, forty
// dropdowns and forty round trips to Google, and the fortieth is where the
// mistake is. Everybody already knows the gesture that does it: take the
// little square at the corner of a cell and pull it down.
//
// Three things make this different from forty ordinary edits, and all three
// are why it is worth its own module:
//
//   IT FOLLOWS WHAT IS ON SCREEN. The span is over the rows AS DISPLAYED --
//   after the page filters, this table's own filters, the sort and the
//   page. Somebody drags over what they can see. Reading the underlying
//   order instead would fill rows that are not on screen, which is the one
//   outcome nobody could predict from the gesture.
//
//   IT IS ONE WRITE, NOT FORTY. The whole span goes to Google as a single
//   batch, and the page reloads once at the end. Forty sequential writes
//   with a full reload between each is thirty seconds of a table flickering
//   -- and a failure halfway through leaves a span half filled with no way
//   to tell where it stopped.
//
//   IT IS OFF UNTIL AN ADMIN TURNS IT ON, PER COLUMN. A gesture that can
//   overwrite a hundred cells by accident does not belong on the column
//   holding chassis numbers. It belongs on Status, on Stage, on the ones
//   where a run of rows genuinely shares an answer.

/**
 * The most cells one drag may write.
 *
 * A page of rows is normally far below this; the cap is for the table set
 * to "full screen height" with a page size to match, where a drag from the
 * first row to the last is a four-figure write nobody meant to make.
 */
export const FILL_LIMIT = 500

/** The columns an admin has opened up to the gesture. */
export function fillColumnsOf(widget) {
  return (widget?.fillColumns || []).filter(Boolean)
}

/**
 * May THIS reader drag THIS column?
 *
 * Three separate answers, all required, and none of them a substitute for
 * the server's own check on every cell that gets written:
 *
 *   the table is editable at all,
 *   the admin turned the gesture on for this column,
 *   and this reader has the column granted to them.
 *
 * The grant is last and it is the one that varies per person: two people
 * looking at the same table see the handle on different columns.
 */
export function canFill(widget, column, editableColumns = []) {
  if (!widget?.editable) return false
  if (!fillColumnsOf(widget).includes(column)) return false
  return (editableColumns || []).includes(column)
}

/** Does this table offer the gesture anywhere this reader can use it? */
export function fillIsOffered(widget, editableColumns = []) {
  return fillColumnsOf(widget).some((col) => canFill(widget, col, editableColumns))
}

/**
 * The rows the drag currently covers, as displayed positions.
 *
 * Inclusive of both ends and of the anchor itself, because that is what
 * gets the highlight -- a span drawn from the row below the anchor reads as
 * though the anchor is not part of it.
 *
 * Dragging UP is a fill too, and means the same thing: the anchor's value,
 * into everything the pointer has crossed.
 */
export function fillRange(anchorIndex, toIndex, count) {
  if (!Number.isInteger(anchorIndex) || !Number.isInteger(toIndex)) return null
  if (!Number.isInteger(count) || count <= 0) return null
  const last = count - 1
  const a = Math.max(0, Math.min(anchorIndex, last))
  const b = Math.max(0, Math.min(toIndex, last))
  return { from: Math.min(a, b), to: Math.max(a, b), anchor: a }
}

/** Is this displayed row inside the span being dragged? */
export function inFillRange(range, index) {
  if (!range) return false
  return index >= range.from && index <= range.to
}

/**
 * What the drag will actually write.
 *
 * `rows` is the displayed page, in the order it is drawn. Returns the
 * anchor's value and one entry per row that will change:
 *
 *   a row that already holds the value is skipped, so dragging over a run
 *   of rows that are already Delivered costs nothing -- and this is what
 *   excludes the anchor too, which holds the value it is the source of by
 *   definition. A separate guard for it would be a line no test could ever
 *   make fail;
 *
 *   a row with no sheet number cannot be addressed by the write and is not
 *   pretended to be.
 *
 * `capped` is true when the span was longer than the limit, so the caller
 * can say so rather than quietly filling the first five hundred.
 */
export function fillTargets(rows, { column, anchorIndex, toIndex, limit = FILL_LIMIT } = {}) {
  const list = rows || []
  const range = column ? fillRange(anchorIndex, toIndex, list.length) : null
  if (!range) return { value: '', writes: [], capped: false }

  const anchor = list[range.anchor]
  if (!anchor) return { value: '', writes: [], capped: false }
  const value = anchor[column] ?? ''

  const writes = []
  let capped = false
  for (let i = range.from; i <= range.to; i += 1) {
    const row = list[i]
    if (!row || row._row === undefined || row._row === null) continue
    if ((row[column] ?? '') === value) continue
    if (writes.length >= limit) {
      capped = true
      break
    }
    writes.push({ row, value })
  }
  return { value, writes, capped }
}

/** What to tell somebody once it has happened. */
export function filledNote(column, count, capped = false) {
  if (count <= 0) return ''
  const rows = `${count.toLocaleString('en-IN')} row${count === 1 ? '' : 's'}`
  const note = `Filled ${column} into ${rows}`
  return capped ? `${note} — the most one drag can change` : note
}
