import { useMemo, useState } from 'react'
import { ChevronRight, CornerDownRight, Filter, Layers } from 'lucide-react'
import { dailyCounts } from '../../lib/dataUtils.js'
import { chainDrill, getStagePopupRows, getStageRows, stageConditions } from '../../lib/pipelineStageData.js'
import {
  ascend,
  descend,
  hasSubStages,
  livePath,
  stageBox,
  stageNumberClass,
  stagePath,
  stagesAt,
  subStages,
} from '../../lib/pipelineNav.js'
import Sparkline from './Sparkline.jsx'
import StageKpiPopup from '../StageKpiPopup.jsx'

/**
 * A funnel of stages. Each stage is just a label + colour + a set of
 * conditions, defined by the admin exactly like a button is -- so the
 * pipeline is no longer hardcoded to any particular sales process. Point
 * the stages at whatever columns your sheet actually uses.
 *
 * Clicking a stage cross-filters the whole dashboard to the rows in it --
 * unless the stage owns stages of its own, in which case it opens them and
 * the level it came from becomes a breadcrumb. See lib/pipelineNav.js.
 */
export default function PipelineWidget({ widget, rowsByTab, rawRowsByTab, crossFilters, onCrossFilter, dateOrder }) {
  const stages = widget.stages || []

  // Which sub-pipeline is open, as the ids of the stages leading to it. Ids
  // rather than indexes: an admin reordering the stages while somebody has
  // one open should not swap what they are looking at.
  const [openPath, setOpenPath] = useState([])

  // Resolved once, not three times: `subStages` filters, so a fresh array
  // comes back on every render and the counting memo below would never hit.
  const { path, chain, level } = useMemo(() => {
    const live = livePath(stages, openPath)
    return { path: live, chain: stagePath(stages, live), level: stagesAt(stages, live) }
  }, [stages, openPath.join('>')])

  const box = stageBox(widget)

  const computed = useMemo(() => {
    return level.map((stage) => {
      const { matchedRows, count, total } = getStageRows({
        stage,
        ancestors: chain,
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
    // `path` rather than `chain`, because the chain is a new array every
    // render and would make this memo do nothing at all.
  }, [level, path.join('>'), rowsByTab, rawRowsByTab, widget, dateOrder])

  // Percentages read against either the first stage (classic funnel
  // conversion) or that stage's own tab total.
  const base = widget.percentBase === 'total' ? null : computed[0]?.count || 0

  const [openStageId, setOpenStageId] = useState(null)

  function isActive(stage) {
    return crossFilters.some((cf) => cf.id === `stage_${widget.id}_${stage.id}`)
  }

  /**
   * Filtering the dashboard to a stage -- and to everything it sits inside.
   *
   * A sub-stage on its own is not what the reader clicked. "Finance done"
   * means finance done WITHIN Booked, which is the set the box counted, so
   * the ancestors travel with it or the number and the filter disagree.
   */
  function drill(stage, ancestors = chain) {
    const list = [...(ancestors || []), stage]
    const { conditions, match, tab, stacked, label } = chainDrill(list)
    const value = list.map((s) => s.id).join('>')

    for (const outer of stacked) {
      onCrossFilter({
        id: `stagechain_${widget.id}_${outer.stage.id}`,
        value,
        kind: 'conditions',
        tab: outer.stage.tab,
        match: outer.match,
        conditions: outer.conditions,
        icon: outer.stage.icon,
        label: outer.stage.label,
      })
    }

    onCrossFilter({
      id: `stage_${widget.id}_${stage.id}`,
      // A lone stage carries no value, exactly as it always did: the id is
      // enough to toggle it. A stacked one needs the pieces to share one.
      ...(stacked.length ? { value } : {}),
      kind: 'conditions',
      tab,
      // Through the same helper the COUNT uses. A condition that never
      // named its tab would otherwise be dropped by the engine, leaving a
      // stage that reads 40 and filters nothing when you click it.
      conditions,
      match,
      icon: stage.icon,
      label,
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
   *
   * "This stage" means the whole chain when the stage is a sub-stage: a KPI
   * inside Booked › Finance is measured on Booked's rows, so filtering by it
   * has to be too.
   */
  function narrowWithinStage(stage, { id, value, conditions, icon, label }) {
    const scope = chainDrill([...chain, stage])
    const splitOut = scope.match === 'any' && scope.conditions.length > 1

    for (const outer of scope.stacked) {
      onCrossFilter({
        id: `stagewithin_${widget.id}_${outer.stage.id}`,
        value,
        kind: 'conditions',
        tab: outer.stage.tab,
        match: outer.match,
        conditions: outer.conditions,
        icon: outer.stage.icon,
        label: outer.stage.label,
      })
    }

    if (splitOut) {
      onCrossFilter({
        id: `stagewithin_${widget.id}_${stage.id}`,
        value,
        kind: 'conditions',
        tab: scope.tab,
        match: scope.match,
        conditions: scope.conditions,
        icon: stage.icon,
        label: scope.label,
      })
    }

    onCrossFilter({
      id,
      value,
      kind: 'conditions',
      tab: stage.tab,
      match: 'all',
      conditions: [...(splitOut ? [] : scope.conditions), ...conditions],
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
    ? (level.find((s) => s.id === openStageId)?.kpis || []).find((k) =>
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
  //
  // A stage with sub-stages does neither: it opens them, and this level
  // steps aside. Filtering by it is still one click away, on the crumb.
  function handleClick(stage, event) {
    if (hasSubStages(stage)) {
      setOpenStageId(null)
      setOpenPath(descend(stages, path, stage.id))
      return
    }
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

  const openStage = level.find((s) => s.id === openStageId) || null
  const openStageRows = openStage
    ? getStagePopupRows({ stage: openStage, ancestors: chain, widget, rowsByTab, rawRowsByTab, dateOrder })
    : []

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="widget-title">🔀 {widget.title}</h2>
        <p className="text-[11px] text-slate-400">
          {level.map((s) => s.label).join(' → ')}
          {widget.ignoreFilters && ' · unfiltered'}
        </p>
      </div>

      {/* Where you are, and the way back. Only ever on screen once there
          IS somewhere to go back to. */}
      {chain.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px]">
          <button
            onClick={() => setOpenPath([])}
            className="rounded px-1.5 py-0.5 font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
          >
            All stages
          </button>
          {chain.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight size={11} className="shrink-0 text-slate-300" />
              <button
                onClick={() => setOpenPath(ascend(path, i))}
                className={`rounded px-1.5 py-0.5 font-semibold transition-colors hover:bg-white ${
                  i === chain.length - 1 ? 'text-slate-700' : 'text-slate-500'
                }`}
                style={i === chain.length - 1 ? { color: crumb.color || '#4F46E5' } : undefined}
              >
                {crumb.icon ? `${crumb.icon} ` : ''}
                {crumb.label}
              </button>
            </span>
          ))}

          {/* Descending is navigation, not filtering -- so the one thing
              the reader loses by descending is offered back here. */}
          <button
            onClick={() => drill(chain[chain.length - 1], chain.slice(0, -1))}
            title={`Filter the dashboard to ${chain[chain.length - 1].label}`}
            className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors ${
              isActive(chain[chain.length - 1])
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-slate-400 hover:bg-white hover:text-slate-600'
            }`}
          >
            <Filter size={10} />
            {isActive(chain[chain.length - 1]) ? 'Filtering' : 'Filter'}
          </button>
        </div>
      )}

      {level.length === 0 ? (
        <p className="empty-state">
          {chain.length ? `${chain[chain.length - 1].label} has no sub-stages yet` : 'No stages configured yet'}
        </p>
      ) : (
        <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
          {computed.map(({ stage, count, total, trend }, i) => {
            const denom = base === null ? total : base
            const pct = denom > 0 ? Math.round((count / denom) * 100) : 0
            const active = isActive(stage)
            const color = stage.color || '#4F46E5'
            const children = subStages(stage).length

            return (
              <div key={stage.id} className="flex items-center">
                <button
                  onClick={(e) => handleClick(stage, e)}
                  title={
                    children
                      ? `Click to open the ${children} stages inside ${stage.label}`
                      : (stage.kpis || []).length > 0
                        ? `Click to see KPIs for ${stage.label}`
                        : `Click to filter the dashboard to ${stage.label}`
                  }
                  className={`group relative flex shrink-0 flex-col overflow-hidden rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${active ? 'border-transparent ring-2 ring-offset-1' : 'border-slate-200/70'
                    }`}
                  style={{
                    width: box.width,
                    ...(box.height ? { height: box.height } : {}),
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
                    <span className="flex items-center gap-1">
                      {/* A box that leads somewhere says so, or its click
                          does something different from its neighbours' for
                          no visible reason. */}
                      {children > 0 && (
                        <span
                          className="flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[9px] font-bold"
                          style={{ backgroundColor: `${color}22`, color }}
                        >
                          <Layers size={9} />
                          {children}
                        </span>
                      )}
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ backgroundColor: `${color}22`, color }}
                      >
                        {pct}%
                      </span>
                    </span>
                  </div>

                  <p className="mt-2 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {stage.label}
                  </p>
                  <p className={`font-bold leading-tight text-slate-800 ${stageNumberClass(box.width)}`}>
                    {count.toLocaleString('en-IN')}
                  </p>

                  <div className="mt-1 h-6">
                    {widget.showSparkline && (
                      trend.length ? (
                        <Sparkline values={trend} color={color} width={Math.max(40, box.width - 28)} height={22} />
                      ) : (
                        <span className="text-[9px] text-slate-300">no trend column set</span>
                      )
                    )}
                  </div>

                  {children > 0 && (
                    <span className="mt-auto flex items-center gap-1 pt-1 text-[9px] font-medium text-slate-400">
                      <CornerDownRight size={9} /> {children} inside
                    </span>
                  )}
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
