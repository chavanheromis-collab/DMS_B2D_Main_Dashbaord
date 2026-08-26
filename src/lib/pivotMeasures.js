import { AGGREGATIONS, aggNeedsColumn } from './config.js'

// ---------------------------------------------------------------------
// Several value columns in one grouped list
// ---------------------------------------------------------------------
// A pivot with a column axis answers "how much, broken down two ways". A
// pivot WITHOUT one is a grouped list -- Region › DSE, and a number -- and
// the question that follows it is almost never "the same number again". It
// is "how many, worth how much, over how many days": several DIFFERENT
// measurements of the same groups, side by side.
//
// One number per row could not say that. Two pivots side by side could, but
// then the grouping is computed twice and the two lists disagree the moment
// one of them caps its rows differently.
//
// So a measure is a small object -- a label, an aggregation, a column, a
// number format -- and a grouped pivot carries a list of them. The list is
// EMPTY by default and an empty list means the single measure the widget
// already had, so a pivot nobody has touched is untouched.

/** The label a measure gets when nobody has typed one. */
export function defaultMeasureLabel(measure) {
  const agg = measure?.aggregation || 'count'
  const column = String(measure?.column || '').trim()

  if (agg === 'count') return 'Count'
  if (!column) return AGGREGATIONS.find((a) => a.value === agg)?.label || 'Value'

  // "Sum of Amount" rather than "Sum (numeric) of Amount": the parenthetical
  // in the picker is there to help somebody CHOOSE, and repeating it in a
  // column heading forty rows tall is noise.
  const words = {
    sum: 'Sum of',
    avg: 'Average of',
    min: 'Lowest',
    max: 'Highest',
    count_filled: 'Filled',
    count_empty: 'Blank',
    count_distinct: 'Distinct',
    percent_filled: '% filled',
  }
  return `${words[agg] || agg} ${column}`.trim()
}

/**
 * The measures a pivot should show, always at least one.
 *
 * An empty or missing list resolves to the widget's own single aggregation,
 * which is what makes this feature invisible until it is used: the grouped
 * list a page has always had renders through exactly the same code path,
 * with a list of one.
 */
export function pivotMeasures(widget) {
  const saved = (widget?.measures || []).filter((m) => m && (m.aggregation || m.column))

  if (saved.length === 0) {
    return [
      {
        id: 'v0',
        label: widget?.valueLabel || 'Total',
        aggregation: widget?.aggregation || 'count',
        column: widget?.column || '',
        format: widget?.format || 'comma',
      },
    ]
  }

  return saved.map((m, i) => ({
    id: m.id || `v${i}`,
    label: String(m.label || '').trim() || defaultMeasureLabel(m),
    aggregation: m.aggregation || 'count',
    // A column on an aggregation that does not use one is ignored rather
    // than passed through: it would make two identical measures look
    // different in the editor and identical on the page.
    column: aggNeedsColumn(m.aggregation || 'count') ? m.column || '' : '',
    format: m.format || widget?.format || 'comma',
  }))
}

/** True once a pivot is showing more than one number per group. */
export function hasManyMeasures(widget) {
  return (widget?.measures || []).filter((m) => m && (m.aggregation || m.column)).length > 1
}

/** A new measure to add, pre-filled with something that already works. */
export function emptyMeasure(widget, index = 0) {
  return {
    id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    aggregation: index === 0 ? widget?.aggregation || 'count' : 'count',
    column: index === 0 ? widget?.column || '' : '',
    format: widget?.format || 'comma',
  }
}
