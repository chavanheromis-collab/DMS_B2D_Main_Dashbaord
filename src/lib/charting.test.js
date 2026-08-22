import test from 'node:test'
import assert from 'node:assert/strict'

import { pivot, splitPivotLabel } from './dataUtils.js'
import { axisTicks, colorForDatum, referenceValue, resolvedReferences } from './chartOptions.js'
import { filterIsActive } from './filterEngine.js'

// --- multi-dimension pivot ---------------------------------------------

const rows = [
  { Region: 'West', DSE: 'Ravi', Stage: 'Won', Amount: '10' },
  { Region: 'West', DSE: 'Ravi', Stage: 'Lost', Amount: '5' },
  { Region: 'West', DSE: 'Sam', Stage: 'Won', Amount: '7' },
  { Region: 'East', DSE: 'Ravi', Stage: 'Won', Amount: '3' },
]

test('the original single-column props still work untouched', () => {
  const p = pivot(rows, { rowColumn: 'Region', colColumn: 'Stage' })
  assert.deepEqual(p.rowLabels.sort(), ['East', 'West'])
  assert.deepEqual(p.colLabels.sort(), ['Lost', 'Won'])
  assert.equal(p.grandTotal, 4)
})

test('crossing several row columns gives one row per real combination', () => {
  const p = pivot(rows, { rowColumns: ['Region', 'DSE'], colColumns: ['Stage'] })
  assert.deepEqual(p.rowLabels.sort(), ['East / Ravi', 'West / Ravi', 'West / Sam'])
  // Not the 2 + 2 of two separate pivots -- the real pairs that occur.
  assert.equal(p.rowLabels.length, 3)
  assert.equal(p.grandTotal, 4)
})

test('a composite label splits back into its parts, in order', () => {
  assert.deepEqual(splitPivotLabel('West / Ravi'), ['West', 'Ravi'])
  assert.deepEqual(splitPivotLabel('West'), ['West'])
  assert.deepEqual(splitPivotLabel(null), [''])
})

test('omitting the column axis collapses to a single Total column', () => {
  const p = pivot(rows, { rowColumns: ['Region'], colColumns: [] })
  assert.deepEqual(p.colLabels, ['Total'])
  // The totals-only view is the same numbers, not a second calculation.
  const full = pivot(rows, { rowColumns: ['Region'], colColumns: ['Stage'] })
  assert.equal(p.grandTotal, full.grandTotal)
})

test('crossed columns aggregate a value column correctly', () => {
  const p = pivot(rows, {
    rowColumns: ['Region', 'DSE'],
    colColumns: [],
    valueColumn: 'Amount',
    aggregation: 'sum',
  })
  const west = p.rowLabels.indexOf('West / Ravi')
  assert.equal(p.rowTotals[west], 15)
})

test('a pivot with no row columns returns an empty shape rather than throwing', () => {
  const p = pivot(rows, { rowColumns: [], colColumns: ['Stage'] })
  assert.deepEqual(p.rowLabels, [])
  assert.equal(p.grandTotal, 0)
})

// --- chart colours ------------------------------------------------------

const data = [{ name: 'a', value: 10 }, { name: 'b', value: 50 }, { name: 'c', value: 100 }]

test('single mode gives every bar the widget colour', () => {
  const w = { color: '#123456', colorMode: 'single' }
  assert.equal(colorForDatum(w, data[0], 0, data), '#123456')
  assert.equal(colorForDatum(w, data[2], 2, data), '#123456')
})

test('palette mode cycles per index', () => {
  const w = { colorMode: 'palette' }
  assert.notEqual(colorForDatum(w, data[0], 0, data), colorForDatum(w, data[1], 1, data))
})

test('rank mode marks the best and the worst', () => {
  const w = { colorMode: 'rank', bestColor: '#00FF00', worstColor: '#FF0000' }
  assert.equal(colorForDatum(w, data[2], 2, data), '#00FF00')
  assert.equal(colorForDatum(w, data[0], 0, data), '#FF0000')
  // The middle recedes rather than taking either extreme.
  const middle = colorForDatum(w, data[1], 1, data)
  assert.notEqual(middle, '#00FF00')
  assert.notEqual(middle, '#FF0000')
})

