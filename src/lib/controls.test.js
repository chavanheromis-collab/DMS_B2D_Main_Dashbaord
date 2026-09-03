import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { controlColumns } from './pageControls.js'
import {
  applyWidgetControls,
  controlIsActive,
  initialControlValues,
  numericBounds,
  stepFor,
  stepperTicks,
  widgetOptionRows,
} from './widgetControls.js'
import { orderWidgets } from './widgetOrder.js'
import { luminance, usesLightText } from './pageBackground.js'
import { pageIcon } from './workspace.js'

const rows = [
  { _row: 2, Name: 'Acme', Status: 'Won', Amount: '1200', Created: '2026-08-01' },
  { _row: 3, Name: 'Globex', Status: 'Lost', Amount: '300', Created: '2020-01-01' },
  { _row: 4, Name: 'Initech', Status: 'Won', Amount: '900', Created: '2026-08-15' },
  { _row: 5, Name: 'Umbrella', Status: '', Amount: 'n/a', Created: '' },
]

// --- slider bounds ------------------------------------------------------

test('slider bounds come from the data unless pinned', () => {
  assert.deepEqual(numericBounds(rows, 'Amount'), { min: 300, max: 1200 })
  assert.deepEqual(numericBounds(rows, 'Amount', { min: 0, max: 5000 }), { min: 0, max: 5000 })
})

test('a column with one distinct value still gives a draggable track', () => {
  const same = [{ V: '7' }, { V: '7' }]
  const { min, max } = numericBounds(same, 'V')
  assert.ok(max > min, 'a zero-width track could never be dragged')
})

test('a column with no numbers at all falls back rather than producing Infinity', () => {
  assert.deepEqual(numericBounds(rows, 'Name'), { min: 0, max: 100 })
})

test('step size keeps a slider around a hundred stops', () => {
  assert.equal(stepFor(0, 1000), 10)
  assert.equal(stepFor(0, 5), 0.1)
  assert.equal(stepFor(0, 1000, { step: 250 }), 250)
})

test('stepper ticks parse, sort and de-duplicate; nonsense falls back', () => {
  assert.deepEqual(stepperTicks({ steps: '100, 0, 50, 50' }), [0, 50, 100])
  assert.deepEqual(stepperTicks({ steps: 'x' }), [0, 25, 50, 75, 100])
})

// --- applying controls --------------------------------------------------

test('an inactive control narrows nothing', () => {
  const controls = [{ id: 'c1', kind: 'select', column: 'Status' }]
  assert.equal(applyWidgetControls(rows, controls, {}).length, 4)
  assert.equal(applyWidgetControls(rows, controls, { c1: '__ALL__' }).length, 4)
})

test('select, chips and search narrow on their own column', () => {
  assert.equal(applyWidgetControls(rows, [{ id: 'c', kind: 'select', column: 'Status' }], { c: 'Won' }).length, 2)
  assert.equal(
    applyWidgetControls(rows, [{ id: 'c', kind: 'multi', column: 'Status' }], { c: ['Won', 'Lost'] }).length,
    3
  )
  assert.equal(applyWidgetControls(rows, [{ id: 'c', kind: 'search', column: 'Name' }], { c: 'ini' }).length, 1)
})

test('a range keeps only rows inside it, dropping non-numeric ones', () => {
  const out = applyWidgetControls(rows, [{ id: 'c', kind: 'range', column: 'Amount' }], {
    c: { from: '500', to: '1500' },
  })
  assert.deepEqual(out.map((r) => r.Name), ['Acme', 'Initech'])
})

test('a threshold respects its direction', () => {
  const gte = applyWidgetControls(rows, [{ id: 'c', kind: 'threshold', column: 'Amount', direction: 'gte' }], { c: 900 })
  assert.deepEqual(gte.map((r) => r.Name), ['Acme', 'Initech'])

  const lte = applyWidgetControls(rows, [{ id: 'c', kind: 'threshold', column: 'Amount', direction: 'lte' }], { c: 900 })
  assert.deepEqual(lte.map((r) => r.Name), ['Globex', 'Initech'])
})

