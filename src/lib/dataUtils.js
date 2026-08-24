// Pure, column-name-agnostic helpers. Nothing in here knows anything about
// cars, enquiries or any particular sheet -- every function takes plain
// rows (objects keyed by header name) plus a column name, which is what
// lets ONE code path serve MASTER, Quotations, GOOGLE REVIEW and any tab
// an admin adds later.

export function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === ''
}

/**
 * Turns a spreadsheet cell into a number. Sheets values arrive as strings
 * and are often decorated ("₹1,20,000", "45%", "(320)", " 12 "), so strip
 * everything that isn't part of the number rather than trusting Number().
 */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (isBlank(v)) return null
  let s = String(v).trim()
  const negative = /^\(.*\)$/.test(s)
  if (negative) s = s.slice(1, -1)
  s = s.replace(/[^0-9.\-+eE]/g, '')
  if (s === '' || s === '-' || s === '.') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/**
 * Parses the date formats Google Sheets actually hands back, without
 * relying on Date.parse's US-centric guessing.
 *
 * `order` ('DMY' | 'MDY') only breaks the genuinely ambiguous case like
 * 05/06/2024 -- if either part is > 12 the real order is detected from the
 * value itself and `order` is ignored. Indian sheets are usually DMY, so
 * that's the default (configurable per page in the admin panel).
 */
export function toDate(v, order = 'DMY') {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (isBlank(v)) return null
  const s = String(v).trim()

  // ISO-ish: 2024-05-12 or 2024/05/12 (optionally with a time part)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return build(+m[1], +m[2] - 1, +m[3], s)

  // 12-May-2024 / 12 May 2024 / May 12, 2024
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo !== undefined) return build(fixYear(+m[3]), mo, +m[1], s)
  }
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{2,4})/)
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    if (mo !== undefined) return build(fixYear(+m[3]), mo, +m[2], s)
  }

  // 12/05/2024, 12-05-2024, 12.05.2024
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    let a = +m[1]
    let b = +m[2]
    let day
    let mon
    if (a > 12) {
      day = a
      mon = b
    } else if (b > 12) {
      mon = a
      day = b
    } else if (order === 'MDY') {
      mon = a
      day = b
    } else {
      day = a
      mon = b
    }
    return build(fixYear(+m[3]), mon - 1, day, s)
  }

  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed

  function fixYear(y) {
    if (y >= 1000) return y
    return y < 70 ? 2000 + y : 1900 + y
  }

  function build(y, mo, d, src) {
    // Carry the time-of-day through when the cell has one, so "today"
    // style conditions behave sensibly on timestamp columns.
    const t = src.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    const date = new Date(y, mo, d, t ? +t[1] : 0, t ? +t[2] : 0, t && t[3] ? +t[3] : 0)
    return Number.isNaN(date.getTime()) ? null : date
  }
}

export function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

/** Parses the yyyy-mm-dd value an <input type="date"> produces. */
export function fromDateInput(s) {
  if (isBlank(s)) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return toDate(s)
  return new Date(+m[1], +m[2] - 1, +m[3])
}

/**
 * Normalises a key cell so real-world sheet data still matches.
 *
 * Sheet keys are notoriously inconsistent -- " SO-1001 " vs "SO-1001", and
 * an order number that Sheets stored as the number 1001 on one tab and the
 * text "1,001" on another. Numbers are compared numerically when BOTH sides
 * parse as numbers, and as trimmed lower-case text otherwise, so neither
 * case silently produces zero matches.
 */
export function normalizeKey(value) {
  if (isBlank(value)) return null
  const text = String(value).trim()
  // A bare number (possibly comma-grouped / currency-decorated) compares
  // numerically, so 1001 === "1,001" === "1001.0".
  if (/^[\s₹$€£]*-?[\d,]+(\.\d+)?[\s%]*$/.test(text)) {
    const n = toNumber(text)
    if (n !== null) return `n:${n}`
  }
  return `s:${text.toLowerCase()}`
}

