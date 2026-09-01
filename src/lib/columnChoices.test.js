import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_OPTIONS,
  blankChoice,
  buildChoices,
  choiceIsComplete,
  choiceMap,
  choiceProblem,
  choicesOf,
  isStrayValue,
  optionsForCell,
  optionsFrom,
} from './columnChoices.js'

const SALESMEN = [
  { Name: 'Ravi Kumar', Branch: 'Nashik' },
  { Name: 'Asha Patil', Branch: 'Pune' },
  { Name: 'Ravi Kumar', Branch: 'Nashik' },
  { Name: '  ', Branch: '' },
]

const widget = (extra = {}) => ({
  type: 'table',
  tab: 'MASTER',
  editable: true,
  columnChoices: [{ id: 'c1', column: 'Salesman', tab: 'STAFF', valueColumn: 'Name' }],
  ...extra,
})

// ---------------------------------------------------------------------
// Where the list comes from
// ---------------------------------------------------------------------

test('the values are read from another tab, live', () => {
  // Typing the salesmen into the widget editor would mean maintaining the
  // same list in two places. Add a name to the sheet and it is in the
  // dropdown, with nobody touching the dashboard.
  const out = buildChoices(widget(), { STAFF: SALESMEN })
  assert.deepEqual(out.Salesman, ['Asha Patil', 'Ravi Kumar'])
})

test('the same name twice in the source is one option', () => {
  assert.deepEqual(optionsFrom(SALESMEN, 'Name'), ['Asha Patil', 'Ravi Kumar'])
})

test('and two spellings of one thing are one option, the first spelling', () => {
  // A source tab holding both "Nashik" and "nashik " is one place, and
  // offering both is offering somebody the chance to split the data again.
  const rows = [{ B: 'Nashik' }, { B: 'nashik ' }, { B: 'NASHIK' }]
  assert.deepEqual(optionsFrom(rows, 'B'), ['Nashik'])
})

test('blanks are not an option', () => {
  // The empty option is offered separately, and always.
  assert.deepEqual(optionsFrom([{ B: '' }, { B: '   ' }, { B: 'x' }], 'B'), ['x'])
})

test('the list is sorted the way people read one', () => {
  const rows = [{ B: 'Item 10' }, { B: 'Item 2' }, { B: 'apple' }, { B: 'Banana' }]
  assert.deepEqual(optionsFrom(rows, 'B'), ['apple', 'Banana', 'Item 2', 'Item 10'])
})

test('a column of fifty thousand values does not become a dropdown of them', () => {
  const rows = Array.from({ length: MAX_OPTIONS + 200 }, (_, i) => ({ B: `v${i}` }))
  assert.equal(optionsFrom(rows, 'B').length, MAX_OPTIONS)
})

test('a missing tab is an empty list, not a crash', () => {
  assert.deepEqual(buildChoices(widget(), {}).Salesman, [])
  assert.deepEqual(buildChoices(widget(), null).Salesman, [])
  assert.deepEqual(optionsFrom(null, 'Name'), [])
  assert.deepEqual(optionsFrom(SALESMEN, ''), [])
})

// ---------------------------------------------------------------------
// Which columns have one
// ---------------------------------------------------------------------

test('a half-filled-in choice is not a dropdown', () => {
  // It would render a select with nothing in it, over a cell that used to
  // be editable.
  assert.equal(choiceIsComplete({ column: 'A', tab: 'T', valueColumn: 'B' }), true)
  assert.equal(choiceIsComplete({ column: 'A', tab: 'T' }), false)
  assert.equal(choiceIsComplete({ column: 'A', valueColumn: 'B' }), false)
  assert.equal(choiceIsComplete({ tab: 'T', valueColumn: 'B' }), false)
  assert.equal(choiceIsComplete(undefined), false)
})

test('and is left out of the map entirely', () => {
  const w = widget({ columnChoices: [{ column: 'A', tab: '' }, { column: 'B', tab: 'T', valueColumn: 'C' }] })
  assert.deepEqual(Object.keys(choiceMap(w)), ['B'])
})

