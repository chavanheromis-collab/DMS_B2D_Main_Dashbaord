import test from 'node:test'
import assert from 'node:assert/strict'

import { CHART_SCROLL, chartExtent, labelEveryCategory, legendHeight } from './chartScroll.js'

// --- a chart that fits is left alone --------------------------------------

test('a handful of categories changes nothing', () => {
  const out = chartExtent({ count: 5, horizontal: true, frame: 260 })
  assert.equal(out.height, 260, 'still exactly the height the widget was given')
  assert.equal(out.scrolls, false)
})

test('a horizontal chart grows down once its rows stop fitting', () => {
  // Forty bars in the height of twelve are hairlines, and the axis silently
  // drops four labels in five.
  const out = chartExtent({ count: 40, horizontal: true, frame: 260 })
  assert.equal(out.height, 40 * CHART_SCROLL.rowHeight)
  assert.ok(out.height > 260)
  assert.equal(out.scrolls, true)
  assert.equal(out.axis, 'y')
})

test('every category gets the same room, however many there are', () => {
  const ten = chartExtent({ count: 10, horizontal: true, frame: 100 })
  const twenty = chartExtent({ count: 20, horizontal: true, frame: 100 })
  assert.equal(twenty.height - ten.height, 10 * CHART_SCROLL.rowHeight)
})

test('a vertical chart asks for a minimum width instead', () => {
  // The card's width is not knowable here, so the answer is a floor: a chart
  // with room still fills its card, one without pushes past it.
  const out = chartExtent({ count: 30, frame: 260 })
  assert.equal(out.height, 260, 'its height is untouched')
  assert.equal(out.minWidth, 30 * CHART_SCROLL.colWidth)
  assert.equal(out.axis, 'x')
  assert.equal(out.scrolls, false, 'whether it does is the browser’s business, and we do not claim to know')
})

test('a chart never shrinks below being a chart', () => {
  assert.equal(chartExtent({ count: 1, horizontal: true, frame: 10 }).height, CHART_SCROLL.minSize)
  assert.equal(chartExtent({ count: 0, horizontal: true }).scrolls, false)
})

test('nonsense in, something drawable out', () => {
  assert.equal(chartExtent({}).height, 260, 'no frame given falls back to the default one')
  assert.equal(chartExtent({ count: -5, horizontal: true }).scrolls, false)
  assert.equal(chartExtent({ count: 'x', horizontal: true, frame: 200 }).height, 200)
})

// --- labels ---------------------------------------------------------------

test('once a chart has room for every bar, every bar is labelled', () => {
  // Recharts thins labels when they collide -- right inside a fixed frame,
  // wrong once the chart has been given the room, where a dropped label is a
  // category the reader cannot name.
  assert.equal(labelEveryCategory(40, { horizontal: true, frame: 260 }), true)
  assert.equal(labelEveryCategory(5, { horizontal: true, frame: 260 }), false)
})

// --- legends --------------------------------------------------------------

test('a legend grows with its series, up to a point', () => {
  assert.ok(legendHeight(2) < legendHeight(4))
  assert.equal(legendHeight(40), 84, 'capped, because a legend is a key and not the chart')
  assert.equal(legendHeight(0), 18)
})
