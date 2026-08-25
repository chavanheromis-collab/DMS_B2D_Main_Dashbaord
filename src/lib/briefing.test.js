import test from 'node:test'
import assert from 'node:assert/strict'

import {
  agingFinding,
  buildBriefing,
  concentrationFinding,
  movementFindings,
  outlierFinding,
  qualityFinding,
  severityFor,
  watchFinding,
} from './briefing.js'
import { applyFilters, matchesConditions } from './filterEngine.js'

const TODAY = new Date(2024, 5, 15) // 15 June 2024
const day = (offset) => {
  const d = new Date(TODAY.getTime() - offset * 86400000)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const COUNT = { dimensions: ['Location'], aggregation: 'count', valueColumn: null, minShare: 0.05 }

/** Rows spread across locations, with an age each. */
const make = (spec) =>
  spec.flatMap(([location, n, age]) =>
    Array.from({ length: n }, (_, i) => ({
      _row: `${location}-${i}`,
      Location: location,
      'In Stock Since': age === undefined ? '' : day(age),
      Value: '100',
    }))
  )

// --- severity -------------------------------------------------------------

test('severity comes from how much of the measure is behind it', () => {
  assert.equal(severityFor(0.4), 'high')
  assert.equal(severityFor(0.15), 'medium')
  assert.equal(severityFor(0.02), 'low')
  assert.equal(severityFor(-0.4), 'high', 'a big fall is as serious as a big rise')
})

// --- concentration --------------------------------------------------------

test('concentration says how few groups hold most of it', () => {
  const rows = make([
    ['Pune', 60, 10],
    ['Nashik', 8, 10],
    ['Satara', 7, 10],
    ['Solapur', 6, 10],
    ['Kolhapur', 5, 10],
    ['Sangli', 5, 10],
    ['Latur', 5, 10],
    ['Beed', 4, 10],
  ])
  const found = concentrationFinding(rows, COUNT, 'Location')
  assert.match(found.headline, /^1 of 8 locations hold 6\d%/)
  assert.equal(found.severity, 'medium')
})

test('a concentration finding drills to exactly the groups it named', () => {
  const rows = make([
    ['Pune', 60, 10],
    ['Nashik', 8, 10],
    ['Satara', 7, 10],
    ['Solapur', 6, 10],
    ['Kolhapur', 5, 10],
    ['Sangli', 5, 10],
  ])
  const found = concentrationFinding(rows, COUNT, 'Location')
  const drilled = applyFilters(rows, {
    tab: 'T',
    crossFilters: [{ id: 'f', kind: 'conditions', match: found.match, conditions: found.conditions.map((c) => ({ ...c, tab: 'T' })) }],
  })
  assert.equal(drilled.length, found.rows, 'the click shows exactly what the sentence counted')
})

test('an even spread is not a finding', () => {
  // Half the groups holding 60% is arithmetic, not news.
  const rows = make([
    ['A', 10, 5],
    ['B', 10, 5],
    ['C', 10, 5],
    ['D', 10, 5],
    ['E', 10, 5],
    ['F', 10, 5],
  ])
  assert.equal(concentrationFinding(rows, COUNT, 'Location'), null)
})

test('too few groups to concentrate is not a finding', () => {
  assert.equal(concentrationFinding(make([['A', 10, 5], ['B', 1, 5]]), COUNT, 'Location'), null)
})

// --- ageing ---------------------------------------------------------------

const AGE = { ...COUNT, dateColumn: 'In Stock Since', ageDays: [90, 60, 30] }

test('ageing reports the oldest pile that is material, not the biggest one', () => {
  // 30 rows over 90 days and 40 more over 30. Being told about the 30-day
  // pile when there is a 90-day pile is being told the smaller thing.
  const rows = make([
    ['Pune', 30, 120],
    ['Nashik', 40, 45],
    ['Satara', 30, 2],
  ])
  const found = agingFinding(rows, AGE, { today: TODAY })
  assert.match(found.headline, /over 90 days/)
  assert.equal(found.rows, 30)
  assert.equal(found.severity, 'high', '30% of everything')
})

test('ageing falls back to a shorter threshold when the long one is empty', () => {
  const rows = make([
    ['Pune', 40, 45],
    ['Nashik', 60, 2],
  ])
  assert.match(agingFinding(rows, AGE, { today: TODAY }).headline, /over 30 days/)
})

test('an ageing finding drills to the rows it counted', () => {
  const rows = make([
    ['Pune', 30, 120],
    ['Satara', 70, 2],
  ])
  const found = agingFinding(rows, AGE, { today: TODAY })
  const drilled = applyFilters(rows, {
    tab: 'T',
    crossFilters: [{ id: 'f', kind: 'conditions', conditions: found.conditions.map((c) => ({ ...c, tab: 'T' })) }],
  })
  assert.equal(drilled.length, found.rows)
})

test('a trivial ageing pile is not worth saying', () => {
  const rows = make([
    ['Pune', 2, 200],
    ['Nashik', 98, 1],
  ])
  assert.equal(agingFinding(rows, AGE, { today: TODAY }), null, '2% is not a finding')
})

test('no date column, no ageing finding — rather than a wrong one', () => {
  assert.equal(agingFinding(make([['A', 10, 200]]), COUNT, { today: TODAY }), null)
})

// --- movement -------------------------------------------------------------

const MOVE = { ...COUNT, dateColumn: 'In Stock Since', windowDays: 30 }

test('movement compares a window against the window before it', () => {
  // Never a part-finished month against a whole one: both windows are
  // thirty days by construction.
  const rows = make([
    ['Pune', 40, 10], // last 30 days
    ['Pune', 100, 45], // the 30 before
  ])
  const found = movementFindings(rows, MOVE, { today: TODAY })
  const total = found.find((f) => f.id === 'movement:total')
  assert.equal(total.direction, 'down')
  assert.match(total.headline, /Down 60% on the previous 30 days/)
})

test('movement names who moved, one each way at most', () => {
  const rows = [
    ...make([['Pune', 10, 10], ['Pune', 60, 45]]),
    ...make([['Nashik', 60, 10], ['Nashik', 10, 45]]),
  ]
  const found = movementFindings(rows, MOVE, { today: TODAY })
  const movers = found.filter((f) => f.id !== 'movement:total')
  assert.equal(movers.length, 2)
  assert.ok(movers.some((m) => m.direction === 'down' && m.headline.startsWith('Pune')))
  assert.ok(movers.some((m) => m.direction === 'up' && m.headline.startsWith('Nashik')))
})

test('a movement drill lands on the right rows in the right window', () => {
  const rows = [...make([['Pune', 10, 10], ['Pune', 60, 45]]), ...make([['Nashik', 60, 10], ['Nashik', 10, 45]])]
  const mover = movementFindings(rows, MOVE, { today: TODAY }).find((f) => f.headline.startsWith('Nashik'))
  const drilled = applyFilters(rows, {
    tab: 'T',
    crossFilters: [{ id: 'f', kind: 'conditions', conditions: mover.conditions.map((c) => ({ ...c, tab: 'T' })) }],
  })
  assert.equal(drilled.length, 60, "Nashik's rows from the last 30 days, and only those")
})

test('a change too small to matter is not reported', () => {
  const rows = make([['Pune', 51, 10], ['Pune', 50, 45]])
  assert.equal(movementFindings(rows, MOVE, { today: TODAY }).length, 0)
})

test('rows dated in the future are not counted as this period', () => {
  const rows = make([['Pune', 50, -10], ['Pune', 10, 10], ['Pune', 10, 45]])
  const total = movementFindings(rows, MOVE, { today: TODAY }).find((f) => f.id === 'movement:total')
  assert.ok(!total || total.rows === 10, 'a delivery date next month is not stock that moved')
})

// --- outliers -------------------------------------------------------------

test('an outlier is measured against the median, not the mean', () => {
  // The mean is dragged by the outlier itself, which is how an outlier
  // hides: it becomes the thing that defines normal.
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => ({ Location: `L${i}`, Value: '10' })),
    ...Array.from({ length: 5 }, () => ({ Location: 'Odd', Value: '100' })),
  ]
  const config = { dimensions: ['Location'], aggregation: 'sum', valueColumn: 'Value', minShare: 0.05 }
  const found = outlierFinding(rows, config, 'Location')
  assert.ok(found, 'the outlier is found')
  assert.match(found.headline, /^Odd is well above/)
})

