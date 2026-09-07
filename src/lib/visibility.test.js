import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  VISIBLE_WHEN,
  chosenValues,
  emptyVisibility,
  isVisible,
  visibilityCount,
  visibilityIsSet,
  visibilityOf,
  visibilityProblem,
  visibilitySummary,
} from './visibility.js'

const ROWS = [
  { _row: 2, Status: 'In Progress', Branch: 'Nashik', Days: '3' },
  { _row: 3, Status: 'Delivered', Branch: 'Pune', Days: '1' },
]

const OVERDUE = [{ tab: 'MASTER', column: 'Days', operator: 'gt', value: '10' }]
const OPEN = [{ tab: 'MASTER', column: 'Status', operator: 'equals', value: 'In Progress' }]

const FILTERS = [
  { id: 'f1', kind: 'select', label: 'Branch', tab: 'MASTER', column: 'Branch' },
  { id: 'f2', kind: 'multi', label: 'Status', tab: 'MASTER', column: 'Status' },
]
const BUTTONS = [{ id: 'b1', kind: 'button', label: 'Finance only' }]

const on = (rule) => ({ id: 'w1', [VISIBLE_WHEN]: rule })

// ---------------------------------------------------------------------
// Nothing written means nothing hidden
// ---------------------------------------------------------------------

test('anything with no rule is simply on the page', () => {
  assert.equal(isVisible({}, { rows: ROWS }), true)
  assert.equal(isVisible(null, { rows: [] }), true)
  assert.equal(isVisible(on(emptyVisibility()), { rows: [] }), true)
})

test('a half-written rule hides nothing', () => {
  // The person who could fix it is the one who can no longer see the
  // widget to click it.
  assert.equal(isVisible(on({ mode: 'rows', conditions: [] }), { rows: [] }), true)
  assert.equal(isVisible(on({ mode: 'rows', conditions: [{ column: '' }] }), { rows: [] }), true)
  assert.equal(isVisible(on({ mode: 'control', filterIds: [], buttonIds: [] }), {}), true)
})

test('an unknown mode is "always", not "never"', () => {
  assert.equal(visibilityOf(on({ mode: 'sometimes' })).mode, 'always')
  assert.equal(isVisible(on({ mode: 'sometimes' }), { rows: [] }), true)
})

// ---------------------------------------------------------------------
// What the data says
// ---------------------------------------------------------------------

test('it appears when a row matches, and goes when none does', () => {
  const item = on({ mode: 'rows', conditions: OPEN })
  assert.equal(isVisible(item, { rows: ROWS }), true)
  assert.equal(isVisible(item, { rows: [ROWS[1]] }), false)
  assert.equal(isVisible(item, { rows: [] }), false)
})

test('one matching row out of a thousand is enough', () => {
  const item = on({ mode: 'rows', conditions: OVERDUE })
  assert.equal(isVisible(item, { rows: ROWS }), false)
  assert.equal(isVisible(item, { rows: [...ROWS, { Days: '40' }] }), true)
})

test('several conditions can be asked together, or separately', () => {
  const both = [...OPEN, { tab: 'MASTER', column: 'Branch', operator: 'equals', value: 'Pune' }]
  assert.equal(isVisible(on({ mode: 'rows', conditions: both, match: 'all' }), { rows: ROWS }), false)
  assert.equal(isVisible(on({ mode: 'rows', conditions: both, match: 'any' }), { rows: ROWS }), true)
})

test('the rule can be turned round', () => {
  // Half the rules people want are the negative one: show the "all clear"
  // panel exactly when nothing is overdue.
  const item = on({ mode: 'rows', conditions: OVERDUE, invert: true })
  assert.equal(isVisible(item, { rows: ROWS }), true)
  assert.equal(isVisible(item, { rows: [{ Days: '40' }] }), false)
})

test('a date condition is read in the page’s own order', () => {
  const item = on({
    mode: 'rows',
    conditions: [{ tab: 'MASTER', column: 'Due', operator: 'date_before', value: '2026-03-20' }],
  })
  const rows = [{ Due: '03/04/2026' }]
  assert.equal(isVisible(item, { rows, dateOrder: 'DMY' }), false)
  assert.equal(isVisible(item, { rows, dateOrder: 'MDY' }), true)
})

