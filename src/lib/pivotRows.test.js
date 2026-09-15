import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  MAX_ROW_RULES,
  ROW_RULES,
  ROW_TESTS,
  activeRowRule,
  conditionHolds,
  controlValue,
  defaultRowColumns,
  newRowCondition,
  newRowRule,
  rowColumnsFor,
  rowRulesOf,
  ruleHolds,
  ruleNote,
  ruleProblem,
  testNeedsValue,
} from './pivotRows.js'

// ---------------------------------------------------------------------
// A pivot whose rows change with the page
// ---------------------------------------------------------------------
// "Sales by branch" and "sales by salesman" are the same table with one
// column swapped. What is worth testing is not that the swap happens --
// it is everything around it: that a rule nobody finished does NOT
// fire, that a rule naming a deleted control does not start matching
// everything, and that a pivot with no rules is untouched.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const pivot = read('components/widgets/AnalyticsWidgets.jsx')
const editor = read('pages/admin/WidgetEditors.jsx')
const dashboard = read('pages/Dashboard.jsx')

const REGION = { id: 'c1', kind: 'multi', label: 'Region', column: 'Region' }
const STAGE = { id: 'c2', kind: 'select', label: 'Stage', column: 'Stage' }
const OVERDUE = { id: 'b1', kind: 'button', label: 'Overdue' }
const byId = { c1: REGION, c2: STAGE, b1: OVERDUE }

const state = (values = {}, buttons = []) => ({ values, buttons, byId })

const rule = (extra = {}) => ({
  ...newRowRule(),
  columns: ['Salesman'],
  when: [{ control: 'c1', test: 'on', value: '' }],
  ...extra,
})

const widget = (rules, columns = ['Branch']) => ({ rowColumns: columns, [ROW_RULES]: rules })

// --- nothing changes for a pivot nobody has ruled -----------------------

test('a pivot with no rules groups by exactly what it always did', () => {
  assert.deepEqual(rowColumnsFor(widget([]), state()), ['Branch'])
  assert.deepEqual(rowColumnsFor({ rowColumns: ['Branch'] }, state()), ['Branch'])
  assert.equal(activeRowRule(widget([]), state()), null)
  // The single-column shape a pivot had before multi-column support.
  assert.deepEqual(defaultRowColumns({ rowColumn: 'Branch' }), ['Branch'])
  assert.deepEqual(defaultRowColumns({}), [])
})

test('a rule that fits nothing leaves the table alone', () => {
  const w = widget([rule()])
  assert.deepEqual(rowColumnsFor(w, state()), ['Branch'], 'the control is not in use')
  assert.deepEqual(rowColumnsFor(w, state({ c1: ['West'] })), ['Salesman'])
})

// --- a half-written rule does nothing ------------------------------------

test('a rule with no conditions never fires', () => {
  // "Matches everything" is the worst reading of an empty list: it
  // would take over the table the moment the first row appeared in the
  // editor.
  assert.equal(ruleHolds({ columns: ['X'], when: [] }, state()), false)
  assert.equal(ruleHolds(newRowRule(), state()), false)
  assert.equal(ruleHolds(null, state()), false)
})

test('a rule with nothing to group by never fires either', () => {
  assert.equal(ruleHolds(rule({ columns: [] }), state({ c1: ['West'] })), false)
})

test('a condition naming a control that has gone is false, not ignored', () => {
  // Ignored would mean the rest of the rule matching on its own, which
  // is a rule quietly changing meaning when somebody deletes a filter.
  const orphan = { control: 'gone', test: 'on', value: '' }
  assert.equal(conditionHolds(orphan, state({ gone: 'x' })), false)
  assert.equal(conditionHolds({ control: '', test: 'on' }, state()), false)
  // ...and the whole rule goes with it under "all".
  const w = widget([rule({ when: [{ control: 'c1', test: 'on' }, orphan] })])
  assert.deepEqual(rowColumnsFor(w, state({ c1: ['West'] })), ['Branch'])
})

// --- the tests themselves ------------------------------------------------