test('an outlier nobody would care about is not reported', () => {
  // One row at nine times the going rate is statistically miles out and
  // worth 15% of the measure. A briefing full of those gets closed.
  const rows = [
    ...Array.from({ length: 50 }, (_, i) => ({ Location: `L${i % 10}`, Value: '10' })),
    { Location: 'Tiny', Value: '90' },
  ]
  const config = { dimensions: ['Location'], aggregation: 'sum', valueColumn: 'Value', minShare: 0.5 }
  assert.equal(outlierFinding(rows, config, 'Location'), null, 'far out but not material')

  // Lower the bar and the same row is reported: it is the materiality that
  // decides, not the statistics.
  assert.ok(outlierFinding(rows, { ...config, minShare: 0.05 }, 'Location'))
})

test('too few groups to have a normal is not an outlier', () => {
  const rows = [{ Location: 'A', Value: '1' }, { Location: 'B', Value: '100' }]
  assert.equal(outlierFinding(rows, { ...COUNT, valueColumn: 'Value', aggregation: 'sum' }, 'Location'), null)
})

// --- data quality ---------------------------------------------------------

test('blanks in a column everything is grouped by are said out loud', () => {
  const rows = [...make([['Pune', 80, 5]]), ...Array.from({ length: 20 }, () => ({ Location: '', Value: '1' }))]
  const found = qualityFinding(rows, COUNT, 'Location')
  assert.match(found.headline, /20% of rows have no Location/)
  assert.equal(found.rows, 20)
})

