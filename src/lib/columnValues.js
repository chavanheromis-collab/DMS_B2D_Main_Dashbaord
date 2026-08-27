// ---------------------------------------------------------------------
// What is actually IN a column
// ---------------------------------------------------------------------
// Every condition in this app -- a button, a fixed filter, a widget's own
// rule, a flow branch, a colour pinned to a value -- ends in somebody
// typing a value into a box. Typing it means knowing it, spelling it, and
// matching the case and the stray trailing space the sheet happens to have.
// Get any of those wrong and the condition matches nothing, silently, and
// looks exactly like a condition that matches nothing legitimately.
//
// So the values are collected where the rows already are -- during a sync,
// which has just read every tab and costs nothing extra -- and stored beside
// the headers. They last until the next sync, which is the right lifetime:
// they describe the data as it was last read, and so does everything else
// on the screen.
//
// The whole column, deliberately. Not the values that survive the current
// filters: an admin writing a rule is describing what the data CAN say, not
// what it happens to be saying while they write.
//
// Pure: rows in, values out. No Firestore, no network, no React.

/** More than this is not a dropdown, it is a scroll bar with a search box. */
export const MAX_PER_COLUMN = 200

/**
 * A budget for the whole source, because a Firestore document is 1MB and a
 * spreadsheet is not.
 *
 * Counted in VALUES rather than bytes: bytes would need the encoder, and a
 * value is close enough to a fixed cost that a count is an honest proxy.
 */
export const MAX_PER_SOURCE = 6000

const clean = (value) => String(value ?? '').trim()

/**
 * Every distinct value in one column, in the order a person reads them.
 *
 * Blanks are left out: "(blank)" is not a value somebody types into a
 * condition, and the operators that care about emptiness have their own.
 *
 * Case and spacing are kept EXACTLY as the sheet has them, because that is
 * what a condition has to match. Two spellings of the same word are two
 * entries here, which is not tidy -- and is the truth.
 */
export function distinctValues(rows, column, { max = MAX_PER_COLUMN } = {}) {
  if (!column) return { values: [], total: 0, capped: false }

  const seen = new Set()
  for (const row of rows || []) {
    const value = clean(row?.[column])
    if (value !== '') seen.add(value)
    // Counting past the cap tells an admin how much they are NOT seeing,
    // which is the difference between a short list and a lie.
    if (seen.size > max * 4) break
  }

  const all = [...seen].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
  return {
    values: all.slice(0, max),
    total: all.length,
    capped: all.length > max,
  }
}

/**
 * One tab's columns, indexed.
 *
 * A column with more distinct values than the cap is left OUT rather than
 * truncated. A list of the first two hundred VINs is worse than no list: it
 * looks complete, and the one being looked for is almost certainly not in
 * it. The editor falls back to a plain box, which is honest.
 */
export function valueIndexFor(rows, headers, { max = MAX_PER_COLUMN, budget = MAX_PER_SOURCE } = {}) {
  const out = {}
  let spent = 0

  for (const column of headers || []) {
    if (spent >= budget) break
    const { values, capped } = distinctValues(rows, column, { max })
    if (capped || values.length === 0) continue
    if (spent + values.length > budget) continue
    out[column] = values
    spent += values.length
  }

  return out
}

/**
 * The values stored for one tab's column, or null if there are none.
 *
 * Null and empty are different answers and the caller needs both: null is
 * "nothing was indexed for this, offer a plain box", and an empty array
 * would be "this column is empty", which is not a thing this ever stores.
 */
export function storedValues(source, tab, column) {
  if (!source || !tab || !column) return null
  const values = source?.tabValues?.[tab]?.[column]
  return Array.isArray(values) && values.length > 0 ? values : null
}

/**
 * The same question asked with a ref, which is how everything above the
 * data layer addresses a tab.
 */
export function valuesForRef(sourcesById, ref, column) {
  const [sourceId, tab] = String(ref || '').split('::')
  if (!sourceId || !tab) return null
  return storedValues(sourcesById?.[sourceId], tab, column)
}
