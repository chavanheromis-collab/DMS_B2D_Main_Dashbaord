// ---------------------------------------------------------------------
// The two dashboard PAGES. This is the whole "navigation" of the app.
// ---------------------------------------------------------------------
// Each page owns exactly ONE Google Spreadsheet (one sheetId) which may
// contain MANY tabs (MASTER, Quotations, GOOGLE REVIEW, Prospects, ...).
// Everything an admin configures -- widgets, filters, buttons -- lives
// under one page and reads from that page's own tabs only. Adding a tab
// to PREMIA can never affect HERO and vice-versa, because the tab list
// lives on `sheetConfigs/PREMIA` and every widget stores the page it
// belongs to implicitly (it's in `layouts/PREMIA`).
// `import.meta.env` only exists under Vite. Guarding it lets this module --
// and everything that imports it -- also load in plain Node, which is what
// the `node --test` suite runs on.
export const PAGES = [
  import.meta.env?.VITE_PAGE_A_LABEL || 'PREMIA',
  import.meta.env?.VITE_PAGE_B_LABEL || 'HERO',
]

export const DEFAULT_PAGE = PAGES[0]

export function isValidPage(p) {
  return PAGES.includes(p)
}

// ---------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------
export const WIDGET_TYPES = [
  { value: 'kpi', label: 'KPI Card', icon: '📊', hint: 'One number from one tab + column' },
  { value: 'pipeline', label: 'Workflow Pipeline', icon: '🔀', hint: 'Funnel of stages, each with its own pop-up KPIs' },
  { value: 'flow', label: 'Flow (drill-down tree)', icon: '🌳', hint: 'One number that opens into levels — split, branch, or hop to another tab' },
  { value: 'filters', label: 'Filter Panel', icon: '🎚️', hint: 'The page filters as a panel of buttons, down the side of the report' },
  { value: 'leaderboard', label: 'Leaderboard', icon: '🏆', hint: 'Rank a column by any metrics you choose' },
  { value: 'table', label: 'Data Table', icon: '📋', hint: 'Rows with drag-ordered columns, dropdowns and buttons' },
  { value: 'chart', label: 'Chart', icon: '📈', hint: 'Group a tab by a column and plot it — 11 chart styles' },
  { value: 'trend', label: 'Trend Over Time', icon: '📅', hint: 'Bucket a date column by day / week / month' },
  { value: 'pivot', label: 'Pivot Table', icon: '🧮', hint: 'Cross-tabulate two columns — rows × columns' },
  { value: 'heatmap', label: 'Heat Map', icon: '🔥', hint: 'Two columns as a colour-graded matrix' },
  { value: 'stacked', label: 'Stacked / Grouped Bars', icon: '📶', hint: 'Group by one column, split each bar by another' },
  { value: 'combo', label: 'Combo Chart', icon: '🪢', hint: 'Bars and a line on two axes — volume vs rate' },
  { value: 'scatter', label: 'Scatter / Bubble', icon: '⚬', hint: 'Plot two numeric columns against each other' },
  { value: 'gauge', label: 'Gauge / Target', icon: '🎯', hint: 'Progress toward a target, with zones and click-to-filter' },
  { value: 'activity', label: 'Activity Feed', icon: '🕒', hint: 'A live, chronological feed of the newest rows' },
  { value: 'scorecard', label: 'Scorecard', icon: '⚖️', hint: 'Compare a metric between two conditions, side by side' },
]

// ---------------------------------------------------------------------
// Time bucketing (Trend widget)
// ---------------------------------------------------------------------
export const TIME_GRAINS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

// ---------------------------------------------------------------------
// In-table controls
// ---------------------------------------------------------------------
// Dropdowns and buttons that live INSIDE one table and filter only that
// table -- distinct from the page-level filter bar, which spans widgets.
export const TABLE_CONTROL_KINDS = [
  { value: 'select', label: 'Dropdown (values from the column)' },
  { value: 'button', label: 'Button (applies a condition)' },
]

