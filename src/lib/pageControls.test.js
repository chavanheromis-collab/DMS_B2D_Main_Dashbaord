import test from 'node:test'
import assert from 'node:assert/strict'

import fs from 'node:fs'
import path from 'node:path'

import {
  activeCount,
  canBeDefault,
  captureView,
  controlActive,
  controlWidth,
  defaultList,
  initialValues,
  takesManyValues,
  toggleDefault,
  isButton,
  kindNeedsColumn,
  normalizeControls,
  partitionByProminence,
  splitControls,
  viewIsActive,
} from './pageControls.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')

// --- reading a page -----------------------------------------------------

test('a page saved with the old two arrays reads as one ordered list', () => {
  const legacy = {
    filters: [{ id: 'f1', kind: 'select', column: 'Status' }],
    buttons: [{ id: 'b1', label: 'Pending', conditions: [] }],
  }
  const controls = normalizeControls(legacy)

  assert.equal(controls.length, 2)
  // Filters first, then buttons -- the order they were rendered in before,
  // so an upgrade doesn't rearrange anyone's dashboard.
  assert.equal(controls[0].id, 'f1')
  assert.equal(controls[1].id, 'b1')
  assert.equal(controls[1].kind, 'button', 'a legacy button gains its kind')
})

test('a legacy filter with no kind defaults to a dropdown', () => {
  const [control] = normalizeControls({ filters: [{ id: 'f1', column: 'Status' }] })
  assert.equal(control.kind, 'select')
})

test('the unified list wins once it exists', () => {
  const page = {
    controls: [{ id: 'c1', kind: 'chips' }],
    filters: [{ id: 'old', kind: 'select' }],
    buttons: [{ id: 'oldb' }],
  }
  assert.deepEqual(normalizeControls(page).map((c) => c.id), ['c1'])
})

test('a page with nothing at all reads as an empty list', () => {
  assert.deepEqual(normalizeControls(null), [])
  assert.deepEqual(normalizeControls({}), [])
})

// --- splitting for the engine ------------------------------------------

test('the engine still receives filters and buttons apart', () => {
  const controls = [
    { id: 'a', kind: 'select' },
    { id: 'b', kind: 'button' },
    { id: 'c', kind: 'slider' },
  ]
  const { filters, buttons } = splitControls(controls)

  assert.deepEqual(filters.map((f) => f.id), ['a', 'c'])
  assert.deepEqual(buttons.map((b) => b.id), ['b'])
  assert.equal(isButton(controls[1]), true)
  assert.equal(isButton(controls[0]), false)
})

test('splitting round-trips: nothing is lost or duplicated', () => {
  const controls = [
    { id: 'a', kind: 'select' },
    { id: 'b', kind: 'button' },
    { id: 'c', kind: 'chips' },
    { id: 'd', kind: 'button' },
  ]
  const { filters, buttons } = splitControls(controls)
  assert.equal(filters.length + buttons.length, controls.length)
})

test('only some kinds need a column', () => {
  assert.equal(kindNeedsColumn('select'), true)
  assert.equal(kindNeedsColumn('slider'), true)
  assert.equal(kindNeedsColumn('button'), false)
})

// --- prominence ---------------------------------------------------------

test('controls split into up-front and behind "More", skipping hidden ones', () => {
  const { visible, advanced } = partitionByProminence([
    { id: 'a', kind: 'select' },
    { id: 'b', kind: 'select', advanced: true },
    { id: 'c', kind: 'select', hidden: true },
    { id: 'd', kind: 'select', advanced: true, hidden: true },
  ])
  assert.deepEqual(visible.map((c) => c.id), ['a'])
  assert.deepEqual(advanced.map((c) => c.id), ['b'])
})

// --- width --------------------------------------------------------------

test('a control with no width set fits its contents', () => {
  assert.equal(controlWidth({}), null)
  assert.equal(controlWidth({ widthPx: null }), null)
  assert.equal(controlWidth({ widthPx: '' }), null)
  assert.equal(controlWidth({ width: 'auto' }), null)
  assert.equal(controlWidth(null), null)
})

