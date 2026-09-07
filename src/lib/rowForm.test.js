import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  NO_DRAFT,
  changeCount,
  changedFields,
  clearedDraft,
  draftField,
  fieldValue,
  hasChanges,
  unsavedNote,
} from './rowForm.js'

const ROW = {
  _row: 12,
  Status: 'In Progress',
  'Delivery Date': '20/03/2026',
  Finance: 'HDFC',
  Chassis: 'MD2A11CZ',
  Remark: '',
}

const COLUMNS = ['Status', 'Delivery Date', 'Finance', 'Chassis', 'Remark']
const EDITABLE = ['Status', 'Delivery Date', 'Finance', 'Remark']

// ---------------------------------------------------------------------
// What a field shows
// ---------------------------------------------------------------------

test('an untouched field shows the sheet', () => {
  assert.equal(fieldValue(ROW, NO_DRAFT, 'Status'), 'In Progress')
  assert.equal(fieldValue(ROW, NO_DRAFT, 'Nothing'), '', 'a column the row has not got is blank, not undefined')
})

test('a touched field shows what was typed, not what the sheet says', () => {
  // Reading the row directly would mean a field went back to its old value
  // the moment it lost focus, and stayed there until Save.
  const draft = draftField(NO_DRAFT, 'Status', 'Cancelled')
  assert.equal(fieldValue(ROW, draft, 'Status'), 'Cancelled')
  assert.equal(fieldValue(ROW, draft, 'Finance'), 'HDFC', 'and the rest still come from the sheet')
})

test('a field emptied on purpose stays empty', () => {
  // The falsy trap: '' is a value somebody chose, not an absence.
  const draft = draftField(NO_DRAFT, 'Finance', '')
  assert.equal(fieldValue(ROW, draft, 'Finance'), '')
})

test('the row can keep moving underneath the draft', () => {
  // It is re-read live from the sheet, and somebody else's edit to a field
  // this person has not touched should still show.
  const draft = draftField(NO_DRAFT, 'Status', 'Cancelled')
  const moved = { ...ROW, Finance: 'Axis' }
  assert.equal(fieldValue(moved, draft, 'Finance'), 'Axis')
  assert.equal(fieldValue(moved, draft, 'Status'), 'Cancelled', 'but not over what is being typed')
})

// ---------------------------------------------------------------------
// What is waiting to be saved
// ---------------------------------------------------------------------

test('only the fields that actually moved are saved', () => {
  const draft = { Status: 'Cancelled', Finance: 'HDFC' }
  assert.deepEqual(changedFields(ROW, draft), { Status: 'Cancelled' })
  assert.equal(changeCount(ROW, draft), 1, 'a field typed back to what it was is not a change')
})

test('emptying a field that had something in it is a change', () => {
  assert.deepEqual(changedFields(ROW, { Finance: '' }), { Finance: '' })
})

test('emptying a field that was already empty is not', () => {
  // Otherwise the unsaved count claims work that does not exist, and Save
  // writes a blank over a blank.
  assert.deepEqual(changedFields(ROW, { Remark: '' }), {})
  assert.equal(hasChanges(ROW, { Remark: '' }), false)
})

test('a field someone else has already saved the same value into is not written again', () => {
  const draft = draftField(NO_DRAFT, 'Status', 'Cancelled')
  assert.equal(changeCount({ ...ROW, Status: 'Cancelled' }, draft), 0)
})

test('nothing typed is nothing to save', () => {
  assert.deepEqual(changedFields(ROW, NO_DRAFT), {})
  assert.deepEqual(changedFields(ROW, null), {})
  assert.equal(hasChanges(ROW, NO_DRAFT), false)
})

test('typing twice in one field leaves the second value', () => {
  let draft = draftField(NO_DRAFT, 'Status', 'Cancelled')
  draft = draftField(draft, 'Status', 'Delivered')
  assert.deepEqual(changedFields(ROW, draft), { Status: 'Delivered' })
})

test('the draft is replaced, never mutated', () => {
  // The panel compares drafts across renders; changing one in place would
  // mean the before and the after were the same object.
  const first = draftField(NO_DRAFT, 'Status', 'Cancelled')
  const second = draftField(first, 'Finance', 'Axis')
  assert.deepEqual(Object.keys(first), ['Status'])
  assert.notEqual(first, second)
})

// ---------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------

test('clear empties every field this person may edit', () => {
  assert.deepEqual(clearedDraft(ROW, COLUMNS, EDITABLE), {
    Status: '',
    'Delivery Date': '',
    Finance: '',
  })
})