test('top N is applied LAST, whatever order the controls are in', () => {
  // topn is declared first, but must still mean "top 1 of what survived the
  // status filter" -- not "top 1 of the raw tab, then filter".
  const controls = [
    { id: 'n', kind: 'topn' },
    { id: 's', kind: 'select', column: 'Status' },
  ]
  const out = applyWidgetControls(rows, controls, { n: 1, s: 'Won' })
  assert.equal(out.length, 1)
  assert.equal(out[0].Name, 'Acme')
})

test('a control missing its column is skipped rather than emptying the widget', () => {
  const out = applyWidgetControls(rows, [{ id: 'c', kind: 'select', column: '' }], { c: 'Won' })
  assert.equal(out.length, 4)
})

test('controls stack', () => {
  const controls = [
    { id: 'a', kind: 'select', column: 'Status' },
    { id: 'b', kind: 'threshold', column: 'Amount', direction: 'gte' },
  ]
  assert.equal(applyWidgetControls(rows, controls, { a: 'Won', b: 1000 }).length, 1)
})

test('activity detection matches each control’s value shape', () => {
  assert.equal(controlIsActive({ kind: 'button' }, true), true)
  assert.equal(controlIsActive({ kind: 'button' }, false), false)
  assert.equal(controlIsActive({ kind: 'range' }, {}), false)
  assert.equal(controlIsActive({ kind: 'range' }, { from: '1' }), true)
  assert.equal(controlIsActive({ kind: 'topn' }, ''), false)
  assert.equal(controlIsActive({ kind: 'topn' }, 5), true)
  assert.equal(controlIsActive({ kind: 'multi' }, []), false)
})

test('admin defaults seed the opening values', () => {
  const seeded = initialControlValues([
    { id: 'a', kind: 'select', defaultValue: 'Won' },
    { id: 'b', kind: 'multi', defaultValue: 'Won, Lost' },
    { id: 'c', kind: 'button', defaultValue: true },
    { id: 'd', kind: 'select' },
  ])
  assert.equal(seeded.a, 'Won')
  assert.deepEqual(seeded.b, ['Won', 'Lost'])
  assert.equal(seeded.c, true)
  assert.equal('d' in seeded, false)
})

// --- three-level widget ordering ---------------------------------------

test('a user beats an admin-assigned order, which beats the page default', () => {
  const widgets = [
    { id: 'a', order: 1 },
    { id: 'b', order: 2 },
    { id: 'c', order: 3 },
  ]
  assert.deepEqual(orderWidgets(widgets, {}, {}).map((w) => w.id), ['a', 'b', 'c'])

  // Admin puts C first for this user.
  assert.deepEqual(orderWidgets(widgets, {}, { c: 0 }).map((w) => w.id), ['c', 'a', 'b'])

  // The user then puts B first for themselves; the admin's C is still ahead
  // of the page default for A.
  assert.deepEqual(orderWidgets(widgets, { b: -1 }, { c: 0 }).map((w) => w.id), ['b', 'c', 'a'])
})

test('omitting the assigned order keeps the old two-level behaviour', () => {
  const widgets = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(orderWidgets(widgets, { b: 1 }).map((w) => w.id), ['b', 'a'])
})

// --- contrast -----------------------------------------------------------

test('luminance weights the channels by eye sensitivity, not evenly', () => {
  assert.equal(luminance('#000000'), 0)
  assert.equal(luminance('#ffffff'), 1)
  // Green reads far brighter than blue at the same channel value.
  assert.ok(luminance('#00ff00') > luminance('#0000ff'))
  assert.equal(luminance('#fff'), 1, 'short hex is supported')
  assert.equal(luminance('not a colour'), null)
})

