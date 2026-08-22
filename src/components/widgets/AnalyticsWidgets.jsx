import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  timeSeries,
  pivot,
  pivotTree,
  splitPivotLabel,
  aggregate,
  formatNumber,
  toNumber,
} from '../../lib/dataUtils'
import { matchesConditions } from '../../lib/filterEngine'
import { MousePointerClick } from 'lucide-react'

// =====================================================================
// Trend over time
// =====================================================================
/**
 * Groups a date column into day/week/month buckets. Distinct from the
 * plain Chart widget, which groups by a raw cell value: this one
 * understands dates, keeps buckets in chronological order, and fills empty
 * periods with zero so a quiet month reads as a dip rather than vanishing.
 */
export function TrendWidget({ widget, rows, unfilteredRows, tabError, dateOrder, onCrossFilter, crossFilters = [] }) {
  const source = widget.ignoreFilters ? unfilteredRows : rows

  const data = useMemo(
    () =>
      timeSeries(source, {
        dateColumn: widget.dateColumn,
        grain: widget.grain || 'month',
        valueColumn: widget.column,
        aggregation: widget.aggregation || 'count',
        order: dateOrder,
      }),
    [source, widget.dateColumn, widget.grain, widget.column, widget.aggregation, dateOrder]
  )

  const color = widget.color || '#4F46E5'
  const type = widget.chartType || 'area'

  const activeBucket = crossFilters.find((cf) => cf.id === `trend_${widget.id}`)?.label

  /**
   * Clicking a bucket filters the dashboard to that PERIOD.
   *
   * A trend's x-axis holds labels like "Mar 26", which no row contains, so
   * this drills on the bucket's real date span rather than on its caption --
   * the same reasoning as a histogram bin. `timeSeries` already knows where
   * each bucket starts and ends, so the range is exact rather than reverse
   * engineered from the label.
   */
  function drill(state) {
    const bucketName = state?.activeLabel ?? state?.activePayload?.[0]?.payload?.name
    if (!bucketName || !onCrossFilter || !widget.dateColumn) return

    const bucket = data.find((d) => d.name === bucketName)
    if (!bucket?.start || !bucket?.end) return

    const iso = (d) => new Date(d).toISOString().slice(0, 10)
    onCrossFilter({
      id: `trend_${widget.id}`,
      kind: 'conditions',
      tab: widget.tab,
      match: 'all',
      conditions: [
        {
          tab: widget.tab,
          column: widget.dateColumn,
          operator: 'date_between',
          value: iso(bucket.start),
          value2: iso(bucket.end),
        },
      ],
      icon: '📅',
      label: bucketName,
    })
  }

  const onClick = onCrossFilter ? drill : undefined
  const cursor = onCrossFilter ? { cursor: 'pointer' } : {}
  /** Everything outside the drilled bucket recedes. */
  const dim = (entry) => (activeBucket && activeBucket !== entry.name ? 0.3 : 1)

  // A simple first-half vs second-half comparison — enough to say which way
  // things are moving without pretending to be a forecast.
  const momentum = useMemo(() => {
    if (data.length < 4) return null
    const half = Math.floor(data.length / 2)
    const older = data.slice(0, half).reduce((a, b) => a + b.value, 0) / half
    const recent = data.slice(half).reduce((a, b) => a + b.value, 0) / (data.length - half)
    if (older === 0) return null
    return Math.round(((recent - older) / older) * 100)
  }, [data])

  return (
    <div className="card flex h-full flex-col">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="widget-title">📅 {widget.title}</h2>
          <p className="text-[11px] text-slate-400">
            {widget.tab} · {widget.dateColumn || '—'} by {widget.grain || 'month'}
            {onCrossFilter && ' · click a period to drill in'}
          </p>
        </div>
        {momentum !== null && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              momentum >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            }`}
            title="Recent half vs earlier half of the period shown"
          >
            {momentum >= 0 ? '▲' : '▼'} {Math.abs(momentum)}%
          </span>
        )}
      </div>

      {tabError ? (
        <p className="py-10 text-center text-sm text-rose-500">Tab “{widget.tab}” could not be read</p>
      ) : data.length === 0 ? (
        <p className="empty-state">
          {widget.dateColumn ? 'No parseable dates in that column' : 'Pick a date column in the admin panel'}
        </p>
      ) : (
        <div className="min-h-[200px] flex-1">
          <ResponsiveContainer width="100%" height={widget.height || 240}>
            {type === 'bar' ? (
              <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -14 }} onClick={onClick} {...cursor}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="value" radius={[5, 5, 0, 0]}>
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={color} fillOpacity={dim(entry)} cursor={onCrossFilter ? 'pointer' : 'default'} />
                  ))}
                </Bar>
              </BarChart>
            ) : type === 'line' ? (
              <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -14 }} onClick={onClick} {...cursor}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 2, cursor: onCrossFilter ? 'pointer' : 'default' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            ) : (
              <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -14 }} onClick={onClick} {...cursor}>
                <defs>
                  <linearGradient id={`tg_${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#tg_${widget.id})`}
                  dot={{ r: 2, cursor: onCrossFilter ? 'pointer' : 'default' }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Pivot table
// =====================================================================
/**
 * Cross-tabulates columns — "models × stages", "DSE × month".
 *
 * Either axis can cross SEVERAL columns, giving one row per real combination
 * ("West / Ravi") rather than two pivots side by side. Dropping the column
 * axis entirely, or choosing "Totals only", collapses it to a ranked list of
 * row totals — the same data, read a different way.
 *
 * Cells are heat-shaded relative to the largest value so the shape of the
 * data is visible at a glance, and clicking one drills the dashboard into
 * that exact combination.
 */
export function PivotWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = widget.ignoreFilters ? unfilteredRows : rows

  // Back-compat: the original single-column props are the one-element case.
  const rowCols = widget.rowColumns?.length ? widget.rowColumns : [widget.rowColumn].filter(Boolean)
  const colCols = widget.colColumns?.length ? widget.colColumns : [widget.colColumn].filter(Boolean)
  const totalsOnly = widget.display === 'totals'

  const { rowLabels, colLabels, matrix, rowTotals, colTotals, grandTotal } = useMemo(
    () =>
      pivot(source, {
        rowColumns: rowCols,
        // "Totals only" is expressed by asking for no column axis at all, so
        // it shares one code path with the matrix rather than being a second
        // implementation that could disagree with it.
        colColumns: totalsOnly ? [] : colCols,
        valueColumn: widget.column,
        aggregation: widget.aggregation || 'count',
        maxRows: widget.maxRows || 25,
        maxCols: widget.maxCols || 12,
      }),
    [source, rowCols.join('|'), colCols.join('|'), totalsOnly, widget.column, widget.aggregation, widget.maxRows, widget.maxCols]
  )

  // The totals view renders as a grouped hierarchy -- one column per level,
  // parent values written once and merged down their children.
  const tree = useMemo(
    () =>
      totalsOnly
        ? pivotTree(source, {
            rowColumns: rowCols,
            valueColumn: widget.column,
            aggregation: widget.aggregation || 'count',
            sort: widget.sort || 'value_desc',
            maxGroups: widget.maxGroups || 0,
            maxRows: widget.maxRows || 400,
          })
        : null,
    [totalsOnly, source, rowCols.join('|'), widget.column, widget.aggregation, widget.sort, widget.maxGroups, widget.maxRows]
  )

  const max = useMemo(() => Math.max(1, ...matrix.flat()), [matrix])
  const color = widget.color || '#4F46E5'

  /**
   * Every part of a composite label has to become its own condition, or a
   * "West / Ravi" drill would filter on a value no single column holds.
   */
  function conditionsFor(columns, label) {
    const parts = splitPivotLabel(label)
    return columns.map((column, i) => ({
      tab: widget.tab,
      column,
      operator: 'equals',
      value: parts[i] ?? '',
    }))
  }

  function drill(rowLabel, colLabel) {
    if (!onCrossFilter) return
    onCrossFilter({
      id: `pivot_${widget.id}`,
      kind: 'conditions',
      tab: widget.tab,
      match: 'all',
      conditions: [
        ...conditionsFor(rowCols, rowLabel),
        ...(totalsOnly || !colLabel ? [] : conditionsFor(colCols, colLabel)),
      ],
      label: totalsOnly ? rowLabel : `${rowLabel} × ${colLabel}`,
    })
  }

  /**
   * Drilling a whole ROW or a whole COLUMN from its header, rather than only
   * a single cell. "All of March" and "everything for West" are the two
   * questions a pivot invites most, and both used to need a trip to the
   * filter bar.
   */
  function drillAxis(rowLabel, colLabel) {
    if (!onCrossFilter) return
    onCrossFilter({
      id: `pivot_${widget.id}`,
      kind: 'conditions',
      tab: widget.tab,
      match: 'all',
      conditions: rowLabel ? conditionsFor(rowCols, rowLabel) : conditionsFor(colCols, colLabel),
      label: rowLabel || colLabel,
    })
  }

  const rowHeading = rowCols.join(' / ') || '—'

  return (
    <div className="card">
      <div className="mb-2">
        <h2 className="widget-title">🧮 {widget.title}</h2>
        <p className="text-[11px] text-slate-400">
          {widget.tab} · {rowHeading}
          {!totalsOnly && colCols.length > 0 && ` × ${colCols.join(' / ')}`}
          {totalsOnly && ' · totals only'}
        </p>
      </div>

      {tabError ? (
        <p className="py-8 text-center text-sm text-rose-500">Tab “{widget.tab}” could not be read</p>
      ) : totalsOnly ? (
        <PivotTree
          tree={tree}
          widget={widget}
          color={color}
          onDrill={onCrossFilter ? (parts) => drill(parts.join(' / '), null) : null}
        />
      ) : rowLabels.length === 0 ? (
        <p className="empty-state">Pick at least one row column in the admin panel</p>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 px-2 py-2 text-left font-medium text-slate-500">
                  {rowHeading}
                </th>
                {!totalsOnly &&
                  colLabels.map((c) => (
                    <th
                      key={c}
                      // A column header drills to that whole column. Being
                      // able to click only the cells meant "all of March"
                      // took a filter change instead of a click.
                      onClick={() => onCrossFilter && drillAxis(null, c)}
                      className={`whitespace-nowrap px-2 py-2 text-right font-medium text-slate-500 ${
                        onCrossFilter ? 'cursor-pointer hover:text-indigo-600' : ''
                      }`}
                      title={onCrossFilter ? `Filter to ${c}` : c}
                    >
                      {c}
                    </th>
                  ))}
                <th className="px-2 py-2 text-right font-semibold text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {rowLabels.map((r, ri) => (
                <tr key={r} className="border-t border-slate-50">
                  <td
                    className={`sticky left-0 z-10 max-w-[220px] truncate bg-white px-2 py-1.5 font-medium text-slate-700 ${
                      onCrossFilter ? 'cursor-pointer hover:text-indigo-600' : ''
                    }`}
                    title={onCrossFilter ? `Filter to ${r}` : r}
                    // A row header drills to the WHOLE row, in the matrix as
                    // well as the totals view -- "everything for West" is one
                    // of the two questions a pivot invites most.
                    onClick={() => onCrossFilter && drillAxis(r, null)}
                  >
                    {/* A composite label reads better with its parts spaced
                        than as one run of text. */}
                    {splitPivotLabel(r).map((part, i) => (
                      <span key={i}>
                        {i > 0 && <span className="mx-1 text-slate-300">›</span>}
                        {part}
                      </span>
                    ))}
                  </td>
                  {!totalsOnly &&
                    colLabels.map((c, ci) => {
                      const v = matrix[ri][ci]
                      return (
                        <td
                          key={c}
                          onClick={() => v > 0 && drill(r, c)}
                          className={`px-2 py-1.5 text-right tabular-nums ${v > 0 && onCrossFilter ? 'cursor-pointer' : ''}`}
                          style={{ backgroundColor: v > 0 ? `${color}${toHex(v / max)}` : undefined }}
                          title={v > 0 ? `${r} × ${c} — click to filter` : undefined}
                        >
                          {v > 0 ? formatNumber(v, widget.format, widget.aggregation) : <span className="text-slate-200">·</span>}
                        </td>
                      )
                    })}
                  <td
                    className="bg-slate-50/60 px-2 py-1.5 text-right font-semibold tabular-nums text-slate-700"
                    style={
                      // In totals-only mode the Total column IS the chart, so
                      // it carries the heat shading the cells would have.
                      totalsOnly && rowTotals[ri] > 0
                        ? { backgroundColor: `${color}${toHex(rowTotals[ri] / Math.max(1, ...rowTotals))}` }
                        : undefined
                    }
                  >
                    {formatNumber(rowTotals[ri], widget.format, widget.aggregation)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 font-semibold text-slate-600">Total</td>
                {!totalsOnly &&
                  colTotals.map((t, i) => (
                    <td key={i} className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-700">
                      {formatNumber(t, widget.format, widget.aggregation)}
                    </td>
                  ))}
                <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-800">
                  {formatNumber(grandTotal, widget.format, widget.aggregation)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * The grouped-hierarchy pivot: one column per level, parent values written
 * once and merged down their children.
 *
 *   Model        SKU               Color   Stock
 *   SPLENDOR +   HSPLMDRSCFIBHG    BHG       159
 *                HSPUNIRSCFIBLA    BLA        63
 *   HF DELUXE    HDLHADRSCFISBK    SBK        85
 *
 * A real `rowSpan` rather than blanked-out repeats, so the merged cell is
 * one cell: it stays put when the table scrolls, copies as one value, and
 * reads correctly to a screen reader.
 */
function PivotTree({ tree, widget, color, onDrill }) {
  if (!tree || tree.columns.length === 0) {
    return <p className="empty-state">Pick at least one row column in the admin panel</p>
  }
  if (tree.rows.length === 0) {
    return <p className="empty-state">No data to group</p>
  }

  const depth = tree.columns.length
  const max = Math.max(1, ...tree.rows.map((r) => r.value))
  const showBars = widget.showBars !== false
  const showSubtotals = !!widget.showGroupTotals

  return (
    <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-100">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>
            {tree.columns.map((column, i) => (
              <th
                key={column}
                className={`whitespace-nowrap px-2 py-2 text-left font-medium text-slate-500 ${
                  i > 0 ? 'border-l border-dotted border-slate-200' : ''
                }`}
              >
                {column}
              </th>
            ))}
            <th className="border-l border-dotted border-slate-200 px-2 py-2 text-right font-semibold text-slate-600">
              {widget.valueLabel || 'Total'}
            </th>
          </tr>
        </thead>

        <tbody>
          {tree.rows.map((row, ri) => {
            // A new top-level group starts wherever level 0 spans again.
            const startsGroup = row.spans[0] > 0
            return (
              <tr
                key={`${row.parts.join('|')}-${ri}`}
                className={startsGroup && ri > 0 ? 'border-t border-slate-300' : 'border-t border-slate-100'}
              >
                {row.parts.map((part, level) => {
                  // Zero means this cell is covered by a spanning cell above,
                  // so it must not be rendered at all -- emitting an empty
                  // <td> would push the row one column to the right.
                  if (row.spans[level] === 0) return null
                  const isLeaf = level === depth - 1
                  return (
                    <td
                      key={level}
                      rowSpan={row.spans[level]}
                      className={`px-2 py-1.5 align-top ${
                        level === 0 ? 'font-medium text-slate-800' : 'text-slate-600'
                      } ${level > 0 ? 'border-l border-dotted border-slate-200' : ''} ${
                        !isLeaf ? 'bg-white' : ''
                      }`}
                      title={part}
                    >
                      <span className="block max-w-[240px] truncate">{part}</span>
                      {showSubtotals && !isLeaf && (
                        <span className="mt-0.5 block text-[10px] font-normal tabular-nums text-slate-400">
                          {formatNumber(row.subtotals[level], widget.format, widget.aggregation)}
                        </span>
                      )}
                    </td>
                  )
                })}

                <td
                  onClick={() => onDrill?.(row.parts)}
                  className={`relative border-l border-dotted border-slate-200 px-2 py-1.5 text-right tabular-nums text-slate-700 ${
                    onDrill ? 'cursor-pointer hover:bg-slate-50' : ''
                  }`}
                  title={onDrill ? 'Click to filter the dashboard to this row' : undefined}
                >
                  {/* A faint proportional bar behind the number: the shape of
                      the distribution without a column of its own. */}
                  {showBars && row.value > 0 && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0.5 right-0 rounded-l"
                      style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, backgroundColor: `${color}1F` }}
                    />
                  )}
                  <span className="relative">{formatNumber(row.value, widget.format, widget.aggregation)}</span>
                </td>
              </tr>
            )
          })}

          <tr className="border-t-2 border-slate-300 bg-slate-50">
            <td colSpan={depth} className="px-2 py-1.5 font-semibold text-slate-600">
              Total · {tree.rows.length.toLocaleString('en-IN')} rows
            </td>
            <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-800">
              {formatNumber(tree.grandTotal, widget.format, widget.aggregation)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Opacity suffix for a hex colour, used for pivot heat shading. */
function toHex(ratio) {
  const alpha = Math.round(Math.min(1, Math.max(0.06, ratio)) * 190)
  return alpha.toString(16).padStart(2, '0')
}

// =====================================================================
// Gauge / target
// =====================================================================
/**
 * Progress toward a target the admin sets — monthly booking goals, review
 * counts, whatever. Renders as an arc so it reads differently from the
 * plain KPI cards around it.
 */
export function GaugeWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter, isDrilled }) {
  const source = widget.ignoreFilters ? unfilteredRows : rows
  const scoped = useMemo(
    () => (widget.conditions?.length ? source.filter((row) => matchesConditions(row, widget.conditions, widget.conditionsMatch || 'all')) : source),
    [source, widget.conditions, widget.conditionsMatch]
  )
  const value = useMemo(
    () => aggregate(scoped, widget.column, widget.aggregation || 'count'),
    [scoped, widget.column, widget.aggregation]
  )

  const target = toNumber(widget.target) || 0
  const lowerIsBetter = !!widget.lowerIsBetter
  const rawPct = target > 0 ? (value / target) * 100 : 0
  // "Lower is better" gauges (pending counts, average days-to-close) read
  // backwards -- being UNDER target is success, so the fill and colour
  // logic both flip rather than reusing the "higher is better" math with a
  // negative sign, which would just look broken.
  const pct = lowerIsBetter ? Math.min(150, 200 - rawPct) : Math.min(150, rawPct)
  const onTarget = lowerIsBetter ? value <= target : value >= target
  const color = onTarget ? '#059669' : pct >= 60 ? widget.color || '#4F46E5' : '#F59E0B'
  const shown = Math.min(100, Math.max(0, pct))

  // Semi-circular arc: 180° sweep, drawn with a dash offset. Three faint
  // threshold zones sit behind it (danger / caution / on-target) so the
  // gauge reads at a glance, not just from the number underneath it.
  const R = 52
  const circumference = Math.PI * R
  const dash = (shown / 100) * circumference
  const zoneColors = lowerIsBetter ? ['#059669', '#F59E0B', '#FCA5A5'] : ['#FCA5A5', '#F59E0B', '#059669']

  const delta = value - target
  const deltaLabel = lowerIsBetter
    ? delta <= 0
      ? `${formatNumber(Math.abs(delta), widget.format, widget.aggregation)} under target`
      : `${formatNumber(delta, widget.format, widget.aggregation)} over target`
    : delta >= 0
      ? `${formatNumber(delta, widget.format, widget.aggregation)} over target`
      : `${formatNumber(Math.abs(delta), widget.format, widget.aggregation)} to go`

  const crossFilter = widget.conditions?.length ? { match: widget.conditionsMatch || 'all', conditions: widget.conditions } : null
  const clickable = !!crossFilter && !!onCrossFilter && !widget.ignoreFilters

  function handleClick() {
    if (!clickable) return
    onCrossFilter({
      id: `gauge_${widget.id}`,
      kind: 'conditions',
      tab: widget.tab,
      match: crossFilter.match,
      conditions: crossFilter.conditions,
      icon: widget.icon || '🎯',
      label: widget.title,
    })
  }

  if (tabError) {
    return (
      <div className="card flex flex-col justify-center">
        <p className="text-xs font-semibold text-slate-400">{widget.title}</p>
        <p className="mt-1 text-xs text-rose-500">Tab "{widget.tab}" could not be read</p>
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          handleClick()
        }
      }}
      title={clickable ? `Click to filter the dashboard by "${widget.title}"` : undefined}
      className={`card group flex flex-col items-center justify-center transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        clickable ? 'cursor-pointer' : ''
      } ${isDrilled ? 'ring-2 ring-offset-1' : ''}`}
      style={isDrilled ? { '--tw-ring-color': color } : undefined}
    >
      <div className="mb-1 flex w-full items-center justify-between">
        <p className="text-[14px] font-semibold uppercase tracking-wide text-slate-800">{widget.title}</p>
        <span className="flex items-center gap-1">
          {clickable && (
            <MousePointerClick
              size={11}
              className={`transition-opacity ${isDrilled ? 'opacity-70' : 'opacity-0 group-hover:opacity-50'}`}
              style={{ color }}
            />
          )}
          {widget.icon && <span className="text-sm leading-none">{widget.icon}</span>}
        </span>
      </div>

      <svg viewBox="0 0 130 78" className="w-full max-w-[190px]">
        {/* threshold zones, drawn as three short arcs behind the value arc */}
        <path d="M 13 66 A 52 52 0 0 1 51 15.5" fill="none" stroke={zoneColors[0]} strokeOpacity="0.16" strokeWidth="11" strokeLinecap="round" />
        <path d="M 51 15.5 A 52 52 0 0 1 79 15.5" fill="none" stroke={zoneColors[1]} strokeOpacity="0.16" strokeWidth="11" />
        <path d="M 79 15.5 A 52 52 0 0 1 117 66" fill="none" stroke={zoneColors[2]} strokeOpacity="0.16" strokeWidth="11" strokeLinecap="round" />

        <path
          d="M 13 66 A 52 52 0 0 1 117 66"
          fill="none"
          stroke={color}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 600ms ease, stroke 300ms ease' }}
        />
        {/* needle tip -- a small dot at the current position, purely decorative polish */}
        <circle
          cx={65 + 52 * Math.cos(Math.PI - (shown / 100) * Math.PI)}
          cy={66 - 52 * Math.sin(Math.PI - (shown / 100) * Math.PI)}
          r="4.5"
          fill="white"
          stroke={color}
          strokeWidth="2.5"
          style={{ transition: 'cx 600ms ease, cy 600ms ease' }}
        />

        <text x="65" y="56" textAnchor="middle" className="fill-slate-800" style={{ fontSize: 19, fontWeight: 700 }}>
          {formatNumber(value, widget.format, widget.aggregation)}
        </text>
        <text x="65" y="70" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9 }}>
          {lowerIsBetter ? 'ceiling' : 'target'} {formatNumber(target, widget.format, widget.aggregation)}
        </text>
      </svg>

      <div className="mt-1 flex items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ color, backgroundColor: `${color}18` }}>
          {onTarget ? '✓ on target' : deltaLabel}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-slate-400">
       
        {widget.conditions?.length > 0 && ' · conditioned'}
      </p>
    </div>
  )
}