test('a quality finding drills to the blank rows', () => {
  const rows = [...make([['Pune', 80, 5]]), ...Array.from({ length: 20 }, () => ({ Location: '' }))]
  const found = qualityFinding(rows, COUNT, 'Location')
  const drilled = applyFilters(rows, {
    tab: 'T',
    crossFilters: [{ id: 'f', kind: 'conditions', conditions: found.conditions.map((c) => ({ ...c, tab: 'T' })) }],
  })
  assert.equal(drilled.length, 20)
})

test('a clean column is not a finding', () => {
  assert.equal(qualityFinding(make([['Pune', 100, 5]]), COUNT, 'Location'), null)
})

// --- watches --------------------------------------------------------------

test('a watch is a sentence somebody asked for, with a threshold', () => {
  const rows = make([['Pune', 60, 5], ['Nashik', 40, 5]])
  const watch = {
    id: 'w1',
    label: 'Unallocated stock',
    threshold: 50,
    severity: 'high',
    conditions: [{ column: 'Location', operator: 'equals', value: 'Pune' }],
  }
  const found = watchFinding(rows, COUNT, watch, matchesConditions, 'DMY')
  assert.equal(found.tripped, true)
  assert.match(found.headline, /Unallocated stock: 60 \(over 50\)/)
})

test('a watch that is fine still says so', () => {
  // An MD told nothing cannot tell "fine" from "not checked".
  const rows = make([['Pune', 10, 5], ['Nashik', 90, 5]])
  const watch = {
    id: 'w1',
    label: 'Unallocated stock',
    threshold: 50,
    conditions: [{ column: 'Location', operator: 'equals', value: 'Pune' }],
  }
  const found = watchFinding(rows, COUNT, watch, matchesConditions, 'DMY')
  assert.equal(found.tripped, false)
  assert.equal(found.severity, 'ok')
  assert.match(found.headline, /within 50/)
})

