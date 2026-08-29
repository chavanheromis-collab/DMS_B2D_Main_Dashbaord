import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Filter } from 'lucide-react'
import { aggregate, bucketConditions, formatNumber, pivot } from '../lib/dataUtils'
import { matchesConditions } from '../lib/filterEngine'
import { followsStage, kpiTab } from '../lib/pipelineNav'

const MARGIN = 10 // keep the popup this far from the viewport edge
const MEDALS = ['🥇', '🥈', '🥉']
/**
 * Where to put the popup, given the stage button's own bounding box.
 * Prefers opening below the button; flips above it if there isn't enough
 * room underneath. Horizontally centred on the button but clamped so it
 * never runs off either edge of the screen.
 */
export function computePosition(anchor, popupWidth, popupHeight) {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = anchor.left + anchor.width / 2 - popupWidth / 2
  left = Math.max(MARGIN, Math.min(left, vw - popupWidth - MARGIN))

  const spaceBelow = vh - anchor.bottom
  const openAbove = spaceBelow < popupHeight + MARGIN && anchor.top > popupHeight + MARGIN
  const top = openAbove ? anchor.top - popupHeight - 10 : anchor.bottom + 10

  return { left, top: Math.max(MARGIN, top), openAbove }
}

/**
 * The pop-up that opens when you click a pipeline stage.
 *
 * Rendered through a portal straight onto <body>, at `position: fixed`, so
 * it sits on its own top-level layer above every other widget on the
 * dashboard — including ones that render later in the grid. (Each widget
 * card has its own entrance animation, and a CSS transform animation
 * creates a new stacking context; without the portal, a chart appearing
 * after the pipeline in the DOM would paint over the popup no matter how
 * high its z-index went, because that z-index only wins inside the
 * pipeline's own card. Escaping to <body> sidesteps that entirely.)
 *
 * It's a small, capped-height card rather than a full drawer on purpose:
 * the pipeline usually sits above other widgets, and this way clicking a
 * stage never reflows the layout underneath it.
 */