test('"in use" means what it means for that kind of control', () => {
  // Chips with nothing chosen, a dropdown on "all", a button not
  // pressed -- three different shapes of "left alone".
  assert.equal(conditionHolds({ control: 'c1', test: 'on' }, state({ c1: [] })), false)
  assert.equal(conditionHolds({ control: 'c1', test: 'on' }, state({ c1: ['West'] })), true)
  assert.equal(conditionHolds({ control: 'c2', test: 'on' }, state({ c2: '__ALL__' })), false)
  assert.equal(conditionHolds({ control: 'c2', test: 'on' }, state({ c2: 'Booked' })), true)
  assert.equal(conditionHolds({ control: 'b1', test: 'on' }, state()), false)
  assert.equal(conditionHolds({ control: 'b1', test: 'on' }, state({}, ['b1'])), true)
})

test('"not in use" is the other half of it', () => {
  assert.equal(conditionHolds({ control: 'c2', test: 'off' }, state()), true)
  assert.equal(conditionHolds({ control: 'c2', test: 'off' }, state({ c2: 'Booked' })), false)
})

test('a value can be matched exactly, or excluded', () => {
  assert.equal(conditionHolds({ control: 'c2', test: 'is', value: 'Booked' }, state({ c2: 'Booked' })), true)
  assert.equal(conditionHolds({ control: 'c2', test: 'is', value: 'Booked' }, state({ c2: 'Lost' })), false)
  assert.equal(conditionHolds({ control: 'c2', test: 'not', value: 'Booked' }, state({ c2: 'Lost' })), true)
  // A number in a cell and text in the box are the same value.
  assert.equal(conditionHolds({ control: 'c2', test: 'is', value: '7' }, state({ c2: 7 })), true)
})

test('chips are asked whether they include something', () => {
  assert.equal(conditionHolds({ control: 'c1', test: 'has', value: 'West' }, state({ c1: ['West', 'East'] })), true)
  assert.equal(conditionHolds({ control: 'c1', test: 'has', value: 'North' }, state({ c1: ['West'] })), false)
  // And a single-valued control answers it the obvious way rather than
  // failing, because an admin will point this at a dropdown one day.
  assert.equal(conditionHolds({ control: 'c2', test: 'has', value: 'Booked' }, state({ c2: 'Booked' })), true)
})

test('a pressed button is a value, wherever "pressed" is kept', () => {
  // It has none of its own: on lives in a list of active ids somewhere
  // else entirely, and a rule must be able to say "while Overdue is
  // pressed" in the same breath as "while Region is West".
  assert.equal(controlValue('b1', { buttons: ['b1'] }), true)
  assert.equal(controlValue('b1', { buttons: [] }), undefined)
  assert.equal(controlValue('c2', { values: { c2: 'Booked' } }), 'Booked')
  assert.equal(controlValue('', {}), undefined)
})

// --- which rule wins -----------------------------------------------------

test('the first rule that fits wins, in the admin order', () => {
  const first = rule({ id: 'a', columns: ['Salesman'], when: [{ control: 'c1', test: 'on' }] })
  const second = rule({ id: 'b', columns: ['Model'], when: [{ control: 'c2', test: 'on' }] })
  const w = widget([first, second])
  assert.deepEqual(rowColumnsFor(w, state({ c1: ['West'], c2: 'Booked' })), ['Salesman'])
  assert.deepEqual(rowColumnsFor(w, state({ c2: 'Booked' })), ['Model'])
  assert.equal(activeRowRule(w, state({ c2: 'Booked' })).id, 'b')
})

test('all of these, or any of these', () => {
  const both = [{ control: 'c1', test: 'on' }, { control: 'c2', test: 'on' }]
  assert.equal(ruleHolds(rule({ match: 'all', when: both }), state({ c1: ['West'] })), false)
  assert.equal(ruleHolds(rule({ match: 'any', when: both }), state({ c1: ['West'] })), true)
  assert.equal(ruleHolds(rule({ match: 'all', when: both }), state({ c1: ['West'], c2: 'Booked' })), true)
})

// --- what a stored document may say --------------------------------------

