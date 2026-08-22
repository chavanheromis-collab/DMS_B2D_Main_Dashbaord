import test from 'node:test'
import assert from 'node:assert/strict'

import { pivotTree } from './dataUtils.js'

// Shaped like the reference: model → sku → colour, with a stock figure.
const stock = [
  { Model: 'SPLENDOR +', SKU: 'HSPLMDRSCFIBHG', Color: 'BHG', Stock: '159' },
  { Model: 'SPLENDOR +', SKU: 'HSPUNIRSCFIBLA', Color: 'BLA', Stock: '63' },
  { Model: 'SPLENDOR +', SKU: 'HSPLMDRSCFISBK', Color: 'SBK', Stock: '37' },
  { Model: 'HF DELUXE', SKU: 'HDLHADRSCFISBK', Color: 'SBK', Stock: '85' },
  { Model: 'HF DELUXE', SKU: 'HDLHADRSCFIBKG', Color: 'BKG', Stock: '42' },
  { Model: 'PASSION +', SKU: 'HPPLDISSCFIHGR', Color: 'HGR', Stock: '20' },
]

const opts = { rowColumns: ['Model', 'SKU', 'Color'], valueColumn: 'Stock', aggregation: 'sum' }

test('one row per leaf, one column per level', () => {
  const tree = pivotTree(stock, opts)
  assert.deepEqual(tree.columns, ['Model', 'SKU', 'Color'])
  assert.equal(tree.rows.length, 6)
  assert.equal(tree.rows[0].parts.length, 3)
})

test('groups are ordered by their own total, not by first appearance', () => {
  const tree = pivotTree(stock, opts)
  const models = tree.rows.filter((r) => r.spans[0] > 0).map((r) => r.parts[0])
  // SPLENDOR + totals 259, HF DELUXE 127, PASSION + 20.
  assert.deepEqual(models, ['SPLENDOR +', 'HF DELUXE', 'PASSION +'])
})

test('leaves inside a group are ordered by value too', () => {
  const tree = pivotTree(stock, opts)
  const splendor = tree.rows.filter((r) => r.parts[0] === 'SPLENDOR +').map((r) => r.value)
  assert.deepEqual(splendor, [159, 63, 37])
})

test('a parent cell spans exactly its own children', () => {
  const tree = pivotTree(stock, opts)
  // SPLENDOR + has three leaves, so its cell spans 3 and the next two rows
  // report 0 -- meaning "covered by the cell above, render nothing".
  assert.equal(tree.rows[0].spans[0], 3)
  assert.equal(tree.rows[1].spans[0], 0)
  assert.equal(tree.rows[2].spans[0], 0)
  assert.equal(tree.rows[3].spans[0], 2, 'HF DELUXE spans its two leaves')
  assert.equal(tree.rows[5].spans[0], 1, 'PASSION + has a single leaf')
})

test('every row is covered exactly once at every level', () => {
  // The invariant that keeps the table from shearing: the spans in a column
  // must tile the rows with no gap and no overlap.
  const tree = pivotTree(stock, opts)
  for (let level = 0; level < tree.columns.length; level += 1) {
    let covered = 0
    for (const row of tree.rows) covered += row.spans[level]
    assert.equal(covered, tree.rows.length, `level ${level} must tile every row`)
  }
})

test('a repeated child under different parents does not merge across them', () => {
  // SBK appears under both SPLENDOR + and HF DELUXE. Those are different
  // cells; merging them would join two unrelated groups into one.
  const rows = [
    { A: 'X', B: 'SBK', V: '1' },
    { A: 'Y', B: 'SBK', V: '1' },
  ]
  const tree = pivotTree(rows, { rowColumns: ['A', 'B'], valueColumn: 'V', aggregation: 'sum' })
  assert.equal(tree.rows[0].spans[1], 1)
  assert.equal(tree.rows[1].spans[1], 1)
})

test('consecutive same values under ONE parent do merge', () => {
  const rows = [
    { A: 'X', B: 'same', C: 'p', V: '1' },
    { A: 'X', B: 'same', C: 'q', V: '1' },
  ]
  const tree = pivotTree(rows, { rowColumns: ['A', 'B', 'C'], valueColumn: 'V', aggregation: 'sum' })
  assert.equal(tree.rows[0].spans[1], 2)
  assert.equal(tree.rows[1].spans[1], 0)
})

test('each row carries the subtotal of every ancestor', () => {
  const tree = pivotTree(stock, opts)
  const first = tree.rows[0]
  assert.equal(first.subtotals[0], 259, 'the whole SPLENDOR + group')
  assert.equal(first.subtotals[2], 159, 'the leaf itself')
})

test('a single level still works, with no merging to do', () => {
  const tree = pivotTree(stock, { rowColumns: ['Model'], valueColumn: 'Stock', aggregation: 'sum' })
  assert.equal(tree.rows.length, 3)
  assert.deepEqual(tree.rows.map((r) => r.spans[0]), [1, 1, 1])
  assert.equal(tree.grandTotal, 406)
})

test('spans stay correct when the row cap cuts a group in half', () => {
  // Spans are computed after capping for exactly this reason: one worked out
  // from the full tree would claim more rows than got rendered, and the
  // table would shear.
  const tree = pivotTree(stock, { ...opts, maxRows: 2 })
  assert.equal(tree.rows.length, 2)
  assert.equal(tree.rows[0].spans[0], 2, 'not 3 -- only two rows exist')

  for (let level = 0; level < tree.columns.length; level += 1) {
    const covered = tree.rows.reduce((sum, r) => sum + r.spans[level], 0)
    assert.equal(covered, tree.rows.length)
  }
})

test('maxGroups caps top-level groups', () => {
  const tree = pivotTree(stock, { ...opts, maxGroups: 1 })
  assert.deepEqual([...new Set(tree.rows.map((r) => r.parts[0]))], ['SPLENDOR +'])
})

test('blank values group under a visible label rather than vanishing', () => {
  const tree = pivotTree([{ A: '', B: 'x', V: '5' }], {
    rowColumns: ['A', 'B'],
    valueColumn: 'V',
    aggregation: 'sum',
  })
  assert.equal(tree.rows[0].parts[0], '(blank)')
})

test('no row columns returns an empty shape rather than throwing', () => {
  const tree = pivotTree(stock, { rowColumns: [] })
  assert.deepEqual(tree.columns, [])
  assert.deepEqual(tree.rows, [])
  assert.equal(tree.grandTotal, 0)
})

test('counting works as well as summing', () => {
  const tree = pivotTree(stock, { rowColumns: ['Model'], aggregation: 'count' })
  const splendor = tree.rows.find((r) => r.parts[0] === 'SPLENDOR +')
  assert.equal(splendor.value, 3)
  assert.equal(tree.grandTotal, 6)
})

test('sorting by name orders every level alphabetically', () => {
  const tree = pivotTree(stock, { ...opts, sort: 'name_asc' })
  const models = tree.rows.filter((r) => r.spans[0] > 0).map((r) => r.parts[0])
  assert.deepEqual(models, ['HF DELUXE', 'PASSION +', 'SPLENDOR +'])
})
