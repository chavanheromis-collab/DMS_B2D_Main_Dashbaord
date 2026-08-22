import test from 'node:test'
import assert from 'node:assert/strict'

import { stripUndefined } from './firestoreSafe.js'

test('undefined properties are dropped, null is kept', () => {
  // `null` is how "cleared" is spelled -- Firestore stores it happily, and
  // under { merge: true } it actually overwrites the old value, which
  // dropping the key would not.
  assert.deepEqual(stripUndefined({ a: 1, b: undefined, c: null }), { a: 1, c: null })
})

test('the real bug: a cleared width no longer poisons the whole document', () => {
  const control = { id: 'c1', kind: 'select', widthPx: null, width: undefined }
  const clean = stripUndefined(control)
  assert.equal('width' in clean, false)
  assert.equal(clean.widthPx, null)
})

test('nesting is handled at every depth', () => {
  const page = {
    widgets: [{ id: 'w1', style: { bg: undefined, radius: 12 } }],
    controls: [{ id: 'c1', links: [{ tab: 'a', column: undefined }] }],
  }
  assert.deepEqual(stripUndefined(page), {
    widgets: [{ id: 'w1', style: { radius: 12 } }],
    controls: [{ id: 'c1', links: [{ tab: 'a' }] }],
  })
})

test('an undefined ARRAY ELEMENT becomes null rather than vanishing', () => {
  // Dropping it would renumber everything after it and silently reorder an
  // ordered list of widgets or controls.
  const out = stripUndefined({ items: ['a', undefined, 'c'] })
  assert.equal(out.items.length, 3)
  assert.deepEqual(out.items, ['a', null, 'c'])
})

test('non-plain objects pass through untouched', () => {
  // Rebuilding a Date as a plain object would destroy it.
  const date = new Date(2026, 0, 1)
  assert.equal(stripUndefined({ at: date }).at, date)
})

test('primitives and empties survive', () => {
  assert.equal(stripUndefined(null), null)
  assert.equal(stripUndefined(0), 0)
  assert.equal(stripUndefined(''), '')
  assert.equal(stripUndefined(false), false)
  assert.deepEqual(stripUndefined({}), {})
  assert.deepEqual(stripUndefined([]), [])
})

test('the input is not mutated', () => {
  const input = { a: 1, b: undefined }
  stripUndefined(input)
  assert.equal('b' in input, true)
})