test('a column configured twice behaves as the one edited last', () => {
  const w = widget({
    columnChoices: [
      { column: 'A', tab: 'T1', valueColumn: 'X' },
      { column: 'A', tab: 'T2', valueColumn: 'Y' },
    ],
  })
  assert.equal(choiceMap(w).A.tab, 'T2')
})

test('a table with none of this configured has none', () => {
  assert.deepEqual(choicesOf({}), [])
  assert.deepEqual(choicesOf({ columnChoices: 'nonsense' }), [])
  assert.deepEqual(buildChoices({}, { STAFF: SALESMEN }), {})
})

// ---------------------------------------------------------------------
// The cell's own value
// ---------------------------------------------------------------------

test('a cell holding something the list has lost keeps it', () => {
  // The salesman who left is still who sold it. A dropdown that cannot
  // represent its own cell blanks the cell the moment somebody opens it.
  const options = ['Asha Patil', 'Ravi Kumar']
  assert.deepEqual(optionsForCell(options, 'Gone Person'), ['Gone Person', 'Asha Patil', 'Ravi Kumar'])
})

test('and it is offered first, where it cannot be missed', () => {
  // Sorted into the middle, nobody would notice the current value is not
  // one of the offered ones.
  assert.equal(optionsForCell(['b', 'c'], 'a')[0], 'a')
  assert.equal(optionsForCell(['a', 'c'], 'b')[0], 'b')
})

test('a value already in the list is not offered twice', () => {
  assert.deepEqual(optionsForCell(['a', 'b'], 'a'), ['a', 'b'])
  assert.deepEqual(optionsForCell(['Nashik'], 'nashik'), ['Nashik'], 'and not on a case difference')
})

test('an empty cell adds nothing to the list', () => {
  assert.deepEqual(optionsForCell(['a'], ''), ['a'])
  assert.deepEqual(optionsForCell(['a'], null), ['a'])
  assert.deepEqual(optionsForCell(null, 'x'), ['x'])
})

test('a stray value is one the list does not have', () => {
  assert.equal(isStrayValue(['a', 'b'], 'c'), true)
  assert.equal(isStrayValue(['a', 'b'], 'a'), false)
  assert.equal(isStrayValue(['Nashik'], 'nashik '), false, 'a case or spacing difference is not stray')
  assert.equal(isStrayValue(['a'], ''), false, 'and an empty cell is not stray, it is empty')
  assert.equal(isStrayValue(null, 'x'), true)
})

// ---------------------------------------------------------------------
// Setting one up
// ---------------------------------------------------------------------

test('a new one starts empty, and says what is missing', () => {
  assert.deepEqual(blankChoice(), { column: '', tab: '', valueColumn: '' })
  assert.ok(choiceProblem(blankChoice()).includes('column'))
})

test('each missing piece is named, one at a time', () => {
  // "Invalid" tells an admin nothing about what to do next.
  assert.ok(choiceProblem({ column: 'A' }).toLowerCase().includes('tab'))
  assert.ok(choiceProblem({ column: 'A', tab: 'T' }).toLowerCase().includes('values from'))
  assert.equal(choiceProblem({ column: 'A', tab: 'T', valueColumn: 'B' }), '')
})

test('a column that is not on this table is caught here', () => {
  // Renaming a column in the sheet leaves the choice pointing at nothing,
  // and the table would simply stop offering a dropdown with no explanation.
  assert.ok(choiceProblem({ column: 'Gone', tab: 'T', valueColumn: 'B' }, ['A', 'B']).includes('Gone'))
  assert.equal(choiceProblem({ column: 'A', tab: 'T', valueColumn: 'B' }, ['A', 'B'], ['B']), '')
})

test('...and so is a source column that is not on that tab', () => {
  const problem = choiceProblem({ column: 'A', tab: 'T', valueColumn: 'Gone' }, ['A'], ['B', 'C'])
  assert.ok(problem.includes('Gone'))
  assert.ok(problem.includes('that tab'))
})