test('clear leaves alone what cannot be written', () => {
  // The server would refuse it, and a refusal in the middle of a save
  // leaves a record nobody can explain.
  assert.equal('Chassis' in clearedDraft(ROW, COLUMNS, EDITABLE), false)
  assert.deepEqual(clearedDraft(ROW, COLUMNS, []), {})
})

test('clear leaves alone what is not on the form', () => {
  // A change nobody could see before pressing Save is not a change they
  // agreed to.
  const shown = ['Status', 'Finance']
  assert.deepEqual(clearedDraft(ROW, shown, EDITABLE), { Status: '', Finance: '' })
})

test('clear does not count fields that are already empty', () => {
  assert.equal('Remark' in clearedDraft(ROW, COLUMNS, EDITABLE), false)
  assert.equal(changeCount(ROW, clearedDraft(ROW, COLUMNS, EDITABLE)), 3)
})

test('clear on an already-empty record is a no-op, not three blank writes', () => {
  const blank = { _row: 4, Status: '', Finance: '', 'Delivery Date': '' }
  assert.deepEqual(clearedDraft(blank, COLUMNS, EDITABLE), {})
})

// ---------------------------------------------------------------------
// Saying what is unsaved
// ---------------------------------------------------------------------

test('the bar counts what is waiting', () => {
  assert.equal(unsavedNote(1), '1 unsaved change')
  assert.equal(unsavedNote(3), '3 unsaved changes')
  assert.equal(unsavedNote(0), '')
})

// ---------------------------------------------------------------------
// Wiring: the panel, and the row-wide write behind it
// ---------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const PANEL = read('src/components/RowDetailPanel.jsx')
const TABLE = read('src/components/widgets/TableWidget.jsx')

test('a field is filled in, not written', () => {
  const start = PANEL.indexOf('function commit(col, next)')
  const body = PANEL.slice(start, PANEL.indexOf('\n  }\n', start))
  assert.match(body, /setForm\(\(current\) => draftField\(current/)
  assert.equal(body.includes('onSaveRow'), false, 'nothing reaches the sheet until Save')
})

test('the form shows what has been typed, and marks it', () => {
  assert.match(PANEL, /const value = fieldValue\(row, form, col\)/)
  assert.match(PANEL, /const touched = Object\.prototype\.hasOwnProperty\.call\(form, col\)/)
  assert.match(PANEL, /edited<\/span>/, 'a form of twenty fields with three changed is a memory test')
})

test('Save sends the whole form in one go, and Clear only drafts', () => {
  assert.match(PANEL, /await onSaveRow\?\.\(row, changes\)/)
  assert.match(PANEL, /onClick=\{\(\) => setForm\(clearedDraft\(row, columns, editableColumns\)\)\}/)
  const clear = PANEL.slice(PANEL.indexOf('setForm(clearedDraft('))
  assert.equal(
    clear.slice(0, clear.indexOf('</button>')).includes('onSaveRow'),
    false,
    'Clear must not write: a mis-click is undone by closing the panel, not by retyping the record'
  )
})

test('Save is dead until there is something to save', () => {
  assert.match(PANEL, /disabled=\{pendingCount === 0 \|\| saving\}/)
})

test('there is a way back from Clear that is not retyping the record', () => {
  assert.match(PANEL, /onClick=\{\(\) => setForm\(NO_DRAFT\)\}/)
  assert.match(PANEL, /discard/)
})

test('closing with unsaved changes says so', () => {
  assert.match(PANEL, /closing loses unsaved changes/)
})

test('a read-only reader is offered neither button', () => {
  assert.match(PANEL, /\{editableColumns\.length > 0 && \(\s*<div className="flex items-center gap-2 border-t/)
})

test('the form and the grid write down the same path', () => {
  // One is the many-column case of the other, so a clearing rule cannot
  // fire in the table and not in the form.
  assert.match(TABLE, /async function writeRow\(row, changes\)/)
  assert.match(TABLE, /async function writeCell\(row, col, value\) \{\s*await writeRow\(row, \{ \[col\]: value \}\)/)
})

test('a whole form is judged as one change, not several', () => {
  // Three fields saved together have to be tested against the row as it
  // will be with all three on it, or a rule needing two of them never
  // fires -- and one clearing the date because the status changed would
  // fire on a row where the new date had been typed but not yet saved.
  const start = TABLE.indexOf('function editPlan(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /columnsToClear\(widget, row, \{\s*changes,/)
})
