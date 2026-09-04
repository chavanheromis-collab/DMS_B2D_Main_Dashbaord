import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { formatNumber } from '../../lib/dataUtils'
import { boxplotData } from '../../lib/boxplot'
import { sankeyData, ribbonPath } from '../../lib/sankeyData'
import { wordCloudData } from '../../lib/wordCloud'
import { profileData } from '../../lib/columnProfile'
import { seriesColor } from '../../lib/seriesData'

// =====================================================================
// Distribution widgets
// =====================================================================
// Every other chart reduces a group of rows to one number. These four
// refuse to:
//
//   Box plot -- the whole spread, so two branches with the same average
//               stop looking identical
//   Sankey   -- where the rows went, as widths rather than as a grid
//   Word cloud -- what a free-text column is full of, which nothing else
//               in the app can read at all
//   Profile  -- whether the sheet is fit to report on in the first place

const sourceRows = (widget, rows, unfilteredRows) => (widget.ignoreFilters ? unfilteredRows : rows)

function Shell({ widget, icon, caption, tabError, children, footer }) {
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
        <>
          <div className="min-h-0 flex-1">{children}</div>
          {footer}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Box plot
// ---------------------------------------------------------------------
/**
 * Median, quartiles, whiskers and every outlier, per group.
 *
 * The outliers are the reason to draw this rather than a bar of averages.
 * A bar chart says two branches sell the same amount; a box says one of
 * them does it forty cars at a time and the other did it once, in March,
 * with a fleet deal that will not repeat.
 */
export default function BoxPlotWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => boxplotData(widget, { rows: source }), [widget, source])
  const horizontal = widget.orientation === 'horizontal'

  const fmt = (v) => formatNumber(v, widget.format, 'avg')

  const colorFor = (box) =>
    widget.groupBy
      ? seriesColor(box.name, box.index, widget.seriesColors, widget.palette || 'default')
      : widget.color || '#4F46E5'

  function drill(box) {
    if (!onCrossFilter || !widget.groupBy) return
    onCrossFilter({
      id: `boxplot_${widget.id}`,
      label: `${widget.groupBy}: ${box.name}`,
      match: 'all',
      conditions: [{ tab: widget.tab, column: widget.groupBy, operator: 'equals', value: box.name }],
    })
  }

  const height = Math.max(160, Math.min(900, Number(widget.height) || 300))

  return (
    <Shell
      widget={widget}
      icon="📦"
      caption={`${widget.tab} · ${widget.column || '—'}${widget.groupBy ? ` by ${widget.groupBy}` : ''}`}
      tabError={tabError}
      footer={
        data.ready && data.boxes.length > 0 ? (
          <p className="mt-2 text-[10px] text-slate-400">
            Box is the middle half · line is the median
            {widget.showMean !== false && ' · dot is the mean'}
            {data.hidden > 0 && ` · ${data.hidden} groups beyond the limit`}
            {data.tooSmall.length > 0 &&
              ` · ${data.tooSmall.length} group${data.tooSmall.length === 1 ? '' : 's'} too small to summarise`}
            {data.unusable > 0 && ` · ${data.unusable} non-numeric cells ignored`}
          </p>
        ) : null
      }
    >
      {!data.ready ? (
        <p className="empty-state">{data.reason}</p>
      ) : data.boxes.length === 0 ? (
        <p className="empty-state">No group has enough rows to summarise</p>
      ) : horizontal ? (
        <div className="space-y-2">
          {data.boxes.map((box) => (
            <HorizontalBox key={box.name} box={box} color={colorFor(box)} widget={widget} fmt={fmt} onDrill={onCrossFilter ? () => drill(box) : undefined} />
          ))}
          <Axis data={data} fmt={fmt} />
        </div>
      ) : (
        <div className="flex" style={{ height }}>
          {/* The axis is a column of its own so the labels cannot be
              clipped by the plot area, which is what happens when they are
              absolutely positioned inside it. */}
          <div className="relative w-14 shrink-0 text-right text-[9px] text-slate-400">
            {data.ticks.map((tick, i) => (
              <span key={i} className="absolute right-1 -translate-y-1/2 tabular-nums" style={{ bottom: `${tick.fraction * 100}%` }}>
                {fmt(tick.value)}
              </span>
            ))}
          </div>

          <div className="flex flex-1 items-stretch gap-2 border-l border-slate-100 pl-2">
            {data.boxes.map((box) => (
              <VerticalBox
                key={box.name}
                box={box}
                color={colorFor(box)}
                widget={widget}
                fmt={fmt}
                onDrill={onCrossFilter ? () => drill(box) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </Shell>
  )
}

function Axis({ data, fmt }) {
  return (
    <div className="relative mt-1 h-3 border-t border-slate-100">
      {data.ticks.map((tick, i) => (
        <span
          key={i}
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] tabular-nums text-slate-400"
          style={{ left: `${tick.fraction * 100}%` }}
        >
          {fmt(tick.value)}
        </span>
      ))}
    </div>
  )
}

function BoxTitle({ box, fmt }) {
  return `${box.name} — ${box.stats.count} rows
median ${fmt(box.stats.median)}
middle half ${fmt(box.stats.q1)} to ${fmt(box.stats.q3)}
range ${fmt(box.stats.min)} to ${fmt(box.stats.max)}${
    box.stats.outliers.length ? `\n${box.stats.outliers.length} outliers` : ''
  }`
}

function VerticalBox({ box, color, widget, fmt, onDrill }) {
  const f = box.fractions
  const pct = (v) => `${v * 100}%`

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        className={`relative flex-1 ${onDrill ? 'cursor-pointer' : ''}`}
        onClick={onDrill}
        title={BoxTitle({ box, fmt })}
      >
        {/* Whisker */}
        <span className="absolute left-1/2 w-px -translate-x-1/2 bg-slate-400" style={{ bottom: pct(f.whiskerLow), height: pct(f.whiskerHigh - f.whiskerLow) }} />
        {/* Whisker caps */}
        <span className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-slate-400" style={{ bottom: pct(f.whiskerLow) }} />
        <span className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-slate-400" style={{ bottom: pct(f.whiskerHigh) }} />

        {/* The middle half */}
        <span
          className="absolute left-1/2 w-[70%] max-w-[46px] -translate-x-1/2 rounded-sm"
          style={{
            bottom: pct(f.q1),
            height: pct(Math.max(0.004, f.q3 - f.q1)),
            backgroundColor: `${color}33`,
            border: `1.5px solid ${color}`,
          }}
        />
        {/* The median, drawn heavier than the box edges -- it is the one
            number people actually read off this chart. */}
        <span
          className="absolute left-1/2 h-[2.5px] w-[70%] max-w-[46px] -translate-x-1/2 rounded-full"
          style={{ bottom: pct(f.median), backgroundColor: color }}
        />

        {widget.showMean !== false && (
          <span
            className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 translate-y-1/2 rotate-45 border border-white"
            style={{ bottom: pct(f.mean), backgroundColor: color }}
            title={`mean ${fmt(box.stats.mean)}`}
          />
        )}

        {widget.showOutliers !== false &&
          box.outlierFractions.map((o, i) => (
            <span
              key={i}
              className="absolute left-1/2 h-1 w-1 -translate-x-1/2 translate-y-1/2 rounded-full"
              style={{ bottom: pct(o.fraction), backgroundColor: color, opacity: 0.55 }}
              title={fmt(o.value)}
            />
          ))}
      </div>

      <p className="mt-1 truncate text-center text-[10px] text-slate-500" title={box.name}>
        {box.name}
      </p>
      <p className="text-center text-[9px] tabular-nums text-slate-400">{fmt(box.stats.median)}</p>
    </div>
  )
}

function HorizontalBox({ box, color, widget, fmt, onDrill }) {
  const f = box.fractions
  const pct = (v) => `${v * 100}%`

  return (
    <div className={onDrill ? 'cursor-pointer' : ''} onClick={onDrill}>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[10px]">
        <span className="truncate text-slate-600">{box.name}</span>
        <span className="shrink-0 tabular-nums text-slate-400">
          n={box.stats.count} · median {fmt(box.stats.median)}
        </span>
      </div>
      <div className="relative h-5" title={BoxTitle({ box, fmt })}>
        <span className="absolute top-1/2 h-px -translate-y-1/2 bg-slate-400" style={{ left: pct(f.whiskerLow), width: pct(f.whiskerHigh - f.whiskerLow) }} />
        <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-slate-400" style={{ left: pct(f.whiskerLow) }} />
        <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-slate-400" style={{ left: pct(f.whiskerHigh) }} />
        <span
          className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm"
          style={{
            left: pct(f.q1),
            width: pct(Math.max(0.004, f.q3 - f.q1)),
            backgroundColor: `${color}33`,
            border: `1.5px solid ${color}`,
          }}
        />
        <span className="absolute top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full" style={{ left: pct(f.median), backgroundColor: color }} />
        {widget.showOutliers !== false &&
          box.outlierFractions.map((o, i) => (
            <span
              key={i}
              className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: pct(o.fraction), backgroundColor: color, opacity: 0.55 }}
              title={fmt(o.value)}
            />
          ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Sankey
// ---------------------------------------------------------------------
/**
 * Where the rows went, as widths.
 *
 * Drawn in a 0→1 coordinate box and scaled by the SVG viewBox, so the
 * whole diagram reflows to whatever width the card ends up with without
 * a single measurement in JavaScript.
 */
export function SankeyWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => sankeyData(widget, { rows: source }), [widget, source])
  const [hovered, setHovered] = useState(null)

  const height = Math.max(200, Math.min(1200, Number(widget.height) || 360))
  // Taken from the LAYOUT rather than recomputed here. The last column is
  // pulled back by exactly this much so its blocks end flush with the right
  // edge; a second copy of the number would be the version that drifts.
  const nodeWidth = data.nodeWidth
  const opacity = Math.max(0.1, Math.min(1, Number(widget.linkOpacity ?? 0.42)))

  const colorFor = (node) =>
    node.isOther ? '#94A3B8' : seriesColor(node.label, node.order, widget.seriesColors, widget.palette || 'default')

  function drillNode(node) {
    if (!onCrossFilter) return
    const column = data.columnNames[node.stage]
    if (!column || node.isOther) return
    onCrossFilter({
      id: `sankey_${widget.id}`,
      label: `${column}: ${node.label}`,
      match: 'all',
      conditions: [{ tab: widget.tab, column, operator: 'equals', value: node.label }],
    })
  }

  return (
    <Shell
      widget={widget}
      icon="🌊"
      caption={`${widget.tab} · ${(widget.stages || []).filter(Boolean).join(' → ') || '—'}`}
      tabError={tabError}
      footer={
        data.ready && data.links.length > 0 ? (
          <p className="mt-1 text-[10px] text-slate-400">
            {formatNumber(data.total, widget.format, widget.aggregation)} in total
            {data.folded > 0 && ` · smallest values merged into “${data.otherLabel}”`}
          </p>
        ) : null
      }
    >
      {!data.ready ? (
        <p className="empty-state">{data.reason || 'Pick at least two columns'}</p>
      ) : data.links.length === 0 ? (
        <p className="empty-state">No rows flow between these columns</p>
      ) : (
        <div className="relative w-full" style={{ height }}>
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            // Without this the ribbons stretch their strokes with the
            // viewBox and every edge becomes a different thickness.
            style={{ overflow: 'visible' }}
          >
            {data.links.map((link, i) => {
              const dim = hovered && hovered !== link.source?.key && hovered !== link.target?.key
              return (
                <path
                  key={i}
                  d={ribbonPath(link, { nodeWidth })}
                  fill={colorFor(link.source)}
                  opacity={dim ? opacity * 0.25 : opacity}
                  onMouseEnter={() => setHovered(link.source?.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ transition: 'opacity 140ms ease' }}
                >
                  <title>
                    {`${link.source?.label} → ${link.target?.label}: ${formatNumber(
                      link.value,
                      widget.format,
                      widget.aggregation
                    )}`}
                  </title>
                </path>
              )
            })}

            {data.stages.flatMap((column) =>
              column.nodes.map((node) => (
                <rect
                  key={node.key}
                  x={node.x}
                  y={node.y0}
                  width={nodeWidth}
                  height={Math.max(0.002, node.height)}
                  fill={colorFor(node)}
                  rx={nodeWidth / 3}
                  onMouseEnter={() => setHovered(node.key)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => drillNode(node)}
                  style={{ cursor: onCrossFilter && !node.isOther ? 'pointer' : 'default' }}
                >
                  <title>
                    {`${node.label}: ${formatNumber(node.value, widget.format, widget.aggregation)}`}
                  </title>
                </rect>
              ))
            )}
          </svg>

          {/* Labels live in HTML rather than in the SVG. A `viewBox` of
              0→1 with `preserveAspectRatio="none"` stretches text into
              unreadable ribbons; positioning them absolutely keeps every
              label the size it was set to. */}
          <div className="pointer-events-none absolute inset-0">
            {data.stages.flatMap((column) =>
              column.nodes
                .filter((node) => node.height > 0.035)
                .map((node) => {
                  // The last column's labels sit to the LEFT of their
                  // blocks; anywhere else they would be off the card.
                  const last = column.index === data.stages.length - 1
                  return (
                    <span
                      key={node.key}
                      className="absolute max-w-[45%] truncate whitespace-nowrap text-[10px] font-medium text-slate-600"
                      style={{
                        top: `${(node.y0 + node.height / 2) * 100}%`,
                        [last ? 'right' : 'left']: last
                          ? `${(1 - node.x) * 100}%`
                          : `${(node.x + nodeWidth) * 100}%`,
                        transform: 'translateY(-50%)',
                        [last ? 'marginRight' : 'marginLeft']: 6,
                        textAlign: last ? 'right' : 'left',
                      }}
                    >
                      {node.label}
                      {widget.showValues !== false && (
                        <span className="ml-1 tabular-nums text-slate-400">
                          {formatNumber(node.value, widget.format, widget.aggregation)}
                        </span>
                      )}
                    </span>
                  )
                })
            )}
          </div>
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Word cloud
// ---------------------------------------------------------------------
/**
 * The words a free-text column is full of.
 *
 * Laid out by the browser's own line breaking rather than by a packing
 * algorithm, which means it can never overlap itself -- the failure that
 * makes most word clouds unreadable. Deterministic too, so it does not
 * reshuffle on every render and make the reader think the data moved.
 */
export function WordCloudWidget({ widget, rows, unfilteredRows, tabError, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => wordCloudData(widget, { rows: source }), [widget, source])

  const colorFor = (word) => {
    if (widget.colorMode === 'palette') {
      return seriesColor(word.text, word.index, widget.seriesColors, widget.palette || 'default')
    }
    // Shading by frequency says something true. A colour per word implies
    // a grouping that does not exist.
    const base = widget.color || '#4F46E5'
    return base
  }

  function drill(word) {
    if (!onCrossFilter || !widget.column) return
    onCrossFilter({
      id: `wordcloud_${widget.id}`,
      label: `${widget.column} contains “${word.text}”`,
      match: 'all',
      conditions: [{ tab: widget.tab, column: widget.column, operator: 'contains', value: word.text }],
    })
  }

  return (
    <Shell
      widget={widget}
      icon="💬"
      caption={`${widget.tab} · ${widget.column || '—'}`}
      tabError={tabError}
      footer={
        data.ready && data.words.length > 0 ? (
          <p className="mt-2 text-[10px] text-slate-400">
            {data.distinct} distinct {widget.mode === 'phrase' ? 'phrases' : 'words'} across {data.filled} filled cells
            {data.hidden > 0 && ` · ${data.hidden} below the cut`}
          </p>
        ) : null
      }
    >
      {!data.ready ? (
        <p className="empty-state">Pick a text column in the editor</p>
      ) : data.words.length === 0 ? (
        <p className="empty-state">Nothing left after the stop-words</p>
      ) : widget.layout === 'ranked' ? (
        <div className="space-y-1">
          {data.words.map((word) => (
            <button
              key={word.text}
              onClick={() => drill(word)}
              disabled={!onCrossFilter}
              className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left ${
                onCrossFilter ? 'hover:bg-slate-50' : 'cursor-default'
              }`}
            >
              <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-slate-300">{word.rank}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{word.text}</span>
              <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(4, word.share * 100)}%`, backgroundColor: colorFor(word) }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-500">
                {word.count}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 py-2">
          {data.laidOut.map((word) => (
            <button
              key={word.text}
              onClick={() => drill(word)}
              disabled={!onCrossFilter}
              title={`${word.text} — ${word.count} ${word.count === 1 ? 'row' : 'rows'}`}
              className={`leading-tight transition-transform ${
                onCrossFilter ? 'hover:scale-110' : 'cursor-default'
              }`}
              style={{
                fontSize: word.size,
                // Weight tracks frequency alongside size. Size alone at
                // small type sizes is nearly invisible; weight carries the
                // difference the last few pixels cannot.
                fontWeight: 400 + Math.round(word.weight * 3) * 100,
                color: colorFor(word),
                opacity: 0.45 + word.weight * 0.55,
              }}
            >
              {word.text}
            </button>
          ))}
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Column profile
// ---------------------------------------------------------------------
const TYPE_BADGES = {
  number: { label: '123', color: '#0369A1', bg: '#F0F9FF' },
  date: { label: 'date', color: '#7C3AED', bg: '#F5F3FF' },
  category: { label: 'list', color: '#059669', bg: '#F0FDF4' },
  text: { label: 'text', color: '#64748B', bg: '#F8FAFC' },
  empty: { label: 'empty', color: '#DC2626', bg: '#FEF2F2' },
}

const SEVERITY = {
  high: { color: '#DC2626', bg: '#FEF2F2', Icon: AlertTriangle },
  medium: { color: '#B45309', bg: '#FFFBEB', Icon: AlertTriangle },
  low: { color: '#0369A1', bg: '#F0F9FF', Icon: Info },
}

/**
 * Is this sheet actually fit to report on?
 *
 * The one widget on the canvas whose subject is the DATA rather than the
 * business. Everything else silently absorbs a column that is 40% blank or
 * that has both "Delivered" and "delivered " in it; this says so, which is
 * the only way anybody finds out before the number reaches a meeting.
 */
export function ProfileWidget({ widget, rows, unfilteredRows, tabError, tabHeaders = [], dateOrder }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(
    () => profileData(widget, { rows: source, headers: tabHeaders, dateOrder }),
    [widget, source, tabHeaders, dateOrder]
  )
  const [open, setOpen] = useState(null)

  return (
    <Shell
      widget={widget}
      icon="🔍"
      caption={`${widget.tab} · ${data.rowCount} rows × ${data.columnCount} columns`}
      tabError={tabError}
      footer={
        data.ready ? (
          <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
            {data.problemColumns === 0 ? (
              <>
                <CheckCircle2 size={11} className="text-emerald-500" /> Nothing to flag
              </>
            ) : (
              <>
                <AlertTriangle size={11} className="text-amber-500" />
                {data.problemColumns} column{data.problemColumns === 1 ? '' : 's'} worth a look
                {data.highSeverity > 0 && ` · ${data.highSeverity} serious`}
                {data.hiddenClean > 0 && ` · ${data.hiddenClean} clean columns hidden`}
              </>
            )}
          </p>
        ) : null
      }
    >
      {!data.ready ? (
        <p className="empty-state">No columns to profile</p>
      ) : data.profiles.length === 0 ? (
        <p className="empty-state">Every column looks clean</p>
      ) : (
        <div className="max-h-[460px] space-y-1 overflow-y-auto pr-1">
          {data.profiles.map((p) => {
            const badge = TYPE_BADGES[p.type] || TYPE_BADGES.text
            const worst = p.issues[0]
            const tone = worst ? SEVERITY[worst.severity] : null
            const isOpen = open === p.column

            return (
              <div key={p.column} className="rounded-lg border border-slate-100">
                <button
                  onClick={() => setOpen(isOpen ? null : p.column)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-50"
                >
                  <span
                    className="shrink-0 rounded px-1 py-px text-[9px] font-semibold"
                    style={{ color: badge.color, backgroundColor: badge.bg }}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{p.column}</span>

                  {/* The fill bar is the headline. Everything else about a
                      column matters less than whether it is filled in. */}
                  <span className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:block">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${p.fillRate}%`,
                        backgroundColor: p.fillRate >= 95 ? '#10B981' : p.fillRate >= 60 ? '#F59E0B' : '#EF4444',
                      }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
                    {Math.round(p.fillRate)}%
                  </span>
                  <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-400" title="distinct values">
                    {p.distinct}
                  </span>

                  {tone && (
                    <tone.Icon size={12} className="shrink-0" style={{ color: tone.color }} title={worst.text} />
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 px-2 py-2 text-[11px]">
                    {p.issues.length > 0 && (
                      <ul className="mb-2 space-y-0.5">
                        {p.issues.map((issue) => {
                          const s = SEVERITY[issue.severity]
                          return (
                            <li key={issue.key} className="flex items-center gap-1.5" style={{ color: s.color }}>
                              <s.Icon size={11} /> {issue.text}
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    {p.type === 'number' && p.min !== undefined && (
                      <p className="mb-2 tabular-nums text-slate-500">
                        min {formatNumber(p.min, 'comma')} · median {formatNumber(p.median, 'comma')} · mean{' '}
                        {formatNumber(p.mean, 'comma')} · max {formatNumber(p.max, 'comma')}
                        {p.zeroes > 0 && ` · ${p.zeroes} zeroes`}
                        {p.negatives > 0 && ` · ${p.negatives} negative`}
                      </p>
                    )}

                    {p.type === 'date' && p.earliest && (
                      <p className="mb-2 text-slate-500">
                        {p.earliest.toLocaleDateString()} → {p.latest.toLocaleDateString()}
                        {p.staleDays > 0 && ` · newest is ${p.staleDays} days old`}
                      </p>
                    )}

                    {p.nearDuplicates.length > 0 && (
                      <div className="mb-2">
                        <p className="mb-0.5 text-[10px] font-semibold text-slate-400">Same value, typed differently</p>
                        {p.nearDuplicates.map((g) => (
                          <p key={g.key} className="truncate text-slate-500">
                            {g.variants.map((v) => `“${v}”`).join(' · ')}
                          </p>
                        ))}
                      </div>
                    )}

                    {widget.showSamples !== false && p.top.length > 0 && (
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold text-slate-400">Commonest values</p>
                        {p.top.map((t) => (
                          <div key={t.value} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-slate-600">{t.value}</span>
                            <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-slate-100">
                              <span className="block h-full rounded-full bg-indigo-400" style={{ width: `${t.share}%` }} />
                            </span>
                            <span className="w-10 shrink-0 text-right tabular-nums text-slate-400">{t.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Shell>
  )
}
