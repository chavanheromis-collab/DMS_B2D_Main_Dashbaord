import { isBlank, shownValue, toDate, toNumber, startOfDay, endOfDay, fromDateInput } from './dataUtils.js'
import { matchesConditions } from './filterEngine.js'

// ---------------------------------------------------------------------
// Per-widget controls
// ---------------------------------------------------------------------
// Controls that live ON one widget and narrow only that widget, leaving the
// rest of the canvas alone. Distinct from the page-level filter bar, which
// spans every widget reading a tab.
//
// The distinction earns its keep constantly: a table of "all quotations"
// wants its own status dropdown and an amount slider without disturbing the
// KPIs sitting beside it, and a chart wants a "top 10" limiter that would be
// meaningless applied page-wide.
//
// This started life as in-TABLE controls. It now serves every widget
// types, because the rendering moved up into the canvas wrapper -- the
// widgets themselves never learned that controls exist.

export const CONTROL_KINDS = [
  { value: 'select', label: 'Dropdown', hint: 'One value from the column.', needsColumn: true },
  { value: 'multi', label: 'Chips (multi-choice)', hint: 'Any number of values.', needsColumn: true },
  { value: 'search', label: 'Search box', hint: 'Free text across one column.', needsColumn: true },
  { value: 'button', label: 'Condition button', hint: 'A saved set of conditions, toggled on and off.' },
  { value: 'range', label: 'Slider — number range', hint: 'Two handles. Bounds read from the data.', needsColumn: true },
  { value: 'threshold', label: 'Slider — single threshold', hint: 'One handle: at least / at most.', needsColumn: true },
  { value: 'stepper', label: 'Slider — stepped', hint: 'Snaps to your own steps, with tick labels.', needsColumn: true },
  { value: 'dateslider', label: 'Slider — last N days', hint: 'Drag back through time on a date column.', needsColumn: true },
  { value: 'date', label: 'Date range', hint: 'Two date boxes.', needsColumn: true },
  { value: 'topn', label: 'Slider — top N rows', hint: 'Keeps the first N rows after everything else.' },
]

export function controlMeta(kind) {
  return CONTROL_KINDS.find((k) => k.value === kind) || CONTROL_KINDS[0]
}

export function controlNeedsColumn(kind) {
  return controlMeta(kind).needsColumn === true
}

/** Is this control currently narrowing anything? */
export function controlIsActive(control, value) {
  if (value === undefined || value === null) return false
  switch (control.kind) {
    case 'button':
      return value === true
    case 'multi':
      return Array.isArray(value) && value.length > 0
    case 'range':
    case 'date':
      return Boolean(value.from !== undefined && value.from !== '') || Boolean(value.to !== undefined && value.to !== '')
    case 'threshold':
    case 'dateslider':
    case 'topn':
      return value !== '' && Number.isFinite(Number(value))
    case 'search':
      return String(value).trim() !== ''
    case 'select':
    default:
      return value !== '' && value !== '__ALL__'
  }
}

/** Any control on this widget currently doing something? */
export function anyControlActive(controls, values) {
  return (controls || []).some((c) => controlIsActive(c, values?.[c.id]))
}

/**
 * The numeric bounds for a slider, taken from the column's REAL values
 * unless the admin pinned them.
 *
 * Reading bounds from the data is what keeps a slider honest as the sheet
 * grows -- a hard-coded max of 100,000 silently becomes a filter the day
 * someone books a bigger order.
 */
export function numericBounds(rows, column, control = {}) {
  const pinnedMin = toNumber(control.min)
  const pinnedMax = toNumber(control.max)
  if (pinnedMin !== null && pinnedMax !== null && pinnedMax > pinnedMin) {
    return { min: pinnedMin, max: pinnedMax }
  }

  let lo = Infinity
  let hi = -Infinity
  for (const row of rows || []) {
    const n = toNumber(row[column])
    if (n === null) continue
    if (n < lo) lo = n
    if (n > hi) hi = n
  }
  if (lo === Infinity) return { min: 0, max: 100 }

  const min = pinnedMin !== null ? pinnedMin : Math.floor(lo)
  let max = pinnedMax !== null ? pinnedMax : Math.ceil(hi)
  // A column where every row holds the same number would give a zero-width
  // track that cannot be dragged.
  if (max <= min) max = min + 1
  return { min, max }
}

/** A sensible step so a slider has ~100 stops rather than 4 or 4 million. */
export function stepFor(min, max, control = {}) {
  const pinned = toNumber(control.step)
  if (pinned !== null && pinned > 0) return pinned
  const span = Math.abs(max - min)
  if (span <= 10) return 0.1
  return Math.max(1, Math.round(span / 100))
}

/** The tick values for a stepped slider. */
export function stepperTicks(control) {
  const raw = String(control.steps || '')
    .split(',')
    .map((s) => toNumber(s))
    .filter((n) => n !== null)
  return raw.length >= 2 ? Array.from(new Set(raw)).sort((a, b) => a - b) : [0, 25, 50, 75, 100]
}