test('conditional rules match in order, first one winning', () => {
  const w = {
    colorMode: 'rules',
    fallbackColor: '#CCCCCC',
    colorRules: [
      { operator: 'gte', value: 80, color: '#00FF00' },
      { operator: 'gte', value: 40, color: '#FFAA00' },
    ],
  }
  assert.equal(colorForDatum(w, { value: 100 }, 0, data), '#00FF00')
  assert.equal(colorForDatum(w, { value: 50 }, 0, data), '#FFAA00')
  assert.equal(colorForDatum(w, { value: 10 }, 0, data), '#CCCCCC')
})

test('a rule with an unusable threshold is skipped, not treated as zero', () => {
  const w = {
    colorMode: 'rules',
    fallbackColor: '#CCCCCC',
    colorRules: [{ operator: 'gte', value: '', color: '#00FF00' }],
  }
  assert.equal(colorForDatum(w, { value: 100 }, 0, data), '#CCCCCC')
})

// --- reference lines ----------------------------------------------------

test('reference kinds resolve against the plotted data', () => {
  assert.equal(referenceValue({ kind: 'avg' }, data), (10 + 50 + 100) / 3)
  assert.equal(referenceValue({ kind: 'median' }, data), 50)
  assert.equal(referenceValue({ kind: 'max' }, data), 100)
  assert.equal(referenceValue({ kind: 'min' }, data), 10)
  assert.equal(referenceValue({ kind: 'value', value: 42 }, data), 42)
})

test('median averages the middle pair on an even count', () => {
  const even = [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }]
  assert.equal(referenceValue({ kind: 'median' }, even), 25)
})

test('an unresolvable reference is dropped rather than drawn at zero', () => {
  assert.equal(referenceValue({ kind: 'avg' }, []), null)
  assert.equal(referenceValue({ kind: 'value', value: 'abc' }, data), null)

  const lines = resolvedReferences(
    { references: [{ kind: 'value', value: 'abc' }, { kind: 'max' }] },
    data
  )
  assert.equal(lines.length, 1)
  assert.equal(lines[0].y, 100)
})

test('a reference line falls back to its kind for a label', () => {
  const [line] = resolvedReferences({ references: [{ kind: 'avg' }] }, data)
  assert.equal(line.text, 'Average of the bars')
  const [named] = resolvedReferences({ references: [{ kind: 'avg', label: 'Target' }] }, data)
  assert.equal(named.text, 'Target')
})

// --- axis scaling -------------------------------------------------------

test('no step means the chart picks its own ticks', () => {
  assert.equal(axisTicks(data, null), null)
  assert.equal(axisTicks(data, 0), null)
  assert.equal(axisTicks(data, 'abc'), null)
})

test('ticks land on the step, with the domain rounded outward', () => {
  const scale = axisTicks([{ value: 0 }, { value: 130 }], 50)
  assert.deepEqual(scale.domain, [0, 150])
  assert.deepEqual(scale.ticks, [0, 50, 100, 150])
  // The tallest bar keeps headroom rather than touching the frame.
  assert.ok(scale.domain[1] > 130)
})

test('a reference line above every bar is kept inside the domain', () => {
  // Otherwise a target line would be clipped off the top -- precisely when
  // you most need to see it.
  const scale = axisTicks([{ value: 30 }], 50, [{ y: 220 }])
  assert.equal(scale.domain[1], 250)
})

test('negative values extend the domain downward', () => {
  const scale = axisTicks([{ value: -30 }, { value: 80 }], 50)
  assert.deepEqual(scale.domain, [-50, 100])
})

test('an absurd step is ignored rather than drawing thousands of gridlines', () => {
  assert.equal(axisTicks([{ value: 1000000 }], 1), null)
})

// --- new page-level slider filters -------------------------------------

test('the page filter engine understands the new slider kinds', () => {
  assert.equal(filterIsActive({ kind: 'threshold' }, 5), true)
  assert.equal(filterIsActive({ kind: 'threshold' }, ''), false)
  // Zero is a legitimate threshold, not an empty one.
  assert.equal(filterIsActive({ kind: 'threshold' }, 0), true)
  assert.equal(filterIsActive({ kind: 'dateslider' }, 30), true)
  assert.equal(filterIsActive({ kind: 'stepper' }, { from: '0', to: '100' }), true)
  assert.equal(filterIsActive({ kind: 'stepper' }, {}), false)
})