// ---------------------------------------------------------------------
// What the controls say
// ---------------------------------------------------------------------

test('it waits for a filter to be set at all', () => {
  const item = on({ mode: 'control', filterIds: ['f1'] })
  assert.equal(isVisible(item, { filters: FILTERS, values: {} }), false)
  assert.equal(isVisible(item, { filters: FILTERS, values: { f1: 'Nashik' } }), true)
})

test('or for it to be set to something in particular', () => {
  const item = on({ mode: 'control', filterIds: ['f1'], values: { f1: ['Nashik'] } })
  assert.equal(isVisible(item, { filters: FILTERS, values: { f1: 'Nashik' } }), true)
  assert.equal(isVisible(item, { filters: FILTERS, values: { f1: 'Pune' } }), false)
  assert.equal(isVisible(item, { filters: FILTERS, values: {} }), false)
})

test('a multi-select counts if any of its values is one of the wanted ones', () => {
  const item = on({ mode: 'control', filterIds: ['f2'], values: { f2: ['Cancelled'] } })
  assert.equal(isVisible(item, { filters: FILTERS, values: { f2: ['Delivered'] } }), false)
  assert.equal(isVisible(item, { filters: FILTERS, values: { f2: ['Delivered', 'Cancelled'] } }), true)
})

test('an empty wanted list means "set to anything"', () => {
  const item = on({ mode: 'control', filterIds: ['f2'], values: { f2: [] } })
  assert.equal(isVisible(item, { filters: FILTERS, values: { f2: [] } }), false)
  assert.equal(isVisible(item, { filters: FILTERS, values: { f2: ['Delivered'] } }), true)
})

test('it waits for a button', () => {
  const item = on({ mode: 'control', buttonIds: ['b1'] })
  assert.equal(isVisible(item, { activeButtonIds: [] }), false)
  assert.equal(isVisible(item, { activeButtonIds: ['b1'] }), true)
})

test('several controls, any one or all of them', () => {
  const any = on({ mode: 'control', filterIds: ['f1'], buttonIds: ['b1'], need: 'any' })
  const all = on({ mode: 'control', filterIds: ['f1'], buttonIds: ['b1'], need: 'all' })
  const ctx = { filters: FILTERS, values: { f1: 'Nashik' }, activeButtonIds: [] }
  assert.equal(isVisible(any, ctx), true)
  assert.equal(isVisible(all, ctx), false)
  assert.equal(isVisible(all, { ...ctx, activeButtonIds: ['b1'] }), true)
})

test('a filter that has been deleted cannot be set', () => {
  // And the editor says so, rather than the widget silently never
  // appearing again.
  const item = on({ mode: 'control', filterIds: ['gone'] })
  assert.equal(isVisible(item, { filters: FILTERS, values: { gone: 'x' } }), false)
  assert.match(visibilityProblem(item, { filters: FILTERS, buttons: BUTTONS }), /deleted/)
})

test('a range has no discrete values to compare, so it answers "is it set"', () => {
  assert.deepEqual(chosenValues({ from: '1', to: '9' }), [])
  assert.deepEqual(chosenValues(['a', 'b']), ['a', 'b'])
  assert.deepEqual(chosenValues('a'), ['a'])
  assert.deepEqual(chosenValues(''), [])
  assert.deepEqual(chosenValues(null), [])
  assert.deepEqual(chosenValues(0), ['0'], 'zero is a value somebody picked')
})

// ---------------------------------------------------------------------
// What the editor shows
// ---------------------------------------------------------------------

test('a section badge counts the tests, not the rule', () => {
  assert.equal(visibilityCount({}), 0)
  assert.equal(visibilityCount(on({ mode: 'rows', conditions: OPEN })), 1)
  assert.equal(visibilityCount(on({ mode: 'control', filterIds: ['f1'], buttonIds: ['b1'] })), 2)
})

