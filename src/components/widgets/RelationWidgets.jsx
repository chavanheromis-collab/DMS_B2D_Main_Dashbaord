import { useMemo, useState } from 'react'
import { formatNumber, pivotTree } from '../../lib/dataUtils'
import { spanDomain, spanRows, spanTally } from '../../lib/spanData'
import { arcMid, arcPath, fitsLabel, sunburstArcs } from '../../lib/sunburstData'
import { PALETTE } from '../../lib/config'
import { seriesColor } from '../../lib/seriesData'

// =====================================================================
// Relation widgets
// =====================================================================
// Two shapes the app could not draw, both about how things sit RELATIVE to
// each other rather than how big they are:
//
//   Dumbbell -- two numbers per category, and the distance between them
//   Sunburst -- a hierarchy as rings, where a wedge is exactly as wide as
//               its children add up to
//
// The arithmetic is in lib/spanData.js and lib/sunburstData.js. Everything
// here is drawing.

/** The rows a widget should read, honouring its own "ignore filters" flag. */
const sourceRows = (widget, rows, unfilteredRows) => (widget.ignoreFilters ? unfilteredRows : rows)

function Shell({ widget, icon, caption, tabError, children }) {
  return (
    <div className="card flex h-full flex-col">
      <div className="mb-2">
        <h2 className="widget-title">
          <span className="widget-icon">{icon}</span> {widget.title}
        </h2>
        {caption && (
          <p className="widget-caption text-[11px] text-slate-400">
            {caption}
            {widget.ignoreFilters && ' · unfiltered'}
          </p>
        )}
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
// Dumbbell
// ---------------------------------------------------------------------
/**
 * Two dots and the line between them, one row per category.
 *
 * Drawn by hand rather than through recharts: there is no chart type for
 * this, and the recharts version is a stacked bar with a transparent base
 * plus two scatter series -- three components pretending to be one shape,
 * each with its own idea of the axis. Two divs and a percentage is less
 * code and cannot disagree with itself.
 *
 * The bar behind each row is the axis, so every row shares one scale and
 * the eye can compare gaps down the column. That is the whole trick: it
 * only works because the domain is worked out once, for all of them.
 */
export default function DumbbellWidget({
  widget,
  rows,
  unfilteredRows,
  tabError,
  crossFilters = [],
  onCrossFilter,
  dateOrder = 'DMY',
}) {
  const data = useMemo(
    () =>
      spanRows(sourceRows(widget, rows, unfilteredRows), {
        groupBy: widget.groupBy,
        fromColumn: widget.column,
        fromAggregation: widget.aggregation || 'count',
        toColumn: widget.secondaryColumn,
        toAggregation: widget.secondaryAggregation || 'count',
        limit: widget.limit ?? 12,
        sort: widget.spanSort,
        dateOrder,
      }),
    [widget, rows, unfilteredRows, dateOrder]
  )

  const [low, high] = useMemo(() => spanDomain(data), [data])
  const tally = useMemo(() => spanTally(data), [data])

  const fromColor = widget.color || PALETTE[0]
  const toColor = widget.lineColor || PALETTE[4]
  const fmt = (v) => formatNumber(v, widget.format, widget.aggregation)
  const at = (v) => ((v - low) / (high - low || 1)) * 100

  const activeName = crossFilters.find((cf) => cf.id === `dumbbell_${widget.id}`)?.value

  const drill = (name) => {
    if (!onCrossFilter || !widget.groupBy) return
    onCrossFilter({
      id: `dumbbell_${widget.id}`,
      value: name,
      kind: 'conditions',
      tab: widget.tab,
      match: 'all',
      conditions: [{ tab: widget.tab, column: widget.groupBy, operator: 'equals', value: name }],
      label: `${widget.groupBy}: ${name}`,
    })
  }

  return (
    <Shell
      widget={widget}
      icon="⟷"
      tabError={tabError}
      caption={
        data.length === 0
          ? undefined
          : `${widget.fromLabel || 'First'} → ${widget.toLabel || 'Second'} · ${tally.up} up, ${tally.down} down${
              tally.flat ? `, ${tally.flat} level` : ''
            }`
      }
    >
      {data.length === 0 ? (
        <p className="empty-state">Pick a column to group by and two measures to compare</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {/* The legend is two dots, because the whole chart is two dots. */}
          <div className="mb-1 flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: fromColor }} />
              {widget.fromLabel || 'First'}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: toColor }} />
              {widget.toLabel || 'Second'}
            </span>
          </div>

          {data.map((row) => {
            const a = at(row.from)
            const b = at(row.to)
            const left = Math.min(a, b)
            const width = Math.abs(b - a)
            const dim = activeName && activeName !== row.name

            return (
              <button
                key={row.name}
                onClick={() => drill(row.name)}
                disabled={!onCrossFilter}
                title={`${row.name}: ${fmt(row.from)} → ${fmt(row.to)}`}
                className={`flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors ${
                  onCrossFilter ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
                } ${activeName === row.name ? 'bg-indigo-50/70' : ''}`}
                style={dim ? { opacity: 0.4 } : undefined}
              >
                <span className="w-28 shrink-0 truncate text-[11px] font-medium text-slate-600">{row.name}</span>

                <span className="relative h-4 min-w-0 flex-1">
                  {/* The axis every row shares. Without it the dots are two
                      numbers; with it they are a position. */}
                  <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-100" />
                  <span
                    className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: row.gap >= 0 ? toColor : fromColor,
                      opacity: 0.35,
                    }}
                  />
                  <span
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                    style={{ left: `${a}%`, backgroundColor: fromColor }}
                  />
                  <span
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                    style={{ left: `${b}%`, backgroundColor: toColor }}
                  />
                </span>

                {/* The gap, said in numbers, because reading a distance off
                    a line is the thing this chart is meant to save you. */}
                <span
                  className="w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums"
                  style={{ color: row.gap === 0 ? '#94a3b8' : row.gap > 0 ? '#059669' : '#e11d48' }}
                >
                  {row.gap > 0 ? '+' : ''}
                  {fmt(row.gap)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Sunburst
// ---------------------------------------------------------------------
/**
 * A hierarchy as rings.
 *
 * Hovering a wedge names the whole path -- "West › Pune › SPLENDOR" -- and
 * the middle holds the total, because a ring chart with nothing in the
 * middle is a doughnut with a hole where its own headline should be.
 */
export function SunburstWidget({
  widget,
  rows,
  unfilteredRows,
  tabError,
  crossFilters = [],
  onCrossFilter,
  dateOrder = 'DMY',
}) {
  const levels = useMemo(
    () => [widget.groupBy, widget.groupBy2, widget.groupBy3, widget.groupBy4].filter(Boolean),
    [widget.groupBy, widget.groupBy2, widget.groupBy3, widget.groupBy4]
  )

  const tree = useMemo(() => {
    if (levels.length === 0) return []
    return pivotTree(sourceRows(widget, rows, unfilteredRows), {
      rowColumns: levels,
      valueColumn: widget.column,
      aggregation: widget.aggregation || 'count',
      sort: widget.sort || 'value_desc',
      sortColumn: widget.sortColumn,
      sortReducer: widget.sortReducer,
      buckets: widget.buckets,
      dateOrder,
    }).tree
  }, [levels, widget, rows, unfilteredRows, dateOrder])

  const rings = Math.max(1, Math.min(levels.length || 1, Number(widget.rings) || levels.length || 1))
  const { arcs, total, hidden } = useMemo(() => sunburstArcs(tree, { rings }), [tree, rings])

  const [hover, setHover] = useState(null)
  const fmt = (v) => formatNumber(v, widget.format, widget.aggregation)
  const palette = widget.palette

  const activeKey = crossFilters.find((cf) => cf.id === `sunburst_${widget.id}`)?.value

  function drill(arc) {
    if (!onCrossFilter) return
    onCrossFilter({
      id: `sunburst_${widget.id}`,
      value: arc.key,
      kind: 'conditions',
      tab: widget.tab,
      match: 'all',
      // Every level down to the wedge, or clicking "Pune" inside "West"
      // would filter to every Pune in the sheet.
      conditions: arc.path.map((part, i) => ({
        tab: widget.tab,
        column: levels[i],
        operator: 'equals',
        value: part,
      })),
      label: arc.key,
    })
  }

  /**
   * A wedge's colour comes from the TOP-LEVEL ancestor it belongs to, in
   * lighter shades further out. A palette colour per wedge would make a
   * region and one of its branches look unrelated, which is the one thing a
   * ring chart is drawn to show.
   */
  const colorFor = (arc) => {
    const root = arc.path[0]
    const index = Math.max(0, tree.findIndex((n) => n.label === root))
    // By NAME as well as index, so the same region keeps its colour when a
    // filter changes which regions are on the chart -- the same rule every
    // other multi-series widget follows.
    return { fill: seriesColor(root, index, widget.valueColors, palette), opacity: 1 - arc.depth * 0.22 }
  }

  const shown = hover || null

  return (
    <Shell
      widget={widget}
      icon="◎"
      tabError={tabError}
      caption={levels.length > 0 ? levels.join(' → ') : undefined}
    >
      {arcs.length === 0 ? (
        <p className="empty-state">Pick at least one column to break down by</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <div className="relative w-full max-w-[280px]">
            <svg viewBox="-104 -104 208 208" className="h-auto w-full" role="img">
              {arcs.map((arc) => {
                const { fill, opacity } = colorFor(arc)
                const on = activeKey === arc.key || hover?.key === arc.key
                return (
                  <path
                    key={arc.key}
                    d={arcPath(arc, { rings })}
                    fill={fill}
                    fillOpacity={on ? 1 : opacity}
                    stroke="#fff"
                    strokeWidth={0.8}
                    className={onCrossFilter ? 'cursor-pointer' : ''}
                    onMouseEnter={() => setHover(arc)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => drill(arc)}
                  />
                )
              })}

              {/* Only where it fits. A label that does not is a word lying
                  across three other wedges. */}
              {widget.showLabels !== false &&
                arcs.filter(fitsLabel).map((arc) => {
                  const mid = arcMid(arc, { rings })
                  return (
                    <text
                      key={`t_${arc.key}`}
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={arc.depth === 0 ? 6 : 5}
                      fill="#fff"
                      className="pointer-events-none select-none font-semibold"
                    >
                      {arc.label}
                    </text>
                  )
                })}
            </svg>

            {/* The middle: the total, or whatever is under the pointer. A
                ring chart with nothing in the middle has a hole where its
                own headline should be. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="max-w-[38%] truncate text-[9px] font-medium uppercase tracking-wide text-slate-400">
                {shown ? shown.label : widget.valueLabel || 'Total'}
              </p>
              <p className="text-lg font-bold leading-tight text-slate-800">
                {fmt(shown ? shown.value : total)}
              </p>
              {shown && <p className="text-[9px] text-slate-400">{Math.round(shown.share * 100)}% of all</p>}
            </div>
          </div>

          <p className="mt-1 h-4 truncate text-center text-[10px] text-slate-400">
            {shown ? shown.key : hidden > 0 ? `${hidden} too small to draw` : ''}
          </p>
        </div>
      )}
    </Shell>
  )
}