export default function StageKpiPopup({
  open,
  stage,
  anchorRect,
  rows,
  // Every tab's rows, for the KPIs that read their own instead of the
  // stage's. Absent, every KPI falls back to the stage -- which is what
  // every KPI written before this existed did anyway.
  rowsFor,
  dateOrder,
  onClose,
  onDrill,
  isDrilled,
  onDrillKpi,
  drilledKpiId,
  onDrillValue,
  drilledValueKey,
}) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  // Measure the popup itself once it has real content, then place it. Runs
  // before paint so there's no visible jump from a wrong initial position.
  useLayoutEffect(() => {
    if (!open || !anchorRect || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos(computePosition(anchorRect, rect.width, rect.height))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchorRect, stage?.id])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    // Scrolling the page would leave a fixed-position popup floating away
    // from the stage it belongs to, so close it rather than let it drift.
    function onScroll(e) {
      if (ref.current && e.target && ref.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, onClose])

  // The stage's own rows. Everything in here -- the KPIs, the pivot, the
  // leaderboard -- describes the stage you clicked, which is what makes the
  // numbers agree with the card above and with whatever you then drill the
  // dashboard by. Each KPI narrows further with its own conditions.
  const baseRows = useMemo(() => {
    return rows || []
  }, [rows])

  /**
   * The condition behind clicking one label.
   *
   * `(blank)` is a real group -- the pivot puts every empty cell in it -- so
   * it drills as "this column is empty" rather than as the literal text,
   * which would match nothing and look like a broken click.
   */
  const valueCondition = (column, label) => {
    if (String(label) === '(blank)') return { column, operator: 'is_empty', value: '' }
    // A bucketed axis needs the conditions that DEFINE the bucket. "May
    // 2024" is not a value in the date column, so an equals on the label
    // would filter to nothing at all.
    const spec = stage?.pivot?.buckets?.[column]
    const fromBucket = spec?.bucket ? bucketConditions(column, label, spec, dateOrder) : null
    return fromBucket && fromBucket.length === 1
      ? fromBucket[0]
      : { column, operator: 'equals', value: String(label) }
  }

  /** The same, for a label that may need more than one condition. */
  const valueConditions = (column, label) => {
    if (String(label) === '(blank)') return [{ column, operator: 'is_empty', value: '' }]
    const spec = stage?.pivot?.buckets?.[column]
    const fromBucket = spec?.bucket ? bucketConditions(column, label, spec, dateOrder) : null
    return fromBucket || [{ column, operator: 'equals', value: String(label) }]
  }

  const drillValue = (key, label, conditions) =>
    onDrillValue && onDrillValue(stage, { key, label, conditions })

  // Every drillable cell looks the same and says the same thing.
  const cellProps = (key, label, conditions) =>
    onDrillValue
      ? {
          onClick: () => drillValue(key, label, conditions),
          title: `Filter the dashboard to ${label}`,
          className: 'cursor-pointer hover:bg-indigo-50/70',
          'aria-pressed': drilledValueKey === key,
        }
      : {}

  const drilledCell = (key) =>
    drilledValueKey === key ? { boxShadow: 'inset 0 0 0 2px rgb(99 102 241)' } : undefined

  const kpis = useMemo(() => {
    if (!stage) return []
    return (stage.kpis || []).map((kpi) => {
      // The stage's rows, or its own -- see KPI_SCOPES in lib/pipelineNav.js
      // for why a number in here might not be about the stage at all.
      const own = !followsStage(kpi) && rowsFor
      const from = own ? rowsFor(kpiTab(kpi, stage)) || [] : baseRows
      const scoped = kpi.conditions?.length
        ? from.filter((row) => matchesConditions(row, kpi.conditions, kpi.match || 'all', dateOrder))
        : from
      return {
        ...kpi,
        independent: Boolean(own),
        value: aggregate(scoped, kpi.column, kpi.aggregation),
        matched: scoped.length,
        of: from.length,
      }
    })
  }, [stage, baseRows, rowsFor, dateOrder])

  const pivotData = useMemo(() => {
    if (!stage?.pivot?.rowColumn || !stage?.pivot?.colColumn) return null
    return pivot(baseRows, {
      rowColumn: stage.pivot.rowColumn,
      colColumn: stage.pivot.colColumn,
      valueColumn: stage.pivot.column,
      aggregation: stage.pivot.aggregation || 'count',
      buckets: stage.pivot.buckets,
      dateOrder,
    })
  }, [stage, baseRows, dateOrder])

  const leaderboardData = useMemo(() => {
    if (!stage?.leaderboard?.groupBy) return null
    const groupBy = stage.leaderboard.groupBy
    const metrics = stage.leaderboard.metrics || []
    if (!metrics.length) return null
    const buckets = new Map()

    for (const row of baseRows) {
      const name = String(row[groupBy] ?? '').trim() || '(blank)'
      if (!buckets.has(name)) buckets.set(name, [])
      buckets.get(name).push(row)
    }

    const out = Array.from(buckets.entries()).map(([name, groupRows]) => ({
      name,
      values: metrics.map((metric) => aggregate(groupRows, metric.column, metric.aggregation)),
    }))

    const sortIdx = Math.max(0, metrics.findIndex((metric) => metric.id === stage.leaderboard.sortBy))
    out.sort((a, b) => (b.values[sortIdx] || 0) - (a.values[sortIdx] || 0))
    return out.slice(0, stage.leaderboard.limit || 10)
  }, [stage, baseRows])

  const pivotDisplay = stage?.pivot?.display || 'matrix'

  if (!open || !stage) return null

  const style = pos
    ? { position: 'fixed', top: pos.top, left: pos.left, visibility: 'visible' }
    : { position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' } // measure off-screen first frame

  return createPortal(
    <>
      {/* A transparent scrim, not a dimmed one — the point is still to see
          the dashboard underneath, just to make outside-click-to-close
          obvious and to block accidental clicks on covered widgets. */}
      <div className="fixed inset-0 z-[999]" onClick={onClose} />
      <div
        ref={ref}
        style={style}
        className={`pop-in z-[1000] w-[calc(100vw-20px)] max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${pos?.openAbove ? 'pop-in-up' : ''
          }`}
      >
        {/* Header takes the stage's own colour so it's obvious which card you clicked */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ background: `linear-gradient(90deg, ${stage.color}1F 0%, ${stage.color}08 100%)` }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-lg leading-none">{stage.icon}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{stage.label}</p>
              <p className="text-[11px] text-slate-500">
                {baseRows.length.toLocaleString('en-IN')} rows · {stage.tab}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => onDrill(stage)}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all ${isDrilled ? 'text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              style={isDrilled ? { backgroundColor: stage.color } : undefined}
            >
              <Filter size={11} />
              {isDrilled ? 'Filtering by this' : 'Filter dashboard'}
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-600">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Capped height + internal scroll keeps the popup itself compact
            even when an admin adds many KPIs to one stage. */}
        <div className="max-h-[min(60vh,420px)] overflow-y-auto p-3 space-y-3">
          {!kpis.length && !pivotData && !leaderboardData ? (
            <p className="py-6 text-center text-xs text-slate-400">
              No KPIs, pivot table, or leaderboard configured for this stage yet — add them in the admin panel under this stage.
            </p>
          ) : (
            <>
              {kpis.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {kpis.map((kpi) => {
                    // A stage KPI can drill the dashboard the same way the
                    // stage itself can -- but only when it has conditions of
                    // its own to narrow BY. A KPI that just counts the stage's
                    // rows would produce a filter identical to clicking the
                    // stage, so it stays inert rather than offering a second
                    // control that does the same thing. The same holds for an
                    // independent one: with no conditions it is a whole tab,
                    // and filtering the page to a whole tab filters nothing.
                    const canDrill = !!onDrillKpi && kpi.conditions?.length > 0
                    const drilled = drilledKpiId === kpi.id
                    return (
                      <button
                        key={kpi.id}
                        type="button"
                        onClick={() => canDrill && onDrillKpi(stage, kpi)}
                        disabled={!canDrill}
                        className={`relative overflow-hidden rounded-xl p-2.5 text-left transition-transform ${
                          canDrill ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'
                        } ${drilled ? 'ring-2 ring-offset-1' : ''}`}
                        style={{
                          backgroundColor: `${kpi.color}12`,
                          border: `1px solid ${kpi.color}30`,
                          ...(drilled ? { '--tw-ring-color': kpi.color } : null),
                        }}
                        title={
                          canDrill
                            ? `Click to filter the dashboard by “${kpi.label}”`
                            : `${kpi.column || 'rows'} · ${kpi.aggregation}`
                        }
                      >
                        <span className="absolute left-0 top-0 h-full w-[3px]" style={{ backgroundColor: kpi.color }} />
                        <div className="flex items-start justify-between gap-1">
                          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {kpi.label}
                          </p>
                          <span className="flex items-center gap-1">
                            {canDrill && <Filter size={10} className={drilled ? 'opacity-80' : 'opacity-40'} style={{ color: kpi.color }} />}
                            {kpi.icon && <span className="text-sm leading-none">{kpi.icon}</span>}
                          </span>
                        </div>
                        <p className="mt-1 text-lg font-bold leading-tight tabular-nums" style={{ color: kpi.color }}>
                          {formatNumber(kpi.value, kpi.format, kpi.aggregation)}
                        </p>
                        {/* An independent KPI always says what it is
                            out of, conditions or not: its number is not
                            about the stage, and a bare figure in a stage's
                            pop-up reads as though it were. */}
                        {(kpi.conditions?.length > 0 || kpi.independent) && (
                          <p className="mt-0.5 truncate text-[9px] text-slate-400">
                            {kpi.matched.toLocaleString('en-IN')} of {kpi.of.toLocaleString('en-IN')}
                            {kpi.independent ? ' · own rows' : ' rows'}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {pivotData && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Pivot table</p>
                      <p className="text-[11px] text-slate-500">
                        {stage.pivot.rowColumn} × {stage.pivot.colColumn} · {pivotDisplay === 'totals' ? 'Totals only' : 'Full matrix'}
                      </p>
                    </div>
                  </div>

                  {pivotData.rowLabels.length === 0 ? (
                    <p className="text-xs text-slate-400">No pivot table rows available for this stage.</p>
                  ) : pivotDisplay === 'totals' ? (
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
                        <div className="grid grid-cols-[1.6fr_1fr] gap-2 border-b border-slate-100 px-2 py-2 text-xs font-semibold text-slate-500">
                          <div>Row</div>
                          <div className="text-right">Total</div>
                        </div>
                        {pivotData.rowLabels.map((rowLabel, ri) => {
                          const key = `row:${rowLabel}`
                          const props = cellProps(key, rowLabel, valueConditions(stage.pivot.rowColumn, rowLabel))
                          return (
                            <div
                              key={rowLabel}
                              {...props}
                              className={`grid grid-cols-[1.6fr_1fr] gap-2 border-t border-slate-100 px-2 py-2 text-right text-xs text-slate-700 ${props.className || ''}`}
                              style={drilledCell(key)}
                            >
                              <div className="text-left font-medium" title={rowLabel}>{rowLabel}</div>
                              <div className="tabular-nums">{formatNumber(pivotData.rowTotals[ri], stage.pivot.format, stage.pivot.aggregation)}</div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
                        <div className="grid grid-cols-[1.6fr_1fr] gap-2 border-b border-slate-100 px-2 py-2 text-xs font-semibold text-slate-500">
                          <div>Column totals</div>
                          <div className="text-right">Value</div>
                        </div>
                        {pivotData.colLabels.map((colLabel, ci) => {
                          const key = `col:${colLabel}`
                          const props = cellProps(key, colLabel, valueConditions(stage.pivot.colColumn, colLabel))
                          return (
                            <div
                              key={colLabel}
                              {...props}
                              className={`grid grid-cols-[1.6fr_1fr] gap-2 border-t border-slate-100 px-2 py-2 text-right text-xs text-slate-700 ${props.className || ''}`}
                              style={drilledCell(key)}
                            >
                              <div className="text-left font-medium truncate" title={colLabel}>{colLabel}</div>
                              <div className="tabular-nums">{formatNumber(pivotData.colTotals[ci], stage.pivot.format, stage.pivot.aggregation)}</div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-right text-xs font-semibold text-slate-700">
                        Grand total: {formatNumber(pivotData.grandTotal, stage.pivot.format, stage.pivot.aggregation)}
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-auto rounded-xl border border-slate-100 bg-white">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-left font-semibold">{stage.pivot.rowColumn}</th>
                            {pivotData.colLabels.map((colLabel) => (
                              <th key={colLabel} className="whitespace-nowrap px-2 py-2 text-right font-semibold" title={colLabel}>
                                {colLabel}
                              </th>
                            ))}
                            <th className="px-2 py-2 text-right font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pivotData.rowLabels.map((rowLabel, ri) => (
                            <tr key={rowLabel} className="border-t border-slate-100">
                              <td className="sticky left-0 z-10 bg-white px-2 py-1.5 font-medium text-slate-700" title={rowLabel}>
                                {rowLabel}
                              </td>
                              {pivotData.colLabels.map((colLabel, ci) => {
                                const value = pivotData.matrix[ri][ci]
                                // An empty cell has no rows behind it, so it
                                // stays inert rather than offering a click
                                // that would empty the dashboard.
                                const key = `cell:${rowLabel}|${colLabel}`
                                const props = value > 0
                                  ? cellProps(key, `${rowLabel} \u00d7 ${colLabel}`, [
                                      ...valueConditions(stage.pivot.rowColumn, rowLabel),
                                      ...valueConditions(stage.pivot.colColumn, colLabel),
                                    ])
                                  : {}
                                return (
                                  <td
                                    key={colLabel}
                                    {...props}
                                    className={`px-2 py-1.5 text-right tabular-nums text-slate-700 ${props.className || ''}`}
                                    style={drilledCell(key)}
                                  >
                                    {value > 0 ? formatNumber(value, stage.pivot.format, stage.pivot.aggregation) : <span className="text-slate-300">·</span>}
                                  </td>
                                )
                              })}
                              {(() => {
                                const key = `row:${rowLabel}`
                                const props = cellProps(key, rowLabel, valueConditions(stage.pivot.rowColumn, rowLabel))
                                return (
                                  <td
                                    {...props}
                                    className={`bg-slate-50 px-2 py-1.5 text-right font-semibold tabular-nums text-slate-700 ${props.className || ''}`}
                                    style={drilledCell(key)}
                                  >
                                    {formatNumber(pivotData.rowTotals[ri], stage.pivot.format, stage.pivot.aggregation)}
                                  </td>
                                )
                              })()}
                            </tr>
                          ))}
                          <tr className="border-t border-slate-200 bg-slate-50">
                            <td className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 font-semibold text-slate-600">Total</td>
                            {pivotData.colTotals.map((colTotal, ci) => (
                              <td key={ci} className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-700">
                                {formatNumber(colTotal, stage.pivot.format, stage.pivot.aggregation)}
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-800">
                              {formatNumber(pivotData.grandTotal, stage.pivot.format, stage.pivot.aggregation)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {leaderboardData && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Leaderboard</p>
                      <p className="text-[11px] text-slate-500">
                        {stage.leaderboard.groupBy}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-auto rounded-xl border border-slate-100 bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold">Rank</th>
                          <th className="px-2 py-2 text-left font-semibold">{stage.leaderboard.groupBy}</th>
                          {stage.leaderboard.metrics?.map((metric) => (
                            <th key={metric.id} className="px-2 py-2 text-right font-semibold">
                              {metric.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboardData.map((row, i) => {
                          const key = `lb:${row.name}`
                          const props = cellProps(key, row.name, [valueCondition(stage.leaderboard.groupBy, row.name)])
                          return (
                          <tr
                            key={row.name}
                            {...props}
                            className={`border-t border-slate-100 ${props.className || ''}`}
                            style={drilledCell(key)}
                          >
                            <td className="px-2 py-1.5 text-sm">{MEDALS[i] || <span className="text-slate-400">#{i + 1}</span>}</td>
                            <td className="px-2 py-1.5 font-medium text-slate-700" title={row.name}>
                              {row.name}
                            </td>
                            {row.values.map((value, vi) => (
                              <td key={vi} className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                                {formatNumber(value, stage.leaderboard.metrics?.[vi]?.format, stage.leaderboard.metrics?.[vi]?.aggregation)}
                              </td>
                            ))}
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
