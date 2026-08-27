import { matchesConditions } from './filterEngine.js'

/**
 * A stage's conditions, ready to be either COUNTED or DRILLED BY.
 *
 * One function for both, because the two used to disagree. Counting went
 * through `matchesConditions`, which only looks at `column`; drilling goes
 * through the cross-filter engine, which also insists each condition names
 * the tab it applies to (that is what lets one drill span two tabs and
 * leave a third alone). A stage whose conditions carried no `tab` -- one
 * written before refs existed, one migrated from v2 -- therefore counted
 * perfectly and then filtered nothing at all when you clicked it.
 *
 * The stage already knows its own tab, so a condition without one inherits
 * it rather than being quietly dropped.
 */
export function stageConditions(stage) {
  return (stage?.conditions || [])
    .filter((c) => c && c.column)
    .map((c) => ({ ...c, tab: c.tab || stage?.tab }))
}

/**
 * The rows a stage counts.
 *
 * `ancestors` are the stages it sits inside, outermost first. A sub-stage
 * divides the rows its parent matched -- which is what makes it a SUB-stage
 * rather than a second pipeline that happens to be drawn in the same card.
 * Without that, "Finance done" under "Booked" would count finance rows from
 * every stage of the sheet and the four sub-stages would not add up to the
 * number you clicked to reach them.
 *
 * `total` follows the same rule, so "each stage's own tab total" means the
 * rows its LEVEL starts from. At the top level there are no ancestors and
 * that is the tab, exactly as it always was.
 */
export function getStageRows({ stage, ancestors = [], widget, rowsByTab, rawRowsByTab, dateOrder = 'DMY' }) {
  const source = widget?.ignoreFilters ? rawRowsByTab : rowsByTab
  const tabRows = source?.[stage?.tab] || []

  let scopedRows = tabRows
  for (const parent of ancestors || []) {
    const within = stageConditions(parent)
    if (!within.length) continue
    scopedRows = scopedRows.filter((row) => matchesConditions(row, within, parent.match || 'all', dateOrder))
  }

  const conditions = stageConditions(stage)
  const matchedRows = conditions.length
    ? scopedRows.filter((row) => matchesConditions(row, conditions, stage.match || 'all', dateOrder))
    : scopedRows

  return {
    tabRows,
    scopedRows,
    matchedRows,
    count: matchedRows.length,
    total: scopedRows.length,
  }
}

/**
 * A chain of stages, as filters the cross-filter engine can actually apply.
 *
 * The last link is the one that was clicked; the rest are what it sits
 * inside. Most chains collapse into a single AND-ed condition set, which is
 * one chip on the page and one thing to clear.
 *
 * They cannot always. "(booked or delivered) and financed" is not
 * expressible as one flat list, so a link whose own match is ANY -- or any
 * ancestor at all, once the clicked stage is itself an ANY -- travels as a
 * filter of its own and stacks. The caller gives every piece the same
 * `value`, which is what makes them appear, move and clear together.
 *
 * Returns `{ conditions, match, tab, stacked, label }`. A chain of one comes
 * back exactly as a lone stage always did: its own conditions, its own
 * match, and nothing stacked.
 */
export function chainDrill(chain) {
  const list = (chain || []).filter(Boolean)
  const stage = list[list.length - 1]
  const ancestors = list.slice(0, -1)
  const match = stage?.match || 'all'

  const merged = []
  const stacked = []
  for (const parent of ancestors) {
    const conditions = stageConditions(parent)
    if (!conditions.length) continue
    // An ancestor folds in only when BOTH sides are plain ANDs. Folding an
    // OR in -- or folding anything into an OR -- would widen the filter to
    // rows the stage never counted.
    if (match === 'all' && (parent.match || 'all') === 'all') merged.push(...conditions)
    else stacked.push({ stage: parent, conditions, match: parent.match || 'all' })
  }

  return {
    conditions: [...merged, ...stageConditions(stage)],
    match,
    tab: stage?.tab,
    stacked,
    label: list.map((s) => s.label).join(' · '),
  }
}

/**
 * The rows behind a stage's pop-up.
 *
 * The stage's OWN rows, not its whole tab. It used to be the whole tab, and
 * that made every number in the pop-up describe a different set of rows
 * from the card that opened it -- a stage reading 40 opening a pop-up that
 * says 4,000, a leaderboard of everybody rather than of everybody in this
 * stage, and a KPI that could never agree with what clicking it filtered
 * the dashboard to. The admin panel had it right all along: "leave empty to
 * measure the whole STAGE".
 */
export function getStagePopupRows({ stage, ancestors = [], widget, rowsByTab, rawRowsByTab, dateOrder = 'DMY' }) {
  return getStageRows({ stage, ancestors, widget, rowsByTab, rawRowsByTab, dateOrder }).matchedRows
}