// ---------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------
export function aggregate(rows, column, agg) {
  const list = rows || []
  if (agg === 'count') return list.length
  if (!column) return 0

  const raw = list.map((r) => r[column])

  switch (agg) {
    case 'count_filled':
      return raw.filter((v) => !isBlank(v)).length
    case 'count_empty':
      return raw.filter((v) => isBlank(v)).length
    case 'count_distinct':
      return new Set(raw.filter((v) => !isBlank(v)).map((v) => String(v).trim())).size
    case 'percent_filled': {
      if (list.length === 0) return 0
      return (raw.filter((v) => !isBlank(v)).length / list.length) * 100
    }
    default: {
      const nums = raw.map(toNumber).filter((n) => n !== null)
      if (nums.length === 0) return 0
      if (agg === 'sum') return nums.reduce((a, b) => a + b, 0)
      if (agg === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
      if (agg === 'min') return Math.min(...nums)
      if (agg === 'max') return Math.max(...nums)
      return 0
    }
  }
}

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------
export function formatNumber(value, format = 'comma', agg) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const n = Number(value)
  const isCounty = ['count', 'count_filled', 'count_empty', 'count_distinct'].includes(agg)
  const decimals = isCounty ? 0 : Math.abs(n) >= 100 || Number.isInteger(n) ? 0 : 1

  if (agg === 'percent_filled' && format !== 'plain') {
    return `${n.toFixed(n >= 10 ? 0 : 1)}%`
  }

  switch (format) {
    case 'percent':
      return `${n.toFixed(n >= 10 ? 0 : 1)}%`
    case 'inr':
      return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: decimals })}`
    case 'compact':
      return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
    case 'plain':
      return String(Number(n.toFixed(decimals)))
    case 'comma':
    default:
      return n.toLocaleString('en-IN', { maximumFractionDigits: decimals })
  }
}

// ---------------------------------------------------------------------
// Grouping (charts)
// ---------------------------------------------------------------------
/**
 * Groups rows by `groupBy` and aggregates `valueColumn` within each group.
 * Returns [{ name, value }] ready for recharts.
 */
export function groupRows(rows, { groupBy, valueColumn, aggregation = 'count', limit = 12, sort = 'value_desc', includeBlank = false }) {
  if (!groupBy) return []
  const buckets = new Map()
  for (const row of rows || []) {
    const raw = row[groupBy]
    if (isBlank(raw) && !includeBlank) continue
    const key = isBlank(raw) ? '(blank)' : String(raw).trim()
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }

  let out = Array.from(buckets.entries()).map(([name, groupedRows]) => ({
    name,
    value: aggregate(groupedRows, valueColumn, aggregation),
    count: groupedRows.length,
  }))

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  if (sort === 'value_desc') out.sort((a, b) => b.value - a.value)
  else if (sort === 'value_asc') out.sort((a, b) => a.value - b.value)
  else if (sort === 'name_asc') out.sort((a, b) => collator.compare(a.name, b.name))
  else if (sort === 'name_desc') out.sort((a, b) => collator.compare(b.name, a.name))

  if (limit && out.length > limit) out = out.slice(0, limit)
  return out
}

/**
 * Groups rows by one column and splits each group by a SECOND column --
 * the data behind a stacked or grouped bar chart.
 *
 * Returns `{ data, series }` where each `data` entry is one bar
 * (`{ name, [seriesName]: value }`) and `series` lists the stack segments in
 * a stable order.
 *
 * Both axes are capped independently: a chart with 400 bars is unreadable,
 * and one with 40 stack segments is worse -- the legend alone would fill the
 * card. Segments beyond `maxSeries` are merged into "Other" rather than
 * dropped, so the bar heights still add up to the real total.
 */
export function groupStacked(rows, {
  groupBy,
  stackBy,
  valueColumn,
  aggregation = 'count',
  limit = 12,
  maxSeries = 8,
  sort = 'value_desc',
}) {
  if (!groupBy || !stackBy) return { data: [], series: [] }

  const groups = new Map()
  const seriesTotals = new Map()

  for (const row of rows || []) {
    const g = isBlank(row[groupBy]) ? '(blank)' : String(row[groupBy]).trim()
    const s = isBlank(row[stackBy]) ? '(blank)' : String(row[stackBy]).trim()
    if (!groups.has(g)) groups.set(g, new Map())
    const bucket = groups.get(g)
    if (!bucket.has(s)) bucket.set(s, [])
    bucket.get(s).push(row)
    seriesTotals.set(s, (seriesTotals.get(s) || 0) + 1)
  }

  const topSeries = Array.from(seriesTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSeries)
    .map((e) => e[0])
  const keep = new Set(topSeries)
  const hasOther = seriesTotals.size > topSeries.length
  const series = hasOther ? [...topSeries, 'Other'] : topSeries

  let data = Array.from(groups.entries()).map(([name, bucket]) => {
    const entry = { name, __total: 0 }
    for (const key of series) entry[key] = 0
    for (const [s, groupedRows] of bucket.entries()) {
      const key = keep.has(s) ? s : 'Other'
      const value = aggregate(groupedRows, valueColumn, aggregation)
      entry[key] = (entry[key] || 0) + value
      entry.__total += value
    }
    return entry
  })

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  if (sort === 'value_desc') data.sort((a, b) => b.__total - a.__total)
  else if (sort === 'value_asc') data.sort((a, b) => a.__total - b.__total)
  else if (sort === 'name_asc') data.sort((a, b) => collator.compare(a.name, b.name))
  else if (sort === 'name_desc') data.sort((a, b) => collator.compare(b.name, a.name))

  if (limit && data.length > limit) data = data.slice(0, limit)
  return { data, series }
}

/**
 * Groups rows by one column and computes SEVERAL aggregations per group --
 * the data behind a combo chart ("count of orders" as bars against "average
 * turnaround" as a line).
 *
 * `series` is `[{ key, column, aggregation }]`; each becomes a numeric field
 * on every returned entry.
 */
export function groupSeries(rows, { groupBy, series = [], limit = 12, sort = 'value_desc' }) {
  if (!groupBy || series.length === 0) return []

  const buckets = new Map()
  for (const row of rows || []) {
    const key = isBlank(row[groupBy]) ? '(blank)' : String(row[groupBy]).trim()
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }

  let out = Array.from(buckets.entries()).map(([name, groupedRows]) => {
    const entry = { name, count: groupedRows.length }
    for (const s of series) entry[s.key] = aggregate(groupedRows, s.column, s.aggregation || 'count')
    return entry
  })

  // Sorting by value means the FIRST series -- the one drawn as bars, and so
  // the one a reader takes as the chart's subject.
  const primary = series[0]?.key
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  if (sort === 'value_desc') out.sort((a, b) => (b[primary] || 0) - (a[primary] || 0))
  else if (sort === 'value_asc') out.sort((a, b) => (a[primary] || 0) - (b[primary] || 0))
  else if (sort === 'name_asc') out.sort((a, b) => collator.compare(a.name, b.name))
  else if (sort === 'name_desc') out.sort((a, b) => collator.compare(b.name, a.name))

  if (limit && out.length > limit) out = out.slice(0, limit)
  return out
}

/**
 * Turns rows into scatter/bubble points. Rows where either axis isn't a
 * number are skipped -- a scatter plot can't place them, and silently
 * treating them as zero would invent a cluster at the origin that isn't
 * real.
 *
 * With `groupBy`, returns one series per distinct value so each renders in
 * its own colour; without it, a single unnamed series.
 */
export function scatterPoints(rows, { xColumn, yColumn, sizeColumn, groupBy, labelColumn, limit = 400, maxSeries = 8 }) {
  if (!xColumn || !yColumn) return []

  const bySeries = new Map()
  let taken = 0

  for (const row of rows || []) {
    if (taken >= limit) break
    const x = toNumber(row[xColumn])
    const y = toNumber(row[yColumn])
    if (x === null || y === null) continue

    const name = groupBy ? (isBlank(row[groupBy]) ? '(blank)' : String(row[groupBy]).trim()) : 'All rows'
    if (!bySeries.has(name)) bySeries.set(name, [])
    bySeries.get(name).push({
      x,
      y,
      z: sizeColumn ? toNumber(row[sizeColumn]) ?? 1 : 1,
      label: labelColumn ? String(row[labelColumn] ?? '') : '',
    })
    taken += 1
  }

  return Array.from(bySeries.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxSeries)
    .map(([name, points]) => ({ name, points }))
}

/**
 * Buckets a NUMERIC column into equal-width bins -- a histogram.
 *
 * The one chart shape that doesn't group by a category: it answers "how are
 * these numbers distributed", which no amount of grouping by another column
 * can tell you. Rows without a number are skipped rather than counted as
 * zero, which would invent a spike at the bottom of the range.
 *
 * Each bin carries `from`/`to` so clicking one can drill to a real range
 * rather than to a label that only looks like one.
 */
export function histogram(rows, { column, bins = 12, min: pinnedMin, max: pinnedMax }) {
  if (!column) return []

  const values = []
  for (const row of rows || []) {
    const n = toNumber(row[column])
    if (n !== null) values.push(n)
  }
  if (values.length === 0) return []

  const lo = toNumber(pinnedMin) ?? Math.min(...values)
  const hi = toNumber(pinnedMax) ?? Math.max(...values)
  const count = Math.max(2, Math.min(60, Math.round(bins) || 12))

  // Every value identical: one bin is the honest answer, and it avoids a
  // zero-width step that would divide by zero below.
  if (hi === lo) return [{ name: String(lo), value: values.length, from: lo, to: lo }]

  const step = (hi - lo) / count
  const buckets = new Array(count).fill(0)

  for (const n of values) {
    if (n < lo || n > hi) continue
    // The final bin is closed at the top, so the maximum value lands in the
    // last bucket instead of falling off the end.
    const index = n === hi ? count - 1 : Math.floor((n - lo) / step)
    buckets[index] += 1
  }

  const round = (n) => Number(n.toFixed(Math.abs(step) < 1 ? 2 : 0))
  return buckets.map((value, i) => {
    const from = lo + i * step
    const to = from + step
    return { name: `${round(from)}–${round(to)}`, value, from, to }
  })
}

/** Distinct, sorted values of a column -- powers admin-built dropdowns. */
export function distinctValues(rows, column, cap = 500) {
  if (!column) return []
  const set = new Set()
  for (const r of rows || []) {
    const v = r[column]
    if (!isBlank(v)) set.add(String(v).trim())
    if (set.size >= cap) break
  }
  return Array.from(set).sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare)
}

/** Columns that look like they hold dates -- used to pre-select in admin. */
export function looksLikeDateColumn(name) {
  return /date|day|時|timestamp|created|updated|on$/i.test(String(name || ''))
}

/**
 * Counts rows per day over the last `days` days using a date column --
 * the little trend line under each pipeline stage. Returns a plain array
 * of counts, oldest first, so it can be drawn as a sparkline directly.
 */
export function dailyCounts(rows, dateColumn, days = 30, order = 'DMY') {
  if (!dateColumn) return []
  const buckets = new Array(days).fill(0)
  const today = startOfDay(new Date()).getTime()
  for (const row of rows || []) {
    const d = toDate(row[dateColumn], order)
    if (!d) continue
    const age = Math.floor((today - startOfDay(d).getTime()) / 86400000)
    if (age >= 0 && age < days) buckets[days - 1 - age] += 1
  }
  return buckets
}

/**
 * A stable, pleasant colour for an arbitrary text value -- used to render
 * status-ish columns as coloured pills without anyone configuring a
 * colour per value by hand.
 */
const BADGE_COLORS = [
  { bg: '#EFF6FF', fg: '#1D4ED8' }, { bg: '#ECFDF5', fg: '#047857' },
  { bg: '#FEF3C7', fg: '#B45309' }, { bg: '#FCE7F3', fg: '#BE185D' },
  { bg: '#EDE9FE', fg: '#6D28D9' }, { bg: '#E0F2FE', fg: '#0369A1' },
  { bg: '#FFEDD5', fg: '#C2410C' }, { bg: '#F1F5F9', fg: '#475569' },
]

export function badgeColor(value) {
  const s = String(value ?? '')
  let hash = 0
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return BADGE_COLORS[hash % BADGE_COLORS.length]
}

// ---------------------------------------------------------------------
// Time bucketing (Trend widget)
// ---------------------------------------------------------------------
/** Start of the week (Monday) containing d. */
function startOfWeek(d) {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7 // Mon = 0
  x.setDate(x.getDate() - dow)
  return x
}

/**
 * Buckets rows by a date column into day/week/month/quarter/year and
 * aggregates within each bucket. Unlike groupRows (which groups by a raw
 * cell value), this understands dates, so it fills EMPTY periods with zero
 * -- otherwise a month with no sales silently vanishes and the line implies
 * continuity that isn't there.
 */
export function timeSeries(rows, { dateColumn, grain = 'month', valueColumn, aggregation = 'count', order = 'DMY', maxBuckets = 36 }) {
  if (!dateColumn) return []

  const keyed = new Map()
  let min = null
  let max = null

  for (const row of rows || []) {
    const d = toDate(row[dateColumn], order)
    if (!d) continue
    const b = bucketStart(d, grain)
    const k = b.getTime()
    if (!keyed.has(k)) keyed.set(k, [])
    keyed.get(k).push(row)
    if (min === null || k < min) min = k
    if (max === null || k > max) max = k
  }
  if (min === null) return []

  const out = []
  let cursor = new Date(min)
  while (cursor.getTime() <= max && out.length < maxBuckets * 4) {
    const k = cursor.getTime()
    const bucketRows = keyed.get(k) || []
    const next = nextBucket(cursor, grain)
    out.push({
      name: bucketLabel(cursor, grain),
      value: aggregate(bucketRows, valueColumn, aggregation),
      count: bucketRows.length,
      // The bucket's real span, so clicking it can filter to a DATE RANGE.
      // "Mar 26" is a caption, not a value any row holds, and reverse
      // engineering the range from the label would be guesswork.
      start: new Date(cursor),
      end: new Date(next.getTime() - 1),
    })
    cursor = next
  }
  return out.length > maxBuckets ? out.slice(out.length - maxBuckets) : out
}

export function bucketStart(d, grain) {
  const x = startOfDay(d)
  if (grain === 'week') return startOfWeek(x)
  if (grain === 'month') return new Date(x.getFullYear(), x.getMonth(), 1)
  if (grain === 'quarter') return new Date(x.getFullYear(), Math.floor(x.getMonth() / 3) * 3, 1)
  if (grain === 'year') return new Date(x.getFullYear(), 0, 1)
  return x
}

export function nextBucket(d, grain) {
  const x = new Date(d)
  if (grain === 'week') x.setDate(x.getDate() + 7)
  else if (grain === 'month') x.setMonth(x.getMonth() + 1)
  else if (grain === 'quarter') x.setMonth(x.getMonth() + 3)
  else if (grain === 'year') x.setFullYear(x.getFullYear() + 1)
  else x.setDate(x.getDate() + 1)
  return x
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function bucketLabel(d, grain) {
  if (grain === 'year') return String(d.getFullYear())
  if (grain === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${String(d.getFullYear()).slice(2)}`
  if (grain === 'month') return `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
  return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`
}

