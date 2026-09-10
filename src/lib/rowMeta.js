// ---------------------------------------------------------------------
// The keys on a row that are not columns
// ---------------------------------------------------------------------
// A row arrives from the sheet as `{ _row: 42, Model: 'SPLENDOR', ... }`.
// `_row` is not data -- it is the row's ADDRESS, the thing a write is aimed
// at -- and every place that walks a row's keys has had to remember to skip
// it: the CSV export, the search box, the column pickers, the blend.
//
// Five separate `!== '_row'` checks worked for exactly as long as there was
// one such key. Row operations need a second (`_fp`, see rowFingerprint.js:
// what the row LOOKED LIKE, so a delete can refuse to fire at a row that
// has moved underneath it), and a sixth place that had never heard of it
// would put a hash in a CSV column, or let a search for "a1" match one.
//
// So the list lives here and every skip reads from it. Anything added later
// -- a revision, a source tag -- is one entry rather than a hunt.

/** Keys the sheet did not put there, and that no column picker should offer. */
export const META_COLUMNS = ['_row', '_fp']

export function isMetaColumn(key) {
  return META_COLUMNS.includes(key)
}

/** A key list with the meta keys taken out, order kept. */
export function dataColumns(keys) {
  return (keys || []).filter((k) => !isMetaColumn(k))
}

/**
 * A row's real values, without its address or its fingerprint.
 *
 * Used where a row is COPIED rather than read -- a duplicate, or a row sent
 * to another tab. Carrying `_row` across would give the new row the old
 * one's address, which is the one field on it that must not be inherited.
 */
export function dataValues(row) {
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    if (!isMetaColumn(key)) out[key] = value
  }
  return out
}