test('text flips to light only over a genuinely dark backdrop', () => {
  assert.equal(usesLightText(null), false)
  assert.equal(usesLightText({ mode: 'color', color: '#0F172A' }), true)
  assert.equal(usesLightText({ mode: 'color', color: '#FFFFFF' }), false)
  assert.equal(usesLightText({ mode: 'gradient', gradientFrom: '#000000', gradientTo: '#111111' }), true)
})

test('a dark colour turned down to near-invisible does not ask for light text', () => {
  // At 10% visibility the page is really near-white, so white text would be
  // unreadable -- the check has to account for what a reader actually sees.
  assert.equal(usesLightText({ mode: 'color', color: '#000000', opacity: 10 }), false)
  assert.equal(usesLightText({ mode: 'color', color: '#000000', opacity: 100 }), true)
})

test('a heavy white tint over black flips the text back to dark', () => {
  assert.equal(
    usesLightText({ mode: 'color', color: '#000000', overlayColor: '#FFFFFF', overlayOpacity: 85 }),
    false
  )
})

test('an image is left to the admin rather than guessed at', () => {
  const img = { mode: 'image', imageUrl: 'https://e.com/a.jpg' }
  assert.equal(usesLightText(img), false)
  assert.equal(usesLightText({ ...img, textMode: 'light' }), true)
})

// --- page icons ---------------------------------------------------------

test('a page falls back to its emoji when no image is set or usable', () => {
  assert.deepEqual(pageIcon({ icon: '🚗' }), { type: 'emoji', char: '🚗' })
  assert.deepEqual(pageIcon({}), { type: 'emoji', char: '📊' })

  const safe = (u) => (String(u || '').startsWith('https://') ? u : '')
  assert.deepEqual(pageIcon({ icon: '🚗', iconUrl: 'javascript:x' }, safe), { type: 'emoji', char: '🚗' })
  assert.deepEqual(pageIcon({ icon: '🚗', iconUrl: 'https://e.com/l.png' }, safe), {
    type: 'image',
    url: 'https://e.com/l.png',
  })
})

// --- joining columns is a switch -----------------------------------------

test('joining is on only when it has been switched on', () => {
  // Ticking a column used to BE the decision, so there was no way to look at
  // a joined control, decide against it, and get back except by un-picking
  // every column one at a time.
  const control = { column: 'Rep', columns: ['Rep', 'Branch'] }
  assert.deepEqual(controlColumns({ ...control, concat: true }), ['Rep', 'Branch'])
  assert.deepEqual(controlColumns({ ...control, concat: false }), ['Rep'], 'off means the first column only')
})

test('the columns are remembered while the switch is off', () => {
  const control = { column: 'Rep', columns: ['Rep', 'Branch'], concat: false }
  assert.deepEqual(controlColumns({ ...control, concat: true }), ['Rep', 'Branch'], 'and come back when it is on')
})

test('a control saved before the switch existed keeps working', () => {
  // Absence means exactly what it used to: a list at all is a join. That
  // includes the odd shapes -- a one-entry list naming a different column
  // from `column` -- because somewhere there is a page relying on one.
  assert.deepEqual(controlColumns({ column: 'Rep', columns: ['Rep', 'Branch'] }), ['Rep', 'Branch'])
  assert.deepEqual(controlColumns({ column: 'Region', columns: ['Rep'] }), ['Rep'])
  assert.deepEqual(controlColumns({ column: 'Rep' }), ['Rep'])
})

test('switching it on with nothing picked joins nothing', () => {
  assert.deepEqual(controlColumns({ column: 'Rep', columns: [], concat: true }), ['Rep'])
})

test('a control with no column at all has no columns', () => {
  assert.deepEqual(controlColumns({}), [])
  assert.deepEqual(controlColumns(null), [])
})

// ---------------------------------------------------------------------
// A widget's controls narrowing each other
// ---------------------------------------------------------------------