test('a watch with nothing in it is not a watch', () => {
  assert.equal(watchFinding([], COUNT, { id: 'w', label: '', conditions: [] }, matchesConditions, 'DMY'), null)
})

// --- the whole briefing ---------------------------------------------------

const FULL = {
  dimensions: ['Location'],
  aggregation: 'count',
  dateColumn: 'In Stock Since',
  windowDays: 30,
  ageDays: [90, 60, 30],
  minShare: 0.05,
  limit: 6,
}

test('a briefing is ranked, trimmed, and puts a tripped watch first', () => {
  const rows = make([
    ['Pune', 70, 120],
    ['Nashik', 8, 5],
    ['Satara', 7, 5],
    ['Solapur', 6, 5],
    ['Kolhapur', 5, 5],
    ['Sangli', 4, 5],
  ])
  const out = buildBriefing(
    rows,
    {
      ...FULL,
      watches: [
        {
          id: 'w1',
          label: 'Pune stock',
          threshold: 10,
          severity: 'high',
          conditions: [{ column: 'Location', operator: 'equals', value: 'Pune' }],
        },
      ],
    },
    { matchesConditions, today: TODAY }
  )

  assert.equal(out.findings[0].kind, 'watch', 'somebody asked to be told about this by name')
  assert.ok(out.findings.length > 1)
  assert.ok(out.findings.length <= 6)
})

test('a briefing says what it could NOT check', () => {
  // A missing "what changed" section looks identical to a business where
  // nothing changed, and those are very different situations.
  const out = buildBriefing(make([['Pune', 10, 5]]), { dimensions: ['Location'] }, { matchesConditions, today: TODAY })
  assert.ok(out.skipped.some((s) => /no date column/.test(s)))

  const noDims = buildBriefing(make([['Pune', 10, 5]]), { dateColumn: 'In Stock Since' }, { matchesConditions, today: TODAY })
  assert.ok(noDims.skipped.some((s) => /no columns chosen/.test(s)))
})

test('a quiet table produces a quiet briefing, not invented drama', () => {
  const rows = make([
    ['A', 20, 3],
    ['B', 20, 3],
    ['C', 20, 3],
    ['D', 20, 3],
    ['E', 20, 3],
  ])
  const out = buildBriefing(rows, FULL, { matchesConditions, today: TODAY })
  assert.equal(out.quiet, true)
  assert.deepEqual(out.findings, [])
})

test('every finding in a briefing can be drilled to the rows it counted', () => {
  // The rule the whole widget rests on: nothing is asserted that cannot be
  // shown. `movement` carries a window as well as a group, so its row count
  // is checked against its own window.
  const rows = make([
    ['Pune', 70, 120],
    ['Nashik', 8, 5],
    ['Satara', 7, 5],
    ['Solapur', 6, 5],
    ['Kolhapur', 5, 5],
    ['Sangli', 4, 5],
  ])
  const out = buildBriefing(rows, FULL, { matchesConditions, today: TODAY })
  assert.ok(out.findings.length > 0)

  for (const finding of out.findings) {
    const drilled = applyFilters(rows, {
      tab: 'T',
      crossFilters: [
        {
          id: 'f',
          kind: 'conditions',
          match: finding.match,
          conditions: finding.conditions.map((c) => ({ ...c, tab: 'T' })),
        },
      ],
    })
    assert.equal(drilled.length, finding.rows, `${finding.id}: "${finding.headline}"`)
  }
})

test('the briefing survives an empty table', () => {
  const out = buildBriefing([], FULL, { matchesConditions, today: TODAY })
  assert.equal(out.rows, 0)
  assert.equal(out.quiet, true)
  assert.deepEqual(out.findings, [])
})
