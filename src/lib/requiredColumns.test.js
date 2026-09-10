import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  REQUIRED_COLUMNS,
  emptiedRequired,
  isRequired,
  keptNote,
  missingNote,
  missingRequired,
  requiredColumnsOf,
  requiresAnything,
  withoutEmptied,
} from './requiredColumns.js'
import { clearReport } from './clearRules.js'

const widget = (extra = {}) => ({
  type: 'table',
  tab: 'MASTER',
  editable: true,
  [REQUIRED_COLUMNS]: ['Salesman', 'Status'],
  ...extra,
})

const ROW = {
  _row: 12,
  Salesman: 'Ravi',
  Status: 'In Progress',
  Finance: 'HDFC',
  Remark: '',
}

const COLUMNS = ['Salesman', 'Status', 'Finance', 'Remark']
const GRANTED = ['Salesman', 'Status', 'Finance', 'Remark']

// ---------------------------------------------------------------------
// Who it binds, and who it must never trap
// ---------------------------------------------------------------------

test('a column an admin marked is required of somebody who can edit it', () => {
  assert.deepEqual(requiredColumnsOf(widget()), ['Salesman', 'Status'])
  assert.equal(isRequired(widget(), 'Salesman', GRANTED), true)
  assert.equal(isRequired(widget(), 'Finance', GRANTED), false, 'not marked')
})

test('it binds nobody who cannot fill it in', () => {
  // A column required of everyone but granted to three people would stop
  // the other forty saving anything at all, on a field they are not
  // allowed to touch.
  assert.equal(isRequired(widget(), 'Salesman', ['Finance']), false)
  assert.equal(isRequired(widget(), 'Salesman', []), false)
})

test('a table nobody can edit requires nothing', () => {
  assert.equal(isRequired(widget({ editable: false }), 'Salesman', GRANTED), false)
  assert.equal(requiresAnything(widget({ editable: false }), GRANTED), false)
})

test('a table is asked once whether anything is required of this reader', () => {
  assert.equal(requiresAnything(widget(), GRANTED), true)
  assert.equal(requiresAnything(widget(), ['Finance']), false)
  assert.equal(requiresAnything(widget({ [REQUIRED_COLUMNS]: [] }), GRANTED), false)
})

// ---------------------------------------------------------------------
// What a form is missing
// ---------------------------------------------------------------------

test('a blank required field is what holds a save back', () => {
  const row = { ...ROW, Salesman: '' }
  assert.deepEqual(missingRequired(widget(), row, { columns: COLUMNS, editable: GRANTED }), ['Salesman'])
})

test('whitespace is not a value', () => {
  const row = { ...ROW, Salesman: '   ' }
  assert.deepEqual(missingRequired(widget(), row, { columns: COLUMNS, editable: GRANTED }), ['Salesman'])
})

test('a full record is missing nothing', () => {
  assert.deepEqual(missingRequired(widget(), ROW, { columns: COLUMNS, editable: GRANTED }), [])
})

test('a field the form does not show cannot hold the form back', () => {
  // An admin who shortens the detail form does not mean to lock it: a Save
  // that refuses because of a field nobody can see is a Save that refuses
  // for no visible reason.
  const row = { ...ROW, Salesman: '' }
  assert.deepEqual(missingRequired(widget(), row, { columns: ['Status', 'Finance'], editable: GRANTED }), [])
})

test('a field this reader cannot edit cannot hold their form back', () => {
  const row = { ...ROW, Salesman: '' }
  assert.deepEqual(missingRequired(widget(), row, { columns: COLUMNS, editable: ['Finance'] }), [])
})

test('nothing open is nothing missing', () => {
  assert.deepEqual(missingRequired(widget(), null, { columns: COLUMNS, editable: GRANTED }), [])
})

// ---------------------------------------------------------------------
// Emptying, which is the only thing it ever refuses
// ---------------------------------------------------------------------

test('taking the value out of a required field is refused', () => {
  assert.deepEqual(emptiedRequired(widget(), ROW, { Salesman: '' }, GRANTED), ['Salesman'])
  assert.deepEqual(emptiedRequired(widget(), ROW, { Salesman: '  ' }, GRANTED), ['Salesman'])
})

test('filling one in is always allowed', () => {
  const row = { ...ROW, Salesman: '' }
  assert.deepEqual(emptiedRequired(widget(), row, { Salesman: 'Asha' }, GRANTED), [])
})

test('changing one to another value is allowed', () => {
  assert.deepEqual(emptiedRequired(widget(), ROW, { Salesman: 'Asha' }, GRANTED), [])
})

test('a field that was already blank is not being emptied by this edit', () => {
  // Otherwise an old record with a gap in it could never be corrected one
  // field at a time -- every save would be refused because of a blank the
  // person was not touching.
  const row = { ...ROW, Salesman: '' }
  assert.deepEqual(emptiedRequired(widget(), row, { Salesman: '', Finance: 'Axis' }, GRANTED), [])
})

test('emptying a field that is not required is nobody’s business', () => {
  assert.deepEqual(emptiedRequired(widget(), ROW, { Finance: '' }, GRANTED), [])
})

test('the refused change is dropped, and the rest of the save goes through', () => {
  const changes = { Salesman: '', Finance: 'Axis', Remark: 'called' }
  const emptied = emptiedRequired(widget(), ROW, changes, GRANTED)
  assert.deepEqual(withoutEmptied(changes, emptied), { Finance: 'Axis', Remark: 'called' })
  assert.deepEqual(withoutEmptied(changes, []), changes, 'and nothing is copied when nothing was refused')
})

