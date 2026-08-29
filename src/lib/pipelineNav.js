// ---------------------------------------------------------------------
// A pipeline inside a pipeline
// ---------------------------------------------------------------------
// A real process is not one row of boxes. "Booked" is a stage of the sale
// and a process of its own -- documents, finance, insurance, RTO -- and
// drawing those four beside the six stages of the sale makes ten boxes that
// are not the same kind of thing.
//
// So a stage can own stages. Clicking one REPLACES the row with its own,
// the way opening a folder replaces the listing: the level you left is a
// breadcrumb, not something still on screen competing for the eye.
//
// The nesting is what makes it one pipeline rather than two. A sub-stage
// divides the rows its parent matched (see `getStageRows`), so the numbers
// inside always add up to the number you clicked to get there -- which is
// the difference between a sub-pipeline and a second widget that happens to
// be drawn in the same card.
//
// Pure: stages and a path in, stages and a path out. No rows, no React.

/** How deep the nesting may go. */
export const MAX_DEPTH = 4

export const DEFAULT_STAGE_WIDTH = 132
export const MIN_STAGE_WIDTH = 80
export const MAX_STAGE_WIDTH = 520

/** Zero means "as tall as whatever is in it", which is the old behaviour. */
export const DEFAULT_STAGE_HEIGHT = 0
export const MAX_STAGE_HEIGHT = 400

export const subStages = (stage) => (stage?.stages || []).filter(Boolean)
export const hasSubStages = (stage) => subStages(stage).length > 0

/**
 * The stages named by a path, as objects.
 *
 * A path is ids, and ids go stale: an admin deletes a stage while somebody
 * has it open, or a saved page names one that no longer exists. Resolving
 * stops at the first id it cannot find and returns the part that IS real,
 * so a deleted sub-stage puts the reader back at its parent rather than in
 * front of an empty card.
 */
export function stagePath(stages, path) {
  const chain = []
  let level = stages || []
  for (const id of path || []) {
    const found = level.find((s) => s?.id === id)
    if (!found) break
    chain.push(found)
    level = subStages(found)
  }
  return chain
}

/** The stages to draw for a path -- the top level, or the last one's own. */
export function stagesAt(stages, path) {
  const chain = stagePath(stages, path)
  return chain.length ? subStages(chain[chain.length - 1]) : stages || []
}

/**
 * The path as it actually resolved.
 *
 * Handed back to the component so a stale id is dropped from state rather
 * than kept around to be re-resolved on every render.
 */
export function livePath(stages, path) {
  return stagePath(stages, path).map((s) => s.id)
}

/** Descending into a stage -- only where there is something to descend into. */
export function descend(stages, path, stageId) {
  const level = stagesAt(stages, path)
  const stage = level.find((s) => s?.id === stageId)
  if (!stage || !hasSubStages(stage)) return path
  if ((path?.length || 0) + 1 > MAX_DEPTH) return path
  return [...(path || []), stageId]
}

/** Going back up. `-1` is the top level, `0` the first crumb, and so on. */
export function ascend(path, index) {
  return (path || []).slice(0, Math.max(0, index + 1))
}

/**
 * Whether a stage should open its sub-stages rather than its pop-up.
 *
 * Sub-stages win. A stage that has both is asking two different things of
 * one click, and the sub-stages are the bigger answer -- the KPIs of the
 * parent are still reachable from the breadcrumb, which offers the whole
 * level as a filter.
 */
export const opensSubStages = (stage) => hasSubStages(stage)

/**
 * What a collapsed stage says about itself in the editor.
 *
 * Enough to find the one you came for without opening it, and no more. A
 * stage with no conditions counts its ENTIRE tab, which looks like a
 * half-finished stage and reads like a bug, so it says so rather than
 * showing "0 rules" and leaving the admin to work out what that means.
 *
 * KPIs go unmentioned once a stage has stages inside it: the pop-up they
 * belong to never opens, so counting them would be advertising something
 * that cannot happen.
 */
