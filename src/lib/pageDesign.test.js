import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COLUMN_CHOICES,
  DEFAULT_DESIGN,
  GAP_MAX,
  SCALE_MAX,
  SCALE_MIN,
  clampDesign,
  designVars,
  dropIndex,
  dropTargetAt,
  isDefaultDesign,
  moveItem,
} from './pageDesign.js'
import { spanForWidth } from './gridSpan.js'

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
  const d = clampDesign({ gapX: -50, gapY: 9999, columns: 300, fontScale: 12, cardRadius: -4 })
  assert.equal(d.gapX, 0)
  assert.equal(d.gapY, GAP_MAX)
  assert.equal(d.columns, DEFAULT_DESIGN.columns, 'an impossible column count falls back')
  assert.equal(d.fontScale, SCALE_MAX)
  assert.equal(d.cardRadius, 0)
})

test('nonsense is the default, not NaN', () => {
  const d = clampDesign({ gapX: 'wide', fontScale: null, columns: 'lots' })
  assert.equal(d.gapX, DEFAULT_DESIGN.gapX)
  assert.equal(d.fontScale, SCALE_MIN, 'null reads as 0, which clamps up to the floor')
  assert.equal(d.columns, 12)
})

test('every column choice offered is one the design accepts', () => {
  for (const columns of COLUMN_CHOICES) assert.equal(clampDesign({ columns }).columns, columns)
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

// --- the column count is not fixed ---------------------------------------

test('a named width scales with the column count, so no span is baked in', () => {
  // "Half" is half of whatever the canvas is divided into, not six twelfths
  // for ever.
  assert.equal(spanForWidth('half', 'lg', undefined, 12), 6)
  assert.equal(spanForWidth('half', 'lg', undefined, 24), 12)
  assert.equal(spanForWidth('quarter', 'lg', undefined, 8), 2)
  assert.equal(spanForWidth('full', 'lg', undefined, 24), 24)
})

test('an exact span the admin set scales too, and never exceeds the canvas', () => {
  assert.equal(spanForWidth('', 'lg', 3, 24), 6, 'three twelfths is six twenty-fourths')
  assert.equal(spanForWidth('', 'lg', 12, 6), 6, 'never wider than the whole canvas')
  assert.equal(spanForWidth('', 'lg', 1, 24), 2)
})

test('below the large breakpoint a widget still widens, whatever the columns', () => {
  assert.equal(spanForWidth('quarter', 'base', undefined, 24), 24, 'full width on a phone')
  assert.equal(spanForWidth('quarter', 'md', undefined, 24), 12)
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

test('dropping one place to the right actually moves it one place right', () => {
  // The classic drag-and-drop bug: removing the dragged item first shifts
  // everything down by one, so "after b" is index 1, not 2 -- and getting
  // it wrong makes an item refuse to move rightwards at all.
  const ids = ['a', 'b', 'c']
  assert.equal(dropIndex(ids, 'a', 'b', true), 1)
  assert.deepEqual(moveItem(ids, 0, dropIndex(ids, 'a', 'b', true)), ['b', 'a', 'c'])
})

test('dropping before and after land on different sides', () => {
  const ids = ['a', 'b', 'c']
  assert.deepEqual(moveItem(ids, 2, dropIndex(ids, 'c', 'b', false)), ['a', 'c', 'b'])
  assert.deepEqual(moveItem(ids, 2, dropIndex(ids, 'c', 'b', true)), ['a', 'b', 'c'])
})

test('dropping onto something that is not there changes nothing', () => {
  const ids = ['a', 'b']
  assert.equal(dropIndex(ids, 'a', 'zzz', true), 0)
  assert.equal(dropIndex(ids, 'zzz', 'a', true), -1)
})

// --- where a drop lands ---------------------------------------------------

const boxes = [
  { id: 'a', left: 0, top: 0, width: 100, height: 60 },
  { id: 'b', left: 120, top: 0, width: 100, height: 60 },
  { id: 'c', left: 0, top: 100, width: 100, height: 60 },
]

test('a drop lands on the nearest widget, and on the side it was dropped', () => {
  assert.deepEqual(dropTargetAt(boxes, { x: 130, y: 20 }, 'a'), { id: 'b', after: false })
  assert.deepEqual(dropTargetAt(boxes, { x: 210, y: 20 }, 'a'), { id: 'b', after: true })
})

test('a drop in the gap between two widgets still means something', () => {
  // Distance to a centre, not "is the pointer inside a box": a masonry
  // canvas has real gaps, and dropping into one has to land somewhere.
  const hit = dropTargetAt(boxes, { x: 110, y: 30 }, 'c')
  assert.ok(hit && (hit.id === 'a' || hit.id === 'b'))
})

test('a widget is never a drop target for itself', () => {
  assert.equal(dropTargetAt(boxes, { x: 50, y: 30 }, 'a').id !== 'a', true)
})

test('nothing to drop onto is null, not a guess', () => {
  assert.equal(dropTargetAt([], { x: 0, y: 0 }, 'a'), null)
  assert.equal(dropTargetAt([boxes[0]], { x: 0, y: 0 }, 'a'), null)
})
