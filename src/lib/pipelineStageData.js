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

export function getStageRows({ stage, widget, rowsByTab, rawRowsByTab, dateOrder = 'DMY' }) {
  const source = widget?.ignoreFilters ? rawRowsByTab : rowsByTab
  const tabRows = source?.[stage?.tab] || []
  const conditions = stageConditions(stage)
  const matchedRows = conditions.length
    ? tabRows.filter((row) => matchesConditions(row, conditions, stage.match || 'all', dateOrder))
    : tabRows

  return {
    tabRows,
    matchedRows,
    count: matchedRows.length,
    total: tabRows.length,
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
export function getStagePopupRows({ stage, widget, rowsByTab, rawRowsByTab, dateOrder = 'DMY' }) {
  return getStageRows({ stage, widget, rowsByTab, rawRowsByTab, dateOrder }).matchedRows
}
