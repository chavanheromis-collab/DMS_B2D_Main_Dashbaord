import { useMemo, useRef, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from 'recharts'
import { DEFAULT_PIE_OPTIONS, PIE_PERCENT_BASES, REST_LABEL, labelledSlices, legendScrollStart, legendWindowSize, pieSlices, pieWindow, rollupNote, sliceLabel } from '../../lib/pieData.js'

/**
 * A part-of-whole chart that survives real data.
 *
 * The failure it is built against: 120 categories, long names, and a circle
 * that turns into a grey smear of overlapping text. Four things fix that,
 * and only one of them is cosmetic:
 *
 *  1. Roll the tail into "Other" instead of dropping it (lib/pieData.js).
 *     Dropping is not a smaller version of the same chart -- it is a
 *     different, wrong chart, because every percentage silently becomes a
 *     percentage of what survived.
 *  2. Label only the slices with room for a label. The rest are still
 *     slices; it is the TEXT that is dropped, not the category.
 *  3. Put the names in a LIST beside the chart. A list holds 120 rows and
 *     stays readable; a circle does not, and no label-placement algorithm
 *     will change that.
 *  4. Make the two halves one object: hovering either highlights both, so
 *     the list is how you read the circle rather than a separate legend to
 *     cross-reference.
 */
export default function PiePanel({ type, data, widget, fmt, colorFor, activeName, onDrill, height }) {
  const [hover, setHover] = useState(-1)

  // "Scroll" is the other answer to a hundred and twenty categories: every
  // one of them in the legend, and the pie showing whichever are in view.
  const scrolling = widget.pieOverflow === 'scroll'

  const result = useMemo(
    () =>
      pieSlices(data, {
        maxSlices: Number(widget.pieMaxSlices) > 0 ? Number(widget.pieMaxSlices) : DEFAULT_PIE_OPTIONS.maxSlices,
        minPercent: widget.pieMinPercent ?? DEFAULT_PIE_OPTIONS.minPercent,
        rollup: scrolling ? false : widget.pieRollup !== false,
      }),
    [data, widget.pieMaxSlices, widget.pieMinPercent, widget.pieRollup, scrolling]
  )

  // Where the legend is scrolled to, and how many rows it can show.
  const [start, setStart] = useState(0)
  const [rows, setRows] = useState(DEFAULT_PIE_OPTIONS.maxSlices)

  // Whether the circle is filled by what is on screen, or keeps the whole
  // and draws the rest as one grey wedge. Filling is the default: eight
  // slices worth 1% between them against a 99% wedge is a chart of nothing.
  const fill = widget.pieFillWindow !== false

  const view = useMemo(
    () => (scrolling ? pieWindow(result.slices, { start, count: rows, fill }) : null),
    [scrolling, result.slices, start, rows, fill]
  )

  // Which percentage a label means. On a filled circle the geometry is the
  // share of what is shown, so saying "% of everything" beside a slice that
  // looks like a third of the pie needs the caption underneath to explain
  // it -- which it does.
  const percentBase = widget.piePercentBase === 'shown' ? 'shown' : 'total'

  const slices = view ? view.slices : result.slices
  const labelFloor = widget.pieLabelMinPercent ?? DEFAULT_PIE_OPTIONS.labelMinPercent
  const labelled = useMemo(
    () => new Set(labelledSlices(slices, labelFloor).map((s) => s.name)),
    [slices, labelFloor]
  )

  const showLabels = widget.showLabels && widget.pieLabels !== 'none'
  const showLegend = widget.pieLegend !== false
  const labelStyle = widget.labelStyle || 'name_percent'
  const isRose = type === 'rose'
  const donut = type === 'donut'

  const max = Math.max(...slices.map((s) => s.value), 0) || 1
  const hovered = hover >= 0 ? slices[hover] : null
  // What the middle of a donut says: the whole, until you point at a part.
  const centre = hovered || (result.total ? { name: 'Total', value: result.total, percent: 1 } : null)

  const dim = (slice) => {
    if (hovered && hovered.name !== slice.name) return 0.45
    if (activeName && activeName !== slice.name) return 0.25
    return 1
  }

  function drill(slice) {
    // "Other" is a bucket this chart invented, not a value any row holds --
    // there is nothing coherent to filter the page to.
    if (!slice || slice.isOther || slice.isRest) return
    onDrill?.(slice.name)
  }

  if (slices.length === 0) return <p className="empty-state">No data to chart</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row">
        <div className="relative min-h-[200px] flex-1">
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={donut ? '55%' : isRose ? '14%' : 0}
                outerRadius={showLabels ? '70%' : '82%'}
                paddingAngle={isRose ? 2 : slices.length > 1 ? 1 : 0}
                startAngle={90}
                // Clockwise from twelve, which is how a pie is read.
                endAngle={-270}
                isAnimationActive={false}
                labelLine={false}
                label={showLabels ? renderLabel({ labelled, labelStyle, fmt, percentBase }) : false}
                activeIndex={isRose ? undefined : hover}
                activeShape={isRose ? undefined : ActiveSlice}
                onMouseEnter={(_, index) => setHover(index)}
                onMouseLeave={() => setHover(-1)}
                onClick={(_, index) => drill(slices[index])}
              >
                {slices.map((slice, i) => (
                  <Cell
                    key={`${slice.name}-${i}`}
                    fill={slice.isOther || slice.isRest ? '#cbd5e1' : colorFor(slice, i)}
                    fillOpacity={dim(slice)}
                    stroke="#fff"
                    strokeWidth={1}
                    cursor={onDrill && !slice.isOther ? 'pointer' : 'default'}
                    {...(isRose ? { outerRadius: `${20 + (slice.value / max) * 58}%` } : null)}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* The centre of a donut is the most valuable real estate on the
              chart and is otherwise a hole. */}
          {donut && centre && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="max-w-[46%] truncate text-[10px] uppercase tracking-wide text-slate-400">
                {centre.name}
              </span>
              <span className="text-xl font-bold tabular-nums text-slate-800">{fmt(centre.value)}</span>
              {centre.percent < 1 && (
                <span className="text-[10px] font-semibold text-slate-400">
                  {(centre.percent * 100).toFixed(centre.percent < 0.1 ? 1 : 0)}% of total
                </span>
              )}
            </div>
          )}
        </div>

        {showLegend && (
          <SliceList
            // Scrolling lists EVERY category; rolling up lists the slices
            // that were drawn, which already include Other.
            slices={scrolling ? result.slices : slices}
            colorFor={colorFor}
            fmt={fmt}
            hover={hover}
            activeName={activeName}
            onHover={setHover}
            onDrill={drill}
            canDrill={Boolean(onDrill)}
            windowed={scrolling}
            start={view?.start ?? 0}
            count={rows}
            onWindow={(nextStart, nextRows) => {
              setStart(nextStart)
              if (nextRows) setRows(nextRows)
            }}
          />
        )}
      </div>

      {result.truncated && (
        <p className="mt-1 shrink-0 text-[10px] text-slate-400">{rollupNote(result, fmt)}</p>
      )}

      {/* Nothing is hidden here -- it is all in the list -- but the reader
          should be told that the circle is showing a window of it. */}
      {scrolling && view?.restCount > 0 && (
        <p className="mt-1 shrink-0 text-[10px] text-slate-400">
          {fill ? (
            <>
              The circle is these {view.slices.length} of {result.slices.length} — scroll the list to move it
              through them. Together they are{' '}
              <strong>{(view.shownShare * 100).toFixed(view.shownShare < 0.1 ? 1 : 0)}% of the whole</strong>
              {percentBase === 'shown' ? ', and the percentages beside them are shares of the circle.' : '.'}
            </>
          ) : (
            <>
              Showing {view.slices.length - 1} of {result.slices.length} — scroll the list to move the pie through
              them. The rest is the one grey wedge, {((view.restValue / (result.total || 1)) * 100).toFixed(0)}% of
              the whole.
            </>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * The hovered slice, lifted out of the circle.
 *
 * A hover state you can see from across the room is the difference between
 * a chart you can point at in a meeting and one you have to describe.
 */
function ActiveSlice(props) {
  const { outerRadius = 0, ...rest } = props
  return (
    <g>
      <Sector {...rest} outerRadius={outerRadius + 5} />
      <Sector
        {...rest}
        innerRadius={outerRadius + 7}
        outerRadius={outerRadius + 9}
        fillOpacity={0.55}
      />
    </g>
  )
}

/** Outside labels, only where one fits. */
function renderLabel({ labelled, labelStyle, fmt, percentBase = 'total' }) {
  return function Label({ cx, cy, midAngle, outerRadius, name, value, percent, index, payload }) {
    if (!labelled.has(name)) return null

    const rad = -midAngle * (Math.PI / 180)
    const r = outerRadius + 14
    const x = cx + r * Math.cos(rad)
    const y = cy + r * Math.sin(rad)
    const right = Math.cos(rad) >= 0

    // Long category names are why these charts fall apart; the full name is
    // one glance away in the list, so the label carries the short form.
    // `percent` from the chart is the share of what it DREW, which on a
    // filled window is the share of the window. The slice's own numbers ride
    // along in `payload`, so a label asking for "% of everything" gets the
    // number that actually means that.
    const text = sliceLabel(
      {
        name: truncate(name, 16),
        value,
        percent: payload?.percent ?? percent,
        percentShown: payload?.percentShown ?? percent,
      },
      labelStyle,
      fmt,
      percentBase
    )

    return (
      <text
        key={index}
        x={x}
        y={y}
        textAnchor={right ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={10}
        fill="#64748b"
      >
        {text}
      </text>
    )
  }
}

function truncate(text, at) {
  const s = String(text ?? '')
  return s.length > at ? `${s.slice(0, at - 1)}…` : s
}

/**
 * Every category, as a list.
 *
 * This is the part that actually solves 120 slices. It scrolls, it shows
 * the full name, the value and the share, and it is bound to the same hover
 * and click as the circle -- so it is not a legend to cross-reference, it
 * is the readable half of one chart.
 */
const ROW_HEIGHT = 24

function SliceList({
  slices,
  colorFor,
  fmt,
  hover,
  activeName,
  onHover,
  onDrill,
  canDrill,
  windowed = false,
  start = 0,
  count = 8,
  onWindow,
}) {
  const boxRef = useRef(null)

  // Which rows are in view, worked out from the scroll rather than from
  // anything React knows -- a list of a hundred and twenty rows is scrolled
  // by the browser, and the browser is the only thing that knows where.
  const report = () => {
    if (!windowed || !onWindow || !boxRef.current) return
    const el = boxRef.current
    onWindow(legendScrollStart(el.scrollTop, ROW_HEIGHT), legendWindowSize(el.clientHeight, ROW_HEIGHT))
  }

  return (
    <div
      ref={boxRef}
      onScroll={report}
      onPointerEnter={report}
      className="max-h-[220px] shrink-0 overflow-y-auto pr-1 sm:max-h-none sm:w-[42%] sm:max-w-[240px]">
      <ul className="space-y-px">
        {slices.map((slice, i) => {
          const on = hover === i || activeName === slice.name
          // Which of these the pie is currently drawing.
          const inView = !windowed || (i >= start && i < start + count)
          return (
            <li key={`${slice.name}-${i}`} style={windowed ? { height: ROW_HEIGHT } : undefined}>
              <button
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(-1)}
                onClick={() => onDrill(slice)}
                disabled={!canDrill || slice.isOther}
                className={`flex h-full w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors ${
                  on ? 'bg-slate-100' : 'hover:bg-slate-50'
                } ${inView ? '' : 'opacity-45'} disabled:cursor-default`}
                title={
                  slice.isOther
                    ? `${slice.members.map((m) => `${m.name} ${fmt(m.value)}`).slice(0, 12).join('\n')}${
                        slice.members.length > 12 ? `\n… and ${slice.members.length - 12} more` : ''
                      }`
                    : `${slice.name} — ${fmt(slice.value)}`
                }
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: slice.isOther ? '#cbd5e1' : colorFor(slice, i) }}
                />
                <span className={`min-w-0 flex-1 truncate text-[11px] ${slice.isOther ? 'italic text-slate-400' : 'text-slate-600'}`}>
                  {slice.name}
                </span>
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-700">
                  {fmt(slice.value)}
                </span>
                <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
                  {(slice.percent * 100).toFixed(slice.percent < 0.1 ? 1 : 0)}%
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