test('nothing known about the columns yet is not an error', () => {
  // The headers arrive after the first render; complaining before they do
  // would show a red line on a choice that is perfectly fine.
  assert.equal(choiceProblem({ column: 'A', tab: 'T', valueColumn: 'B' }, [], []), '')
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const table = read('src/components/widgets/TableWidget.jsx')
const dashboard = read('src/pages/Dashboard.jsx')
const panel = read('src/pages/admin/WidgetsPanel.jsx')
const lib = read('src/lib/columnChoices.js')

test('the source tab is stored under `tab`, so refs are rewritten for free', () => {
  // Dashboard rewrites every `tab` field from a ref to a display label
  // before the widgets see it. Named anything else, this one lookup would
  // silently fail on a page with two sources.
  assert.ok(lib.includes("tab: ''"))
  assert.ok(dashboard.includes('columnChoices={buildChoices(widget, rowsByLabel)}'))
})

test('the lists are built where every tab is, not inside the table', () => {
  // The options live in a DIFFERENT tab; the widget only has its own rows.
  assert.ok(dashboard.includes("import { buildChoices } from '../lib/columnChoices'"))
  assert.ok(!table.includes('buildChoices'))
})

test('a dropdown is only drawn where the column is editable', () => {
  // A dropdown on a read-only column is a control that cannot do anything,
  // which is worse than no control.
  assert.ok(table.includes('const choices = editable ? columnChoices[col] : null'))
  assert.ok(table.includes('{isEditing && choices ? ('))
})

test('a chosen value is saved without waiting for a re-render', () => {
  // A `<select>` changes and blurs in the same breath. Reading the value
  // back off `draft` would save the value BEFORE the one just picked.
  assert.ok(table.includes('onChange={(e) => commitEdit(row, col, e.target.value)}'))
  assert.ok(table.includes('const value = next === undefined ? draft : next'))
})

test('a cell can still be emptied', () => {
  // A dropdown with no empty option is a cell that can never be cleared
  // once it is set.
  const select = table.slice(table.indexOf('{isEditing && choices ? ('), table.indexOf(') : isEditing ? ('))
  assert.ok(select.includes('<option value="">—</option>'))
})

test('a stray value is shown as one, not quietly corrected', () => {
  assert.ok(table.includes('isStrayValue(choices, value)'))
})

test('the admin editor is a section of the table, with a count', () => {
  assert.ok(panel.includes("key: 'choices'"))
  assert.ok(panel.includes('badge: (widget.columnChoices || []).length'))
  assert.ok(panel.includes("{part === 'choices' && <ChoiceEditor widget={widget} set={set} cols={cols} />}"))
})

test('picking a tab clears the column that belonged to the old one', () => {
  // Otherwise the choice keeps a column name from the previous tab and
  // reads as configured while offering nothing.
  assert.ok(panel.includes("ops.update(choice.id, { tab: v, valueColumn: '' })"))
})

test('an admin is told when the dropdowns cannot appear at all', () => {
  // Inline editing off means every one of these is dead config.
  assert.ok(panel.includes('const editableOn = widget.editable'))
  assert.ok(panel.includes('{!editableOn && ('))
  assert.ok(panel.includes('Inline editing is off for this table'))
})

test('each choice carries an id, because the list is keyed by one', () => {
  // `listOps` updates and removes by id; two dropdowns on the same column
  // would otherwise edit each other.
  assert.ok(panel.includes("ops.add({ ...blankChoice(''), id: uid('cc') })"))
  assert.ok(panel.includes('ops.remove(choice.id)'))
  // Each of the three fields, not just "an update by id somewhere": one
  // reverting to an index would be covered by its two neighbours.
  for (const field of ['{ column: v }', "{ tab: v, valueColumn: '' }", '{ valueColumn: v }']) {
    assert.ok(panel.includes(`ops.update(choice.id, ${field})`), field)
  }
})
