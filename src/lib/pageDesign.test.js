import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_DESIGN,
  GAP_MAX,
  SCALE_MAX,
  SCALE_MIN,
  clampDesign,
  designVars,
  isDefaultDesign,
  moveItem,
} from './pageDesign.js'

// --- the design itself ----------------------------------------------------

test('an untouched page is the stock design, and emits no card overrides', () => {
  const vars = designVars(undefined)
  assert.equal(vars['--page-gap-x'], '12px')
  assert.equal(vars['--font-scale'], 1)
  assert.equal('--card-radius' in vars, false, 'nothing is re-specified until it is changed')
  assert.equal('--card-bg' in vars, false)
  assert.equal(isDefaultDesign(undefined), true)
})

test('the two gaps are two separate decisions', () => {
  const vars = designVars({ gapX: 28, gapY: 4 })
  assert.equal(vars['--page-gap-x'], '28px')
  assert.equal(vars['--page-gap-y'], '4px')
})

test('a number that cannot be drawn is brought back to one that can', () => {
  // Applied on READ, so a page edited by hand cannot produce a canvas with
  // a negative gap or three hundred columns.
  const d = clampDesign({ gapX: -50, gapY: 9999, fontScale: 12, cardRadius: -4 })
  assert.equal(d.gapX, 0)
  assert.equal(d.gapY, GAP_MAX)
  assert.equal(d.fontScale, SCALE_MAX)
  assert.equal(d.cardRadius, 0)
})

test('nonsense is the default, not NaN', () => {
  const d = clampDesign({ gapX: 'wide', fontScale: null })
  assert.equal(d.gapX, DEFAULT_DESIGN.gapX)
  assert.equal(d.fontScale, SCALE_MIN, 'null reads as 0, which clamps up to the floor')
})

test('a card surface set page-wide reaches the cards', () => {
  const vars = designVars({ cardRadius: 4, cardPadding: 8, cardBg: '#fff8f0', cardBorder: '#eaddcf' })
  assert.equal(vars['--card-radius'], '4px')
  assert.equal(vars['--card-padding'], '8px')
  assert.equal(vars['--card-bg'], '#fff8f0')
  assert.equal(vars['--card-border-color'], '#eaddcf')
})

test('changing anything means it is no longer the stock design', () => {
  assert.equal(isDefaultDesign({ gapY: 24 }), false)
  assert.equal(isDefaultDesign({ ...DEFAULT_DESIGN }), true)
})

// --- moving a widget ------------------------------------------------------

test('a widget can be moved anywhere in the list', () => {
  const list = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveItem(list, 1, 1), ['a', 'b', 'c', 'd'], 'a move to where it already is changes nothing')
})

test('moving does not mutate the list it was given', () => {
  const list = ['a', 'b', 'c']
  moveItem(list, 0, 2)
  assert.deepEqual(list, ['a', 'b', 'c'])
})

test('an index that is not in the list is left alone rather than crashing', () => {
  assert.deepEqual(moveItem(['a', 'b'], 9, 0), ['a', 'b'])
  assert.deepEqual(moveItem(undefined, 0, 1), [])
})
