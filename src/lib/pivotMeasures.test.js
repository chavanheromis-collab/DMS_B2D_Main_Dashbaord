import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pivotTree } from './dataUtils.js'
import { defaultMeasureLabel, emptyMeasure, hasManyMeasures, pivotMeasures } from './pivotMeasures.js'

// ---------------------------------------------------------------------
// Several value columns in one grouped list
// ---------------------------------------------------------------------

const ROWS = [
  { Region: 'West', DSE: 'Ravi', Amount: 100, Days: 3 },
  { Region: 'West', DSE: 'Ravi', Amount: 200, Days: 5 },
  { Region: 'West', DSE: 'Sita', Amount: 50, Days: 1 },
  { Region: 'East', DSE: 'Amit', Amount: 400, Days: 9 },
]

const THREE = [
  { id: 'a', aggregation: 'count' },
  { id: 'b', aggregation: 'sum', column: 'Amount' },
  { id: 'c', aggregation: 'avg', column: 'Days' },
]

test('one grouped list, three different measurements of it', () => {
  // The question a grouped list invites is never "the same number again".
  const tree = pivotTree(ROWS, { rowColumns: ['Region', 'DSE'], measures: THREE })

  const ravi = tree.rows.find((r) => r.parts.join('/') === 'West/Ravi')
  assert.deepEqual(ravi.values, [2, 300, 4])

  const amit = tree.rows.find((r) => r.parts.join('/') === 'East/Amit')
  assert.deepEqual(amit.values, [1, 400, 9])
})

test('a group subtotal is worked out per measure, at every level', () => {
  const tree = pivotTree(ROWS, { rowColumns: ['Region', 'DSE'], measures: THREE })
  const ravi = tree.rows.find((r) => r.parts.join('/') === 'West/Ravi')
  // West as a whole: 3 rows, 350, and (3+5+1)/3 = 3 days.
  assert.deepEqual(ravi.subtotalValues[0], [3, 350, 3])
  assert.deepEqual(ravi.subtotalValues[1], [2, 300, 4])
})

test('A COLUMN OF AVERAGES DOES NOT ADD UP TO AN AVERAGE', () => {
  // The grand total is re-aggregated over the rows shown, not added down
  // the column. Added down, the Days column would come to 4+1+9 = 14.
  const tree = pivotTree(ROWS, { rowColumns: ['Region', 'DSE'], measures: THREE })
  assert.deepEqual(tree.grandTotals, [4, 750, 4.5])
})

test('the total counts the rows SHOWN, not the ones a cap hid', () => {
  // A footer that included groups the cap removed would not match the list
  // it sits under.
  const tree = pivotTree(ROWS, {
    rowColumns: ['Region'],
    measures: [{ aggregation: 'sum', column: 'Amount' }],
    maxGroups: 1,
  })
  assert.equal(tree.rows.length, 1)
  assert.equal(tree.grandTotals[0], 400, 'East only — West was capped away')
})

test('the first measure is THE value, so nothing written before this changes', () => {
  const tree = pivotTree(ROWS, { rowColumns: ['Region'], measures: THREE })
  for (const row of tree.rows) {
    assert.equal(row.value, row.values[0])
    assert.equal(row.subtotals[0], row.subtotalValues[0][0])
  }
})

test('rows are ordered by the first measure', () => {
  // It is also the one the bar behind the number is drawn from. A bar drawn
  // from one scale under a number from another is a lie about both.
  const tree = pivotTree(ROWS, {
    rowColumns: ['Region'],
    measures: [{ aggregation: 'sum', column: 'Amount' }, { aggregation: 'count' }],
  })
  assert.deepEqual(tree.rows.map((r) => r.parts[0]), ['East', 'West'])
})

test('no measures at all is the single number this always drew', () => {
  // Which is what makes the feature invisible until it is used.
  const plain = pivotTree(ROWS, { rowColumns: ['Region'], valueColumn: 'Amount', aggregation: 'sum' })
  const listOfOne = pivotTree(ROWS, { rowColumns: ['Region'], measures: [{ aggregation: 'sum', column: 'Amount' }] })
  assert.deepEqual(
    plain.rows.map((r) => [r.parts, r.value]),
    listOfOne.rows.map((r) => [r.parts, r.value])
  )
  assert.equal(plain.grandTotal, listOfOne.grandTotal)
  assert.equal(plain.measureCount, 1)
})

test('the row a renderer receives does not carry the whole sheet', () => {
  // Every source row behind a group, handed to a component that re-renders
  // on every frame, is a leak waiting to be found the hard way.
  const tree = pivotTree(ROWS, { rowColumns: ['Region'], measures: THREE })
  for (const row of tree.rows) assert.equal(row.source, undefined)
})