const BIKES = [
  { Category: 'Scooter', Model: 'Pleasure', Colour: 'Red' },
  { Category: 'Scooter', Model: 'Destini', Colour: 'Blue' },
  { Category: 'Bike', Model: 'Splendor', Colour: 'Red' },
  { Category: 'Bike', Model: 'Xtreme', Colour: 'Black' },
]

const cat = { id: 'c1', kind: 'select', column: 'Category' }
const model = { id: 'c2', kind: 'select', column: 'Model' }
const colour = { id: 'c3', kind: 'select', column: 'Colour' }

test('a control offers only what the other controls have left', () => {
  // Every control on a widget drew from the SAME rows, so picking a
  // category still offered every model in the tab -- most of which came
  // back empty. That is what people report as a bug.
  const rows = widgetOptionRows(model, {
    rows: BIKES,
    controls: [cat, model, colour],
    values: { c1: 'Scooter' },
  })
  assert.deepEqual(rows.map((r) => r.Model), ['Pleasure', 'Destini'])
})

test('and it never narrows itself', () => {
  // Narrowing a control by its own value leaves it offering only what is
  // already picked, so nobody could change their mind.
  const rows = widgetOptionRows(model, {
    rows: BIKES,
    controls: [cat, model],
    values: { c2: 'Splendor' },
  })
  assert.equal(rows.length, 4)
})

test('two controls narrow it together', () => {
  const rows = widgetOptionRows(model, {
    rows: BIKES,
    controls: [cat, model, colour],
    values: { c1: 'Bike', c3: 'Red' },
  })
  assert.deepEqual(rows.map((r) => r.Model), ['Splendor'])
})

test('a control marked independent keeps offering everything', () => {
  // For the one meant to be picked FIRST, and for anything measuring the
  // whole tab rather than the current view.
  const rows = widgetOptionRows(
    { ...model, independent: true },
    { rows: BIKES, controls: [cat, model], values: { c1: 'Scooter' } }
  )
  assert.equal(rows.length, 4)
})

test('the only control on a widget is narrowed by nothing', () => {
  const rows = widgetOptionRows(model, { rows: BIKES, controls: [model], values: { c2: 'Xtreme' } })
  assert.equal(rows.length, 4)
})

test('nothing chosen anywhere narrows nothing', () => {
  const rows = widgetOptionRows(model, { rows: BIKES, controls: [cat, model, colour], values: {} })
  assert.equal(rows.length, 4)
})

test('and it survives being asked about nothing at all', () => {
  // Narrowing nothing is the safe answer everywhere here: a half-built
  // control must leave the list alone rather than empty it, or a widget
  // mid-edit shows a dropdown with nothing in it.
  assert.deepEqual(widgetOptionRows(null, { rows: BIKES }), BIKES)
  assert.deepEqual(widgetOptionRows(model, { rows: BIKES }), BIKES, 'no other controls')
  assert.deepEqual(widgetOptionRows(model, {}), [], 'and no rows is no rows')
})

// --- wiring ---------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const readSrc = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('a widget control is drawn from rows the others have narrowed', () => {
  const ui = readSrc('src/components/WidgetControls.jsx')
  assert.ok(ui.includes('rows={widgetOptionRows(control, { rows, controls, values, dateOrder })}'))
  // The WHOLE list of controls, or it narrows by nothing.
  assert.ok(!ui.includes('controls: [control]'))
})

test('the admin can turn it off, and the switch reads the right way round', () => {
  // Stored as `independent` because that is what the engine reads; shown
  // as its opposite, because "narrow by the others" is the thing somebody
  // is deciding.
  const ed = readSrc('src/pages/admin/WidgetControlsEditor.jsx')
  assert.ok(ed.includes('checked={!control.independent}'))
  assert.ok(ed.includes('onChange={(e) => setControl({ independent: !e.target.checked })}'))
  assert.ok(ed.includes('Narrow by the other controls'))
})
