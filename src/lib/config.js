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

export const WIDTHS = [
  { value: 'quarter', label: '1/4', css: 'lg:col-span-3 md:col-span-6 col-span-12' },
  { value: 'third', label: '1/3', css: 'lg:col-span-4 md:col-span-6 col-span-12' },
  { value: 'half', label: '1/2', css: 'lg:col-span-6 md:col-span-6 col-span-12' },
  { value: 'twothird', label: '2/3', css: 'lg:col-span-8 col-span-12' },
  { value: 'full', label: 'Full', css: 'col-span-12' },
]

export function widthClass(w) {
  return (WIDTHS.find((x) => x.value === w) || WIDTHS[4]).css
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