test('a pivot with no row columns still answers', () => {
  const tree = pivotTree(ROWS, { rowColumns: [], measures: THREE })
  assert.deepEqual(tree.rows, [])
  assert.equal(tree.grandTotals.length, 3)
})

// --- what the editor and the widget agree on -----------------------------

test('an empty list resolves to the widget’s own single calculation', () => {
  const out = pivotMeasures({ aggregation: 'sum', column: 'Amount', format: 'inr', valueLabel: 'Revenue' })
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], { id: 'v0', label: 'Revenue', aggregation: 'sum', column: 'Amount', format: 'inr' })
  assert.equal(pivotMeasures({}).length, 1)
  assert.equal(pivotMeasures(undefined).length, 1)
})

test('a blank label becomes one worth reading', () => {
  assert.equal(defaultMeasureLabel({ aggregation: 'count' }), 'Count')
  assert.equal(defaultMeasureLabel({ aggregation: 'sum', column: 'Amount' }), 'Sum of Amount')
  assert.equal(defaultMeasureLabel({ aggregation: 'avg', column: 'Days' }), 'Average of Days')
  assert.equal(defaultMeasureLabel({}), 'Count')
})

test('a column on an aggregation that ignores columns is dropped', () => {
  // Otherwise two identical measures look different in the editor and
  // identical on the page.
  const out = pivotMeasures({ measures: [{ id: 'a', aggregation: 'count', column: 'Amount' }] })
  assert.equal(out[0].column, '')
})

test('a half-built row is ignored rather than drawn as an empty column', () => {
  const out = pivotMeasures({ measures: [{ id: 'a' }, { id: 'b', aggregation: 'sum', column: 'Amount' }] })
  assert.equal(out.length, 1)
  assert.equal(out[0].label, 'Sum of Amount')
})

test('“several” starts at two', () => {
  assert.equal(hasManyMeasures({}), false)
  assert.equal(hasManyMeasures({ measures: [{ aggregation: 'count' }] }), false)
  assert.equal(hasManyMeasures({ measures: [{ aggregation: 'count' }, { aggregation: 'sum', column: 'A' }] }), true)
})

test('the first one added carries on from what the pivot already showed', () => {
  // Adding a value column must not silently change the number that was
  // already there.
  const first = emptyMeasure({ aggregation: 'sum', column: 'Amount', format: 'inr' }, 0)
  assert.equal(first.aggregation, 'sum')
  assert.equal(first.column, 'Amount')
  const second = emptyMeasure({ aggregation: 'sum', column: 'Amount' }, 1)
  assert.equal(second.aggregation, 'count')
  assert.notEqual(first.id, second.id)
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const widget = read('components/widgets/AnalyticsWidgets.jsx')
const editor = read('pages/admin/WidgetEditors.jsx')

test('the widget asks for measures only where there is no column axis', () => {
  assert.ok(widget.includes('const measures = useMemo(() => (totalsOnly ? pivotMeasures(widget) : [])'))
  assert.ok(widget.includes('measures,'), 'and hands them to the tree')
  assert.ok(widget.includes('<PivotTree tree={tree} widget={widget} measures={measures}'))
})

test('the table draws a column per measure, header and footer included', () => {
  assert.ok(widget.includes('{cols.map((m, i) => ('), 'headers')
  assert.ok(widget.includes('{cols.map((m, mi) => {'), 'cells')
  assert.ok(widget.includes('many ? tree.grandTotals?.[mi] ?? 0 : tree.grandTotal'), 'footer')
})

test('the bar is drawn behind the first measure only', () => {
  assert.ok(widget.includes('showBars && mi === 0 && v > 0'))
})

test('each measure carries its own number format', () => {
  assert.ok(widget.includes('formatNumber(v, m.format || widget.format, m.aggregation || widget.aggregation)'))
})

test('the export follows what is on screen', () => {
  // Falling back to the matrix's single Total would drop every column but
  // the first.
  assert.ok(widget.includes('tree && measures.length > 1'))
  assert.ok(widget.includes('[...tree.columns, ...measures.map((m) => m.label)]'))
})

test('the admin panel has a Values button, and it says why when it cannot be used', () => {
  assert.ok(editor.includes("key: 'values'"))
  assert.ok(editor.includes("{part === 'values' && <MeasuresEditor widget={widget} cols={cols} set={set} />}"))
  assert.ok(editor.includes("if (widget.display !== 'totals') {"))
  assert.ok(editor.includes("onClick={() => set({ display: 'totals' })}"), 'and offers the switch')
})

test('each value column is a full row of choices', () => {
  for (const field of ['aggregation: v', 'column: v', 'label: v', 'format: v']) {
    assert.ok(editor.includes(`setM({ ${field} })`), field)
  }
  assert.ok(editor.includes('ops.add(emptyMeasure(widget, measures.length))'))
  assert.ok(editor.includes('onDelete={() => ops.remove(measure.id)}'))
})