test('an exact pixel width is used as given', () => {
  assert.equal(controlWidth({ widthPx: 260 }), 260)
  assert.equal(controlWidth({ widthPx: '180' }), 180)
})

test('the old named sizes still resolve, so upgrading resizes nothing', () => {
  assert.equal(controlWidth({ width: 'sm' }), 144)
  assert.equal(controlWidth({ width: 'md' }), 208)
  assert.equal(controlWidth({ width: 'lg' }), 288)
})

test('an explicit pixel width beats a leftover named size', () => {
  assert.equal(controlWidth({ width: 'lg', widthPx: 120 }), 120)
})

test('absurd widths are clamped rather than breaking the bar', () => {
  assert.equal(controlWidth({ widthPx: 5 }), 60)
  assert.equal(controlWidth({ widthPx: 99999 }), 1200)
  // Zero and negatives mean "unset", not "invisible".
  assert.equal(controlWidth({ widthPx: 0 }), null)
  assert.equal(controlWidth({ widthPx: -50 }), null)
  assert.equal(controlWidth({ widthPx: 'abc' }), null)
})

// --- active state -------------------------------------------------------

const controls = [
  { id: 'f1', kind: 'select' },
  { id: 'f2', kind: 'slider' },
  { id: 'b1', kind: 'button' },
]

test('active detection spans both filters and buttons', () => {
  assert.equal(controlActive(controls[0], { f1: 'Won' }, []), true)
  assert.equal(controlActive(controls[0], { f1: '__ALL__' }, []), false)
  assert.equal(controlActive(controls[2], {}, ['b1']), true)
  assert.equal(controlActive(controls[2], {}, []), false)

  assert.equal(activeCount(controls, { f1: 'Won', f2: { from: '1' } }, ['b1']), 3)
  assert.equal(activeCount(controls, {}, []), 0)
})

// --- defaults -----------------------------------------------------------

test('admin defaults open already applied', () => {
  const { values, buttons } = initialValues([
    { id: 'a', kind: 'select', defaultValue: 'Won' },
    { id: 'b', kind: 'chips', defaultValue: 'Won, Lost' },
    { id: 'c', kind: 'button', defaultOn: true },
    { id: 'd', kind: 'select' },
    { id: 'e', kind: 'button' },
  ])

  assert.equal(values.a, 'Won')
  assert.deepEqual(values.b, ['Won', 'Lost'])
  assert.deepEqual(buttons, ['c'])
  assert.equal('d' in values, false)
})

test('a hidden control never applies its default', () => {
  // Otherwise a page would be silently narrowed by something nobody can see
  // or clear.
  const { values, buttons } = initialValues([
    { id: 'a', kind: 'select', defaultValue: 'Won', hidden: true },
    { id: 'b', kind: 'button', defaultOn: true, hidden: true },
  ])
  assert.deepEqual(values, {})
  assert.deepEqual(buttons, [])
})

// --- saved views --------------------------------------------------------

test('capturing a view keeps only controls that still exist', () => {
  const snapshot = captureView(
    { f1: 'Won', ghost: 'x' },
    ['b1', 'gone'],
    [{ id: 'f1' }, { id: 'b1' }]
  )
  assert.deepEqual(snapshot.values, { f1: 'Won' })
  assert.deepEqual(snapshot.buttons, ['b1'])
})

test('a view lights up only when the dashboard actually matches it', () => {
  const view = { values: { f1: 'Won' }, buttons: ['b1'] }

  assert.equal(viewIsActive(view, { f1: 'Won' }, ['b1']), true)
  assert.equal(viewIsActive(view, { f1: 'Lost' }, ['b1']), false)
  assert.equal(viewIsActive(view, { f1: 'Won' }, []), false)
  assert.equal(viewIsActive(view, { f1: 'Won' }, ['b1', 'b2']), false)
})

test('button order does not affect whether a view matches', () => {
  const view = { values: {}, buttons: ['b1', 'b2'] }
  assert.equal(viewIsActive(view, {}, ['b2', 'b1']), true)
})

