import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { liveRow } from './openRow.js'

// Every reload rebuilds the rows from the API response, so "the same row"
// is never the same object twice. That is the whole problem.
const before = [
  { _row: 2, Status: 'In Progress', Finance: 'HDFC' },
  { _row: 3, Status: 'Delivered', Finance: 'ICICI' },
]
const after = [
  { _row: 2, Status: 'Cancelled', Finance: '' },
  { _row: 3, Status: 'Delivered', Finance: 'ICICI' },
]

test('a panel opened on a row follows that row through a save', () => {
  const opened = before[0]
  const shown = liveRow(after, opened)
  assert.equal(shown.Status, 'Cancelled', 'the form must show what the sheet now says')
  assert.equal(shown.Finance, '')
  assert.notEqual(shown, opened, 'and not the object it was opened with')
})

test('the row is found by its sheet number, not by where it sits', () => {
  // Sorting, filtering and paging all move rows about between renders.
  const reordered = [after[1], after[0]]
  assert.equal(liveRow(reordered, before[0]).Status, 'Cancelled')
})

test('a row that has left the table keeps the panel open on what it last said', () => {
  // Set a status to Cancelled on a page filtered to Active and the row is
  // gone the instant it saves. Slamming the panel shut at that moment --
  // mid-read, with no explanation -- is worse than stale values.
  const opened = before[0]
  assert.equal(liveRow([after[1]], opened), opened)
  assert.equal(liveRow([], opened), opened)
  assert.equal(liveRow(null, opened), opened)
})

test('nothing open shows nothing', () => {
  assert.equal(liveRow(after, null), null)
  assert.equal(liveRow(after, undefined), null)
})

test('a row with no sheet number is not looked up', () => {
  // Nothing addressable to match on -- and nothing writable either, since
  // an edit is addressed by that same number.
  const orphan = { Status: 'In Progress' }
  assert.equal(liveRow(after, orphan), orphan)
})

test('row 0 is a row number like any other', () => {
  // The falsy-number trap: `if (!id)` would send row 0 down the not-
  // addressable path and freeze its panel forever.
  const zero = { _row: 0, Status: 'old' }
  assert.equal(liveRow([{ _row: 0, Status: 'new' }], zero).Status, 'new')
})

// ---------------------------------------------------------------------
// Wiring: the table's three panels, and the form inside one of them
// ---------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const TABLE = read('src/components/widgets/TableWidget.jsx')
const PANEL = read('src/components/RowDetailPanel.jsx')

test('every row a panel is open on is read live, never from the click', () => {
  // The detail form is the one that was reported, but the remarks popover
  // and the downloads menu hold a row exactly the same way -- and a fix
  // applied to one of three is a bug report waiting on the other two.
  assert.match(TABLE, /const detailRow = useMemo\(\(\) => liveRow\(rows, openDetail\), \[rows, openDetail\]\)/)
  assert.match(
    TABLE,
    /const downloadMenuRow = useMemo\(\(\) => liveRow\(rows, openDownloads\), \[rows, openDownloads\]\)/
  )
  assert.match(TABLE, /row: liveRow\(rows, openNote\.row\)/)
})

test('and re-read when the rows change, which is the only moment that matters', () => {
  // `rows` missing from the dependency list is the same bug wearing a
  // memo: the lookup is right, runs once, and never runs again -- so the
  // form is live until the first save and frozen from then on.
  const memos = TABLE.match(/useMemo\(\s*\(\) =>[\s\S]*?liveRow\(rows[\s\S]*?\]\s*\)/g) || []
  assert.equal(
    memos.length,
    4,
    'the detail form, the downloads menu, the remarks popover and the file viewer'
  )
  for (const memo of memos) {
    const deps = memo.slice(memo.lastIndexOf('['))
    assert.match(deps, /\brows\b/, 'a lookup that never re-runs is a snapshot again: ' + memo)
  }
})

test('the snapshot is only ever written, never read for display', () => {
  // If the raw state leaks into the render the bug is back for whichever
  // panel reads it, and it looks fixed everywhere else.
  const body = TABLE.slice(TABLE.indexOf('export default function TableWidget'))
  for (const name of ['openDetail', 'openDownloads']) {
    const reads = body.split(name).length - 1
    assert.equal(reads, 3, `${name}: declared, set, and looked up -- nothing else`)
  }
})

test('the form stops editing when a different record is opened, not when the same one saves', () => {
  // Keyed on the object, this effect fires on every reload -- and a reload
  // is exactly what saving does, so the rest of the form would be thrown
  // away the moment the first save came back.
  assert.match(PANEL, /setForm\(NO_DRAFT\)\n\s*\}, \[row\?\._row\]\)/)
})

test('the form saves against the value the sheet has now', () => {
  // `changedFields` compares the draft with the LIVE row, so a field
  // somebody else has meanwhile saved the same value into is not written
  // again -- and one typed back to its original value is not a change.
  assert.match(PANEL, /const changes = changedFields\(row, form\)/)
  assert.match(PANEL, /await onSaveRow\?\.\(row, changes\)/)
})
