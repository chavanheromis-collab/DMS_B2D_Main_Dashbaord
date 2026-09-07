import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { badgeColor, badgeStyle } from './dataUtils.js'
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

// --- the form obeys the same rules as the table --------------------------

test('the detail form offers the list the cells offer', () => {
  // A form beside a table that asks for the status as free text, while the
  // table two inches away offers a menu of five, is two rules for one
  // column -- and the typed one is what produces "Deliverd" in the chart.
  const panel = read('src/components/RowDetailPanel.jsx')
  // The branch, not just the call inside it: a list built in a branch
  // nothing reaches is a list nobody sees.
  assert.ok(panel.includes('{choices ? ('), 'the form takes free text where the table does not')
  assert.ok(panel.includes('optionsForCell(choices, value)'), 'the list is not the column’s')
  assert.ok(panel.includes('<option value="">—</option>'), 'a field that can never be emptied once it is set')
  assert.ok(panel.includes('isStrayValue(choices, value)'), 'a value not on the list passes without a word')

  // Through the SAME helpers, not a second opinion about what a column may
  // contain.
  assert.ok(panel.includes("from '../lib/columnChoices'"))
})

test('...and only where the field can be edited at all', () => {
  // A list of choices on a read-only field is a promise the panel cannot
  // keep.
  const panel = read('src/components/RowDetailPanel.jsx')
  assert.ok(panel.includes('const choices = canEdit ? columnChoices[col] : null'))
})

test('a choice is saved as the choice, not as whatever was there before', () => {
  // Reading it back off `draft` would race the state update: the field
  // would save the value BEFORE the one just picked. The same reason the
  // table's own cells pass it in.
  const panel = read('src/components/RowDetailPanel.jsx')
  assert.ok(panel.includes('commit(col, e.target.value)'))
  assert.ok(panel.includes('draftField(current, col, next === undefined ? draft : next)'))
})

test('the form has a way to open the row’s remarks', () => {
  const panel = read('src/components/RowDetailPanel.jsx')
  assert.ok(panel.includes('{onOpenNotes && ('), 'the button is never drawn')
  assert.ok(
    panel.includes('onOpenNotes(e.currentTarget.getBoundingClientRect())'),
    'it opens without saying where, and the popover lands in a corner'
  )
  // And says whether there are any, or it is a button with no news.
  assert.ok(panel.includes('{noteCount > 0 && <span'), 'the count is never shown')
})

test('the table hands the form its own lists and its own remarks', () => {
  const table = read('src/components/widgets/TableWidget.jsx')
  const at = table.indexOf('<RowDetailPanel')
  assert.ok(at >= 0, 'the table no longer opens the form')
  const call = table.slice(at, table.indexOf('/>', at))
  assert.ok(call.includes('columnChoices={columnChoices}'), 'the form works out its own lists')
  // The same popover and the same state, because a remark is on the RECORD:
  // one added from the form has to be the one the row shows.
  assert.ok(call.includes('onOpenNotes='), 'the form cannot reach the row’s remarks')
  assert.ok(call.includes('setOpenNote({ row: detailRow, rect })'), 'it opens a second, separate note')
  assert.ok(call.includes('noteCount='), 'the form does not say whether there are any')
})

// --- the menu is coloured like the thing it is choosing ------------------

test('a value is painted the same way wherever it appears', () => {
  // One helper, because a value shows up in the cell, in the row form, and
  // in the menu you pick it from -- and the whole point of a colour per
  // value is that those three agree.
  assert.deepEqual(badgeStyle('Booked'), {
    backgroundColor: badgeColor('Booked').bg,
    color: badgeColor('Booked').fg,
  })
  // Blank gets nothing: an empty cell is not a status, and a coloured pill
  // around no text is a smudge.
  assert.equal(badgeStyle(''), undefined)
  assert.equal(badgeStyle('   '), undefined)
  assert.equal(badgeStyle(null), undefined)
  // Stable, or the menu and the cell disagree on every render.
  assert.deepEqual(badgeStyle('Booked'), badgeStyle('Booked'))
  assert.notDeepEqual(badgeStyle('Booked'), badgeStyle('Delivered'))
})

test('the table colours its menu exactly where it colours its cells', () => {
  // On a column of two hundred customer names, eight rotating colours is
  // confetti. `badgeColumns` is the admin's own answer to "is this a
  // status?", and it decides both.
  const table = read('src/components/widgets/TableWidget.jsx')
  assert.ok(table.includes('style={badgeCols.includes(col) ? badgeStyle(option) : undefined}'), 'the options are plain')
  // And the closed box takes the current value's colour: that is the state
  // anybody spends their time looking at.
  assert.ok(table.includes('style={asBadge ? badgeStyle(draft) : undefined}'), 'only the open menu is coloured')
})

test('the form colours its menu by the rule the form already uses', () => {
  // It paints a SHORT value as a pill. The options follow that, rather than
  // a second idea about which values are worth a colour.
  const panel = read('src/components/RowDetailPanel.jsx')
  assert.ok(panel.includes('String(option).length <= 24 ? badgeStyle(option) : undefined'), 'the options are plain')
  assert.ok(panel.includes('style={short ? badgeStyle(draft) : undefined}'), 'only the open menu is coloured')
  // ...and the pill it already drew goes through the same helper, so the
  // two cannot drift.
  assert.ok(panel.includes('style={badgeStyle(value)}'))
  assert.ok(!panel.includes('badgeColor('), 'a second spelling of the same colour')
})
