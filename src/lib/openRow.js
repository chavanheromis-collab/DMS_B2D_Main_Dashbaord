// ---------------------------------------------------------------------
// A row held open in a panel has to follow the sheet
// ---------------------------------------------------------------------
// Opening the detail form, the remarks popover or the downloads menu takes
// a row object and puts it in state. That object is a PHOTOGRAPH: saving a
// cell reloads the tab, and the reload builds every row again from the API
// response, so nothing that was captured on click is ever mutated. The
// panel goes on showing the values as they were when it opened, and an edit
// made inside it appears to do nothing at all -- the dropdown snaps back,
// the text box reverts, and the only way to see the new value is to close
// the panel and open it again.
//
// The row that is open is therefore remembered by its IDENTITY -- the sheet
// row number, which is what the write itself is addressed by -- and looked
// up in the live rows on every render.
//
// The snapshot is still kept, as the answer for when the lookup fails. A
// row can leave `rows` while its panel is open: a page filter or a column
// filter that the edit has just stopped matching -- change a status to
// Cancelled on a page filtered to Active, and the row is gone the instant
// it saves. Returning null there would slam the panel shut at the exact
// moment somebody was reading it, so the last known values stay on screen
// until they close it themselves.

/**
 * The live version of a row a panel is open on.
 *
 * `snapshot` is whatever was captured when the panel opened. Returns the
 * row with the same `_row` out of `rows`, or the snapshot when there is no
 * longer one to find.
 */
export function liveRow(rows, snapshot) {
  if (!snapshot) return null
  const id = snapshot._row
  // A row with no sheet number is not addressable and cannot be edited
  // either, so there is nothing to follow.
  if (id === undefined || id === null) return snapshot
  return (rows || []).find((r) => r?._row === id) || snapshot
}
