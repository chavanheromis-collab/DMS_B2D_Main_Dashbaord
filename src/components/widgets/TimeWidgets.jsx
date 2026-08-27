import { useMemo, useState } from 'react'
import { formatNumber } from '../../lib/dataUtils'
import { calendarData, dayLabels, stepFor } from '../../lib/calendarHeat'
import { ganttData } from '../../lib/ganttData'
import { cohortData } from '../../lib/cohortData'
import { inkOn, legendSwatches, stepColor, valueColor } from '../../lib/heatColor'
import { seriesColor } from '../../lib/seriesData'

// =====================================================================
// Time widgets
// =====================================================================
// Three shapes a date column makes that a line chart cannot:
//
//   Calendar -- rhythm and gaps. Which weekdays are dead, which fortnight
//               nobody filled the sheet in.
//   Gantt    -- overlap. What was running at the same time as what.
//   Cohort   -- return. Whether the people from March ever came back.
//
// All three are read by SHAPE rather than by value, which is why all three
// are drawn as grids of cells or bars rather than as plotted points.

const sourceRows = (widget, rows, unfilteredRows) => (widget.ignoreFilters ? unfilteredRows : rows)

function Shell({ widget, icon, caption, tabError, children, footer }) {
  return (
    <div className="card flex h-full flex-col">
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
        <>
          <div className="min-h-0 flex-1">{children}</div>
          {footer}
        </>
      )}
    </div>
  )
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------------------------------------------------------------------
// Calendar heat map
// ---------------------------------------------------------------------
/**
 * A year of days, as a grid.
 *
 * Every cell is one day and every row of the strip is one weekday, which
 * is the whole point: a column of pale Sundays running the width of the
 * card is a fact about the business that no line chart can show, because a
 * line chart sums the week away before you ever see it.
 */
