import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  NO_SELECTION,
  headerState,
  isSelected,
  pruneSelection,
  rowRefs,
  selectAll,
  selectRange,
  selectedRows,
  toggleAll,
  toggleRow,
} from './tableSelection.js'

// ---------------------------------------------------------------------
// Which rows an action is about to fire at
// ---------------------------------------------------------------------
// The selection looks like the easy half of row operations and is the half
// that decides whether they are safe: "Delete" is only ever as correct as
// the set of rows it is handed. Everything here is one rule in three
// shapes -- the selection must never contain a row the reader cannot
// currently see.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const row = (n, extra = {}) => ({ _row: n, _fp: `fp${n}`, Model: `M${n}`, ...extra })
const ROWS = [row(2), row(3), row(4), row(5), row(6)]

// --- ticking -------------------------------------------------------------

test('a row is held by its sheet row number, not its position', () => {
  // Sorting, paging and a reload after a save all rebuild the row objects
  // and reorder them; an index-based selection would silently move to
  // different records under every one of those.
  const one = toggleRow(NO_SELECTION, row(4))
  assert.deepEqual(one, [4])
  assert.equal(isSelected(one, row(4)), true)
  assert.equal(isSelected(one, row(5)), false)
  // The same record, arriving as a different object after a reload.
  assert.equal(isSelected(one, { _row: 4, _fp: 'changed', Model: 'edited' }), true)
})

test('ticking twice unticks', () => {
  assert.deepEqual(toggleRow([4], row(4)), [])
  assert.deepEqual(toggleRow([3, 4], row(3)), [4])
})

test('a row with no sheet number cannot be ticked', () => {
  // It is not addressable, so nothing could be done to it afterwards.
  assert.deepEqual(toggleRow([2], { Model: 'x' }), [2])
  assert.deepEqual(toggleRow([2], null), [2])
})

test('the order is the order it was ticked in', () => {
  // Nothing downstream depends on it, but a bar reading "3 rows" that
  // reorders every time you tick a fourth looks like it is doing something
  // else.
  assert.deepEqual(toggleRow(toggleRow(toggleRow([], row(6)), row(2)), row(4)), [6, 2, 4])
})

// --- shift-click ---------------------------------------------------------

test('shift-click takes the rows between, AS DISPLAYED', () => {
  // On a table sorted by amount, the rows between two clicks are neighbours
  // on screen and scattered through the sheet. A numeric span would select
  // a hundred rows nobody pointed at.
  const shown = [row(6), row(2), row(9), row(4), row(3)]
  assert.deepEqual(selectRange([6], shown, row(6), row(9)), [6, 2, 9])
})

test('shift-click only ever adds', () => {
  // A gesture that also cleared what was outside the span would throw away
  // a selection built up elsewhere in the table.
  assert.deepEqual(selectRange([99, 2], ROWS, row(3), row(5)), [99, 2, 3, 4, 5])
})

test('shift-click backwards is the same span', () => {
  assert.deepEqual(selectRange([], ROWS, row(5), row(3)), [3, 4, 5])
})

test('nothing is ticked twice', () => {
  assert.deepEqual(selectRange([3, 4], ROWS, row(2), row(5)), [3, 4, 2, 5])
})

test('a span whose anchor has been filtered away falls back to a plain tick', () => {
  // Rather than guessing at a span with no start.
  assert.deepEqual(selectRange([], ROWS, row(99), row(4)), [4])
})

// --- the header tick -----------------------------------------------------

test('select-all means the filtered set, not the tab', () => {
  // Which is what somebody who has just narrowed a table to eleven rows and
  // pressed the header tick expects.
  assert.deepEqual(selectAll(ROWS), [2, 3, 4, 5, 6])
  assert.deepEqual(selectAll([]), [])
})

test('the header tick has three states, and the third is the point', () => {
  // With some of the visible rows ticked, a plain checkbox shows "off" and
  // pressing it appears to do nothing, because it selects everything --
  // including what was already selected.
  assert.equal(headerState([], ROWS), 'none')
  assert.equal(headerState([3], ROWS), 'mixed')
  assert.equal(headerState([2, 3, 4, 5, 6], ROWS), 'all')
  assert.equal(headerState([2], []), 'none')
})

test('pressing it from "mixed" selects everything, and from "all" clears', () => {
  assert.deepEqual(toggleAll([3], ROWS), [2, 3, 4, 5, 6])
  assert.deepEqual(toggleAll([2, 3, 4, 5, 6], ROWS), [])
  assert.deepEqual(toggleAll([], ROWS), [2, 3, 4, 5, 6])
})