// Palette for the pop-up KPIs attached to a pipeline stage.
export const KPI_PALETTE = [
  '#4F46E5', '#0EA5E9', '#059669', '#D97706',
  '#DC2626', '#7C3AED', '#0D9488', '#DB2777',
]

// Ready-made stage colours for the pipeline builder, in funnel order.
export const STAGE_PALETTE = [
  '#3B82F6', '#14B8A6', '#0EA5E9', '#22C55E',
  '#6366F1', '#A855F7', '#F97316', '#EA580C',
]

// The standard widths, as fractions of the 12-column canvas. These are the
// ones that tile cleanly -- two halves, three thirds, four quarters -- which
// is why they're offered as named choices rather than left to arithmetic.
export const WIDTHS = [
  { value: 'sixth', label: '1/6 — narrow', units: 2, css: 'lg:col-span-2 md:col-span-4 col-span-12' },
  { value: 'quarter', label: '1/4', units: 3, css: 'lg:col-span-3 md:col-span-6 col-span-12' },
  { value: 'third', label: '1/3', units: 4, css: 'lg:col-span-4 md:col-span-6 col-span-12' },
  { value: 'fivetwelfths', label: '5/12', units: 5, css: 'lg:col-span-5 md:col-span-6 col-span-12' },
  { value: 'half', label: '1/2', units: 6, css: 'lg:col-span-6 md:col-span-6 col-span-12' },
  { value: 'seventwelfths', label: '7/12', units: 7, css: 'lg:col-span-7 col-span-12' },
  { value: 'twothird', label: '2/3', units: 8, css: 'lg:col-span-8 col-span-12' },
  { value: 'threequarter', label: '3/4', units: 9, css: 'lg:col-span-9 col-span-12' },
  { value: 'fivesixths', label: '5/6', units: 10, css: 'lg:col-span-10 col-span-12' },
  { value: 'full', label: 'Full width', units: 12, css: 'col-span-12' },
]

export function widthClass(w) {
  return (WIDTHS.find((x) => x.value === w) || WIDTHS[WIDTHS.length - 1]).css
}

// ---------------------------------------------------------------------
// Widget width: standard, or exact pixels
// ---------------------------------------------------------------------
// Two ways to size a widget, and they answer different questions.
//
// STANDARD is a fraction of the canvas. It tiles cleanly, and it stays right
// on a phone, on a laptop with the sidebar open, and on a 4K monitor --
// because it is relative to whatever room there happens to be.
//
// PIXELS is an exact number. Worth having when a widget must match a
// specific size regardless of the screen, but it cannot adapt: on a narrow
// window it is capped to the space available rather than overflowing, which
// is the only sane thing to do with a number too big for the room.

export const WIDTH_MODES = [
  { value: 'preset', label: 'Standard width', hint: 'A fraction of the canvas. Adapts to the screen.' },
  { value: 'px', label: 'Exact pixels', hint: 'A fixed size, capped when the screen is narrower.' },
]

export const MIN_WIDGET_PX = 120
export const MAX_WIDGET_PX = 3000

// ---------------------------------------------------------------------
// Exact widget width
// ---------------------------------------------------------------------
// The canvas is a 12-column masonry, so width is measured in COLUMNS rather
// than pixels: a fixed pixel width can't stay right across a phone, a
// laptop with the sidebar open, and a 4K monitor. Twelve units gives every
// useful fraction -- a sixth, a quarter, a third, five twelfths -- which is
// finer than the five named presets could offer.
export const WIDTH_UNITS = 12

/** Is this widget sized in pixels rather than as a fraction? */
export function widgetUsesPx(widget) {
  if (widget?.widthMode !== 'px') return false
  const px = Number(widget.widthPx)
  return Number.isFinite(px) && px > 0
}

/** A widget's pixel width, clamped to something renderable. */
export function widgetWidthPx(widget) {
  const px = Number(widget?.widthPx)
  if (!Number.isFinite(px) || px <= 0) return null
  return Math.min(MAX_WIDGET_PX, Math.max(MIN_WIDGET_PX, Math.round(px)))
}

/**
 * The column span for a widget sized the STANDARD way.
 *
 * `widthUnits` is still read first: pages saved while width was a bare 1-12
 * slider keep the exact span they were given.
 */