export default function CalendarHeatWidget({ widget, rows, unfilteredRows, tabError, dateOrder, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => calendarData(widget, { rows: source, dateOrder }), [widget, source, dateOrder])

  const steps = Math.max(2, Math.min(9, Number(widget.steps) || 5))
  const size = Math.max(6, Math.min(28, Number(widget.cellSize) || 13))
  const days = dayLabels(widget.weekStart)

  function drill(cell) {
    if (!onCrossFilter || !cell || cell.empty || !widget.dateColumn) return
    const iso = cell.key
    onCrossFilter({
      id: `calendar_${widget.id}`,
      label: `${widget.dateColumn}: ${cell.day} ${MONTH_NAMES[cell.month]} ${cell.year}`,
      match: 'all',
      // A single day is a between of that day with itself -- an `equals`
      // would have to match the cell's exact typed text, which for a date
      // column is whatever format somebody happened to use that morning.
      conditions: [
        { tab: widget.tab, column: widget.dateColumn, operator: 'date_between', value: iso, value2: iso },
      ],
    })
  }

  // A plain function that returns the markup, rather than a component
  // declared inside this render. A component declared here is a NEW
  // component type on every render, so React unmounts and remounts all
  // three hundred and sixty-five of these every time anything on the page
  // changes. The markup is identical either way.
  const cell = (day, key) =>
    day ? (
      <span
        key={key}
        onClick={() => drill(day)}
        title={`${day.day} ${MONTH_NAMES[day.month]} ${day.year} — ${
          day.empty ? 'nothing' : formatNumber(day.value, widget.format, widget.aggregation)
        }`}
        className={`rounded-[2px] transition-transform ${
          onCrossFilter && !day.empty ? 'cursor-pointer hover:scale-[1.35] hover:ring-1 hover:ring-slate-400' : ''
        }`}
        style={{
          width: size,
          height: size,
          backgroundColor: stepColor(stepFor(day.value, data.max, steps), steps, widget.scale),
        }}
      />
    ) : (
      <span key={key} style={{ width: size, height: size }} />
    )

  const legend = legendSwatches(steps, widget.scale)

  return (
    <Shell
      widget={widget}
      icon="📆"
      caption={`${widget.tab} · ${widget.dateColumn || '—'}`}
      tabError={tabError}
      footer={
        data.ready && widget.showLegend !== false ? (
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>
              {data.activeDays} active {data.activeDays === 1 ? 'day' : 'days'}
              {data.peak && !data.peak.empty && (
                <> · busiest {data.peak.day} {MONTH_NAMES[data.peak.month]} ({formatNumber(data.peak.value, widget.format, widget.aggregation)})</>
              )}
            </span>
            <span className="flex items-center gap-1">
              Less
              {legend.map((color, i) => (
                <span key={i} className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: color }} />
              ))}
              More
            </span>
          </div>
        ) : null
      }
    >
      {!data.ready ? (
        <p className="empty-state">Pick a date column in the editor</p>
      ) : data.cells.length === 0 ? (
        <p className="empty-state">No dates in range</p>
      ) : widget.layout === 'months' ? (
        <div className="flex flex-wrap gap-4">
          {data.blocks.map((block) => (
            <div key={`${block.year}_${block.month}`}>
              <p className="mb-1 text-[10px] font-medium text-slate-500">{block.label}</p>
              <div className="flex gap-[2px]">
                {block.weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[2px]">
                    {week.map((day, di) => cell(day, di))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="inline-block min-w-full">
            {/* Month labels sit above the week their month starts in, and
                are positioned by grid column rather than by guesswork --
                which is what keeps them over the right week when the card
                is resized. */}
            {widget.showMonthLabels !== false && (
              <div
                className="mb-1 grid text-[9px] text-slate-400"
                style={{
                  marginLeft: widget.showDayLabels !== false ? 26 : 0,
                  gridTemplateColumns: `repeat(${data.weeks.length}, ${size + 2}px)`,
                }}
              >
                {data.monthLabels.map((m) => (
                  <span key={`${m.year}_${m.month}`} style={{ gridColumnStart: m.index + 1 }} className="whitespace-nowrap">
                    {m.label}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-[2px]">
              {widget.showDayLabels !== false && (
                <div className="mr-1 flex flex-col gap-[2px] text-[8px] leading-none text-slate-400">
                  {days.map((d, i) => (
                    <span key={d} className="flex items-center" style={{ height: size }}>
                      {/* Every other day only. Seven labels at this size is
                          a grey block, not a legend. */}
                      {i % 2 === 0 ? d.slice(0, 3) : ''}
                    </span>
                  ))}
                </div>
              )}
              {data.weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[2px]">
                  {week.map((day, di) => cell(day, di))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Timeline / Gantt
// ---------------------------------------------------------------------
/**
 * One bar per row, on a shared time axis.
 *
 * Overlap becomes a shape. Four bars stacked in the same fortnight is a
 * capacity problem you can see without doing any arithmetic, and a bar
 * that starts in March and has not ended is the row somebody needs to
 * chase.
 */
export function GanttWidget({ widget, rows, unfilteredRows, tabError, dateOrder, fillHeight }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => ganttData(widget, { rows: source, dateOrder }), [widget, source, dateOrder])
  const [hovered, setHovered] = useState(null)

  const barHeight = Math.max(10, Math.min(48, Number(widget.barHeight) || 22))
  const grouped = widget.laneMode === 'lanes' && widget.groupBy

  const colorFor = (bar) =>
    widget.colorColumn
      ? seriesColor(bar.colorKey, bar.index, widget.seriesColors, widget.palette || 'default')
      : widget.color || '#4F46E5'

  // Same reason as the calendar's cells: a component declared inside this
  // render is remounted wholesale on every state change, and hovering a bar
  // IS a state change -- so every bar on the chart would remount on every
  // mouse move across it.
  const barRow = (bar) => (
    <div
      key={bar.index}
      className="group relative flex items-center"
      style={{ height: barHeight }}
      onMouseEnter={() => setHovered(bar.index)}
      onMouseLeave={() => setHovered(null)}
    >
      <div
        className={`absolute rounded-md transition-all ${
          bar.open ? 'opacity-80' : ''
        } ${hovered === bar.index ? 'ring-2 ring-slate-900/20' : ''}`}
        style={{
          left: `${bar.startFraction * 100}%`,
          width: `${bar.widthFraction * 100}%`,
          height: barHeight - 8,
          backgroundColor: colorFor(bar),
          // An open-ended bar fades out at its right edge rather than
          // ending in a hard cap, because it has not actually ended.
          backgroundImage: bar.open
            ? 'linear-gradient(90deg, rgba(255,255,255,0) 55%, rgba(255,255,255,0.75) 100%)'
            : undefined,
        }}
        title={`${bar.label} — ${bar.start.toLocaleDateString()} → ${
          bar.open ? 'still open' : bar.end.toLocaleDateString()
        } (${bar.days} ${bar.days === 1 ? 'day' : 'days'})`}
      >
        {/* The label rides INSIDE the bar when it fits and beside it when
            it does not, so a short bar is never a bar with no name. */}
        <span
          className={`pointer-events-none absolute inset-y-0 flex items-center whitespace-nowrap text-[10px] font-medium ${
            bar.widthFraction > 0.18 ? 'left-1.5 text-white/95 label-on-fill' : 'left-[calc(100%+6px)] text-slate-500'
          }`}
        >
          {bar.label}
          {bar.reversed && <span className="ml-1 text-rose-200">⚠ ends before it starts</span>}
        </span>
      </div>
    </div>
  )

  return (
    <Shell
      widget={widget}
      icon="📊"
      caption={`${widget.tab} · ${widget.startColumn || '—'} → ${
        widget.endMode === 'duration' ? widget.durationColumn || '—' : widget.endMode === 'fixed' ? `${widget.fixedDays}d` : widget.endColumn || 'open'
      }`}
      tabError={tabError}
      footer={
        data.ready && data.bars.length > 0 ? (
          <p className="mt-2 text-[10px] text-slate-400">
            {data.bars.length} of {data.total} rows
            {data.hidden > 0 && ` · ${data.hidden} beyond the limit`}
            {data.openCount > 0 && ` · ${data.openCount} still open`}
            {data.skipped > 0 && ` · ${data.skipped} with no start date`}
            {data.reversedCount > 0 && ` · ${data.reversedCount} finish before they start`}
          </p>
        ) : null
      }
    >
      {!data.ready ? (
        <p className="empty-state">Pick a start-date column in the editor</p>
      ) : data.bars.length === 0 ? (
        <p className="empty-state">No rows have a usable start date</p>
      ) : (
        <div className={fillHeight ? 'flex h-full flex-col' : ''}>
          {/* The axis, above the bars where it is read. */}
          <div className="relative mb-1 h-4 border-b border-slate-200">
            {data.ticks.map((tick, i) => (
              <span
                key={i}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] text-slate-400"
                style={{ left: `${tick.fraction * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>

          {/* The rules live OUTSIDE the scroller, in an overlay that spans
              the visible area. Absolutely positioned inside it they would be
              as tall as one screenful and would scroll away with the bars --
              leaving the today marker on the first ten rows and nowhere
              else. */}
          <div className={`relative ${fillHeight ? 'min-h-0 flex-1' : ''}`}>
            {widget.showGrid !== false && (
              <div className="pointer-events-none absolute inset-0 z-0">
                {data.ticks.map((tick, i) => (
                  <span
                    key={i}
                    className="absolute inset-y-0 w-px bg-slate-100"
                    style={{ left: `${tick.fraction * 100}%` }}
                  />
                ))}
              </div>
            )}
            {widget.showToday !== false && data.today !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-px bg-rose-400"
                style={{ left: `${data.today * 100}%` }}
                title="Today"
              />
            )}

            <div className={`relative z-10 ${fillHeight ? 'h-full overflow-y-auto' : 'max-h-[420px] overflow-y-auto'}`}>
            {grouped ? (
              data.lanes.map((lane) => (
                <div key={lane.name} className="mb-1">
                  <p className="sticky top-0 z-10 bg-white/85 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur">
                    {lane.name || '(no group)'} · {lane.bars.length}
                  </p>
                  {lane.bars.map(barRow)}
                </div>
              ))
            ) : (
              data.bars.map(barRow)
            )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------
// Cohort / retention
// ---------------------------------------------------------------------
/**
 * Groups pinned to when they arrived, tracked across what happened after.
 *
 * The empty bottom-right is deliberate and is the honest part of the
 * chart: a cohort that started last month has not HAD six months to come
 * back, and filling those cells with a zero would invent a collapse that
 * has not happened.
 */
export function CohortWidget({ widget, rows, unfilteredRows, tabError, dateOrder, onCrossFilter }) {
  const source = sourceRows(widget, rows, unfilteredRows)
  const data = useMemo(() => cohortData(widget, { rows: source, dateOrder }), [widget, source, dateOrder])

  const metric = widget.metric || 'retention'
  const firstPeriod = widget.hideFirstPeriod ? 1 : 0

  const label = (cell) => {
    if (cell.future) return ''
    if (metric === 'retention') return `${Math.round(cell.value)}%`
    if (metric === 'active') return String(cell.active)
    return formatNumber(cell.value, widget.format, widget.aggregation)
  }

  return (
    <Shell
      widget={widget}
      icon="🪜"
      caption={`${widget.tab} · ${widget.entityColumn || '—'} by ${widget.dateColumn || '—'}, ${data.grain || widget.grain}`}
      tabError={tabError}
      footer={
        data.ready && data.cohorts.length > 0 ? (
          <p className="mt-2 text-[10px] text-slate-400">
            {data.entityCount} distinct {widget.entityColumn || 'entities'} · {Math.round(data.repeatRate)}% came back at
            least once
            {data.hidden > 0 && ` · ${data.hidden} older cohorts not shown`}
          </p>
        ) : null
      }
    >
      {!data.ready ? (
        <p className="empty-state">{data.reason || 'Pick who repeats, and when'}</p>
      ) : data.cohorts.length === 0 ? (
        <p className="empty-state">Nothing to group into cohorts</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="min-w-full border-separate border-spacing-[2px] text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white/90 px-1.5 py-1 text-left font-semibold text-slate-500">
                  Cohort
                </th>
                {widget.showSize !== false && (
                  <th className="px-1.5 py-1 text-right font-semibold text-slate-400">Size</th>
                )}
                {data.periods.slice(firstPeriod).map((p) => (
                  <th key={p} className="px-1.5 py-1 text-center font-semibold text-slate-500">
                    {p === 0 ? 'Start' : `+${p}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((cohort) => (
                <tr key={cohort.key}>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white/90 px-1.5 py-1 font-medium text-slate-700">
                    {cohort.label}
                  </td>
                  {widget.showSize !== false && (
                    <td className="px-1.5 py-1 text-right tabular-nums text-slate-500">{cohort.size}</td>
                  )}
                  {cohort.cells.slice(firstPeriod).map((cell) => {
                    // Period 0 is 100% for every cohort by construction, so
                    // it is drawn as a flat neutral rather than as the
                    // darkest cell in its row -- otherwise the only thing
                    // the eye sees is a black first column.
                    const bg = cell.future
                      ? 'transparent'
                      : cell.period === 0
                        ? '#E2E8F0'
                        : valueColor(cell.value, data.max, widget.scale)
                    return (
                      <td
                        key={cell.period}
                        onClick={
                          onCrossFilter && !cell.future && cell.rows.length
                            ? () =>
                                onCrossFilter({
                                  id: `cohort_${widget.id}`,
                                  label: `${cohort.label}, +${cell.period}`,
                                  match: 'all',
                                  conditions: [
                                    {
                                      tab: widget.tab,
                                      column: widget.entityColumn,
                                      operator: 'one_of',
                                      value: [...new Set(cell.rows.map((r) => r[widget.entityColumn]))].join(','),
                                    },
                                  ],
                                })
                            : undefined
                        }
                        title={
                          cell.future
                            ? 'This period has not happened yet for this cohort'
                            : `${cohort.label}, +${cell.period}: ${cell.active} of ${cell.size} (${Math.round(
                                cell.retention
                              )}%)`
                        }
                        className={`rounded px-1.5 py-1 text-center tabular-nums transition-transform ${
                          cell.future ? 'text-slate-200' : ''
                        } ${onCrossFilter && !cell.future && cell.rows.length ? 'cursor-pointer hover:scale-105' : ''}`}
                        style={{
                          backgroundColor: bg,
                          color: cell.future ? undefined : inkOn(bg),
                          // A dashed outline says "not yet", where an empty
                          // cell would just look like a gap in the data.
                          border: cell.future ? '1px dashed rgb(226 232 240)' : undefined,
                        }}
                      >
                        {cell.future ? '·' : label(cell)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}
