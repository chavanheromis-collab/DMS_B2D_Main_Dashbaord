import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyRowConditions,
  conditionCount,
  emptyRowCondition,
  hasRowConditions,
  usableConditions,
} from './rowConditions.js'

// ---------------------------------------------------------------------
// "Only the rows where..." -- on anything
// ---------------------------------------------------------------------

const ROWS = [
  { Stage: 'Pending', DSE: 'Ravi', Amount: '100' },
  { Stage: 'Done', DSE: 'Ravi', Amount: '200' },
  { Stage: 'Pending', DSE: 'Sunil', Amount: '50' },
]

const rule = (conditions, rowMatch) => ({ rowConditions: conditions, rowMatch })

test('no rule is the rows exactly as they came', () => {
  // Not a copy, not a filtered clone: the SAME array, so a widget nobody
  // has written a rule for costs nothing at all.
  assert.equal(applyRowConditions(ROWS, {}, 'MASTER'), ROWS)
  assert.equal(applyRowConditions(ROWS, undefined, 'MASTER'), ROWS)
  assert.equal(applyRowConditions(ROWS, rule([]), 'MASTER'), ROWS)
})

test('one condition narrows to the rows that match it', () => {
  const out = applyRowConditions(
    ROWS,
    rule([{ tab: 'MASTER', column: 'Stage', operator: 'equals', value: 'Pending' }]),
    'MASTER'
  )
  assert.deepEqual(out.map((r) => r.DSE), ['Ravi', 'Sunil'])
})

test('several combine as ALL by default, and as ANY when asked', () => {
  const conds = [
    { tab: 'MASTER', column: 'Stage', operator: 'equals', value: 'Pending' },
    { tab: 'MASTER', column: 'DSE', operator: 'equals', value: 'Ravi' },
  ]
  assert.equal(applyRowConditions(ROWS, rule(conds), 'MASTER').length, 1)
  assert.equal(applyRowConditions(ROWS, rule(conds, 'any'), 'MASTER').length, 3)
  assert.equal(applyRowConditions(ROWS, rule(conds, 'nonsense'), 'MASTER').length, 1, 'anything else is ALL')
})

test('a half-written condition is ignored rather than matching nothing', () => {
  // Somebody is mid-edit. Emptying their widget while they pick a column is
  // not feedback, it is a fright.
  const out = applyRowConditions(
    ROWS,
    rule([{ tab: 'MASTER', column: '', operator: 'equals', value: 'Pending' }]),
    'MASTER'
  )
  assert.equal(out.length, 3)
})

test('a condition about ANOTHER tab is dropped, not failed', () => {
  // Rows of one tab cannot answer a question about another, and treating an
  // unanswerable question as "no" would empty the widget.
  const out = applyRowConditions(
    ROWS,
    rule([{ tab: 'QUOTES', column: 'Stage', operator: 'equals', value: 'Pending' }]),
    'MASTER'
  )
  assert.equal(out.length, 3)
  assert.deepEqual(usableConditions(rule([{ tab: 'QUOTES', column: 'Stage' }]), 'MASTER'), [])
})

test('a condition with no tab at all is read on whatever tab it is given', () => {
  const out = applyRowConditions(
    ROWS,
    rule([{ column: 'Stage', operator: 'equals', value: 'Done' }]),
    'MASTER'
  )
  assert.equal(out.length, 1)
})

test('the count is what a section button needs, and skips the half-written', () => {
  assert.equal(conditionCount({}), 0)
  assert.equal(conditionCount(rule([{ column: 'Stage' }, { column: '' }])), 1)
  assert.equal(hasRowConditions(rule([{ column: '' }])), false)
  assert.equal(hasRowConditions(rule([{ column: 'Stage' }])), true)
})

test('a blank condition arrives pointed at the tab it will be read on', () => {
  const blank = emptyRowCondition('MASTER')
  assert.equal(blank.tab, 'MASTER')
  assert.equal(blank.column, '')
  assert.equal(blank.operator, 'is_not_empty')
})

test('it is a DIFFERENT field from the conditions a KPI already had', () => {
  // Reusing that name would apply the old rule twice on the widgets that
  // have it -- once in the component and once on the page -- and a filter
  // that silently runs twice is only harmless while every operator is
  // idempotent.
  const kpi = { conditions: [{ tab: 'MASTER', column: 'Stage', operator: 'equals', value: 'Pending' }] }
  assert.equal(applyRowConditions(ROWS, kpi, 'MASTER').length, 3)
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

const dashboard = read('pages/Dashboard.jsx')
const widgets = read('pages/admin/WidgetsPanel.jsx')
const controls = read('pages/admin/ControlsPanel.jsx')

test('EVERY widget gets it, because it runs in one place rather than fifteen', () => {
  // The page assembles a widget's rows; that is where a rule about which
  // rows a widget has belongs.
  assert.equal((dashboard.match(/applyRowConditions\(/g) || []).length, 3)
  assert.ok(dashboard.includes('applyRowConditions( blended ? blended.rows : rowsByLabel[widget.tab] || [], widget, widget.tab, dateOrder )'))
  assert.ok(dashboard.includes('applyRowConditions( blended ? blended.unfiltered : rawRowsByLabel[widget.tab] || [], widget, widget.tab, dateOrder )'))
})

test('the rule runs BEFORE the widget’s own controls', () => {
  // A rule is what the widget IS; a control is somebody narrowing it.
  const rulePos = dashboard.indexOf('const preControl = applyRowConditions(')
  const controlPos = dashboard.indexOf('applyWidgetControls(preControl')
  assert.ok(rulePos > 0 && controlPos > rulePos)
})

test('a control’s rule narrows what it OFFERS', () => {
  assert.ok(
    dashboard.includes('rows: applyRowConditions(dataByLabel[control.tab]?.rows || [], control, control.tab, dateOrder)')
  )
})

test('every widget has a Conditions button, marked with how many', () => {
  assert.ok(widgets.includes("key: 'conditions'"))
  assert.ok(widgets.includes('badge: conditionCount(widget)'))
  assert.ok(widgets.includes("{here === 'conditions' && ("))
  assert.ok(widgets.includes('onChange={(rowConditions) => set({ rowConditions })}'))
  assert.ok(widgets.includes('tabs={[widget.tab]}'), 'and it can only ask about its own tab')
})

test('a control has one too, and a button does not', () => {
  // A button already says what it wants in conditions, and offers no values,
  // so it has nothing to narrow here.
  assert.ok(controls.includes('conditions={control.rowConditions || []}'))
  const at = controls.indexOf('Only offer values from rows where')
  assert.ok(at > 0)
  assert.ok(controls.slice(Math.max(0, at - 300), at).includes('!isButton(control)'))
})

test('both editors offer the first condition rather than an empty box', () => {
  assert.ok(widgets.includes('set({ rowConditions: [emptyRowCondition(widget.tab)] })'))
  assert.ok(controls.includes('set({ rowConditions: [emptyRowCondition(control.tab)] })'))
})

test('ALL or ANY is a choice in both places', () => {
  for (const panel of [widgets, controls]) {
    assert.ok(panel.includes("onChange={(v) => set({ rowMatch: v })}"))
    assert.ok(panel.includes("label: 'ANY of these (OR)'"))
  }
})