// ---------------------------------------------------------------------
// Pivot table
// ---------------------------------------------------------------------
/**
 * Cross-tabulates rows by two columns. Returns row labels, column labels,
 * the cell matrix and both sets of totals, so the widget can render a full
 * contingency table without recomputing anything.
 */
/** The composite key several grouping columns make for one row. */
const PART_SEP = ' / '

function compositeKey(row, columns) {
  return columns
    .map((c) => (isBlank(row[c]) ? '(blank)' : String(row[c]).trim()))
    .join(PART_SEP)
}

/** Splits a composite label back into its parts, for indented rendering. */
export function splitPivotLabel(label) {
  return String(label ?? '').split(PART_SEP)
}

// ---------------------------------------------------------------------
// Hierarchical pivot (one column per level, parent cells merged)
// ---------------------------------------------------------------------
/**
 * Groups rows down several levels and returns them ready to render as a
 * table with ONE COLUMN PER LEVEL and repeated parent values merged into a
 * single spanning cell:
 *
 *   Model        SKU               Color   Stock
 *   SPLENDOR +   HSPLMDRSCFIBHG    BHG       159
 *                HSPUNIRSCFIBLA    BLA        63
 *                HSPLMDRSCFISBK    SBK        37
 *   HF DELUXE    HDLHADRSCFISBK    SBK        85
 *
 * This is a different shape from the composite-label pivot: there, "SPLENDOR
 * + / HSPL… / BHG" is one string in one cell. Here each level is its own
 * column and the parent is written once, which is what makes a long list
 * readable -- the eye finds the group boundaries instead of re-reading the
 * same model name forty times.
 *
 * Returns `{ columns, rows, grandTotal }` where each row carries:
 *   parts     the value at each level
 *   value     the aggregate for that leaf
 *   spans     rowspan per level; 0 means "covered by the cell above", so the
 *             renderer simply skips that cell
 *   subtotals the aggregate of the whole group at each level
 */
