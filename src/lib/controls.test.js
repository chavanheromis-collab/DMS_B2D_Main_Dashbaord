import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyWidgetControls,
  controlIsActive,
  initialControlValues,
  numericBounds,
  stepFor,
  stepperTicks,
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
