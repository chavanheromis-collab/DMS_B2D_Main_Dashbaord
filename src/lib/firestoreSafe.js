// ---------------------------------------------------------------------
// Making config safe to write
// ---------------------------------------------------------------------
// Firestore rejects `undefined` outright, and it rejects the WHOLE document
// rather than the offending field:
//
//   FirebaseError: Function setDoc() called with invalid data.
//   Unsupported field value: undefined (found in document dashboards/pg_…)
//
// That error names the document but not the field, so one editor writing a
// stray `undefined` breaks saving for the entire page and gives almost
// nothing to debug from. Config objects here are assembled by two dozen
// editors, each spreading patches into the last -- `{ ...control, width:
// undefined }` is a natural way to express "clear this", and it is exactly
// what blows up.
//
// So every write goes through `stripUndefined` rather than relying on every
// editor remembering. Clearing a field is spelled `null`, which Firestore
// stores happily; `undefined` is treated as "no opinion" and dropped, which
// under `{ merge: true }` leaves whatever was already there.

/**
 * Deep-copies a value, dropping every `undefined` object property.
 *
 * Arrays keep their length -- an `undefined` element becomes `null` rather
 * than vanishing, because dropping it would silently renumber everything
 * after it and quietly corrupt an ordered list of widgets or controls.
 */
export function stripUndefined(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : stripUndefined(item)))

  // Dates, Timestamps and the like must pass through untouched -- rebuilding
  // them as plain objects would destroy them.
  if (value === null || typeof value !== 'object' || value.constructor !== Object) return value

  const out = {}
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue
    out[key] = stripUndefined(val)
  }
  return out
}
