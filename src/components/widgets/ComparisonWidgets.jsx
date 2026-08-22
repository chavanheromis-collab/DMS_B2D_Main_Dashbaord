import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { formatNumber, groupSeries, groupStacked, pivot, scatterPoints } from '../../lib/dataUtils'
import { HEAT_SCALES, PALETTE } from '../../lib/config'

const tooltipBox = { borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }

/**
 * The category a chart click landed on.
 *
 * Reading `activeLabel` means a click ANYWHERE in a category's column
 * counts, not only a direct hit on the bar -- hunting for a 6px target was
 * the worst thing about the old behaviour.
 */
function nameFromChartEvent(state) {
  if (!state) return null
  if (state.activeLabel !== undefined && state.activeLabel !== null && state.activeLabel !== '') {
    return String(state.activeLabel)
  }
  return state.activePayload?.[0]?.payload?.name ?? null
}

/** The rows a widget should read, honouring its own "ignore filters" flag. */
const sourceRows = (widget, rows, unfilteredRows) => (widget.ignoreFilters ? unfilteredRows : rows)

function Shell({ widget, icon, caption, tabError, children }) {
  return (
    <div className="card flex h-full flex-col">
      <div className="mb-2">
        <h2 className="widget-title">
          {icon} {widget.title}
        </h2>
        <p className="text-[11px] text-slate-400">
          {caption}
          {widget.ignoreFilters && ' · unfiltered'}
        </p>
      </div>
      {tabError ? (
        <p className="py-10 text-center text-sm text-rose-500">Tab “{widget.tab}” could not be read</p>
      ) : (
        children
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Stacked / grouped bars
// ---------------------------------------------------------------------
/**
 * One bar per value of `groupBy`, split into segments by `stackBy`.
 *
 * "Stacked" answers "how big is each group, and what is it made of";
 * "grouped" answers "how do the segments compare within each group". Same
 * data, and the admin picks -- so both are one widget, not two.
 */
export function StackedWidget({ widget, rows, unfilteredRows, tabError, crossFilters = [], onCrossFilter }) {
  const { data, series } = useMemo(
    () =>
      groupStacked(sourceRows(widget, rows, unfilteredRows), {
        groupBy: widget.groupBy,
        stackBy: widget.stackBy,
        valueColumn: widget.column,
        aggregation: widget.aggregation || 'count',
        limit: widget.limit || 12,
        maxSeries: widget.maxSeries || 8,
        sort: widget.sort || 'value_desc',
      }),
    [widget, rows, unfilteredRows]
  )

  const activeName = crossFilters.find((cf) => cf.id === `stacked_${widget.id}`)?.value
  const grouped = widget.layout === 'grouped'

  function drill(name) {
    if (!name || !widget.groupBy || !onCrossFilter) return
    onCrossFilter({
      id: `stacked_${widget.id}`,
      kind: 'value',
      tab: widget.tab,
      column: widget.groupBy,
      value: name,
      label: `${widget.groupBy}: ${name}`,
    })
  }

  const onChartClick = onCrossFilter ? (state) => drill(nameFromChartEvent(state)) : undefined
  const cursorProp = onCrossFilter ? { cursor: 'pointer' } : {}

  return (
    <Shell
      widget={widget}
      icon="📶"
      caption={`${widget.tab} · ${widget.groupBy || '—'} split by ${widget.stackBy || '—'}`}
      tabError={tabError}
    >
      {data.length === 0 ? (
        <p className="empty-state">No data to chart</p>
      ) : (
        <div className="min-h-[240px] flex-1">
          <ResponsiveContainer width="100%" height={widget.height || 280}>
            <BarChart
              data={data}
              margin={{ top: 5, right: 10, bottom: 5, left: -12 }}
              onClick={onChartClick}
              {...cursorProp}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={54} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipBox}
                cursor={{ fill: '#f8fafc' }}
                formatter={(v, n) => [formatNumber(v, widget.format, widget.aggregation), n]}
              />
              {widget.showLegend !== false && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  // A shared stackId is the only difference between a stacked
                  // and a grouped chart in recharts.
                  stackId={grouped ? undefined : 'a'}
                  fill={PALETTE[i % PALETTE.length]}
                  radius={grouped || i === series.length - 1 ? [5, 5, 0, 0] : 0}
                  onClick={(entry) => drill(entry?.name ?? entry?.payload?.name)}
                  cursor="pointer"
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} opacity={activeName && activeName !== entry.name ? 0.3 : 1} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Combo chart
// ---------------------------------------------------------------------
/**
 * Bars and a line sharing an x-axis but with their own y-axes.
 *
 * The two axes are the point: volume ("orders this month") and rate
 * ("average days to deliver") live on completely different scales, and
 * forcing them onto one axis flattens whichever is smaller into a
 * meaningless line along the bottom.
 */
export function ComboWidget({ widget, rows, unfilteredRows, tabError, crossFilters = [], onCrossFilter }) {
  const data = useMemo(
    () =>
      groupSeries(sourceRows(widget, rows, unfilteredRows), {
        groupBy: widget.groupBy,
        series: [
          { key: 'barValue', column: widget.column, aggregation: widget.aggregation || 'count' },
          { key: 'lineValue', column: widget.lineColumn, aggregation: widget.lineAggregation || 'count' },
        ],
        limit: widget.limit || 12,
        sort: widget.sort || 'value_desc',
      }),
    [widget, rows, unfilteredRows]
  )

  const activeName = crossFilters.find((cf) => cf.id === `combo_${widget.id}`)?.value
  const barColor = widget.color || PALETTE[0]
  const lineColor = widget.lineColor || PALETTE[4]

  function drill(name) {
    if (!name || !widget.groupBy || !onCrossFilter) return
    onCrossFilter({
      id: `combo_${widget.id}`,
      kind: 'value',
      tab: widget.tab,
      column: widget.groupBy,
      value: name,
      label: `${widget.groupBy}: ${name}`,
    })
  }

  const onChartClick = onCrossFilter ? (state) => drill(nameFromChartEvent(state)) : undefined
  const cursorProp = onCrossFilter ? { cursor: 'pointer' } : {}

  return (
    <Shell
      widget={widget}
      icon="🪢"
      caption={`${widget.tab} · by ${widget.groupBy || '—'}${onCrossFilter ? ' · click to drill in' : ''}`}
      tabError={tabError}
    >
      {data.length === 0 ? (
        <p className="empty-state">No data to chart</p>
      ) : (
        <div className="min-h-[240px] flex-1">
          <ResponsiveContainer width="100%" height={widget.height || 280}>
            <ComposedChart
              data={data}
              margin={{ top: 5, right: 6, bottom: 5, left: -12 }}
              onClick={onChartClick}
              {...cursorProp}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={54} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipBox}
                cursor={{ fill: '#f8fafc' }}
                formatter={(v, key) =>
                  key === 'barValue'
                    ? [formatNumber(v, widget.format, widget.aggregation), widget.barLabel || 'Bars']
                    : [formatNumber(v, widget.lineFormat, widget.lineAggregation), widget.lineLabel || 'Line']
                }
              />
              {widget.showLegend !== false && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Bar
                yAxisId="left"
                dataKey="barValue"
                name={widget.barLabel || 'Bars'}
                fill={barColor}
                radius={[5, 5, 0, 0]}
                onClick={(entry) => drill(entry?.name ?? entry?.payload?.name)}
                cursor="pointer"
              >
                {data.map((entry) => (
                  <Cell key={entry.name} opacity={activeName && activeName !== entry.name ? 0.3 : 1} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="lineValue"
                name={widget.lineLabel || 'Line'}
                stroke={lineColor}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Scatter / bubble
// ---------------------------------------------------------------------
/**
 * Two numeric columns plotted against each other, optionally sized by a
 * third and coloured by a fourth. The one widget that shows individual rows
 * rather than aggregates -- useful for spotting outliers that any grouping
 * would average away.
 */
export function ScatterWidget({ widget, rows, unfilteredRows, tabError }) {
  const series = useMemo(
    () =>
      scatterPoints(sourceRows(widget, rows, unfilteredRows), {
        xColumn: widget.xColumn,
        yColumn: widget.yColumn,
        sizeColumn: widget.sizeColumn,
        groupBy: widget.groupBy,
        labelColumn: widget.labelColumn,
        limit: widget.limit || 400,
      }),
    [widget, rows, unfilteredRows]
  )

  const plotted = series.reduce((n, s) => n + s.points.length, 0)

  return (
    <Shell
      widget={widget}
      icon="⚬"
      caption={`${widget.tab} · ${widget.xColumn || '—'} vs ${widget.yColumn || '—'} · ${plotted.toLocaleString('en-IN')} points`}
      tabError={tabError}
    >
      {plotted === 0 ? (
        <p className="empty-state">
          {widget.xColumn && widget.yColumn
            ? 'No rows have numbers in both columns'
            : 'Pick an X and a Y column in the admin panel'}
        </p>
      ) : (
        <div className="min-h-[240px] flex-1">
          <ResponsiveContainer width="100%" height={widget.height || 280}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 5, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis
                type="number"
                dataKey="x"
                name={widget.xColumn}
                tick={{ fontSize: 11 }}
                label={{ value: widget.xColumn, position: 'insideBottom', offset: -2, fontSize: 10, fill: '#94a3b8' }}
              />
              <YAxis type="number" dataKey="y" name={widget.yColumn} tick={{ fontSize: 11 }} />
              {widget.sizeColumn && <ZAxis type="number" dataKey="z" range={[40, 420]} name={widget.sizeColumn} />}
              <Tooltip
                contentStyle={tooltipBox}
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(v, n) => [formatNumber(v, widget.format), n]}
              />
              {series.length > 1 && widget.showLegend !== false && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((s, i) => (
                <Scatter
                  key={s.name}
                  name={s.name}
                  data={s.points}
                  fill={PALETTE[i % PALETTE.length]}
                  fillOpacity={0.7}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Heat map
// ---------------------------------------------------------------------
/** Blends two hex colours. `t` runs 0 → 1. */
function mix(from, to, t) {
  const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [r1, g1, b1] = parse(from)
  const [r2, g2, b2] = parse(to)
  const ch = (a, b) => Math.round(a + (b - a) * t)
  return `rgb(${ch(r1, r2)}, ${ch(g1, g2)}, ${ch(b1, b2)})`
}

/**
 * The same cross-tabulation as the pivot widget, rendered as colour
 * intensity instead of numbers.
 *
 * A pivot answers "what is the exact figure for this pair"; a heat map
 * answers "where are the concentrations" at a glance, which is a different
 * question and much harder to read off a grid of numerals.
 */
export function HeatmapWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const data = useMemo(
    () =>
      pivot(sourceRows(widget, rows, unfilteredRows), {
        rowColumn: widget.rowColumn,
        colColumn: widget.colColumn,
        valueColumn: widget.column,
        aggregation: widget.aggregation || 'count',
        maxRows: widget.maxRows || 15,
        maxCols: widget.maxCols || 12,
      }),
    [widget, rows, unfilteredRows]
  )

  const scale = HEAT_SCALES.find((s) => s.value === (widget.scale || 'indigo')) || HEAT_SCALES[0]
  const max = Math.max(...data.matrix.flat(), 0)

  function drill(rowLabel, colLabel) {
    if (!onCrossFilter) return
    // Passing only one of the two drills that whole row or column -- "all of
    // March" and "everything for West" are the questions a heat map invites
    // most, and neither should need a trip to the filter bar.
    const conditions = []
    if (rowLabel) conditions.push({ tab: widget.tab, column: widget.rowColumn, operator: 'equals', value: rowLabel })
    if (colLabel) conditions.push({ tab: widget.tab, column: widget.colColumn, operator: 'equals', value: colLabel })
    if (conditions.length === 0) return

    onCrossFilter({
      id: `heatmap_${widget.id}`,
      kind: 'conditions',
      tab: widget.tab,
      match: 'all',
      conditions,
      label: [rowLabel, colLabel].filter(Boolean).join(' × '),
    })
  }

  return (
    <Shell
      widget={widget}
      icon="🔥"
      caption={`${widget.tab} · ${widget.rowColumn || '—'} × ${widget.colColumn || '—'}`}
      tabError={tabError}
    >
      {data.rowLabels.length === 0 ? (
        <p className="empty-state">No data to plot</p>
      ) : (
        <div className="-mx-1 flex-1 overflow-x-auto px-1">
          <table className="min-w-full border-separate border-spacing-[2px] text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white/90 px-1.5 py-1 text-left font-semibold text-slate-500">
                  {widget.rowColumn}
                </th>
                {data.colLabels.map((col) => (
                  <th
                    key={col}
                    onClick={() => onCrossFilter && drill(null, col)}
                    className={`whitespace-nowrap px-1.5 py-1 text-center font-semibold text-slate-500 ${
                      onCrossFilter ? 'cursor-pointer hover:text-indigo-600' : ''
                    }`}
                    title={onCrossFilter ? `Filter to ${col}` : col}
                  >
                    {col.length > 12 ? `${col.slice(0, 12)}…` : col}
                  </th>
                ))}
                <th className="px-1.5 py-1 text-right font-semibold text-slate-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rowLabels.map((rowLabel, ri) => (
                <tr key={rowLabel}>
                  <td
                    onClick={() => onCrossFilter && drill(rowLabel, null)}
                    className={`sticky left-0 z-10 max-w-[150px] truncate bg-white/90 px-1.5 py-1 font-medium text-slate-700 ${
                      onCrossFilter ? 'cursor-pointer hover:text-indigo-600' : ''
                    }`}
                    title={onCrossFilter ? `Filter to ${rowLabel}` : rowLabel}
                  >
                    {rowLabel}
                  </td>
                  {data.colLabels.map((colLabel, ci) => {
                    const value = data.matrix[ri][ci]
                    // Zero gets no tint at all -- shading it the palest
                    // colour makes "nothing here" look like "a little here".
                    const t = max > 0 ? value / max : 0
                    return (
                      <td
                        key={colLabel}
                        onClick={() => value > 0 && drill(rowLabel, colLabel)}
                        title={`${rowLabel} × ${colLabel}: ${formatNumber(value, widget.format, widget.aggregation)}`}
                        className={`rounded px-1.5 py-1 text-center tabular-nums transition-transform ${
                          value > 0 && onCrossFilter ? 'cursor-pointer hover:scale-105' : ''
                        }`}
                        style={{
                          backgroundColor: value > 0 ? mix(scale.from, scale.to, t) : '#F8FAFC',
                          // Past roughly the midpoint the tint is dark enough
                          // that dark text stops being readable on it.
                          color: t > 0.55 ? '#fff' : '#475569',
                        }}
                      >
                        {value > 0 ? formatNumber(value, widget.format, widget.aggregation) : '·'}
                      </td>
                    )
                  })}
                  <td className="px-1.5 py-1 text-right font-semibold tabular-nums text-slate-600">
                    {formatNumber(data.rowTotals[ri], widget.format, widget.aggregation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}