export function stageSummary(stage) {
  const rules = (stage?.conditions || []).filter((c) => c && c.column).length
  const kpis = (stage?.kpis || []).length
  const inside = subStages(stage).length

  const parts = [rules ? plural(rules, 'rule') : 'every row']
  if (inside) parts.push(`${inside} inside`)
  else if (kpis) parts.push(plural(kpis, 'KPI'))
  return parts.join(' · ')
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ---------------------------------------------------------------------
// What a pop-up KPI measures
// ---------------------------------------------------------------------
// A stage's pop-up is usually about the stage: 40 booked, of which 22
// financed and 9 delivered. Everything in it narrows the same rows, and
// that is what makes the numbers agree with the box that was clicked.
//
// But not every number worth putting there is about the stage. "Booked this
// month, against a target of 300" needs the 300; "12 of these, out of 4,000
// enquiries all year" needs the 4,000. Those are context, not contents, and
// scoping them to the stage would make them wrong rather than merely
// unhelpful -- so a KPI can opt out and read its own rows instead.

export const KPI_SCOPES = [
  { value: 'stage', label: 'Rows in this stage' },
  { value: 'own', label: 'Its own rows — ignores the stage' },
]

/** Absent means "stage", so nothing written before this existed changes. */
export const followsStage = (kpi) => (kpi?.scope || 'stage') !== 'own'

/**
 * The tab a KPI reads.
 *
 * A stage-scoped KPI reads the stage's, always: it is narrowing rows the
 * stage already matched, and rows from another sheet are not those rows. An
 * independent one may name its own, and falls back to the stage's, which is
 * the sensible thing to measure first.
 */
export const kpiTab = (kpi, stage) => (followsStage(kpi) ? stage?.tab : kpi?.tab || stage?.tab)

/**
 * What clicking a KPI filters the dashboard by.
 *
 * `withinStage` tells the caller whether the stage (and everything it sits
 * inside) has to travel with it. An independent KPI is not describing the
 * stage, so filtering by the stage as well would contradict the number the
 * reader just clicked.
 */
export function kpiDrill(kpi, stage) {
  const tab = kpiTab(kpi, stage)
  return {
    tab,
    match: kpi?.match || 'all',
    // A condition that never named its tab is dropped by the engine, so it
    // inherits the one it is written against -- the same rule stages use.
    conditions: (kpi?.conditions || []).filter((c) => c && c.column).map((c) => ({ ...c, tab: c.tab || tab })),
    withinStage: followsStage(kpi),
  }
}

/**
 * What a collapsed pop-up KPI says about itself.
 *
 * What it measures, and what it measures it over. `aggregations` is passed
 * in rather than imported so this file stays dependency-free -- the caller
 * already has the list it renders the picker from, and a label that drifts
 * from that picker would be worse than none.
 */
export function kpiSummary(kpi, aggregations = []) {
  const agg = kpi?.aggregation || 'count'
  const what = aggregations.find((a) => a.value === agg)?.label || agg
  const rules = (kpi?.conditions || []).filter((c) => c && c.column).length

  const over = followsStage(kpi)
    ? [rules ? plural(rules, 'rule') : 'whole stage']
    : ['own rows', rules && plural(rules, 'rule')].filter(Boolean)

  return [kpi?.column ? `${what} · ${kpi.column}` : what, ...over].join(' · ')
}

/**
 * The size of a stage box.
 *
 * Bounded rather than free: a 20px box cannot hold a five-figure number and
 * a 2000px one is not a funnel, and a number typed into a box in the admin
 * panel is exactly where a stray keystroke turns into a page nobody can
 * read. Height of zero keeps the old behaviour -- as tall as its contents.
 */
export function stageBox(widget) {
  const width = clamp(widget?.stageWidth, DEFAULT_STAGE_WIDTH, MIN_STAGE_WIDTH, MAX_STAGE_WIDTH)
  const height = clamp(widget?.stageHeight, DEFAULT_STAGE_HEIGHT, 0, MAX_STAGE_HEIGHT)
  return { width, height }
}

function clamp(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * The percentage a stage box shows.
 *
 * `base` is the level's shared denominator -- the first stage's count, for a
 * funnel -- or null where each stage is measured against its own rows. Both
 * the row of stages and the parent drawn beside them ask this, so a parent
 * cannot read 40% on the way in and 100% once you are inside it.
 */
export function stagePercent(count, { base, total }) {
  const denom = base === null || base === undefined ? total : base
  return denom > 0 ? Math.round((count / denom) * 100) : 0
}

/**
 * How big the number in a stage box is allowed to be.
 *
 * A narrow box and a five-figure count cannot both have their way, and the
 * count is the point of the box -- so the type steps down rather than the
 * number being clipped or the box silently widening past what was asked
 * for.
 */
export function stageNumberClass(width) {
  if (width < 100) return 'text-lg'
  if (width < DEFAULT_STAGE_WIDTH) return 'text-xl'
  return 'text-2xl'
}
