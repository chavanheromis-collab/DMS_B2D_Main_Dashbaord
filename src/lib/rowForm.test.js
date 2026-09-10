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

test('clear does not take out what has to stay in', () => {
  // Blank it and let Save refuse, and one press becomes a form nobody can
  // save until they have retyped a value they never meant to lose.
  const out = clearedDraft(ROW, COLUMNS, EDITABLE, ['Status'])
  assert.equal('Status' in out, false)
  assert.deepEqual(out, { 'Delivery Date': '', Finance: '' })
  // ...and with nothing required, it clears exactly as it did.
  assert.deepEqual(clearedDraft(ROW, COLUMNS, EDITABLE, []), {
    Status: '',
    'Delivery Date': '',
    Finance: '',
  })
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

test('an editable field is a box, ready to type in', () => {
  // Not a pencil that reveals one. The pencil was the "are you sure" for a
  // write that happened the moment the field closed; Save is the write now,
  // so the click before every field bought nothing and cost twenty-two of
  // them to correct eleven fields.
  assert.match(PANEL, /\{canEdit \? \(/, 'the box is drawn on the grant, not on a click')
  assert.equal(PANEL.includes('Pencil'), false, 'no pencil to press first')
  assert.equal(PANEL.includes('setEditing'), false, 'and no per-field open/closed state left behind')
  assert.equal(PANEL.includes('autoFocus'), false, 'nothing steals the caret when the panel opens')
})

test('a read-only field is still text, not a box that refuses', () => {
  // A disabled input on every field a reader cannot write is a form that
  // looks broken rather than one that is partly theirs.
  const start = PANEL.indexOf('{canEdit ? (')
  const body = PANEL.slice(start, PANEL.indexOf('</dd>', start))
  const readOnly = body.slice(body.indexOf(') : ('))
  assert.equal(readOnly.includes('<input'), false)
  assert.equal(readOnly.includes('<select'), false)
  assert.match(readOnly, /onClick=\{\(\) => copy\(col\)\}/, 'and can still be copied out')
})

test('each box is fed its own column, and its own drafted value', () => {
  // Everything above says the boxes are DRAWN. This says they are WIRED:
  // a box showing the sheet while the draft says otherwise looks exactly
  // like a form that ignores what you type, and one handed a neighbour's
  // column writes the right value into the wrong field.
  assert.match(PANEL, /<select\n\s*value=\{value\}/, 'the list shows the draft, not the sheet')
  assert.match(
    PANEL,
    /<FormInput\n\s*value=\{value\}\n\s*onChange=\{\(next\) => commit\(col, next\)\}/,
    'and the box writes back into the column it belongs to'
  )
})

test('a text field types at the speed of the keyboard', () => {
  // Handing every keystroke straight to the form re-renders thirty fields
  // per letter, which is where fast typing starts dropping characters.
  assert.match(PANEL, /function FormInput\(\{ value, onChange, placeholder, type = 'text'/)
  assert.match(PANEL, /useTypingBuffer\(value, onChange\)/)
  // The buffer's own value is what is rendered. Rendering the incoming one
  // instead leaves the field fighting its own echo: a letter is typed, and
  // shows up a debounce later.
  //
  // BOTH boxes: the one-line input and the long-text one are two renders of
  // the same buffer, and an assertion that either satisfies is an assertion
  // about neither.
  const boxes = PANEL.match(/value=\{text\}\n\s*onChange=\{\(e\) => onType\(e\.target\.value\)\}/g) || []
  assert.equal(boxes.length, 2, 'the single line and the long text')
  assert.equal(
    (PANEL.match(/onBlur=\{flush\}/g) || []).length,
    2,
    'and both flush on the way out — people finish by leaving'
  )
  assert.match(PANEL, /if \(e\.key === 'Enter'\) flush\(\)/)
})

test('a value the list has lost is said, without being taken away', () => {
  // The salesman who left is still who sold it, so the value stays exactly
  // as the sheet has it and the list simply notes that it is not its own.
  assert.match(PANEL, /choices && !empty && isStrayValue\(choices, value\)/)
  assert.match(PANEL, /is not one of the values this column offers/)
})

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
  assert.match(PANEL, /setForm\(clearedDraft\(row, columns, editableColumns, requiredColumnsOf\(widget\)\)\)/)
  const clear = PANEL.slice(PANEL.indexOf('setForm(clearedDraft('))
  assert.equal(
    clear.slice(0, clear.indexOf('</button>')).includes('onSaveRow'),
    false,
    'Clear must not write: a mis-click is undone by closing the panel, not by retyping the record'
  )
})

test('Save is dead until there is something to save, and while something is missing', () => {
  assert.match(PANEL, /disabled=\{pendingCount === 0 \|\| missing\.length > 0 \|\| bad\.length > 0 \|\| saving\}/)
  // ...and refuses from the handler too. A disabled button is a hint, not
  // a rule: it is one Enter key or one stale render away from firing.
  assert.match(PANEL, /if \(pendingCount === 0 \|\| missing\.length > 0 \|\| bad\.length > 0\) return/)
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
  assert.match(body, /clearReport\(widget, row, \{\s*changes: wanted,/)
})
