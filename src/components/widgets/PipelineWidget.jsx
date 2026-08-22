import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { dailyCounts } from '../../lib/dataUtils.js'
import { getStagePopupRows, getStageRows } from '../../lib/pipelineStageData.js'
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
      conditions: stage.conditions,
      match: stage.match || 'all',
      icon: stage.icon,
      label: `${stage.label}`,
    })
  }

  /**
   * Drilling by a stage KPI narrows the dashboard to the stage AND the KPI's
   * own conditions -- "Delivered vehicles that were financed", not just
   * "financed". Combining them is what makes the number on the card and the
   * rows the dashboard then shows agree; filtering by the KPI's conditions
   * alone would show rows from outside the stage entirely.
   */
  function drillKpi(stage, kpi) {
    onCrossFilter({
      id: `stagekpi_${widget.id}_${stage.id}_${kpi.id}`,
      kind: 'conditions',
      tab: stage.tab,
      match: 'all',
      conditions: [
        ...(stage.conditions || []).filter((c) => c.column),
        // A stage KPI's conditions are written against the stage's own tab,
        // which the builder pins for them, but they don't carry it.
        ...(kpi.conditions || []).filter((c) => c.column).map((c) => ({ ...c, tab: c.tab || stage.tab })),
      ],
      icon: kpi.icon || stage.icon,
      label: `${stage.label} · ${kpi.label}`,
    })
  }

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
  const openStageRows = openStage ? getStagePopupRows({ stage: openStage, widget, rowsByTab, rawRowsByTab }) : []

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-slate-800">🔀 {widget.title}</h2>
        <p className="text-[11px] text-slate-400">
          {stages.map((s) => s.label).join(' → ')}
          {widget.ignoreFilters && ' · unfiltered'}
        </p>
      </div>

      {stages.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-300">No stages configured yet</p>
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
                    <span className="text-base leading-none">{stage.icon || '•'}</span>
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
      />
    </div>
  )
}