// ---------------------------------------------------------------------
// Where it meets the other rule an admin can write
// ---------------------------------------------------------------------

test('required beats a clearing rule, and the reader is told which won', () => {
  // The one place the two rules disagree: this one says the field no
  // longer applies, and the other says it can never be empty.
  const rules = [
    {
      id: 'r1',
      column: 'Status',
      operator: 'equals',
      value: 'Cancelled',
      clear: ['Salesman', 'Finance'],
    },
  ]
  const { clear, kept } = clearReport(widget({ clearRules: rules }), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(clear, ['Finance'])
  assert.deepEqual(kept, ['Salesman'])
})

test('a required field that was already empty is not reported as kept', () => {
  const rules = [
    { id: 'r1', column: 'Status', operator: 'equals', value: 'Cancelled', clear: ['Salesman'] },
  ]
  const row = { ...ROW, Salesman: '' }
  const { clear, kept } = clearReport(widget({ clearRules: rules }), row, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(clear, [])
  assert.deepEqual(kept, [], 'nothing was held back, because nothing was there')
})

test('a table with no required columns clears exactly as it did', () => {
  const rules = [
    { id: 'r1', column: 'Status', operator: 'equals', value: 'Cancelled', clear: ['Salesman', 'Finance'] },
  ]
  const { clear, kept } = clearReport(widget({ clearRules: rules, [REQUIRED_COLUMNS]: [] }), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(clear, ['Salesman', 'Finance'])
  assert.deepEqual(kept, [])
})

// ---------------------------------------------------------------------
// Saying it
// ---------------------------------------------------------------------

test('the bar names what is missing', () => {
  assert.equal(missingNote(['Salesman']), 'Salesman is required')
  assert.equal(missingNote(['Salesman', 'Status']), 'Salesman and Status are required')
  assert.equal(missingNote(['A', 'B', 'C']), 'A, B and C are required')
  assert.equal(missingNote([]), '')
})

test('and what was held back', () => {
  assert.equal(keptNote(['Salesman']), 'Salesman was kept — it cannot be left empty')
  assert.equal(
    keptNote(['Salesman', 'Status']),
    'Salesman and Status were kept — they cannot be left empty'
  )
  assert.equal(keptNote([]), '')
})

// ---------------------------------------------------------------------
// Wiring: one refusal, at the one place every write is planned
// ---------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const TABLE = read('src/components/widgets/TableWidget.jsx')
const PANEL = read('src/components/RowDetailPanel.jsx')
const ADMIN = read('src/pages/admin/WidgetsPanel.jsx')

test('every write is refused in one place, not three', () => {
  // A cell, a form and a drag all plan through here. Enforced at each of
  // the three instead, it would hold until somebody used the one that had
  // been missed.
  const start = TABLE.indexOf('function editPlan(row, changes)')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /const emptied = emptiedRequired\(widget, row, changes, editableColumns\)/)
  assert.match(body, /const allowed = withoutEmptied\(changes, emptied\)/)
  assert.match(body, /changes: wanted/, 'the rule sees what will really be written')
  assert.match(body, /kept: \[\.\.\.new Set\(\[\.\.\.emptied, \.\.\.kept\]\)\]/, 'both ways it survived')
})

test('a drag that would blank a whole required column writes nothing, and says so', () => {
  const start = TABLE.indexOf('async function commitFill(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(
    body,
    /if \(batches\.length === 0\) \{\s*say\(null, \[\], \[\], \[\.\.\.held\], \[\.\.\.refused\.values\(\)\]\)\s*return/
  )
})

test('the form marks the fields, and will not save while one is empty', () => {
  assert.match(PANEL, /const needed = isRequired\(widget, col, editableColumns\)/)
  assert.match(PANEL, /needed && \(/, 'the asterisk is on the field, not only in the bar')
  assert.match(PANEL, /blank \|\| wrong\s*\n\s*\? 'bg-rose-50/, 'and an empty one is coloured, not just marked')
  assert.match(PANEL, /if \(pendingCount === 0 \|\| missing\.length > 0 \|\| bad\.length > 0\) return/)
  assert.match(PANEL, /missing\.length > 0 \? missingNote\(missing\) : invalidNote\(bad\)/, 'and says which')
})

test('the form judges the row as it WILL be, not as the sheet has it', () => {
  // Filling a required field in is the whole point; a check against the
  // sheet would still be complaining while the value sat on screen.
  assert.match(PANEL, /missingRequired\(\s*widget,\s*\{ \.\.\.row, \.\.\.form \},/)
})

test('Clear does not take out what has to stay in', () => {
  // Blank it and let Save refuse, and one press becomes a form nobody can
  // save until they have retyped a value they never meant to lose.
  assert.match(PANEL, /clearedDraft\(row, columns, editableColumns, requiredColumnsOf\(widget\)\)/)
})

test('an admin can pick the columns, next to the switch that makes it mean anything', () => {
  assert.match(ADMIN, /\[REQUIRED_COLUMNS\]: on \? current\.filter\(\(c\) => c !== col\) : \[\.\.\.current, col\]/)
  const at = ADMIN.indexOf('Required <span className="font-normal text-slate-400">(cannot be left empty)</span>')
  assert.ok(at >= 0, 'the grid is still there')
  assert.match(ADMIN.slice(at - 400, at), /part === 'rows' && widget\.editable/)
})
