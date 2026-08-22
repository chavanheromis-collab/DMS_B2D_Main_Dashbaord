import test from 'node:test'
import assert from 'node:assert/strict'

import {
  activeCount,
  captureView,
  controlMode,
  fixedValues,
  initialValues,
  isFixed,
  partitionByProminence,
  viewIsActive,
} from './pageControls.js'
import { applyFilters } from './filterEngine.js'

const ROWS = [
  { Branch: 'Pune', Status: 'Open', Amount: '10' },
  { Branch: 'Pune', Status: 'Cancelled', Amount: '20' },
  { Branch: 'Nashik', Status: 'Open', Amount: '30' },
]

const branch = {
  id: 'fx',
  kind: 'select',
  tab: 'T',
  column: 'Branch',
  label: 'Branch',
  mode: 'fixed',
  defaultValue: 'Pune',
}
const status = { id: 'live', kind: 'select', tab: 'T', column: 'Status', label: 'Status' }

/** The dashboard's rule: a page's own rules are forced over user state. */
function runPage(controls, userValues, userButtons = []) {
  const fixed = fixedValues(controls)
  return applyFilters(ROWS, {
    tab: 'T',
    filters: controls.filter((c) => c.kind !== 'button'),
    buttons: controls.filter((c) => c.kind === 'button'),
    values: { ...userValues, ...fixed.values },
    activeIds: Array.from(new Set([...userButtons, ...fixed.buttons])),
  })
}

// --- the three states ----------------------------------------------------

test('a control is live unless it says otherwise', () => {
  assert.equal(controlMode({ id: 'a' }), 'live')
  assert.equal(controlMode({ id: 'a', mode: 'fixed' }), 'fixed')
})

test('the old “hidden” flag still means parked', () => {
  // Pages written before there were three states must not silently turn
  // their switched-off controls into permanent rules.
  assert.equal(controlMode({ id: 'a', hidden: true }), 'off')
  assert.equal(isFixed({ id: 'a', hidden: true }), false)
  assert.deepEqual(initialValues([{ id: 'a', hidden: true, kind: 'select', defaultValue: 'X' }]).values, {})
})

// --- what the page shows -------------------------------------------------

test('a fixed control is nowhere on the bar — not even behind “More”', () => {
  const { visible, advanced } = partitionByProminence([branch, status, { ...branch, id: 'fx2', advanced: true }])
  assert.deepEqual(visible.map((c) => c.id), ['live'])
  assert.deepEqual(advanced.map((c) => c.id), [])
})

test('it is not counted among the filters a reader can clear', () => {
  // Otherwise the badge says 2 and they can only find one, and go hunting
  // for a control that does not exist.
  assert.equal(activeCount([branch, status], { fx: 'Pune', live: 'Open' }, []), 1)
})

// --- what the page does --------------------------------------------------

test('a fixed control filters the page whether or not anyone asked', () => {
  assert.deepEqual(runPage([branch], {}).map((r) => r.Status), ['Open', 'Cancelled'])
})

test('it cannot be overridden by a value in the user’s state', () => {
  // Nothing renders it, so this should be unreachable -- but a stale value
  // from before the admin fixed the control, or a saved view written when it
  // was still live, would otherwise quietly unset a page rule.
  assert.deepEqual(runPage([branch], { fx: 'Nashik' }).map((r) => r.Branch), ['Pune', 'Pune'])
})

test('a fixed button applies its whole condition set, always', () => {
  const rule = {
    id: 'nb',
    kind: 'button',
    mode: 'fixed',
    defaultOn: true,
    match: 'all',
    conditions: [{ tab: 'T', column: 'Status', operator: 'not_equals', value: 'Cancelled' }],
  }
  assert.deepEqual(runPage([rule], {}, []).map((r) => r.Amount), ['10', '30'])
  // ...and stays on even if the user's button state says nothing about it.
  assert.equal(runPage([rule], {}, ['something_else']).length, 2)
})

test('live controls narrow further, on top of the page’s rules', () => {
  const out = runPage([branch, status], { live: 'Open' })
  assert.deepEqual(out.map((r) => r.Amount), ['10'])
})

test('a fixed control with no value narrows nothing, rather than everything', () => {
  assert.equal(runPage([{ ...branch, defaultValue: '' }], {}).length, 3)
})

// --- reset and saved views ------------------------------------------------

test('Reset returns to the page as designed, rules included', () => {
  const { values } = initialValues([branch, { ...status, defaultValue: 'Open' }])
  assert.deepEqual(values, { fx: 'Pune', live: 'Open' })
})

test('a view neither captures a rule nor can drop one', () => {
  const snapshot = captureView({ fx: 'Pune', live: 'Open' }, ['btn'], [branch, status, { id: 'btn', kind: 'button' }])
  assert.deepEqual(snapshot.values, { live: 'Open' })
  assert.deepEqual(snapshot.buttons, ['btn'])
})

test('a view still lights up while a rule is in force', () => {
  // The rule's value is always present in the live state and never in the
  // view, so comparing it would make every view look inactive forever.
  const view = { values: { live: 'Open' }, buttons: [] }
  assert.equal(viewIsActive(view, { live: 'Open', fx: 'Pune' }, [], [branch, status]), true)
  assert.equal(viewIsActive(view, { live: 'Lost', fx: 'Pune' }, [], [branch, status]), false)
})

test('a fixed button does not stop a view from matching either', () => {
  const rule = { id: 'nb', kind: 'button', mode: 'fixed', defaultOn: true }
  const view = { values: {}, buttons: ['b1'] }
  assert.equal(viewIsActive(view, {}, ['b1', 'nb'], [rule, { id: 'b1', kind: 'button' }]), true)
})

test('without the controls list, views compare exactly as they always did', () => {
  const view = { values: { live: 'Open' }, buttons: [] }
  assert.equal(viewIsActive(view, { live: 'Open' }, []), true)
  assert.equal(viewIsActive(view, { live: 'Open', other: 'x' }, []), false)
})
