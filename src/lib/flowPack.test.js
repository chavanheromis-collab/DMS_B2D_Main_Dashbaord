import test from 'node:test'
import assert from 'node:assert/strict'

import { MIN_WIDTH, NAMED_FRACTIONS, packFlow, requiredWidth, rowSlack } from './flowPack.js'

const item = (id, widthPx, estimatedHeight = 100) => ({ id, widthPx, estimatedHeight })

// --- how wide a widget asks to be ----------------------------------------

test('a pinned width is honoured exactly, with nothing rounded up', () => {
  // The whole reason this file exists: 260 is 260, not the 316 a column grid
  // would have charged for it.
  assert.equal(requiredWidth({ widthPx: 260 }, 1264), 260)
  assert.equal(requiredWidth({ widthPx: 417 }, 1264), 417)
})

test('a widget with no pinned width falls back to the one it was built with', () => {
  assert.equal(requiredWidth({ width: 'half' }, 1200), 600)
  assert.equal(requiredWidth({ width: 'quarter' }, 1200), 300)
  assert.equal(requiredWidth({ width: 'full' }, 1200), 1200)
  assert.equal(requiredWidth({}, 1200), 1200, 'and an unknown name is the whole width')
})

test('every named width the app offers resolves to something drawable', () => {
  for (const name of Object.keys(NAMED_FRACTIONS)) {
    const w = requiredWidth({ width: name }, 1000)
    assert.ok(w >= MIN_WIDTH && w <= 1000, name)
  }
})

test('a widget is never wider than the canvas', () => {
  // A 900px widget on a phone is the phone's width, not a horizontal
  // scrollbar across the whole page.
  assert.equal(requiredWidth({ widthPx: 900 }, 360), 360)
})

test('a width too small to read is raised to a floor', () => {
  assert.equal(requiredWidth({ widthPx: 4 }, 1200), MIN_WIDTH)
})

// --- the packing ----------------------------------------------------------

test('widgets sit side by side, each taking only what it asked for', () => {
  const { positions } = packFlow([item('a', 260), item('b', 260), item('c', 260)], {
    canvasWidth: 1264,
    gapX: 12,
  })
  assert.deepEqual([positions.a.left, positions.b.left, positions.c.left], [0, 272, 544])
  assert.deepEqual([positions.a.width, positions.b.width, positions.c.width], [260, 260, 260])
})

test('the row that used to leave a hole now simply carries on', () => {
  // Three 260px KPIs and two 417px widgets: the exact page that started all
  // of this. The fourth widget follows the third on the SAME row, because
  // there is room for it and no column boundary to wait for.
  const { positions } = packFlow(
    [item('k1', 260, 94), item('k2', 260, 94), item('k3', 260, 94), item('w4', 417, 583), item('w5', 417, 483)],
    { canvasWidth: 1264, gapX: 12, gapY: 12 }
  )
  assert.equal(positions.k1.top, 0)
  assert.equal(positions.k2.top, 0)
  assert.equal(positions.k3.top, 0)
  assert.equal(positions.w4.left, 816, 'straight after the third KPI')
  assert.equal(positions.w4.top, 0, 'and still on the first row')

  // The fifth does not fit, so it starts the next row -- below the tallest
  // thing in the row above, not tucked into a gap.
  assert.equal(positions.w5.left, 0)
  assert.equal(positions.w5.top, 595)
})

test('the order is the order — nothing is ever moved past anything else', () => {
  // A masonry would have tucked the small one into the gap beside the tall
  // one. What the admin arranged is what the reader reads.
  const { positions } = packFlow([item('tall', 900, 600), item('small', 200, 80), item('next', 900, 200)], {
    canvasWidth: 1200,
    gapX: 12,
  })
  assert.equal(positions.tall.left, 0)
  assert.equal(positions.small.left, 912, 'beside it, because it fits')
  assert.equal(positions.next.top > positions.small.top, true, 'and the next one is below both')
})

test('a row is as tall as its tallest widget, so rows line up', () => {
  const { positions, containerHeight } = packFlow([item('a', 400, 100), item('b', 400, 300), item('c', 400, 100)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  assert.equal(positions.a.top, 0)
  assert.equal(positions.b.top, 0)
  assert.equal(positions.c.top, 320, 'below the 300 in the row above, plus the gap')
  assert.equal(containerHeight, 420)
})

test('the canvas is exactly as tall as what is on it, with no trailing gap', () => {
  const { containerHeight } = packFlow([item('a', 400, 100)], { canvasWidth: 900, gapY: 20 })
  assert.equal(containerHeight, 100)
})

test('a measured height beats the estimate', () => {
  const { positions } = packFlow([item('a', 400, 100)], { canvasWidth: 900, heights: { a: 555 } })
  assert.equal(positions.a.height, 555)
})

test('a widget wider than the canvas gets its own row rather than looping', () => {
  const { positions, containerHeight } = packFlow([item('a', 300, 100), item('wide', 5000, 100)], {
    canvasWidth: 600,
    gapX: 12,
    gapY: 10,
  })
  assert.equal(positions.wide.left, 0)
  assert.equal(positions.wide.width, 600, 'clamped to the canvas')
  assert.ok(positions.wide.top > positions.a.top)
  assert.ok(Number.isFinite(containerHeight))
})

test('the same page reflows on a narrower canvas with nobody configuring it', () => {
  const items = [item('k1', 260), item('k2', 260), item('k3', 260)]
  const wide = packFlow(items, { canvasWidth: 1264, gapX: 12 })
  const narrow = packFlow(items, { canvasWidth: 600, gapX: 12 })

  assert.equal(wide.rows.length, 1, 'three across on a monitor')
  assert.equal(narrow.rows.length, 2, 'two and one on a laptop')
  assert.deepEqual(narrow.rows[0].ids, ['k1', 'k2'])
  assert.deepEqual(narrow.rows[1].ids, ['k3'])
})

test('nothing ever runs off the right-hand edge', () => {
  const items = Array.from({ length: 20 }, (_, i) => item(`w${i}`, 137 + i * 29))
  const { positions } = packFlow(items, { canvasWidth: 1000, gapX: 9 })
  for (const [id, p] of Object.entries(positions)) {
    assert.ok(p.left >= 0, id)
    assert.ok(p.left + p.width <= 1000.5, `${id} runs off the edge`)
  }
})

test('an empty page is an empty canvas, not a crash', () => {
  const out = packFlow([], { canvasWidth: 1000 })
  assert.deepEqual(out.positions, {})
  assert.equal(out.containerHeight, 0)
})

test('a canvas of nothing does not divide by it', () => {
  const { positions } = packFlow([item('a', 200)], { canvasWidth: 0 })
  assert.ok(Number.isFinite(positions.a.width))
})

// --- what is left over ----------------------------------------------------

test('the space going spare on a row is reported, not filled', () => {
  // A widget gets the width it asked for. The leftover is a number somebody
  // needs in order to decide what to type into the width box.
  const { positions, rows } = packFlow([item('a', 260), item('b', 260)], { canvasWidth: 1000, gapX: 12 })
  const slack = rowSlack(rows, positions, 1000, 12)
  assert.equal(slack.a, 468, '1000 - 260 - 12 - 260')
  assert.equal(slack.b, 468, 'and it is the same number for everything on the row')
})

test('a full row has nothing spare', () => {
  const { positions, rows } = packFlow([item('a', 494), item('b', 494)], { canvasWidth: 1000, gapX: 12 })
  assert.equal(rowSlack(rows, positions, 1000, 12).a, 0)
})
