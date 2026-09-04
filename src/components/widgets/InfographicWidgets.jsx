import { useMemo } from 'react'
import { formatNumber } from '../../lib/dataUtils'
import { seriesColor } from '../../lib/seriesData'
import { ringGeometry } from '../../lib/kpiShapes'
import { processSteps, pyramidLayers, ringStats } from '../../lib/infographics'

// =====================================================================
// Infographic widgets
// =====================================================================
// Three shapes lifted straight off a printed data-visualisation template:
// rings of percentage, numbered process steps, and a pyramid of layers.
//
// They are drawn in CSS and one small SVG each rather than in Recharts,
// because none of the three is a plot -- there is no axis, no scale and
// nothing to hover. A chart library here would be a lot of machinery for
// a circle and some trapezoids, and would fight the card's own styling
// every time somebody changed the page look.
//
// The arithmetic is all in lib/infographics.js. Nothing in this file
// decides what a number MEANS; it decides how big the circle is.

/** The rows a widget should read, honouring its own "ignore filters" flag. */
const sourceRows = (widget, rows, unfilteredRows) => (widget.ignoreFilters ? unfilteredRows : rows)

function Shell({ widget, icon, caption, tabError, children, className = '' }) {
  return (
    <div className={`card flex h-full flex-col ${className}`}>
      <div className="mb-2">
        <h2 className="widget-title">
          {icon} {widget.title}
        </h2>
        {caption && (
          <p className="text-[11px] text-slate-400">
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

/**
 * What the card says about the categories it did not draw.
 *
 * Always said, never silently dropped: "top 4" with nothing to say the
 * other fourteen exist is the same lie as a truncated pie.
 */
function Rest({ hidden, hiddenValue, format, agg }) {
  if (!hidden) return null
  return (
    <p className="mt-2 text-[11px] text-slate-400">
      + {hidden} more, {formatNumber(hiddenValue, format, agg)} between them
    </p>
  )
}

const colorFor = (widget, name, index) =>
  seriesColor(name, index, widget.seriesColors, widget.palette || 'default')

/** A cross-filter, if the page is wired for one and the widget has a column. */
function drillTo(widget, name, onCrossFilter) {
  if (!onCrossFilter || !widget.groupBy) return undefined
  return () =>
    onCrossFilter({
      id: `${widget.type}_${widget.id}`,
      label: `${widget.groupBy}: ${name}`,
      match: 'all',
      conditions: [{ tab: widget.tab, column: widget.groupBy, operator: 'equals', value: name }],
    })
}

// ---------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------

/**
 * One circle, drawn from the same geometry as the KPI card's ring.
 *
 * Rotated rather than re-computed: an SVG circle starts at three o'clock,
 * and every shape here begins somewhere else.
 */
function Ring({ ring, widget, color, size, stroke }) {
  const geo = ringGeometry(ring.fraction, size, stroke, widget.shape || 'ring')
  const centre = widget.centre || 'percent'
  const percent = `${ring.percent >= 10 || ring.percent === 0 ? Math.round(ring.percent) : ring.percent.toFixed(1)}%`
  const value = formatNumber(ring.value, widget.format || 'comma', widget.aggregation)

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: `rotate(${geo.rotation}deg)`, display: 'block' }}
      >
        <circle
          cx={geo.centre}
          cy={geo.centre}
          r={geo.r}
          fill="none"
          stroke={widget.trackColor || '#E2E8F0'}
          strokeWidth={geo.stroke}
          // The track is only as long as this shape draws. A gauge with a
          // faint ghost of its missing quarter is a ring with a smudge.
          strokeDasharray={geo.dashArray}
          strokeLinecap="round"
        />
        <circle
          cx={geo.centre}
          cy={geo.centre}
          r={geo.r}
          fill="none"
          stroke={color}
          strokeWidth={geo.stroke}
          strokeDasharray={geo.dashArray}
          strokeDashoffset={geo.offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      {centre !== 'none' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="font-bold text-ink" style={{ fontSize: Math.round(size / 4.6) }}>
            {centre === 'percent' ? percent : value}
          </span>
          {centre === 'both' && (
            <span className="mt-1 text-[11px] font-medium text-slate-500">{percent}</span>
          )}
        </div>
      )}
    </div>
  )
}

export function RingStatsWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => ringStats(widget, { rows: source }), [widget, source])

  const size = Math.max(56, Math.min(220, Number(widget.size) || 108))
  const stroke = Math.max(3, Math.min(Math.round(size / 3), Number(widget.thickness) || 12))
  const perRow = Math.max(1, Math.min(6, Number(widget.perRow) || 4))

  return (
    <Shell
      widget={widget}
      icon="◎"
      caption={`${widget.tab} · by ${widget.groupBy || '—'}`}
      tabError={tabError}
    >
      {!data.ready ? (
        <p className="empty-state">Pick a column to split by</p>
      ) : data.rings.length === 0 ? (
        <p className="empty-state">Nothing to show</p>
      ) : (
        <>
          <div
            className="grid flex-1 content-center justify-items-center gap-x-3 gap-y-4"
            style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
          >
            {data.rings.map((ring) => {
              const drill = drillTo(widget, ring.name, onCrossFilter)
              return (
                <div
                  key={ring.name}
                  onClick={drill}
                  className={`flex flex-col items-center text-center ${drill ? 'cursor-pointer' : ''}`}
                  title={`${ring.name} — ${formatNumber(ring.value, widget.format, widget.aggregation)}`}
                >
                  <Ring
                    ring={ring}
                    widget={widget}
                    color={colorFor(widget, ring.name, ring.index)}
                    size={size}
                    stroke={stroke}
                  />
                  <p className="mt-2 max-w-[140px] truncate text-xs font-semibold text-ink">{ring.name}</p>
                  {widget.showValue !== false && (
                    <p className="text-[11px] text-slate-500">
                      {formatNumber(ring.value, widget.format || 'comma', widget.aggregation)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <Rest hidden={data.hidden} hiddenValue={data.hiddenValue} format={widget.format} agg={widget.aggregation} />
        </>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------

/**
 * A chevron, cut with a clip-path.
 *
 * The notch is a percentage of the block's own width, so a narrow step and
 * a wide one get arrowheads of different lengths -- which is what stops a
 * row of six looking like a row of six arrows drawn by different people.
 */
const CHEVRON = 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)'
const CHEVRON_FIRST = 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)'
// The same notch turned a quarter, for a process running down a narrow
// card. Without these, picking "Down" quietly turned the chevrons into
// plain blocks -- the setting still saved, and the shape silently didn't.
const CHEVRON_DOWN = 'polygon(0 0, 50% 12px, 100% 0, 100% calc(100% - 12px), 50% 100%, 0 calc(100% - 12px))'
const CHEVRON_DOWN_FIRST = 'polygon(0 0, 100% 0, 100% calc(100% - 12px), 50% 100%, 0 calc(100% - 12px))'

export function ProcessWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => processSteps(widget, { rows: source }), [widget, source])

  const shape = widget.shape || 'chevron'
  const down = widget.direction === 'column'
  const fromColumn = (widget.source || 'column') === 'column'

  const figure = (step) => {
    if (step.value === null || step.value === undefined) return null
    const value = formatNumber(step.value, widget.format || 'comma', widget.aggregation)
    if (widget.showShare && step.share !== null) return `${value} · ${Math.round(step.share)}%`
    return value
  }

  return (
    <Shell
      widget={widget}
      icon="➜"
      caption={fromColumn ? `${widget.tab} · by ${widget.groupBy || '—'}` : 'Steps you typed'}
      tabError={tabError}
    >
      {!data.ready ? (
        <p className="empty-state">{fromColumn ? 'Pick a column to split by' : 'Add a step'}</p>
      ) : (
        <>
          <div className={`flex flex-1 items-stretch ${down ? 'flex-col gap-2' : 'flex-row gap-1'}`}>
            {data.steps.map((step, i) => {
              const color = colorFor(widget, step.name || step.key, step.index)
              const drill = fromColumn ? drillTo(widget, step.name, onCrossFilter) : undefined
              const value = widget.showValue !== false ? figure(step) : null

              if (shape === 'circle' || shape === 'card') {
                return (
                  <div
                    key={step.key}
                    onClick={drill}
                    className={`relative flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center ${
                      shape === 'card' ? 'rounded-xl border border-slate-200/70 bg-white/70 shadow-sm' : ''
                    } ${drill ? 'cursor-pointer' : ''}`}
                  >
                    {/* The line between the discs, drawn behind them. */}
                    {shape === 'circle' && i > 0 && !down && (
                      <span className="absolute left-0 top-[22px] -z-10 h-0.5 w-full bg-slate-200" />
                    )}
                    {step.number && (
                      <span
                        className="z-10 flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shadow"
                        style={{ background: color }}
                      >
                        {step.number}
                      </span>
                    )}
                    <p className="mt-1 text-xs font-semibold text-ink">{step.name}</p>
                    {step.caption && <p className="text-[11px] leading-snug text-slate-500">{step.caption}</p>}
                    {value && <p className="text-sm font-bold" style={{ color }}>{value}</p>}
                  </div>
                )
              }

              const chevron = shape === 'chevron'
              return (
                <div
                  key={step.key}
                  onClick={drill}
                  className={`relative flex flex-1 items-center gap-2 px-3 py-3 text-white ${
                    chevron ? '' : 'rounded-lg'
                  } ${drill ? 'cursor-pointer' : ''}`}
                  style={{
                    background: color,
                    ...(chevron && !down
                      ? { clipPath: i === 0 ? CHEVRON_FIRST : CHEVRON, paddingLeft: i === 0 ? 14 : 24 }
                      : null),
                    ...(chevron && down
                      ? {
                          clipPath: i === 0 ? CHEVRON_DOWN_FIRST : CHEVRON_DOWN,
                          paddingTop: i === 0 ? 12 : 20,
                          paddingBottom: 20,
                        }
                      : null),
                    ...(shape === 'arrow' && !down ? { marginRight: i === data.steps.length - 1 ? 0 : 10 } : null),
                  }}
                >
                  {step.number && (
                    <span className="text-lg font-bold opacity-70 tabular-nums">{step.number}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{step.name}</span>
                    {step.caption && <span className="block truncate text-[11px] opacity-80">{step.caption}</span>}
                  </span>
                  {value && <span className="text-sm font-bold tabular-nums">{value}</span>}
                  {/* The arrowhead between two blocks, for the shape that
                      does not cut its own. */}
                  {shape === 'arrow' && !down && i < data.steps.length - 1 && (
                    <span
                      className="absolute"
                      aria-hidden
                      style={{
                        right: -9,
                        width: 0,
                        height: 0,
                        borderTop: '9px solid transparent',
                        borderBottom: '9px solid transparent',
                        borderLeft: `9px solid ${color}`,
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
          {fromColumn && (
            <Rest hidden={data.hidden} hiddenValue={data.hiddenValue} format={widget.format} agg={widget.aggregation} />
          )}
        </>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Pyramid
// ---------------------------------------------------------------------

export function PyramidWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => pyramidLayers(widget, { rows: source }), [widget, source])

  const gap = Math.max(0, Math.min(16, Number(widget.gap ?? 4)))
  const shape = widget.shape || 'pyramid'
  // Only the trapezoid shapes get sloped sides. Full-width bands with a
  // taper drawn on them would be claiming a proportion they do not have.
  const sloped = shape !== 'steps'

  return (
    <Shell
      widget={widget}
      icon="🔺"
      caption={`${widget.tab} · by ${widget.groupBy || '—'}`}
      tabError={tabError}
    >
      {!data.ready ? (
        <p className="empty-state">Pick a column to split by</p>
      ) : data.layers.length === 0 ? (
        <p className="empty-state">Nothing to show</p>
      ) : (
        <>
          <div className="flex flex-1 flex-col justify-center" style={{ gap: `${gap}px` }}>
            {data.layers.map((layer, i) => {
              const color = colorFor(widget, layer.name, layer.index)
              const drill = drillTo(widget, layer.name, onCrossFilter)
              const next = data.layers[i + 1]
              // A trapezoid: this layer's width at the top, the next one's
              // at the bottom, so consecutive layers share an edge and the
              // stack reads as one solid shape rather than as loose slabs.
              const bottom = next ? next.width : layer.width
              const inset = (w) => `${(100 - w) / 2}%`
              return (
                <div
                  key={layer.name}
                  onClick={drill}
                  className={`relative flex min-h-[34px] flex-1 items-center justify-center px-3 text-center text-white ${
                    drill ? 'cursor-pointer' : ''
                  }`}
                  style={{
                    background: color,
                    ...(sloped
                      ? {
                          clipPath: `polygon(${inset(layer.width)} 0, ${100 - (100 - layer.width) / 2}% 0, ${
                            100 - (100 - bottom) / 2
                          }% 100%, ${inset(bottom)} 100%)`,
                        }
                      : { borderRadius: 10 }),
                  }}
                  title={`${layer.name} — ${formatNumber(layer.value, widget.format, widget.aggregation)}`}
                >
                  <span className="flex max-w-[70%] flex-wrap items-baseline justify-center gap-x-2 leading-tight">
                    <span className="truncate text-xs font-semibold">{layer.name}</span>
                    {widget.showValue !== false && (
                      <span className="text-sm font-bold tabular-nums">
                        {formatNumber(layer.value, widget.format || 'comma', widget.aggregation)}
                      </span>
                    )}
                    {widget.showShare !== false && (
                      <span className="text-[11px] opacity-80">{Math.round(layer.share)}%</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <Rest hidden={data.hidden} hiddenValue={data.hiddenValue} format={widget.format} agg={widget.aggregation} />
        </>
      )}
    </Shell>
  )
}

export default RingStatsWidget