export function pivotTree(rows, {
  rowColumns,
  valueColumn,
  aggregation = 'count',
  sort = 'value_desc',
  maxGroups = 0,
  maxRows = 400,
}) {
  const columns = (rowColumns || []).filter(Boolean)
  if (columns.length === 0) return { columns: [], rows: [], grandTotal: 0 }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  function sortNodes(nodes) {
    if (sort === 'value_asc') return nodes.sort((a, b) => a.value - b.value)
    if (sort === 'name_asc') return nodes.sort((a, b) => collator.compare(a.label, b.label))
    if (sort === 'name_desc') return nodes.sort((a, b) => collator.compare(b.label, a.label))
    return nodes.sort((a, b) => b.value - a.value)
  }

  /**
   * Sorting happens at EVERY level, not just the leaves: a group ordered by
   * its own total, with its children ordered by theirs, is what makes the
   * biggest thing appear first at every depth.
   */
  function build(list, depth) {
    const buckets = new Map()
    for (const row of list) {
      const key = isBlank(row[columns[depth]]) ? '(blank)' : String(row[columns[depth]]).trim()
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(row)
    }

    const nodes = Array.from(buckets.entries()).map(([label, groupRows]) => ({
      label,
      value: aggregate(groupRows, valueColumn, aggregation),
      children: depth + 1 < columns.length ? build(groupRows, depth + 1) : null,
    }))

    return sortNodes(nodes)
  }

  let tree = build(rows || [], 0)
  if (maxGroups > 0 && tree.length > maxGroups) tree = tree.slice(0, maxGroups)

  // Flatten depth-first into leaf rows, each carrying the aggregate of every
  // ancestor so the renderer can show group subtotals without walking back
  // up the tree.
  const flat = []
  ;(function walk(nodes, parts, subtotals) {
    for (const node of nodes) {
      const nextParts = [...parts, node.label]
      const nextSubs = [...subtotals, node.value]
      if (node.children?.length) walk(node.children, nextParts, nextSubs)
      else flat.push({ parts: nextParts, value: node.value, subtotals: nextSubs })
      if (flat.length >= maxRows) return
    }
  })(tree, [], [])

  const capped = flat.slice(0, maxRows)

  // --- Row spans ---------------------------------------------------------
  // A cell spans every following row that shares its whole prefix. Computed
  // in a second pass over the flattened list rather than during the walk:
  // the tree was capped by `maxRows`, so a span worked out from the tree
  // could claim more rows than actually got rendered.
  const depth = columns.length
  const spans = capped.map(() => new Array(depth).fill(0))

  const samePrefix = (a, b, level) => {
    for (let i = 0; i <= level; i += 1) if (a.parts[i] !== b.parts[i]) return false
    return true
  }

  for (let level = 0; level < depth; level += 1) {
    let i = 0
    while (i < capped.length) {
      let j = i
      while (j + 1 < capped.length && samePrefix(capped[j + 1], capped[i], level)) j += 1
      spans[i][level] = j - i + 1
      i = j + 1
    }
  }

  return {
    columns,
    rows: capped.map((row, i) => ({ ...row, spans: spans[i] })),
    grandTotal: capped.reduce((sum, row) => sum + row.value, 0),
  }
}

