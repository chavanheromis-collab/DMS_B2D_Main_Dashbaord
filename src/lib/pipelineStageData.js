import { matchesConditions } from './filterEngine.js'

export function getStageRows({ stage, widget, rowsByTab, rawRowsByTab, dateOrder = 'DMY' }) {
  const source = widget?.ignoreFilters ? rawRowsByTab : rowsByTab
  const tabRows = source?.[stage?.tab] || []
  const matchedRows = (stage?.conditions?.length
    ? tabRows.filter((row) => matchesConditions(row, stage.conditions, stage.match || 'all', dateOrder))
    : tabRows)

  return {
    tabRows,
    matchedRows,
    count: matchedRows.length,
    total: tabRows.length,
  }
}

export function getStagePopupRows({ stage, widget, rowsByTab, rawRowsByTab }) {
  const source = widget?.ignoreFilters ? rawRowsByTab : rowsByTab
  return source?.[stage?.tab] || []
}