export function widthUnitsFor(widget) {
  const units = Number(widget?.widthUnits)
  if (Number.isFinite(units) && units >= 1) return Math.min(WIDTH_UNITS, Math.round(units))
  return WIDTHS.find((w) => w.value === widget?.width)?.units ?? WIDTH_UNITS
}

/** "1/4", "5/12" — how a span reads to a person. */
export function widthUnitsLabel(units) {
  const n = Math.min(WIDTH_UNITS, Math.max(1, Math.round(units || WIDTH_UNITS)))
  if (n === WIDTH_UNITS) return 'Full width'
  const named = WIDTHS.find((w) => w.units === n)
  if (named) return named.label.replace(/ —.*$/, '')
  return `${n}/12`
}

/** The named preset whose span matches, for showing a slider's position. */
export function presetForUnits(units) {
  return WIDTHS.find((w) => w.units === units)?.value || ''
}

// ---------------------------------------------------------------------
// Aggregations -- used by KPI cards and by charts
// ---------------------------------------------------------------------
export const AGGREGATIONS = [
  { value: 'count', label: 'Count of rows', needsColumn: false },
  { value: 'count_filled', label: 'Count where column is filled', needsColumn: true },
  { value: 'count_empty', label: 'Count where column is empty', needsColumn: true },
  { value: 'count_distinct', label: 'Count of distinct values', needsColumn: true },
  { value: 'percent_filled', label: '% of rows where column is filled', needsColumn: true },
  { value: 'sum', label: 'Sum (numeric)', needsColumn: true },
  { value: 'avg', label: 'Average (numeric)', needsColumn: true },
  { value: 'min', label: 'Minimum (numeric)', needsColumn: true },
  { value: 'max', label: 'Maximum (numeric)', needsColumn: true },
]

export function aggNeedsColumn(agg) {
  return (AGGREGATIONS.find((a) => a.value === agg) || {}).needsColumn !== false
}

// ---------------------------------------------------------------------
// Filter dropdown kinds (the admin-built global filter bar)
// ---------------------------------------------------------------------
export const FILTER_KINDS = [
  { value: 'select', label: 'Dropdown (single choice)' },
  { value: 'multi', label: 'Dropdown (multi choice)' },
  { value: 'text', label: 'Text search box' },
  { value: 'date', label: 'Date range (start / end)' },
  { value: 'number', label: 'Number range (min / max)' },
  // A slider carries the SAME { from, to } value shape as the number range,
  // so the filter engine treats the two identically -- only the control
  // differs. Its bounds are read from the column's real values.
  { value: 'slider', label: 'Slider — number range (two handles)' },
  { value: 'threshold', label: 'Slider — single threshold (≥ / ≤)' },
  { value: 'stepper', label: 'Slider — stepped bands' },
  { value: 'dateslider', label: 'Slider — last N days' },
  { value: 'chips', label: 'Chips (one click per value)' },
]

/** Which page filters are sliders, and so want bounds/step configuration. */
export const SLIDER_FILTER_KINDS = ['slider', 'threshold', 'stepper', 'dateslider']

// ---------------------------------------------------------------------
// Condition operators -- used by admin BUTTONS
// ---------------------------------------------------------------------
// `arity` tells the admin UI how many value inputs to render.
export const OPERATORS = [
  { value: 'equals', label: 'is exactly', arity: 1 },
  { value: 'not_equals', label: 'is not', arity: 1 },
  { value: 'contains', label: 'contains', arity: 1 },
  { value: 'not_contains', label: 'does not contain', arity: 1 },
  { value: 'starts_with', label: 'starts with', arity: 1 },
  { value: 'one_of', label: 'is one of (comma separated)', arity: 1 },
  { value: 'none_of', label: 'is none of (comma separated)', arity: 1 },
  { value: 'is_empty', label: 'is empty', arity: 0 },
  { value: 'is_not_empty', label: 'is not empty', arity: 0 },
  { value: 'gt', label: '> (number)', arity: 1 },
  { value: 'gte', label: '≥ (number)', arity: 1 },
  { value: 'lt', label: '< (number)', arity: 1 },
  { value: 'lte', label: '≤ (number)', arity: 1 },
  { value: 'between', label: 'between (number)', arity: 2 },
  { value: 'date_before', label: 'date is before', arity: 1, date: true },
  { value: 'date_after', label: 'date is after', arity: 1, date: true },
  { value: 'date_between', label: 'date is between', arity: 2, date: true },
  { value: 'last_n_days', label: 'date within last N days', arity: 1 },
  { value: 'next_n_days', label: 'date within next N days', arity: 1 },
  { value: 'greater_than_n_days', label: 'date greater than N days', arity: 1 },
  { value: 'this_month', label: 'date is this month', arity: 0 },
  { value: 'not_this_month', label: 'date is not this month', arity: 0 },
  { value: 'today', label: 'date is today', arity: 0 },
]