test('a rule that asks nothing is reported as asking nothing', () => {
  assert.equal(visibilityIsSet({}), false)
  assert.equal(visibilityIsSet(on({ mode: 'rows', conditions: [] })), false)
  assert.equal(visibilityIsSet(on({ mode: 'rows', conditions: OPEN })), true)
  assert.match(visibilityProblem(on({ mode: 'rows', conditions: [] }), {}), /always be shown/)
  assert.match(visibilityProblem(on({ mode: 'control' }), {}), /always be shown/)
  assert.equal(visibilityProblem({}, {}), null)
})

test('the summary says what will actually happen', () => {
  assert.equal(visibilitySummary({}, {}), 'Always on the page.')
  assert.match(visibilitySummary(on({ mode: 'rows', conditions: OPEN }), {}), /^Shown when a row matches all of 1 condition\./)
  assert.match(
    visibilitySummary(on({ mode: 'rows', conditions: OPEN, invert: true }), {}),
    /^Hidden when/
  )
  assert.equal(
    visibilitySummary(on({ mode: 'control', filterIds: ['f1'], buttonIds: ['b1'], need: 'all' }), {
      filters: FILTERS,
      buttons: BUTTONS,
    }),
    'Shown when Branch and Finance only are set.'
  )
})

// ---------------------------------------------------------------------
// Wiring: the page, and the two panels
// ---------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const DASH = read('src/pages/Dashboard.jsx')
const WIDGETS = read('src/pages/admin/WidgetsPanel.jsx')
const CONTROLS = read('src/pages/admin/ControlsPanel.jsx')
const EDITOR = read('src/pages/admin/VisibilityEditor.jsx')

test('a widget is judged on the rows it would have drawn, after the page filters', () => {
  const start = DASH.indexOf('const showing =')
  const body = DASH.slice(start, DASH.indexOf('if (!showing) return null', start))
  assert.match(body, /rows: preControl/, 'not the raw sheet')
  assert.match(body, /values: effectiveValues/)
  assert.match(body, /activeButtonIds: effectiveButtonIds/)
  assert.match(body, /dateOrder/)
})

test('a hidden widget is off the page, not merely invisible', () => {
  // It draws nothing and reads nothing -- and it changes no totals
  // anywhere else either.
  assert.match(DASH, /if \(!showing\) return null/)
  assert.match(DASH, /\}\)\n\s*\/\/[\s\S]{0,400}?\.filter\(Boolean\)/)
})

test('an admin can always see what they have hidden', () => {
  // A widget hidden by its own rule that an admin could not see would be
  // one they could not fix: the only way back to it is the panel it just
  // took off the page.
  assert.match(DASH, /const showing =\s*\n?\s*editing \|\|/)
  assert.match(DASH, /control\) =>\s*\n?\s*arranging \|\|/)
})

test('controls are narrowed the same way, from one list', () => {
  assert.match(DASH, /const shownControls = useMemo\(/)
  assert.match(DASH, /controls=\{shownControls\}/)
  assert.equal(DASH.includes('controls={view.controls}'), false, 'the raw list must not still be handed over')
})

test('both panels use the one editor', () => {
  // A rule that meant something slightly different on a button than on a
  // widget would be four slightly different dialects of one sentence.
  assert.match(WIDGETS, /here === 'visibility' && \(\s*<VisibilityEditor/)
  assert.match(WIDGETS, /key: 'visibility'/)
  assert.match(WIDGETS, /badge: visibilityCount\(widget\)/)
  assert.match(CONTROLS, /<VisibilityEditor/)
})

test('a control is never offered itself to wait for', () => {
  // It would hide itself the moment it was set, and then nobody could
  // unset it.
  assert.match(CONTROLS, /filters=\{controls\.filter\(\(c\) => c\.id !== control\.id && c\.kind !== 'button'\)\}/)
  assert.match(CONTROLS, /buttons=\{controls\.filter\(\(c\) => c\.id !== control\.id && c\.kind === 'button'\)\}/)
})

test('the editor writes one field, whole', () => {
  assert.match(EDITOR, /set\(\{ \[VISIBLE_WHEN\]: \{ \.\.\.emptyVisibility\(\), \.\.\.rule, \.\.\.change \} \}\)/)
})
