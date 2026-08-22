import test from 'node:test'
import assert from 'node:assert/strict'

import { testCondition } from './filterEngine.js'
import { getStageRows, getStagePopupRows } from './pipelineStageData.js'

test('stage count still honors the stage conditions, but popup data stays independent of them', () => {
  const stage = {
    id: 's1',
    tab: 'MASTER',
    conditions: [{ column: 'Status', operator: 'equals', value: 'Won' }],
    match: 'all',
  }

  const widget = { ignoreFilters: false }

  const rowsByTab = {
    MASTER: [
      { Status: 'Won', Name: 'Alpha' },
      { Status: 'Lost', Name: 'Bravo' },
      { Status: 'Won', Name: 'Charlie' },
    ],
  }

  const rawRowsByTab = {
    MASTER: [
      { Status: 'Won', Name: 'Alpha' },
      { Status: 'Open', Name: 'Delta' },
      { Status: 'Won', Name: 'Charlie' },
    ],
  }

  const stageRows = getStageRows({ stage, widget, rowsByTab, rawRowsByTab, dateOrder: 'DMY' })
  assert.equal(stageRows.matchedRows.length, 2)
  assert.deepEqual(stageRows.tabRows, rowsByTab.MASTER)

  const popupRows = getStagePopupRows({ stage, widget, rowsByTab, rawRowsByTab })
  assert.deepEqual(popupRows, rowsByTab.MASTER)
  assert.equal(popupRows.some((row) => row.Name === 'Bravo'), true)
})

test('not this month matches dates outside the current month and blanks', () => {
  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5)
  const otherMonth = new Date(now.getFullYear(), now.getMonth() === 0 ? 11 : now.getMonth() - 1, 10)

  assert.equal(testCondition({ Date: currentMonth.toISOString() }, { column: 'Date', operator: 'not_this_month' }), false)
  assert.equal(testCondition({ Date: otherMonth.toISOString() }, { column: 'Date', operator: 'not_this_month' }), true)
  assert.equal(testCondition({ Date: '' }, { column: 'Date', operator: 'not_this_month' }), true)
})
