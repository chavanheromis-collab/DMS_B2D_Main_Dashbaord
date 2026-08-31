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

  // -------------------------------------------------------------------
  // Metrics -- several numbers in one card, and numbers against a target
  // -------------------------------------------------------------------
  { value: 'stat', label: 'Stat Grid', icon: '🔢', hint: 'Several KPIs in one card, each with its own change and sparkline' },
  { value: 'bullet', label: 'Bullet Chart', icon: '📍', hint: 'Actual against target on one line, with good / fair / poor bands' },
  { value: 'movers', label: 'Top Movers', icon: '↕️', hint: 'What grew and what fell the most between two periods' },
  { value: 'waffle', label: 'Waffle / Pictogram', icon: '🧇', hint: 'A hundred squares, so a share is counted rather than judged' },

  // -------------------------------------------------------------------
  // Time -- shapes a date column makes that a line chart cannot
  // -------------------------------------------------------------------
  { value: 'calendar', label: 'Calendar Heat Map', icon: '📆', hint: 'A year of days as a grid — which days were busy, at a glance' },
  { value: 'gantt', label: 'Timeline / Gantt', icon: '📊', hint: 'A bar per row, from a start date to an end date' },
  { value: 'cohort', label: 'Cohort / Retention', icon: '🪜', hint: 'Groups by when they joined, tracked across the periods after' },

  // -------------------------------------------------------------------
  // Relation -- how things sit against each other, not how big they are
  // -------------------------------------------------------------------
  {
    value: 'dumbbell',
    label: 'Dumbbell / Gap',
    icon: '⟷',
    hint: 'Two numbers per category and the distance between them — quoted vs booked, target vs actual',
  },
  {
    value: 'sunburst',
    label: 'Sunburst Rings',
    icon: '◎',
    hint: 'A hierarchy as rings — region, then branch, then model, each wedge as wide as its children',
  },

  // -------------------------------------------------------------------
  // Distribution -- the shape of a column, not its total
  // -------------------------------------------------------------------
  { value: 'boxplot', label: 'Box Plot / Spread', icon: '📦', hint: 'Median, quartiles and outliers, per group' },
  { value: 'sankey', label: 'Sankey / Flow', icon: '🌊', hint: 'How rows move from one column’s values to another’s' },
  { value: 'wordcloud', label: 'Word Cloud', icon: '💬', hint: 'The words a text column is actually full of, sized by how often' },
  { value: 'profile', label: 'Column Profile', icon: '🔍', hint: 'Fill rate, distinct values and the top values of every column' },

  // -------------------------------------------------------------------
  // Canvas furniture -- things that carry no data of their own
  // -------------------------------------------------------------------
  { value: 'note', label: 'Note / Heading', icon: '📝', hint: 'A heading, a caption or a callout — text you write, on the canvas' },
  { value: 'media', label: 'Image / Media', icon: '🖼️', hint: 'A picture, a logo or a diagram from any image link' },
  { value: 'countdown', label: 'Countdown / Clock', icon: '⏳', hint: 'Time left to a date, or the time right now' },
]

/**
 * Widget types that read no rows at all.
 *
 * They still live on the canvas and are still sized, styled and ordered
 * like everything else -- but a tab picker, a blend and a set of controls
 * are meaningless on them, and offering all three is how an editor teaches
 * somebody that the settings do not mean what they say.
 */
export const DATALESS_WIDGETS = ['note', 'media', 'countdown']

export function widgetNeedsData(type) {
  return !DATALESS_WIDGETS.includes(type)
}

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
  { value: 'percent_empty', label: '% of rows where column is empty', needsColumn: true },
  { value: 'sum', label: 'Sum (numeric)', needsColumn: true },
  { value: 'avg', label: 'Average (numeric)', needsColumn: true },
  { value: 'min', label: 'Minimum (numeric)', needsColumn: true },
  { value: 'max', label: 'Maximum (numeric)', needsColumn: true },
  // --- what the middle and the tail are doing ------------------------
  // An average is the wrong answer whenever a column has outliers, which
  // in a sales sheet it always does. These are the summaries that survive
  // one enormous deal: what the typical row did, and what the extremes do.
  { value: 'median', label: 'Median — the middle row', needsColumn: true },
  { value: 'mode', label: 'Most common value (numeric)', needsColumn: true },
  { value: 'p25', label: '25th percentile — the lower quartile', needsColumn: true },
  { value: 'p75', label: '75th percentile — the upper quartile', needsColumn: true },
  { value: 'p90', label: '90th percentile', needsColumn: true },
  { value: 'p95', label: '95th percentile', needsColumn: true },
  { value: 'p99', label: '99th percentile', needsColumn: true },
  { value: 'iqr', label: 'Interquartile range, p75 − p25', needsColumn: true },
  { value: 'range', label: 'Range, max − min', needsColumn: true },
  { value: 'stddev', label: 'Standard deviation', needsColumn: true },
  { value: 'variance', label: 'Variance', needsColumn: true },
  { value: 'first', label: 'First value', needsColumn: true },
  { value: 'last', label: 'Last value', needsColumn: true },
]

