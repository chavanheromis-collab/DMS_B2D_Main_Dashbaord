import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts'
import { groupRows, histogram, formatNumber } from '../../lib/dataUtils'
import { PALETTE } from '../../lib/config'
import ExportButton from '../ExportButton.jsx'
import PiePanel from './PiePanel.jsx'
import {
  axisTicks,
  chartCaps,
  colorForDatum,
  paretoData,
  resolvedReferences,
  waterfallData,
} from '../../lib/chartOptions'

// ---------------------------------------------------------------------
// Clicking a chart
// ---------------------------------------------------------------------
/**
 * The category a chart click landed on.
 *
 * Recharts reports a click on a cartesian chart through `activeLabel`, and a
 * click on a polar or hierarchical one through `activePayload`. Reading both
 * is what lets EVERY chart style drill with one handler -- and, on cartesian
 * charts, what lets a click anywhere in a category's column count rather than
 * only a direct hit on the bar itself. Hunting for a 6px-wide bar was the
 * single worst thing about the old behaviour.
 */
function nameFromChartEvent(state) {
  if (!state) return null
  if (state.activeLabel !== undefined && state.activeLabel !== null && state.activeLabel !== '') {
    return String(state.activeLabel)
  }
  const payload = state.activePayload?.[0]?.payload
  if (payload?.name !== undefined) return String(payload.name)
  return null
}

/** A click straight on a shape (slice, tile, segment). */
// The part-of-whole family, which needs a layout rather than a shape.
const PIE_TYPES = new Set(['pie', 'donut', 'rose'])

function nameFromShapeEvent(entry) {
  if (!entry) return null
  return entry.name ?? entry.payload?.name ?? null
}

// ---------------------------------------------------------------------
// Non-recharts styles
// ---------------------------------------------------------------------
/**
 * A ranked list of proportional bars -- the "progress" style.
 *
 * Bars are drawn as a share of the LARGEST value rather than of the total, so
 * the leading category always fills the row. Sharing a total would make every
 * bar a sliver as soon as there were more than a handful of categories, which
 * is exactly when this chart is most useful.
 */
