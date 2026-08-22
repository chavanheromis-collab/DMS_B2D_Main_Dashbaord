import { isBlank, toNumber } from './dataUtils.js'

// ---------------------------------------------------------------------
// Per-column filters, the way a spreadsheet does them
// ---------------------------------------------------------------------
// A funnel on every column header, opening a searchable list of the values
// actually present, with everything ticked until you untick something.
//
// The behaviour people expect from Excel and Sheets, and the part that is
// easy to get wrong: the options a column offers are the values that survive
// the OTHER columns' filters, not the values in the raw table. Filter Model
// to "SPLENDOR +" and the SKU column should offer Splendor SKUs only --
// otherwise you are choosing between options that would return nothing.

export const BLANK_TOKEN = '\u0000blank'

/** The display text a cell contributes to its column's option list. */
export function cellKey(value) {
  return isBlank(value) ? BLANK_TOKEN : String(value).trim()
}

export function cellLabel(key) {
  return key === BLANK_TOKEN ? '(blank)' : key
}

/** Is this column filtered at all? */
export function columnIsFiltered(filter) {
  if (!filter) return false
  if (Array.isArray(filter.exclude) && filter.exclude.length > 0) return true
  return Boolean(String(filter.text || '').trim())
}

/** Every column currently doing something. */
export function activeFilterColumns(filters) {
  return Object.keys(filters || {}).filter((column) => columnIsFiltered(filters[column]))
}

/**
 * Does one row pass one column's filter?
 *
 * Filters store what is EXCLUDED rather than what is included. That is the
 * difference between "everything except Lost" and "only the values that
 * existed when I set this up": with an include list, a value added to the
 * sheet tomorrow would be silently hidden. With an exclude list it shows up,
 * which is what someone who ticked "select all" meant.
 */
export function rowPassesColumn(row, column, filter) {
  if (!columnIsFiltered(filter)) return true

  const key = cellKey(row[column])

  if (filter.exclude?.length && filter.exclude.includes(key)) return false

  const text = String(filter.text || '').trim().toLowerCase()
  if (text) {
    const cell = key === BLANK_TOKEN ? '' : key.toLowerCase()

    // A leading comparison operator turns the box into a numeric test --
    // ">100", "<=5". Typing that into a text box is a strong signal, and
    // matching it as literal text would never find anything.
    const m = text.match(/^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/)
    if (m) {
      const n = toNumber(row[column])
      const target = toNumber(m[2])
      if (n === null || target === null) return false
      if (m[1] === '>') return n > target
      if (m[1] === '>=') return n >= target
      if (m[1] === '<') return n < target
      if (m[1] === '<=') return n <= target
      return n === target
    }

    if (!cell.includes(text)) return false
  }

  return true
}

/** Applies every column filter. */
export function applyColumnFilters(rows, filters) {
  const columns = activeFilterColumns(filters)
  if (columns.length === 0) return rows || []
  return (rows || []).filter((row) => columns.every((column) => rowPassesColumn(row, column, filters[column])))
}

/**
 * The options one column's menu should offer, with a count each.
 *
 * Computed from rows that pass every OTHER column's filter -- see the note at
 * the top of this file. `selected` reflects the column's own exclude list, so
 * reopening a menu shows what you last chose.
 */
export function columnOptions(rows, column, filters, cap = 1000) {
  const others = activeFilterColumns(filters).filter((c) => c !== column)
  const scoped = (rows || []).filter((row) => others.every((c) => rowPassesColumn(row, c, filters[c])))

  const counts = new Map()
  for (const row of scoped) {
    const key = cellKey(row[column])
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const exclude = new Set(filters?.[column]?.exclude || [])
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: cellLabel(key), count, selected: !exclude.has(key) }))
    .sort((a, b) => {
      // Blanks last: they are almost never what someone is looking for.
      if (a.key === BLANK_TOKEN) return 1
      if (b.key === BLANK_TOKEN) return -1
      return collator.compare(a.label, b.label)
    })
    .slice(0, cap)
}

/**
 * Would this exclude list leave the column with nothing at all?
 *
 * Checked against EVERY option, not just the ones a search happens to be
 * showing. Judging it from the visible subset was wrong: unticking the last
 * search result would look like "you've excluded everything" and wipe
 * unrelated exclusions the search was hiding.
 */
function excludesEverything(exclude, allOptions) {
  return allOptions.length > 0 && allOptions.every((o) => exclude.has(o.key))
}

/**
 * The exclude list after toggling one value.
 *
 * `allOptions` is the column's full option list; `options` may be a subset
 * when a search is active. Excluding every last value would show an empty
 * table with no obvious way back, so that is treated as "no filter" instead
 * of as a dead end.
 */
export function toggleOption(filter, key, options, allOptions = options) {
  const exclude = new Set(filter?.exclude || [])
  if (exclude.has(key)) exclude.delete(key)
  else exclude.add(key)

  if (excludesEverything(exclude, allOptions)) return { ...filter, exclude: [] }
  return { ...filter, exclude: Array.from(exclude) }
}

/**
 * Tick or untick everything currently listed.
 *
 * Only `options` is touched, so "deselect shown" during a search adds just
 * those to the exclude list and leaves any other exclusions alone.
 */
export function setAllOptions(filter, options, selected, allOptions = options) {
  const exclude = new Set(filter?.exclude || [])
  for (const option of options) {
    if (selected) exclude.delete(option.key)
    else exclude.add(option.key)
  }

  if (excludesEverything(exclude, allOptions)) return { ...filter, exclude: [] }
  return { ...filter, exclude: Array.from(exclude) }
}