test('a stored list is repaired rather than trusted', () => {
  const stored = rowRulesOf({
    [ROW_RULES]: [
      { id: 'a', columns: ['X', '', null], match: 'nonsense', when: [{ control: 'c1', test: 'wat' }] },
      null,
      'rubbish',
      { id: 'b', when: 'not a list' },
    ],
  })
  assert.equal(stored.length, 2)
  assert.deepEqual(stored[0].columns, ['X'])
  assert.equal(stored[0].match, 'all', 'an unknown match is the safe one')
  assert.equal(stored[0].when[0].test, 'on', 'an unknown test is the safe one')
  assert.deepEqual(stored[1].when, [])
  assert.deepEqual(rowRulesOf({}), [])
  assert.deepEqual(rowRulesOf(null), [])
})

test('there is a ceiling, because past it it is a program', () => {
  const many = Array.from({ length: MAX_ROW_RULES + 5 }, (_, i) => rule({ id: `r${i}` }))
  assert.equal(rowRulesOf(widget(many)).length, MAX_ROW_RULES)
})

// --- saying what is going on ---------------------------------------------

test('the card says which grouping is in force', () => {
  // A table that regroups itself silently is one somebody reads wrong:
  // the same shape, a different meaning.
  assert.equal(ruleNote(rule({ label: 'By salesman' })), 'By salesman')
  assert.equal(ruleNote(rule({ label: '   ', columns: ['Branch', 'Salesman'] })), 'by Branch › Salesman')
  assert.equal(ruleNote(null), '')
  assert.ok(pivot.includes('{rowRule && ` · ${ruleNote(rowRule)}`}'))
})

test('the editor says why a rule cannot fire, rather than leaving it to the page', () => {
  // On the page the only symptom is a table that never changes.
  assert.match(ruleProblem({ columns: [], when: [] }, byId), /Pick what to group by/)
  assert.match(ruleProblem({ columns: ['X'], when: [] }, byId), /never fires/)
  assert.match(ruleProblem({ columns: ['X'], when: [{ control: 'gone', test: 'on' }] }, byId), /no longer on the page/)
  assert.match(
    ruleProblem({ columns: ['X'], when: [{ control: 'c2', test: 'is', value: '' }] }, byId),
    /needs a value/
  )
  assert.equal(ruleProblem({ columns: ['X'], when: [{ control: 'c1', test: 'on' }] }, byId), '')
})

test('every test says whether it needs a value to compare with', () => {
  for (const t of ROW_TESTS) {
    assert.ok(t.label, t.value)
    assert.ok(t.hint, t.value)
    assert.equal(typeof t.needsValue, 'boolean', t.value)
  }
  assert.equal(testNeedsValue('is'), true)
  assert.equal(testNeedsValue('on'), false)
  assert.equal(testNeedsValue('nonsense'), false)
  assert.deepEqual(newRowCondition(), { control: '', test: 'on', value: '' })
})

// --- and how it is wired -------------------------------------------------

test('the widget asks the model, and falls back where there is no state', () => {
  assert.ok(pivot.includes('controlState ? activeRowRule(widget, controlState) : null'))
  assert.ok(pivot.includes('const rowCols = rowRule ? rowRule.columns : defaultRowColumns(widget)'))
})

test('the page hands over every control, its own and the widget’s', () => {
  // The two never share an id, so a rule can name either without the
  // admin having to remember which panel they put the control in.
  assert.ok(dashboard.includes('values: { ...effectiveValues, ...(myValues || {}) }'))
  assert.ok(dashboard.includes('buttons: effectiveButtonIds'))
  assert.ok(dashboard.includes('byId: controlsById'))
  assert.ok(dashboard.includes('const pageControlsById = useMemo('))
})

test('the admin writes the rules, and the reader never picks a column', () => {
  // A dashboard that grows a pivot builder has stopped being a
  // dashboard: what the reader works is the controls already there.
  assert.ok(editor.includes('function RowRulesEditor('))
  assert.ok(editor.includes(`set({ [ROW_RULES]: next })`))
  assert.ok(editor.includes('options={ROW_TESTS}'))
  assert.ok(editor.includes('{testNeedsValue(condition.test) && ('))
  // The tab counts them, so a rule is visible without opening it.
  assert.ok(editor.includes('rowColumns.length + colColumns.length + rowRulesOf(widget).length'))
  // Nothing in the widget itself lets a reader choose columns.
  assert.equal(pivot.includes('onChange={(v) => set({ rowColumns'), false)
})