function ProgressList({ data, fmt, activeName, onDrill, colorFor, showLabels }) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1

  return (
    <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
      {data.map((entry, i) => {
        const dimmed = activeName && activeName !== entry.name
        return (
          <button
            key={entry.name}
            onClick={() => onDrill(entry.name)}
            className={`block w-full text-left transition-opacity ${dimmed ? 'opacity-40' : ''}`}
          >
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-600" title={entry.name}>
                {entry.name}
              </span>
              {showLabels !== false && (
                <span className="shrink-0 font-semibold tabular-nums text-slate-700">{fmt(entry.value)}</span>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(2, (entry.value / max) * 100)}%`, backgroundColor: colorFor(entry, i) }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Treemap tiles.
 *
 * The click handler lives on the RECT, not on the `<Treemap>`: recharts fires
 * the container's onClick with the whole dataset rather than the tile you hit,
 * so drilling from the container drilled to the wrong thing (or to nothing).
 */
function TreemapCell(props) {
  const { x, y, width, height, index, name, value, activeName, colorFor, onDrill, showLabels, fmt } = props
  if (!(width > 0) || !(height > 0)) return null

  const entry = { name, value }
  const dimmed = activeName && activeName !== name
  const roomForLabel = width > 56 && height > 30

  return (
    <g onClick={() => onDrill?.(name)} style={{ cursor: onDrill ? 'pointer' : 'default' }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={colorFor ? colorFor(entry, index) : PALETTE[index % PALETTE.length]}
        fillOpacity={dimmed ? 0.25 : 0.9}
        stroke="#fff"
        strokeWidth={2}
        rx={4}
      />
      {roomForLabel && (
        <>
          <text x={x + 7} y={y + 17} fill="#fff" fontSize={11} fontWeight={600} pointerEvents="none">
            {String(name).length > width / 7 ? `${String(name).slice(0, Math.floor(width / 7))}…` : name}
          </text>
          {showLabels !== false && (
            <text x={x + 7} y={y + 31} fill="#fff" fontSize={10} opacity={0.85} pointerEvents="none">
              {fmt(value)}
            </text>
          )}
        </>
      )}
    </g>
  )
}

/**
 * Groups one tab by one column and plots the result, in any of seventeen
 * styles. It only ever knows a tab name and column names, so it works on
 * whatever tab the admin points it at.
 */
export default function ChartWidget({
  canExport = false, widget, rows, unfilteredRows, tabError, crossFilters = [], onCrossFilter }) {
  const type = widget.chartType || 'bar'
  const caps = chartCaps(type)
  const source = widget.ignoreFilters ? unfilteredRows : rows

  // A histogram bins a numeric column instead of grouping by a category --
  // the one style whose data doesn't come from `groupRows`.
  const base = useMemo(() => {
    if (caps.binned) {
      return histogram(source, {
        column: widget.column || widget.groupBy,
        bins: widget.bins || 12,
        min: widget.binMin,
        max: widget.binMax,
      })
    }
    return groupRows(source, {
      groupBy: widget.groupBy,
      valueColumn: widget.column,
      aggregation: widget.aggregation || 'count',
      // A part-of-whole chart must see EVERYTHING, or its percentages are
      // percentages of a truncated list and the roll-up below has nothing
      // real to roll up. Cutting the tail is that chart's own job, and it
      // groups the tail rather than dropping it (lib/pieData.js).
      limit: PIE_TYPES.has(type) ? 0 : widget.limit || 12,
      sort: widget.sort || 'value_desc',
    })
  }, [caps.binned, source, widget, type])

  // Waterfall and Pareto are the same grouped numbers rearranged, so they
  // reuse everything above and only reshape at the last moment.
  const data = useMemo(() => {
    if (type === 'waterfall') return waterfallData(base, { includeTotal: widget.showTotalBar !== false })
    if (type === 'pareto') return paretoData(base)
    return base
  }, [type, base, widget.showTotalBar])

  const color = widget.color || PALETTE[0]
  const fmt = (v) => formatNumber(v, widget.format, widget.aggregation)
  const pct = (v) => `${Math.round(v)}%`

  const activeName = crossFilters.find((cf) => cf.id === `chart_${widget.id}`)?.value

  /**
   * Drilling from any style. A histogram filters to a RANGE rather than to a
   * label, because "120–140" is not a value any row actually holds.
   */
  function drill(name) {
    if (!name || !onCrossFilter) return

    if (caps.binned) {
      const bin = data.find((d) => d.name === name)
      const column = widget.column || widget.groupBy
      if (!bin || !column) return
      onCrossFilter({
        id: `chart_${widget.id}`,
        kind: 'conditions',
        tab: widget.tab,
        match: 'all',
        conditions: [{ tab: widget.tab, column, operator: 'between', value: String(bin.from), value2: String(bin.to) }],
        label: `${column}: ${name}`,
      })
      return
    }

    if (!widget.groupBy) return
    // The synthetic total column of a waterfall isn't a real category, so
    // clicking it would filter to a value that doesn't exist.
    if (type === 'waterfall' && data.find((d) => d.name === name)?.direction === 'total') return

    onCrossFilter({
      id: `chart_${widget.id}`,
      kind: 'value',
      tab: widget.tab,
      column: widget.groupBy,
      value: name,
      label: `${widget.groupBy}: ${name}`,
    })
  }

  // Clicking anywhere in a category's column, not just on the bar itself.
  const onChartClick = onCrossFilter ? (state) => drill(nameFromChartEvent(state)) : undefined

  const colorFor = (entry, i) => {
    if (type === 'waterfall') {
      if (entry.direction === 'total') return widget.totalColor || '#334155'
      return entry.direction === 'down' ? widget.worstColor || '#DC2626' : widget.bestColor || '#059669'
    }
    // Round styles look wrong in a single colour, so they default to the
    // palette -- but an explicit colour mode still wins.
    if (!caps.cartesian && (!widget.colorMode || widget.colorMode === 'single')) {
      return PALETTE[i % PALETTE.length]
    }
    return colorForDatum(widget, entry, i, data)
  }

  const dimFor = (entry) => (activeName && activeName !== entry.name ? 0.25 : 1)

  const cells = (extra = {}) =>
    data.map((entry, i) => (
      <Cell
        key={`${entry.name}-${i}`}
        fill={colorFor(entry, i)}
        fillOpacity={dimFor(entry)}
        cursor={onCrossFilter ? 'pointer' : 'default'}
        {...extra}
      />
    ))

  // --- Advanced options, applied only where they mean something ----------
  const references = useMemo(
    () => (caps.refLines ? resolvedReferences(widget, data) : []),
    [caps.refLines, widget, data]
  )

  const scale = useMemo(
    () => (caps.axisStep ? axisTicks(data, widget.axisStep, references) : null),
    [caps.axisStep, data, widget.axisStep, references]
  )
  const valueAxis = scale ? { ticks: scale.ticks, domain: scale.domain, allowDecimals: false } : {}

  const showLabels = caps.labels && widget.showLabels
  const showGrid = caps.grid && widget.showGrid !== false
  const showLegend = widget.showLegend === true

  const tooltipStyle = {
    contentStyle: { borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 },
    formatter: (v, key) =>
      key === 'cumulativePct' ? [pct(v), 'Cumulative'] : [fmt(v), widget.valueLabel || 'Value'],
  }

  const grid = showGrid ? <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} /> : null

  const refLines = (axis = 'y') =>
    references.map((reference, i) => (
      <ReferenceLine
        key={reference.id || i}
        {...(axis === 'y' ? { y: reference.y } : { x: reference.y })}
        stroke={reference.color || '#EF4444'}
        strokeDasharray={reference.dashed === false ? undefined : '5 4'}
        strokeWidth={1.5}
        ifOverflow="extendDomain"
        label={{
          value: reference.text ? `${reference.text} ${fmt(reference.y)}` : fmt(reference.y),
          position: axis === 'y' ? 'insideTopRight' : 'top',
          fontSize: 10,
          fill: reference.color || '#EF4444',
        }}
      />
    ))

  const label = (position = 'top') =>
    showLabels ? { position, fontSize: 10, fill: '#64748b', formatter: fmt } : null

  const xAxis = (
    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={54} />
  )

  const height = widget.height || 260
  const topMargin = showLabels ? 20 : 6
  const cursorProp = onCrossFilter ? { cursor: 'pointer' } : {}

  // ---------------------------------------------------------------- render
  function renderChart() {
    switch (type) {
      case 'radar':
        return (
          <RadarChart data={data} outerRadius="70%" onClick={onChartClick} {...cursorProp}>
            {showGrid && <PolarGrid stroke="#e2e8f0" />}
            <PolarAngleAxis dataKey="name" tick={{ fontSize: 10 }} />
            <PolarRadiusAxis tick={{ fontSize: 9 }} {...(scale ? { domain: scale.domain, ticks: scale.ticks } : {})} />
            <Tooltip {...tooltipStyle} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <Radar
              name={widget.valueLabel || 'Value'}
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.35}
              // Dots make the vertices clickable targets in their own right,
              // on top of the chart-level handler.
              dot={{ r: 3, fill: color, cursor: 'pointer' }}
              activeDot={{ r: 5 }}
              label={label()}
            />
          </RadarChart>
        )

      case 'radial':
        return (
          <RadialBarChart
            data={data}
            innerRadius="25%"
            outerRadius="95%"
            startAngle={90}
            endAngle={-270}
            onClick={onChartClick}
            {...cursorProp}
          >
            <Tooltip {...tooltipStyle} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <RadialBar
              dataKey="value"
              background
              cornerRadius={6}
              onClick={(entry) => drill(nameFromShapeEvent(entry))}
              label={showLabels ? { position: 'insideStart', fill: '#fff', fontSize: 10, formatter: fmt } : null}
            >
              {cells()}
            </RadialBar>
          </RadialBarChart>
        )

      case 'treemap':
        return (
          <Treemap
            data={data}
            dataKey="value"
            nameKey="name"
            aspectRatio={4 / 3}
            stroke="#fff"
            isAnimationActive={false}
            content={
              <TreemapCell
                activeName={activeName}
                colorFor={colorFor}
                onDrill={onCrossFilter ? drill : null}
                showLabels={showLabels}
                fmt={fmt}
              />
            }
          >
            <Tooltip {...tooltipStyle} />
          </Treemap>
        )

      case 'funnel':
        return (
          <FunnelChart onClick={onChartClick} {...cursorProp}>
            <Tooltip {...tooltipStyle} />
            <Funnel
              dataKey="value"
              data={data}
              isAnimationActive
              onClick={(entry) => drill(nameFromShapeEvent(entry))}
            >
              <LabelList position="right" fill="#475569" stroke="none" dataKey="name" fontSize={11} />
              {showLabels && (
                <LabelList position="insideRight" fill="#fff" stroke="none" dataKey="value" fontSize={10} formatter={fmt} />
              )}
              {cells()}
            </Funnel>
          </FunnelChart>
        )

      case 'pareto':
        return (
          <ComposedChart
            data={data}
            margin={{ top: topMargin, right: 6, bottom: 5, left: -12 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            {grid}
            {xAxis}
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} {...valueAxis} />
            {/* The cumulative axis is pinned to 0-100: a percentage that
                rescales to its own maximum makes the 80% line meaningless. */}
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 20, 40, 60, 80, 100]}
              tick={{ fontSize: 11 }}
              unit="%"
            />
            <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {refLines('y')}
            {widget.showPareto80 !== false && (
              <ReferenceLine
                yAxisId="right"
                y={80}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                label={{ value: '80%', position: 'right', fontSize: 10, fill: '#94a3b8' }}
              />
            )}
            <Bar yAxisId="left" dataKey="value" name={widget.valueLabel || 'Value'} radius={[5, 5, 0, 0]} label={label()}>
              {cells()}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumulativePct"
              name="Cumulative %"
              stroke={widget.lineColor || '#F59E0B'}
              strokeWidth={2}
              dot={{ r: 2.5 }}
            />
          </ComposedChart>
        )

      case 'waterfall':
        return (
          <BarChart
            data={data}
            margin={{ top: topMargin, right: 10, bottom: 5, left: -12 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            {grid}
            {xAxis}
            <YAxis tick={{ fontSize: 11 }} {...valueAxis} />
            <Tooltip
              contentStyle={tooltipStyle.contentStyle}
              cursor={{ fill: '#f8fafc' }}
              // The stacked base is scaffolding, not data -- showing it in
              // the tooltip would report a number nobody asked about.
              formatter={(v, key, item) =>
                key === 'base' ? null : [fmt(item?.payload?.value ?? v), widget.valueLabel || 'Change']
              }
            />
            {refLines('y')}
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" />
            <Bar dataKey="delta" stackId="w" radius={[4, 4, 0, 0]} label={label()}>
              {cells()}
            </Bar>
          </BarChart>
        )

      case 'histogram':
        return (
          <BarChart
            data={data}
            margin={{ top: topMargin, right: 10, bottom: 5, left: -12 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={58} />
            <YAxis tick={{ fontSize: 11 }} {...valueAxis} />
            <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
            {refLines('y')}
            {/* Bins touch: a histogram with gaps reads as a bar chart of
                unrelated categories rather than as a distribution. */}
            <Bar dataKey="value" barCategoryGap={0} label={label()}>
              {cells()}
            </Bar>
          </BarChart>
        )

      case 'lollipop':
        return (
          <ComposedChart
            data={data}
            margin={{ top: topMargin, right: 10, bottom: 5, left: -12 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            {grid}
            {xAxis}
            <YAxis tick={{ fontSize: 11 }} {...valueAxis} />
            <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
            {refLines('y')}
            {/* A hairline bar is the stem; the scatter dot is the head. Far
                less ink than a bar chart, which is what makes twenty
                categories readable. */}
            <Bar dataKey="value" barSize={2} isAnimationActive={false}>
              {cells()}
            </Bar>
            <Scatter dataKey="value" label={label()}>
              {data.map((entry, i) => (
                <Cell
                  key={`${entry.name}-dot-${i}`}
                  fill={colorFor(entry, i)}
                  fillOpacity={dimFor(entry)}
                  cursor={onCrossFilter ? 'pointer' : 'default'}
                />
              ))}
            </Scatter>
          </ComposedChart>
        )

      case 'line':
      case 'step':
        return (
          <LineChart
            data={data}
            margin={{ top: topMargin, right: 10, bottom: 5, left: -12 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} {...valueAxis} />
            <Tooltip {...tooltipStyle} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {refLines('y')}
            <Line
              type={type === 'step' ? 'stepAfter' : 'monotone'}
              dataKey="value"
              name={widget.valueLabel || 'Value'}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, cursor: onCrossFilter ? 'pointer' : 'default' }}
              activeDot={{ r: 5 }}
              label={label()}
            />
          </LineChart>
        )

      case 'area':
        return (
          <AreaChart
            data={data}
            margin={{ top: topMargin, right: 10, bottom: 5, left: -12 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            <defs>
              <linearGradient id={`grad_${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} {...valueAxis} />
            <Tooltip {...tooltipStyle} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {refLines('y')}
            <Area
              type="monotone"
              dataKey="value"
              name={widget.valueLabel || 'Value'}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad_${widget.id})`}
              dot={{ r: 2.5, cursor: onCrossFilter ? 'pointer' : 'default' }}
              activeDot={{ r: 5 }}
              label={label()}
            />
          </AreaChart>
        )

      case 'hbar':
        return (
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 28, bottom: 5, left: 8 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />}
            {/* On a horizontal bar chart the VALUE axis is x, so the scale
                and the reference lines move with it. */}
            <XAxis type="number" tick={{ fontSize: 11 }} {...valueAxis} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
            <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
            {refLines('x')}
            <Bar dataKey="value" radius={[0, 6, 6, 0]} label={label('right')}>
              {cells()}
            </Bar>
          </BarChart>
        )

      default:
        return (
          <BarChart
            data={data}
            margin={{ top: topMargin, right: 10, bottom: 5, left: -12 }}
            onClick={onChartClick}
            {...cursorProp}
          >
            {grid}
            {xAxis}
            <YAxis tick={{ fontSize: 11 }} {...valueAxis} />
            <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
            {refLines('y')}
            <Bar dataKey="value" radius={[6, 6, 0, 0]} label={label()}>
              {cells()}
            </Bar>
          </BarChart>
        )
    }
  }

  const subject = caps.binned ? widget.column || widget.groupBy : widget.groupBy

  return (
    <div className="card flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="widget-title">📈 {widget.title}</h2>
          <p className="text-[11px] text-slate-400">
            {widget.tab} · {caps.binned ? 'distribution of' : 'by'} {subject || '—'}
            {widget.ignoreFilters && ' · unfiltered'}
            {onCrossFilter && ' · click to drill in'}
          </p>
        </div>
        {canExport && (
          <ExportButton
            name={widget.title || widget.tab}
            // What is plotted, not the rows behind it: the whole point of a
            // chart is the aggregate, and that is the number people want to
            // paste into a deck.
            rows={() => data.map((d) => ({ [subject || 'Group']: d.name, [widget.valueLabel || 'Value']: d.value }))}
            columns={() => [subject || 'Group', widget.valueLabel || 'Value']}
            count={data.length}
          />
        )}
      </div>

      {tabError ? (
        <p className="py-10 text-center text-sm text-rose-500">Tab “{widget.tab}” could not be read</p>
      ) : data.length === 0 ? (
        <p className="empty-state">
          {caps.binned && !subject ? 'Pick a numeric column in the admin panel' : 'No data to chart'}
        </p>
      ) : PIE_TYPES.has(type) ? (
        <PiePanel
          type={type}
          data={data}
          widget={widget}
          fmt={fmt}
          colorFor={colorFor}
          activeName={activeName}
          onDrill={onCrossFilter ? drill : undefined}
          height={height}
        />
      ) : type === 'progress' ? (
        <ProgressList
          data={data}
          fmt={fmt}
          activeName={activeName}
          onDrill={drill}
          colorFor={colorFor}
          showLabels={widget.showLabels !== false}
        />
      ) : (
        <div className="min-h-[240px] flex-1">
          <ResponsiveContainer width="100%" height={height}>
            {renderChart()}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
