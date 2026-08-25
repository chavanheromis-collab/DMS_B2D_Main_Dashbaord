import test from 'node:test'
import assert from 'node:assert/strict'

import { MIN_WIDTH, NAMED_FRACTIONS, packRowGroups, requiredWidth, rowGaps, rowOf, rowSlack } from './flowPack.js'

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
  const { positions } = packRowGroups([item('a', 260), item('b', 260), item('c', 260)], {
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
  const { positions } = packRowGroups(
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
  const { positions } = packRowGroups([item('tall', 900, 600), item('small', 200, 80), item('next', 900, 200)], {
    canvasWidth: 1200,
    gapX: 12,
  })
  assert.equal(positions.tall.left, 0)
  assert.equal(positions.small.left, 912, 'beside it, because it fits')
  assert.equal(positions.next.top > positions.small.top, true, 'and the next one is below both')
})

test('a row is as tall as its tallest widget, so rows line up', () => {
  // Three of the same height: nothing to stack under, so the third wraps.
  const { positions, containerHeight } = packRowGroups([item('a', 400, 300), item('b', 400, 300), item('c', 400, 100)], {
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
  const { containerHeight } = packRowGroups([item('a', 400, 100)], { canvasWidth: 900, gapY: 20 })
  assert.equal(containerHeight, 100)
})

test('a measured height beats the estimate', () => {
  const { positions } = packRowGroups([item('a', 400, 100)], { canvasWidth: 900, heights: { a: 555 } })
  assert.equal(positions.a.height, 555)
})

test('a widget wider than the canvas gets its own row rather than looping', () => {
  const { positions, containerHeight } = packRowGroups([item('a', 300, 100), item('wide', 5000, 100)], {
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
  const wide = packRowGroups(items, { canvasWidth: 1264, gapX: 12 })
  const narrow = packRowGroups(items, { canvasWidth: 600, gapX: 12 })

  assert.equal(wide.rows.length, 1, 'three across on a monitor')
  assert.equal(narrow.rows.length, 2, 'two and one on a laptop')
  assert.deepEqual(narrow.rows[0].ids, ['k1', 'k2'])
  assert.deepEqual(narrow.rows[1].ids, ['k3'])
})

test('nothing ever runs off the right-hand edge', () => {
  const items = Array.from({ length: 20 }, (_, i) => item(`w${i}`, 137 + i * 29))
  const { positions } = packRowGroups(items, { canvasWidth: 1000, gapX: 9 })
  for (const [id, p] of Object.entries(positions)) {
    assert.ok(p.left >= 0, id)
    assert.ok(p.left + p.width <= 1000.5, `${id} runs off the edge`)
  }
})

test('an empty page is an empty canvas, not a crash', () => {
  const out = packRowGroups([], { canvasWidth: 1000 })
  assert.deepEqual(out.positions, {})
  assert.equal(out.containerHeight, 0)
})

test('a canvas of nothing does not divide by it', () => {
  const { positions } = packRowGroups([item('a', 200)], { canvasWidth: 0 })
  assert.ok(Number.isFinite(positions.a.width))
})

// --- what is left over ----------------------------------------------------

test('the space going spare on a row is reported, not filled', () => {
  // A widget gets the width it asked for. The leftover is a number somebody
  // needs in order to decide what to type into the width box.
  const { positions, rows } = packRowGroups([item('a', 260), item('b', 260)], { canvasWidth: 1000, gapX: 12 })
  const slack = rowSlack(rows, positions, 1000, 12)
  assert.equal(slack.a, 468, '1000 - 260 - 12 - 260')
  assert.equal(slack.b, 468, 'and it is the same number for everything on the row')
})

test('a full row has nothing spare', () => {
  const { positions, rows } = packRowGroups([item('a', 494), item('b', 494)], { canvasWidth: 1000, gapX: 12 })
  assert.equal(rowSlack(rows, positions, 1000, 12).a, 0)
})

// --- rows you can put a widget IN ----------------------------------------

const rowItem = (id, widthPx, row, height = 100) => ({ id, widthPx, row, estimatedHeight: height })

test('a page with no rows assigned flows, because unset is row 1', () => {
  // Not a special case: everything starts in row 1 and row 1 spills.
  const { positions } = packRowGroups([item('a', 400), item('b', 400), item('c', 400)], {
    canvasWidth: 900,
    gapX: 12,
  })
  assert.deepEqual([positions.a.left, positions.b.left], [0, 412], 'two across')
  assert.equal(positions.c.left, 0, 'and the third starts the next row')
  assert.ok(positions.c.top > positions.a.top)
})

test('a widget put in row 2 stays in row 2, whatever happens above it', () => {
  const { positions, rows } = packRowGroups(
    [rowItem('a', 300, 1), rowItem('pinned', 300, 2), rowItem('b', 300, 1)],
    { canvasWidth: 1000, gapX: 12 }
  )
  assert.equal(positions.a.row, 1)
  assert.equal(positions.b.row, 1, 'and it is still on row 1, beside a')
  assert.equal(positions.pinned.row, 2)
  assert.equal(positions.pinned.left, 0, 'at the start of its own row')
  assert.equal(rows.length, 2)
})

test('a row that runs out of width spills into the next one', () => {
  const { positions } = packRowGroups(
    [rowItem('a', 400, 1), rowItem('b', 400, 1), rowItem('c', 400, 1)],
    { canvasWidth: 900, gapX: 12 }
  )
  assert.equal(positions.a.row, 1)
  assert.equal(positions.b.row, 1)
  assert.equal(positions.c.row, 2, 'no room left, so it goes to the next row')
  assert.equal(positions.c.left, 0)
})

test('what spilled goes ahead of what was already assigned there', () => {
  // It came first in the sort, so it comes first on the row.
  const { positions } = packRowGroups(
    [rowItem('a', 500, 1), rowItem('b', 500, 1), rowItem('later', 300, 2)],
    { canvasWidth: 900, gapX: 12 }
  )
  assert.equal(positions.b.row, 2)
  assert.equal(positions.b.left, 0, 'the spilled one is first')
  assert.equal(positions.later.left, 512, 'and the assigned one follows it')
})

test('a row is as tall as its tallest widget, so rows line up', () => {
  const { positions, rows, containerHeight } = packRowGroups(
    [rowItem('short', 300, 1, 80), rowItem('tall', 300, 1, 260), rowItem('next', 300, 2, 100)],
    { canvasWidth: 1000, gapX: 12, gapY: 20 }
  )
  assert.equal(rows[0].height, 260)
  assert.equal(positions.next.top, 280, 'below the tallest thing above it, plus the gap')
  assert.equal(containerHeight, 380)
})

test('an empty row between two full ones is simply not drawn', () => {
  // Assigning something to row 5 of a two-row page should not leave three
  // bands of white space above it.
  const { positions, rows } = packRowGroups([rowItem('a', 300, 1), rowItem('z', 300, 5)], {
    canvasWidth: 1000,
    gapX: 12,
    gapY: 10,
  })
  assert.equal(rows.length, 2)
  assert.equal(positions.z.top, positions.a.height + 10)
})

test('a widget wider than the canvas takes a row of its own rather than looping', () => {
  const { positions, containerHeight } = packRowGroups(
    [rowItem('a', 300, 1), rowItem('wide', 5000, 1), rowItem('b', 300, 1)],
    { canvasWidth: 600, gapX: 12 }
  )
  assert.equal(positions.wide.width, 600)
  assert.ok(positions.wide.top > positions.a.top)
  assert.ok(positions.b.top > positions.wide.top)
  assert.ok(Number.isFinite(containerHeight))
})

test('rows come out in order and nothing overlaps', () => {
  const items = Array.from({ length: 14 }, (_, i) => rowItem(`w${i}`, 200 + (i % 3) * 90, (i % 4) + 1, 60 + i * 5))
  const { positions, rows } = packRowGroups(items, { canvasWidth: 900, gapX: 10, gapY: 10 })

  assert.deepEqual(rows.map((r) => r.top), [...rows.map((r) => r.top)].sort((a, b) => a - b))
  for (const row of rows) {
    let edge = 0
    for (const id of row.ids) {
      assert.ok(positions[id].left >= edge - 0.5, `${id} overlaps its neighbour`)
      edge = positions[id].left + positions[id].width + 10
    }
    assert.ok(edge - 10 <= 900.5, `row ${row.row} runs off the canvas`)
  }
})

test('a row number that is nonsense is row 1, not a crash', () => {
  assert.equal(rowOf({ row: 'second' }), 1)
  assert.equal(rowOf({ row: 0 }), 1)
  assert.equal(rowOf({ row: -3 }), 1)
  assert.equal(rowOf({}), 1)
  assert.equal(rowOf({ row: '3' }), 3)
})

test('an empty page is an empty canvas here too', () => {
  const out = packRowGroups([], { canvasWidth: 1000 })
  assert.deepEqual(out.rows, [])
  assert.equal(out.containerHeight, 0)
})

// --- the empty space, drawn ----------------------------------------------

test('the space left on a row is a rectangle with a size in it', () => {
  // Not "there is room" but "there is room for 428 by 94", which is the
  // question anybody actually has while arranging.
  const { positions, rows } = packRowGroups([rowItem('a', 260, 1, 94), rowItem('b', 260, 1, 94)], {
    canvasWidth: 1000,
    gapX: 12,
  })
  const gaps = rowGaps(rows, positions, 1000, 12)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].left, 544, 'starting a gap after the last widget')
  assert.equal(gaps[0].width, 456)
  assert.equal(gaps[0].height, 94, 'as tall as the row it is on')
})

test('a gap too narrow to hold anything is not drawn', () => {
  // A strip narrower than a widget is not somewhere a widget could go, and
  // drawing it would be noise.
  const { positions, rows } = packRowGroups([rowItem('a', 500, 1), rowItem('b', 450, 1)], {
    canvasWidth: 1000,
    gapX: 12,
  })
  assert.deepEqual(rowGaps(rows, positions, 1000, 12), [])
})

test('a full row has no gap at all', () => {
  const { positions, rows } = packRowGroups([rowItem('a', 494, 1), rowItem('b', 494, 1)], {
    canvasWidth: 1000,
    gapX: 12,
  })
  assert.deepEqual(rowGaps(rows, positions, 1000, 12), [])
})

test('every row gets its own gap, at its own height', () => {
  const { positions, rows } = packRowGroups(
    [rowItem('a', 300, 1, 80), rowItem('b', 300, 2, 200)],
    { canvasWidth: 1000, gapX: 12, gapY: 10 }
  )
  const gaps = rowGaps(rows, positions, 1000, 12)
  assert.equal(gaps.length, 2)
  assert.deepEqual(gaps.map((g) => g.height), [80, 200])
  assert.deepEqual(gaps.map((g) => g.row), [1, 2])
})

test('a gap is measured from the widest widget on the row, not the last one', () => {
  // Widgets on a row can wrap in the middle if one is short; the free space
  // starts after whichever edge is furthest right.
  const { positions, rows } = packRowGroups([rowItem('a', 400, 1), rowItem('b', 200, 1)], {
    canvasWidth: 1000,
    gapX: 12,
  })
  const gap = rowGaps(rows, positions, 1000, 12)[0]
  assert.equal(gap.left, 624, '400 + 12 + 200, then a gap')
  assert.equal(gap.width, 376)
})

// --- the space a short widget leaves ------------------------------------

test('a widget that will not fit along the row goes UNDER a short one', () => {
  // A widget half the height of the one beside it leaves a rectangle, and a
  // rectangle that fits is not one anybody wants left empty.
  const { positions } = packRowGroups([item('short', 400, 100), item('tall', 400, 300), item('next', 400, 120)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  assert.equal(positions.next.left, 0, 'under the short one, not on a new row')
  assert.equal(positions.next.top, 120, 'its bottom, plus the gap')
  assert.equal(positions.next.stacked, true)
})

test('it only drops into a gap once the row is actually full', () => {
  // Reading order still runs left to right: nothing jumps into a hole ahead
  // of its turn while there is room beside it.
  const { positions } = packRowGroups([item('short', 200, 100), item('tall', 200, 300), item('next', 200, 80)], {
    canvasWidth: 900,
    gapX: 12,
  })
  assert.equal(positions.next.left, 424, 'beside them, because there is room')
  assert.equal(positions.next.top, 0)
  assert.ok(!positions.next.stacked)
})

test('a widget too tall for the gap still goes to the next row', () => {
  const { positions } = packRowGroups([item('short', 400, 100), item('tall', 400, 300), item('big', 400, 400)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  assert.equal(positions.big.left, 0)
  assert.ok(positions.big.top >= 320, 'a new row, not squashed into 180px')
  assert.ok(!positions.big.stacked)
})

test('a widget too wide for the gap still goes to the next row', () => {
  const { positions } = packRowGroups([item('short', 200, 100), item('tall', 600, 300), item('wide', 500, 80)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  assert.ok(!positions.wide.stacked, '500 does not fit in a 200-wide gap')
})

test('two can stack under the same short widget if they both fit', () => {
  const { positions } = packRowGroups(
    [item('short', 300, 60), item('tall', 500, 400), item('a', 300, 100), item('b', 300, 100)],
    { canvasWidth: 900, gapX: 12, gapY: 10 }
  )
  assert.equal(positions.a.left, 0)
  assert.equal(positions.a.top, 70)
  assert.equal(positions.b.left, 0)
  assert.equal(positions.b.top, 180, 'under the one that just went under')
})

test('stacked widgets never overlap what they were stacked under', () => {
  const { positions } = packRowGroups([item('short', 400, 100), item('tall', 400, 300), item('next', 400, 120)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  assert.ok(positions.next.top >= positions.short.top + positions.short.height)
})

test('the gap under a short widget is offered as a size, like the one beside it', () => {
  const { positions, rows } = packRowGroups([item('short', 400, 100), item('tall', 400, 300)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  const gaps = rowGaps(rows, positions, 900, 12, MIN_WIDTH, 20)
  const under = gaps.find((g) => g.under)
  assert.ok(under, 'the room below the short one is somewhere a widget could go')
  assert.equal(under.left, 0)
  assert.equal(under.top, 120)
  assert.equal(under.width, 400)
  assert.equal(under.height, 180)
})

test('a widget that fills its row leaves no gap underneath', () => {
  const { positions, rows } = packRowGroups([item('a', 400, 300), item('b', 400, 300)], {
    canvasWidth: 812,
    gapX: 12,
    gapY: 20,
  })
  assert.deepEqual(rowGaps(rows, positions, 812, 12, MIN_WIDTH, 20).filter((g) => g.under), [])
})