/**
 * Cross-tabulates rows. Returns row labels, column labels, the cell matrix
 * and both sets of totals, so a widget can render a full contingency table
 * without recomputing anything.
 *
 * Either axis may cross SEVERAL columns: grouping rows by Region and DSE
 * gives one row per real combination ("West / Ravi"), which is the only way
 * to get a genuine breakdown rather than two separate pivots side by side.
 *
 * Omitting the column axis entirely collapses the pivot to a single "Total"
 * column. That is what makes the totals-only display a VIEW of the same
 * data rather than a second code path that could disagree with the matrix.
 */
export function pivot(rows, {
  rowColumn,
  colColumn,
  rowColumns,
  colColumns,
  valueColumn,
  aggregation = 'count',
  maxRows = 25,
  maxCols = 12,
}) {
  // Single-column callers keep working untouched: the original two props are
  // simply the one-element case of the new ones.
  const rowCols = (rowColumns && rowColumns.length ? rowColumns : [rowColumn]).filter(Boolean)
  const colCols = (colColumns && colColumns.length ? colColumns : [colColumn]).filter(Boolean)

  const empty = {
    rowLabels: [],
    colLabels: [],
    matrix: [],
    rowTotals: [],
    colTotals: [],
    grandTotal: 0,
    rowColumns: rowCols,
    colColumns: colCols,
  }
  if (rowCols.length === 0) return empty

  const cells = new Map()
  const rowCounts = new Map()
  const colCounts = new Map()

  for (const row of rows || []) {
    const r = compositeKey(row, rowCols)
    const c = colCols.length ? compositeKey(row, colCols) : 'Total'
    // A NUL separator can never occur inside a real cell value, so two
    // different (row, column) pairs can never collide on one key.
    const key = r + '\u0000' + c
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(row)
    rowCounts.set(r, (rowCounts.get(r) || 0) + 1)
    colCounts.set(c, (colCounts.get(c) || 0) + 1)
  }

  // Keep the biggest rows/columns -- a pivot with 400 columns is unreadable.
  const rank = (m, cap) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, cap).map((e) => e[0])
  const rowLabels = rank(rowCounts, maxRows)
  const colLabels = rank(colCounts, maxCols)

  const matrix = rowLabels.map((r) =>
    colLabels.map((c) => aggregate(cells.get(r + '\u0000' + c) || [], valueColumn, aggregation))
  )
  const rowTotals = matrix.map((line) => line.reduce((a, b) => a + b, 0))
  const colTotals = colLabels.map((_, ci) => matrix.reduce((sum, line) => sum + line[ci], 0))
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0)

  return { rowLabels, colLabels, matrix, rowTotals, colTotals, grandTotal, rowColumns: rowCols, colColumns: colCols }
}

// ---------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------
/**
 * Short, human "how long ago" text -- "3h ago", "just now", "5d ago".
 * Deliberately coarse (no exact timestamps) since a feed is for a quick
 * glance, not an audit log.
 */
export function relativeTime(date) {
  if (!date) return ''
  const diffMs = Date.now() - date.getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(days / 365)}y ago`
}

/**
 * The newest N rows by a date column, each carrying its parsed date so the
 * feed can show relative time without re-parsing. Rows with an unparseable
 * date sort last rather than crashing the ordering.
 */
export function recentRows(rows, dateColumn, limit = 20, order = 'DMY') {
  if (!dateColumn) return []
  const withDates = (rows || []).map((row) => ({ row, date: toDate(row[dateColumn], order) }))
  withDates.sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.getTime() - a.date.getTime()
  })
  return withDates.slice(0, limit)
}