test('rows selected elsewhere do not make the header read "all"', () => {
  assert.equal(headerState([2, 3, 4, 5, 6, 99], ROWS), 'all')
})

// --- pruning -------------------------------------------------------------

test('a row filtered off the screen leaves the selection with it', () => {
  // The rule the whole feature rests on. Tick four rows, type in the search
  // box until three are gone, and without this "Delete 4 rows" is three
  // rows nobody can look at before agreeing to it, plus one they can.
  assert.deepEqual(pruneSelection([2, 3, 4], [row(2), row(9)]), [2])
  assert.deepEqual(pruneSelection([2, 3], []), [])
})

test('pruning nothing hands back the same array', () => {
  // So a component can call it on every render without re-rendering on
  // every keystroke.
  const selection = [2, 3]
  assert.equal(pruneSelection(selection, ROWS), selection)
  // And a pruned one is genuinely a new array, or the state would not move.
  const pruned = pruneSelection(selection, [row(2)])
  assert.notEqual(pruned, selection)
  assert.deepEqual(pruned, [2])
})

test('an empty selection is left alone', () => {
  const empty = []
  assert.equal(pruneSelection(empty, ROWS), empty)
})

// --- what an action is handed --------------------------------------------

test('the selected rows come back in display order', () => {
  // A block picked out top-to-bottom should not arrive shuffled by the
  // order it happened to be ticked in.
  const shown = [row(6), row(2), row(4)]
  assert.deepEqual(selectedRows([4, 6, 2], shown).map((r) => r._row), [6, 2, 4])
})

test('a destructive request carries the address AND the proof', () => {
  // A row number says where to write; the fingerprint says that what is
  // there is still what was read. See lib/rowFingerprint.js.
  assert.deepEqual(rowRefs([row(2), row(3)]), [
    { row: 2, fp: 'fp2' },
    { row: 3, fp: 'fp3' },
  ])
})

test('a row with no address is not sent', () => {
  assert.deepEqual(rowRefs([{ Model: 'x' }, row(2)]), [{ row: 2, fp: 'fp2' }])
})

// --- still wired ---------------------------------------------------------

const table = read('components/widgets/TableWidget.jsx')

test('the table prunes its selection whenever what is on screen changes', () => {
  assert.match(table, /setSelection\(\(current\) => pruneSelection\(current, sorted\)\)/)
  assert.match(table, /\}, \[sorted\]\)/)
})

test('the header tick shows its third state', () => {
  assert.match(table, /el\.indeterminate = headerState\(selection, sorted\) === 'mixed'/)
})

test('select-all takes the filtered set rather than the page', () => {
  // `sorted` is everything the filters and the search have left; `pageRows`
  // is the twenty-five being looked at. Ticking the header and deleting
  // should not quietly stop at the bottom of the page.
  assert.match(table, /toggleAll\(current, sorted\)/)
  assert.equal(/toggleAll\(current, pageRows\)/.test(table), false)
})

test('ticking a row does not also open its detail panel', () => {
  // Selecting four rows would otherwise open and close four panels on the
  // way.
  assert.match(table, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
})

test('the actions sit above the grid, in their own band', () => {
  // Under the table they were a scroll away from the rows they act on, and
  // a bar hanging over the bottom edge covered the last row -- the one
  // somebody is most likely to have just ticked, hidden behind the thing
  // about to delete it.
  const bar = table.indexOf('<RowActionsBar')
  const grid = table.indexOf('<table className=')
  const paging = table.indexOf('Showing {pageRows.length}')
  assert.ok(bar > -1 && grid > -1, 'both must be there')
  assert.ok(bar < grid, 'the actions must come before the grid')
  assert.ok(grid < paging, '...and the paging row after it')
})

test('it reads as a control band, not as a floating footer', () => {
  // Same button shape and sizing as the page's own control bar, so what can
  // be DONE to the rows sits in the same visual family as what narrows
  // them. And it pushes the grid down rather than covering it.
  const actions = read('components/RowActionsBar.jsx')
  assert.match(actions, /rounded-lg border px-3 py-1\.5 text-sm font-semibold/)
  assert.equal(/sticky bottom-0/.test(actions), false)
})

test('the checkbox column is counted in the empty-state colspan', () => {
  assert.match(table, /\(selectable \? 1 : 0\)/)
})

test('shift-click reaches the range selector', () => {
  assert.match(table, /tickRow\(row, e\.nativeEvent\.shiftKey\)/)
  assert.match(table, /selectRange\(current, sorted, anchorRow, row\)/)
})
