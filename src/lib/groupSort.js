// ---------------------------------------------------------------------
// Sorting groups by a column that is not the one being measured
// ---------------------------------------------------------------------
// A chart grouped by DSE can be sorted by its bars (biggest first) or by its
// labels (A to Z). Neither is what somebody wants when the order that
// matters lives in a third column: put the branches in the order head
// office lists them, the stages in the order the process runs, the models
// by launch date.
//
// Sorting by a column means answering a question the column cannot answer on
// its own: a group is many rows, and many rows are many values. So the
// admin says how to reduce them -- the earliest date, the highest number,
// the first one in the sheet -- and that reduced value is the sort key.
// Anything else would be picking one row silently and calling it the group.
//
// This file holds the part with no data in it: the options, and how two
// keys compare. The parsing lives beside the parsers (see `groupSortKey` in
// dataUtils.js), which keeps this pure and keeps the two files acyclic.

/** How a group list can be ordered. */
export const GROUP_SORTS = [
  { value: 'value_desc', label: 'Value, highest first' },
  { value: 'value_asc', label: 'Value, lowest first' },
  { value: 'name_asc', label: 'Name, A → Z' },
  { value: 'name_desc', label: 'Name, Z → A' },
  { value: 'column_asc', label: 'Another column, low → high' },
  { value: 'column_desc', label: 'Another column, high → low' },
]

/**
 * How a control's list of values is ordered.
 *
 * A control's options are values, not groups with a number attached, so
 * "highest first" means nothing here -- there is nothing to be highest. What
 * is left is the alphabet, the sheet, and a third column.
 *
 * An unset order is NOT the same as `name_asc`: a bucketed control already
 * orders itself meaningfully (Mar 2025 before Jan 2026, which is neither
 * alphabetical nor sheet order) and must keep doing so untouched.
 */
export const OPTION_SORTS = [
  { value: '', label: 'Default (dates in date order, else A → Z)' },
  { value: 'name_asc', label: 'A → Z' },
  { value: 'name_desc', label: 'Z → A' },
  { value: 'sheet', label: 'The order they appear in the sheet' },
  { value: 'column_asc', label: 'Another column, low → high' },
  { value: 'column_desc', label: 'Another column, high → low' },
]

/**
 * How many rows become one sort key.
 *
 * `first` is sheet order, which is the honest answer for a column that is
 * the same on every row of a group -- a branch's region, a model's launch
 * date -- and the commonest reason to sort by a column at all.
 */
export const SORT_REDUCERS = [
  { value: 'first', label: 'its first row', numeric: false },
  { value: 'min', label: 'the lowest / earliest', numeric: false },
  { value: 'max', label: 'the highest / latest', numeric: false },
  { value: 'sum', label: 'the total', numeric: true },
  { value: 'avg', label: 'the average', numeric: true },
]

export const DEFAULT_REDUCER = 'first'

/** Is this a sort that needs a column named? */
export function sortsByColumn(sort) {
  return sort === 'column_asc' || sort === 'column_desc'
}

/** Which way round, for the sorts that have a direction in their name. */
export function sortDirection(sort) {
  return String(sort || '').endsWith('_asc') ? 1 : -1
}

/** A reducer that only means something for numbers. */
export function reducerIsNumeric(reducer) {
  return SORT_REDUCERS.some((r) => r.value === reducer && r.numeric)
}

/**
 * Many comparable values, reduced to the one the group sorts on.
 *
 * `sum` and `avg` on text are not wrong so much as meaningless, so they
 * fall back to the lowest -- which is at least an order somebody can
 * predict, unlike whatever adding words would produce.
 */
export function reduceKeys(keys, reducer = DEFAULT_REDUCER) {
  const list = (keys || []).filter((k) => k !== null && k !== undefined && k !== '')
  if (list.length === 0) return null

  const numbers = list.filter((k) => typeof k === 'number')
  const allNumeric = numbers.length === list.length

  if (reducer === 'first') return list[0]
  if (!allNumeric) {
    // Text has no total. Lowest and highest still mean something.
    const sorted = [...list].sort((a, b) => compareKeys(a, b))
    return reducer === 'max' ? sorted[sorted.length - 1] : sorted[0]
  }

  if (reducer === 'min') return Math.min(...numbers)
  if (reducer === 'max') return Math.max(...numbers)
  const total = numbers.reduce((a, b) => a + b, 0)
  if (reducer === 'sum') return total
  if (reducer === 'avg') return total / numbers.length
  return list[0]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Two sort keys, compared.
 *
 * A group with NO value in the sort column goes last, whichever direction
 * the sort runs. It is not the smallest or the largest; it is the one that
 * did not answer, and burying it is kinder than letting it lead.
 *
 * Numbers before text when the column holds both, which a sheet column
 * often does. Arbitrary, but stable and stated -- and the alternative is an
 * order that changes with the data.
 */
export function compareKeys(a, b) {
  const aMissing = a === null || a === undefined || a === ''
  const bMissing = b === null || b === undefined || b === ''
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1

  const aNum = typeof a === 'number'
  const bNum = typeof b === 'number'
  if (aNum && bNum) return a - b
  if (aNum !== bNum) return aNum ? -1 : 1
  return collator.compare(String(a), String(b))
}

/**
 * The comparator for a whole group list, given each group's key.
 *
 * Missing keys stay last in BOTH directions, which is why the direction is
 * applied to the comparison and not to the array: reversing the array would
 * bring them to the front.
 */
export function byKey(keyOf, sort) {
  const dir = sortDirection(sort)
  return (a, b) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    const aMissing = ka === null || ka === undefined || ka === ''
    const bMissing = kb === null || kb === undefined || kb === ''
    if (aMissing || bMissing) return compareKeys(ka, kb)
    return dir * compareKeys(ka, kb)
  }
}