// ---------------------------------------------------------------------
// Applying controls
// ---------------------------------------------------------------------
function applyOne(rows, control, value, dateOrder) {
  const column = control.column
  // Whatever the control's own list offered -- see `shownValue`.
  const shown = (row) => shownValue(row, control, dateOrder)

  switch (control.kind) {
    case 'button':
      return rows.filter((row) => matchesConditions(row, control.conditions, control.match || 'all', dateOrder))

    case 'multi': {
      const wanted = new Set(value.map((v) => String(v).trim()))
      // Bucketed, the control lists "2026" rather than four hundred dates,
      // so what it compares against is the bucket, not the cell.
      return rows.filter((row) => wanted.has(shown(row)))
    }

    case 'search': {
      const q = String(value).trim().toLowerCase()
      return rows.filter((row) => String(row[column] ?? '').toLowerCase().includes(q))
    }

    case 'range':
    case 'stepper': {
      const from = toNumber(value.from)
      const to = toNumber(value.to)
      return rows.filter((row) => {
        const n = toNumber(row[column])
        if (n === null) return false
        if (from !== null && n < from) return false
        if (to !== null && n > to) return false
        return true
      })
    }

    case 'threshold': {
      const n = toNumber(value)
      if (n === null) return rows
      const atMost = control.direction === 'lte'
      return rows.filter((row) => {
        const v = toNumber(row[column])
        if (v === null) return false
        return atMost ? v <= n : v >= n
      })
    }

    case 'date': {
      const from = fromDateInput(value.from)
      const to = fromDateInput(value.to)
      return rows.filter((row) => {
        const d = toDate(row[column], dateOrder)
        if (!d) return false
        if (from && d < startOfDay(from)) return false
        if (to && d > endOfDay(to)) return false
        return true
      })
    }

    case 'dateslider': {
      const days = toNumber(value)
      if (days === null) return rows
      const now = new Date()
      const cutoff = startOfDay(new Date(now.getTime() - days * 86400000))
      return rows.filter((row) => {
        const d = toDate(row[column], dateOrder)
        if (!d) return false
        return d >= cutoff && d <= endOfDay(now)
      })
    }

    case 'topn':
      // Handled after everything else -- see applyWidgetControls.
      return rows

    case 'select':
    default:
      return rows.filter((row) => shown(row) === String(value).trim())
  }
}

/**
 * Runs a widget's own controls over its rows.
 *
 * `topn` is deliberately applied LAST, whatever order the admin put the
 * controls in: "top 10" has to mean the top 10 of what survived the other
 * controls, not the top 10 of the raw tab which the others then whittle down
 * to three.
 */
export function applyWidgetControls(rows, controls, values, dateOrder = 'DMY') {
  let out = rows || []
  let topN = null

  for (const control of controls || []) {
    const value = values?.[control.id]
    if (!controlIsActive(control, value)) continue
    if (control.kind === 'topn') {
      topN = Number(value)
      continue
    }
    if (controlNeedsColumn(control.kind) && !control.column) continue
    out = applyOne(out, control, value, dateOrder)
  }

  if (topN !== null && topN > 0 && out.length > topN) out = out.slice(0, topN)
  return out
}

/**
 * The rows one of a widget's own controls should build its choices from.
 *
 * Every control on a widget was drawing its list from the SAME rows, so two
 * of them never narrowed each other: pick a category and the model list
 * still offered every model in the tab, most of which would come back
 * empty. The page's control bar has narrowed this way for a long time
 * (`optionRows` in lib/pageControls.js) -- this is the same rule, brought
 * to the controls that sit on a widget.
 *
 * Its OWN value is left out, and that is the whole subtlety: narrowing a
 * control by itself would leave it offering only what is already picked,
 * so nobody could ever change their mind.
 *
 * `independent` opts out. A control marked so keeps offering everything --
 * which is what you want for the one that is meant to be picked FIRST, and
 * for anything measuring the whole tab rather than the current view.
 */
export function widgetOptionRows(control, { rows, controls, values, dateOrder = 'DMY' } = {}) {
  if (!control || control.independent) return rows || []
  const others = (controls || []).filter((c) => c && c.id !== control.id)
  return applyWidgetControls(rows, others, values, dateOrder)
}

/**
 * The value a control starts at. Mostly `undefined` (meaning "not
 * narrowing"), but a control the admin marked as having a default opens with
 * it already applied.
 */
export function initialControlValues(controls) {
  const out = {}
  for (const control of controls || []) {
    if (isBlank(control.defaultValue)) continue
    if (control.kind === 'button') out[control.id] = control.defaultValue === true || control.defaultValue === 'true'
    else if (control.kind === 'multi') {
      out[control.id] = String(control.defaultValue)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else out[control.id] = control.defaultValue
  }
  return out
}