test('an absent value and an empty one compare equal', () => {
  // Both mean "not narrowing" to the engine, so a view must not flicker off
  // just because a cleared control left an undefined behind.
  const view = { values: {}, buttons: [] }
  assert.equal(viewIsActive(view, { f1: undefined }, []), true)
  assert.equal(viewIsActive(view, {}, []), true)
  assert.equal(viewIsActive(view, { f1: 'Won' }, []), false)
})

test('a view with a range value matches on structure, not identity', () => {
  const view = { values: { f2: { from: '1', to: '9' } }, buttons: [] }
  assert.equal(viewIsActive(view, { f2: { from: '1', to: '9' } }, []), true)
  assert.equal(viewIsActive(view, { f2: { from: '1', to: '8' } }, []), false)
})

// --- picking the value a control starts on -------------------------------

test('a many-valued default is a list, and one-valued is not', () => {
  assert.equal(takesManyValues({ kind: 'multi' }), true)
  assert.equal(takesManyValues({ kind: 'chips' }), true)
  for (const kind of ['select', 'text', 'number', 'date', 'button']) {
    assert.equal(takesManyValues({ kind }), false, kind)
  }
  assert.equal(takesManyValues(null), false)
})

test('the stored shape is the one the engine already reads', () => {
  // Comma-separated, split on the way in. Changing that shape would need
  // every saved control to be migrated, for no gain.
  assert.deepEqual(defaultList({ defaultValue: 'A, B , C' }), ['A', 'B', 'C'])
  assert.deepEqual(defaultList({ defaultValue: '' }), [])
  assert.deepEqual(defaultList({}), [])
  assert.deepEqual(defaultList(null), [])
  // And what it splits to is what `initialValues` hands the page.
  const control = { id: 'c1', kind: 'chips', column: 'Model', defaultValue: 'A, B' }
  assert.deepEqual(initialValues([control]).values.c1, ['A', 'B'])
})

test('pressing a value adds it, pressing it again takes it away', () => {
  const control = { kind: 'chips', defaultValue: 'A, B' }
  assert.equal(toggleDefault(control, 'C'), 'A, B, C')
  assert.equal(toggleDefault(control, 'A'), 'B')
  assert.equal(toggleDefault({ kind: 'chips', defaultValue: 'A' }, 'A'), '')
  // The order they were picked, not the column's: a default is a small
  // hand-made set, and the admin's own order is the one they recognise.
  assert.equal(toggleDefault({ kind: 'chips', defaultValue: 'Z' }, 'A'), 'Z, A')
})

test('a value with a comma in it is refused, not saved as two', () => {
  // "SPLENDOR PLUS, BLACK" is a real cell in a real sheet. Saved into a
  // comma-separated default it becomes two values that match nothing, and
  // the page opens empty with nothing on it explaining why.
  assert.equal(canBeDefault('SPLENDOR'), true)
  assert.equal(canBeDefault('SPLENDOR PLUS, BLACK'), false)
  assert.equal(canBeDefault(''), true)
  assert.equal(canBeDefault(null), true)

  const control = { kind: 'chips', defaultValue: 'A' }
  assert.equal(toggleDefault(control, 'X, Y'), 'A', 'a comma value was saved anyway')
  // And blank is not a value either.
  assert.equal(toggleDefault(control, '   '), 'A')
})

test('the picker offers the column’s values, and says where they came from', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'src/pages/admin/ControlsPanel.jsx'), 'utf8')
  // A `datalist` is a hint no browser shows until you type and several
  // never show at all, which is why the values are now on screen.
  assert.match(panel, /onChange\(takesMany \? toggleDefault\(control, v\) :/, 'nothing is pickable')
  assert.ok(panel.includes('value{list.length === 1'), 'nothing says how many there are')
  // The box stays: a sheet gets new values every day, and a default that is
  // not in the list yet has to remain possible to write.
  const box = panel.slice(panel.indexOf('function ValueBox('), panel.indexOf('export default function ControlsPanel'))
  assert.ok(box.includes('<TextInput'), 'a value not yet in the sheet cannot be typed')
  assert.ok(box.includes('disabled={!usable}'), 'a comma value is offered as though it would work')
})