/**
 * The aggregations that describe a DISTRIBUTION rather than a total.
 *
 * Worth naming because they behave differently when a widget offers to
 * compare two of them, or to draw a box: summing two medians is nonsense,
 * where summing two sums is arithmetic.
 */
export const DISTRIBUTION_AGGS = ['median', 'p25', 'p75', 'p90', 'p95', 'p99', 'iqr', 'range', 'stddev', 'variance']

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
  // --- more ramps, same two-stop shape --------------------------------
  // Each stays within ONE hue and only moves in lightness. A ramp that also
  // changes hue reads as categories rather than as a quantity, which is the
  // opposite of what a heat map is for.
  { value: 'emerald', label: 'Green', from: '#ECFDF5', to: '#065F46' },
  { value: 'sky', label: 'Sky blue', from: '#F0F9FF', to: '#075985' },
  { value: 'violet', label: 'Violet', from: '#F5F3FF', to: '#5B21B6' },
  { value: 'fuchsia', label: 'Magenta', from: '#FDF4FF', to: '#86198F' },
  { value: 'orange', label: 'Orange', from: '#FFF7ED', to: '#9A3412' },
  { value: 'lime', label: 'Lime', from: '#F7FEE7', to: '#3F6212' },
  { value: 'cyan', label: 'Cyan', from: '#ECFEFF', to: '#155E75' },
  { value: 'stone', label: 'Warm grey', from: '#FAFAF9', to: '#292524' },
  { value: 'ink', label: 'Mono (print-safe)', from: '#FFFFFF', to: '#0F172A' },
  // Long ramps that pass through a second hue on the way up. Worth having
  // where the values span orders of magnitude: a single-hue ramp runs out
  // of distinguishable steps long before the numbers do.
  { value: 'sunset', label: 'Sunset (yellow → red)', from: '#FEF9C3', to: '#9F1239' },
  { value: 'ocean', label: 'Ocean (cyan → navy)', from: '#CFFAFE', to: '#1E3A8A' },
  { value: 'forest', label: 'Forest (lime → deep green)', from: '#ECFCCB', to: '#14532D' },
  { value: 'magma', label: 'Magma (cream → plum)', from: '#FEF3C7', to: '#4C1D95' },
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
  // --- the same money, at the scale it is actually discussed in --------
  // Nobody says "one crore twenty lakh"; they say "1.2 Cr". A figure the
  // reader has to count the digits of is a figure they read wrong once.
  { value: 'inr_compact', label: 'Indian compact (₹1.2 Cr)' },
  { value: 'inr_lakh', label: 'Indian lakhs (₹12.5 L)' },
  { value: 'inr_crore', label: 'Indian crores (₹1.25 Cr)' },
  { value: 'usd', label: 'US dollars ($1,234)' },
  { value: 'usd_compact', label: 'US dollars compact ($1.2M)' },
  { value: 'eur', label: 'Euros (€1,234)' },
  { value: 'gbp', label: 'Pounds (£1,234)' },
  // --- shapes -------------------------------------------------------
  { value: 'decimal1', label: 'One decimal (1,234.5)' },
  { value: 'decimal2', label: 'Two decimals (1,234.56)' },
  { value: 'percent1', label: 'Percent, one decimal (12.3%)' },
  { value: 'signed', label: 'Always signed (+12 / −12)' },
  { value: 'signed_percent', label: 'Always signed percent (+12%)' },
  { value: 'multiple', label: 'Multiple (1.4×)' },
  { value: 'accounting', label: 'Accounting (negatives in brackets)' },
  { value: 'ordinal', label: 'Ordinal (1st, 2nd, 3rd)' },
  // --- units that are not really numbers ------------------------------
  { value: 'duration_sec', label: 'Duration from seconds (2h 14m)' },
  { value: 'duration_min', label: 'Duration from minutes (2h 14m)' },
  { value: 'duration_hr', label: 'Duration from hours (2d 6h)' },
  { value: 'days', label: 'Days (14 days)' },
  { value: 'bytes', label: 'File size (1.4 MB)' },
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
