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
import { drawnWidth, packRows, spanForWidth } from './gridSpan.js'

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

// --- how the page packs ---------------------------------------------------

test('the packing mode is a setting, and nonsense falls back to masonry', () => {
  assert.equal(clampDesign({ packing: 'rows' }).packing, 'rows')
  assert.equal(clampDesign({ packing: 'diagonal' }).packing, 'masonry')
  assert.equal(clampDesign(undefined).packing, 'masonry')
})

test('snapping widths is off unless it is actually turned on', () => {
  assert.equal(clampDesign({ snapWidths: true }).snapWidths, true)
  assert.equal(clampDesign({ snapWidths: 'yes' }).snapWidths, false, 'a truthy string is not a decision')
  assert.equal(clampDesign(undefined).snapWidths, false)
})

test('rows keeps the admin’s order, left to right, wrapping at the edge', () => {
  // The layout the screenshot needed: three KPIs across the top and the
  // wide widgets underneath, in the order they were put there.
  const items = [
    { id: 'k1', estimatedHeight: 94 },
    { id: 'k2', estimatedHeight: 94 },
    { id: 'k3', estimatedHeight: 94 },
    { id: 'w4', estimatedHeight: 583 },
    { id: 'w5', estimatedHeight: 483 },
  ]
  const spans = { k1: 3, k2: 3, k3: 3, w4: 4, w5: 4 }
  const { positions } = packRows(items, spans, {}, 12, 12)

  assert.deepEqual(
    ['k1', 'k2', 'k3'].map((id) => positions[id].col),
    [0, 3, 6],
    'the KPI row runs across'
  )
  assert.equal(positions.k1.top, 0)
  assert.equal(positions.w4.col, 0, 'the next row starts at the left, not in the gap beside a KPI')
  assert.equal(positions.w4.top, 106, 'below the tallest thing in the row above')
  assert.equal(positions.w5.col, 4, 'and the one after it follows on')
  assert.equal(positions.w5.top, 106)
})

test('a row ends when the next widget will not fit', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const spans = { a: 8, b: 8, c: 8 }
  const { positions } = packRows(items, spans, { a: 100, b: 100, c: 100 }, 10, 12)
  assert.deepEqual([positions.a.col, positions.b.col, positions.c.col], [0, 0, 0])
  assert.deepEqual([positions.a.top, positions.b.top, positions.c.top], [0, 110, 220])
})

test('a full-width widget gets its own row rather than being squeezed in', () => {
  const items = [{ id: 'a' }, { id: 'wide' }, { id: 'b' }]
  const spans = { a: 4, wide: 12, b: 4 }
  const { positions } = packRows(items, spans, { a: 50, wide: 50, b: 50 }, 10, 12)
  assert.equal(positions.wide.col, 0)
  assert.ok(positions.wide.top > positions.a.top)
  assert.ok(positions.b.top > positions.wide.top)
})

test('rows never places anything past the edge of the canvas', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, estimatedHeight: 40 }))
  const spans = Object.fromEntries(items.map((it, i) => [it.id, (i % 4) + 2]))
  const { positions } = packRows(items, spans, {}, 12, 12)
  for (const item of items) {
    const p = positions[item.id]
    assert.ok(p.col + p.span <= 12, `${item.id} runs off the canvas`)
  }
})

test('the canvas is exactly as tall as what is on it', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  const { containerHeight } = packRows(items, { a: 6, b: 6 }, { a: 100, b: 250 }, 12, 12)
  assert.equal(containerHeight, 250, 'one row, as tall as its tallest')
})

test('a width told to fill its columns does exactly that', () => {
  assert.equal(drawnWidth(260, { left: 0, containerWidth: 1200, spanWidth: 316, stretch: true }), 316)
  assert.equal(drawnWidth(260, { left: 0, containerWidth: 1200, spanWidth: 316 }), 260, 'and does not, otherwise')
})

test('stretching an unpinned widget is still just its span', () => {
  assert.equal(drawnWidth(0, { left: 0, containerWidth: 1200, spanWidth: 316, stretch: true }), 316)
})