export function operatorMeta(op) {
  return OPERATORS.find((o) => o.value === op) || OPERATORS[0]
}

// Every one of these plots the SAME data shape -- "group a tab by a column
// and aggregate" -- so they're chart STYLES of the one chart widget rather
// than separate widget types. Adding a style needs no new editor.
export const CHART_TYPES = [
  { value: 'bar', label: 'Bar' },
  { value: 'hbar', label: 'Horizontal bar' },
  { value: 'lollipop', label: 'Lollipop' },
  { value: 'arrow', label: 'Arrow bars' },
  { value: 'arrowRow', label: 'Arrow bars (horizontal)' },
  { value: 'cylinder', label: 'Cylinder bars' },
  { value: 'circles', label: 'Nested circles' },
  { value: 'line', label: 'Line' },
  { value: 'step', label: 'Step line' },
  { value: 'area', label: 'Area' },
  { value: 'waterfall', label: 'Waterfall (running total)' },
  { value: 'pareto', label: 'Pareto (bars + cumulative %)' },
  { value: 'histogram', label: 'Histogram (distribution)' },
  { value: 'pie', label: 'Pie' },
  { value: 'donut', label: 'Donut' },
  { value: 'rose', label: 'Rose / polar area' },
  { value: 'radar', label: 'Radar' },
  { value: 'radial', label: 'Radial bars' },
  { value: 'treemap', label: 'Treemap' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'progress', label: 'Progress list' },
]

// Colour ramps for the heat map. Each is [low, high]; values in between are
// interpolated, so any number of distinct values gets a sensible colour.
export const HEAT_SCALES = [
  { value: 'indigo', label: 'Indigo', from: '#EEF2FF', to: '#4338CA' },
  { value: 'teal', label: 'Teal', from: '#ECFEFF', to: '#0F766E' },
  { value: 'amber', label: 'Amber', from: '#FFFBEB', to: '#B45309' },
  { value: 'rose', label: 'Rose', from: '#FFF1F2', to: '#BE123C' },
  { value: 'slate', label: 'Grey', from: '#F8FAFC', to: '#334155' },
]

export const PALETTE = [
  '#4F46E5', '#0EA5E9', '#22C55E', '#F59E0B', '#EF4444',
  '#A855F7', '#14B8A6', '#EC4899', '#F97316', '#64748B',
]

export const NUMBER_FORMATS = [
  { value: 'plain', label: 'Plain number' },
  { value: 'comma', label: 'Thousands separator (1,234)' },
  { value: 'inr', label: 'Indian currency (₹1,23,456)' },
  { value: 'percent', label: 'Percent (12.3%)' },
  { value: 'compact', label: 'Compact (1.2K / 3.4M)' },
]

// Random-ish stable id for new config objects.
export function uid(prefix = 'x') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

// Accepts either a bare spreadsheet ID or a full Google Sheets URL and
// returns just the ID -- admins paste whatever's in their address bar.
export function extractSheetId(input) {
  const s = String(input || '').trim()
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m ? m[1] : s
}

// An empty layout, used before an admin has configured anything.
export const EMPTY_LAYOUT = { widgets: [], filters: [], buttons: [] }
