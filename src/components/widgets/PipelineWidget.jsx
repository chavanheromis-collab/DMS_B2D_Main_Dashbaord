import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { dailyCounts } from '../../lib/dataUtils.js'
import { getStagePopupRows, getStageRows, stageConditions } from '../../lib/pipelineStageData.js'
import Sparkline from './Sparkline.jsx'
import StageKpiPopup from '../StageKpiPopup.jsx'

/**
 * A funnel of stages. Each stage is just a label + colour + a set of
 * conditions, defined by the admin exactly like a button is -- so the
 * pipeline is no longer hardcoded to any particular sales process. Point
 * the stages at whatever columns your sheet actually uses.
 *
 * Clicking a stage cross-filters the whole dashboard to the rows in it.
 */
export default function PipelineWidget({ widget, rowsByTab, rawRowsByTab, crossFilters, onCrossFilter, dateOrder }) {
  const stages = widget.stages || []

  const computed = useMemo(() => {
    return stages.map((stage) => {
      const { tabRows, matchedRows, count, total } = getStageRows({
        stage,
        widget,
        rowsByTab,
        rawRowsByTab,
        dateOrder,
      })
      return {
        stage,
        rows: matchedRows,
        count,
        total,
        trend: widget.showSparkline && stage.dateColumn ? dailyCounts(matchedRows, stage.dateColumn, 30, dateOrder) : [],
      }
    })
  }, [stages, rowsByTab, rawRowsByTab, widget, dateOrder])

  // Percentages read against either the first stage (classic funnel
  // conversion) or that stage's own tab total.
  const base = widget.percentBase === 'total' ? null : computed[0]?.count || 0

  const [openStageId, setOpenStageId] = useState(null)

  function isActive(stage) {
    return crossFilters.some((cf) => cf.id === `stage_${widget.id}_${stage.id}`)
  }

  function drill(stage) {
    onCrossFilter({
      id: `stage_${widget.id}_${stage.id}`,
      kind: 'conditions',
      tab: stage.tab,
      // Through the same helper the COUNT uses. A condition that never
      // named its tab would otherwise be dropped by the engine, leaving a
      // stage that reads 40 and filters nothing when you click it.
      conditions: stageConditions(stage),
      match: stage.match || 'all',
      icon: stage.icon,
      label: `${stage.label}`,
    })
  }

  /**
   * A drill meaning "inside this stage, AND this as well" -- a stage KPI, a
   * leaderboard row, a pivot cell.
   *
   * The stage part is what makes the number you clicked and the rows the
   * dashboard then shows agree: filtering by "financed" alone would pull in
   * rows from outside the stage entirely, and clicking Ravi in the Delivered
   * leaderboard would show everything Ravi has ever touched.
   *
   * How the two sets combine depends on the stage's own match. With ALL they
   * simply concatenate. With ANY they cannot -- "(booked or delivered) and
   * financed" is not expressible in one flat condition set -- so the stage
   * travels as a cross-filter of its own and the narrower one stacks on top,
   * which is exactly what the chips then show. Both carry the same `value`,
   * so they appear, move and clear together.
   */
  function narrowWithinStage(stage, { id, value, conditions, icon, label }) {
    const within = stageConditions(stage)
    const splitOut = (stage.match || 'all') === 'any' && within.length > 1

    if (splitOut) {
      onCrossFilter({
        id: `stagewithin_${widget.id}_${stage.id}`,
        value,
        kind: 'conditions',
        tab: stage.tab,
        match: 'any',
        conditions: within,
        icon: stage.icon,
        label: stage.label,
      })
    }

    onCrossFilter({
      id,
      value,
      kind: 'conditions',
      tab: stage.tab,
      match: 'all',
      conditions: [...(splitOut ? [] : within), ...conditions],
      icon,
      label,
    })
  }

  function drillKpi(stage, kpi) {
    narrowWithinStage(stage, {
      id: `stagekpi_${widget.id}_${stage.id}_${kpi.id}`,
      // A stage KPI's conditions are written against the stage's own tab,
      // which the builder pins for them, but they don't carry it.
      conditions: (kpi.conditions || []).filter((c) => c.column).map((c) => ({ ...c, tab: c.tab || stage.tab })),
      icon: kpi.icon || stage.icon,
      label: `${stage.label} · ${kpi.label}`,
    })
  }

  /**
   * Drilling on something INSIDE the pop-up -- a leaderboard row, a pivot
   * cell, a pivot total.
   *
   * The pop-up hands over a `key` describing what was clicked rather than an
   * id, so clicking the same cell again toggles it off and clicking a
   * different one in the same stage replaces it instead of stacking two
   * contradictory filters on the page.
   */
  function drillValue(stage, { key, label, icon, conditions }) {
    narrowWithinStage(stage, {
      id: `stageval_${widget.id}_${stage.id}`,
      value: key,
      conditions: conditions.filter((c) => c.column).map((c) => ({ ...c, tab: stage.tab })),
      icon: icon || stage.icon,
      label: `${stage.label} · ${label}`,
    })
  }

  const drilledValueKey = crossFilters.find(
    (cf) => cf.id === `stageval_${widget.id}_${openStageId}`
  )?.value

  const drilledKpiId = openStageId
    ? (stages.find((s) => s.id === openStageId)?.kpis || []).find((k) =>
        crossFilters.some((cf) => cf.id === `stagekpi_${widget.id}_${openStageId}_${k.id}`)
      )?.id
    : undefined

  const [anchorRect, setAnchorRect] = useState(null)

  // Clicking a stage opens its KPI/pivot pop-up, anchored to the exact
  // button that was clicked (the popup is portalled to <body>, so it needs
  // the button's page position handed to it explicitly rather than relying
  // on CSS to place it relative to this card). If an admin hasn't given the
  // stage any KPIs or pivot configuration there's nothing to show, so the
  // click falls through to the old behaviour and drills straight in.
  function handleClick(stage, event) {
    const hasKpis = (stage.kpis || []).length > 0
    const hasPivot = Boolean(stage.pivot?.rowColumn && stage.pivot?.colColumn)
    const hasLeaderboard = Boolean(stage.leaderboard?.groupBy)
    if (!hasKpis && !hasPivot && !hasLeaderboard) {
      drill(stage)
      return
    }
    if (openStageId === stage.id) {
      setOpenStageId(null)
      return
    }
    setAnchorRect(event.currentTarget.getBoundingClientRect())
    setOpenStageId(stage.id)
  }

  const openStage = stages.find((s) => s.id === openStageId) || null
  const openStageRows = openStage
    ? getStagePopupRows({ stage: openStage, widget, rowsByTab, rawRowsByTab, dateOrder })
    : []

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="widget-title">🔀 {widget.title}</h2>
        <p className="text-[11px] text-slate-400">
          {stages.map((s) => s.label).join(' → ')}
          {widget.ignoreFilters && ' · unfiltered'}
        </p>
      </div>

      {stages.length === 0 ? (
        <p className="empty-state">No stages configured yet</p>
      ) : (
        <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
          {computed.map(({ stage, count, total, trend }, i) => {
            const denom = base === null ? total : base
            const pct = denom > 0 ? Math.round((count / denom) * 100) : 0
            const active = isActive(stage)
            const color = stage.color || '#4F46E5'

            return (
              <div key={stage.id} className="flex items-center">
                <button
                  onClick={(e) => handleClick(stage, e)}
                  title={
                    (stage.kpis || []).length > 0
                      ? `Click to see KPIs for ${stage.label}`
                      : `Click to filter the dashboard to ${stage.label}`
                  }
                  className={`group relative min-w-[132px] overflow-hidden rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${active ? 'border-transparent ring-2 ring-offset-1' : 'border-slate-200/70'
                    }`}
                  style={{
                    backgroundColor: `${color}12`,
                    ...(active ? { '--tw-ring-color': color } : {}),
                  }}
                >
                  <span className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: color }} />

                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      {/* The step number: a funnel is an ordered thing, and
                          numbering it is what lets someone say "we lose them
                          at three" instead of pointing at the screen. */}
                      <span
                        className="text-[13px] font-black leading-none tabular-nums opacity-30"
                        style={{ color }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-base leading-none">{stage.icon || '•'}</span>
                    </span>
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ backgroundColor: `${color}22`, color }}
                    >
                      {pct}%
                    </span>
                  </div>

                  <p className="mt-2 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {stage.label}
                  </p>
                  <p className="text-2xl font-bold leading-tight text-slate-800">{count.toLocaleString('en-IN')}</p>

                  <div className="mt-1 h-6">
                    {widget.showSparkline && (
                      trend.length ? (
                        <Sparkline values={trend} color={color} width={104} height={22} />
                      ) : (
                        <span className="text-[9px] text-slate-300">no trend column set</span>
                      )
                    )}
                  </div>
                </button>

                {i < computed.length - 1 && <ChevronRight size={14} className="mx-0.5 shrink-0 text-slate-300" />}
              </div>
            )
          })}
        </div>
      )}

      <StageKpiPopup
        open={!!openStage}
        stage={openStage}
        anchorRect={anchorRect}
        rows={openStageRows}
        dateOrder={dateOrder}
        onClose={() => setOpenStageId(null)}
        onDrill={drill}
        isDrilled={openStage ? isActive(openStage) : false}
        onDrillKpi={drillKpi}
        drilledKpiId={drilledKpiId}
        onDrillValue={drillValue}
        drilledValueKey={drilledValueKey}
      />
    </div>
  )
}
