import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_ROW_SPAN,
  MIN_FIT,
  hasRow,
  MIN_HEIGHT,
  MIN_WIDTH,
  STACK_WIDTH,
  fitFor,
  wantedWidth,
  NAMED_FRACTIONS,
  packRowGroups,
  requiredWidth,
  rowGaps,
  rowOf,
  rowSlack,
  rowSpanOf,
  pinnedHeight,
} from './flowPack.js'

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
// A typed height, which is what stacking needs: see the shelf rule.
const pinned = (id, widthPx, heightPx) => ({ id, widthPx, heightPx, estimatedHeight: heightPx })

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

test('A ROW SOMEBODY TYPED WRAPS RATHER THAN SPILLING', () => {
  // A row an admin chose is an instruction. A widget that could be evicted
  // from it by a day with less data in it is not following one.
  const { positions } = packRowGroups(
    [rowItem('a', 400, 1), rowItem('b', 400, 1), rowItem('c', 400, 1)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  assert.equal(positions.a.row, 1)
  assert.equal(positions.b.row, 1)
  assert.equal(positions.c.row, 1, 'still row 1 — on a second line inside it')
  assert.equal(positions.c.left, 0)
  assert.equal(positions.c.top, 120, 'below the first line, plus the gap')
})

test('a widget nobody put anywhere still flows', () => {
  // Blank is row 1 for packing, but it is not somebody SAYING row 1 -- so a
  // page nobody has assigned rows to behaves exactly as it always did.
  const { positions } = packRowGroups([item('a', 400), item('b', 400), item('c', 400)], {
    canvasWidth: 900,
    gapX: 12,
  })
  assert.equal(positions.c.row, 2)
  assert.equal(positions.c.left, 0)
})

test('what spilled goes ahead of what was already assigned there', () => {
  // It came first in the sort, so it comes first on the row. Only a widget
  // nobody placed can spill now, so `a` and `b` have no row of their own.
  const { positions } = packRowGroups([item('a', 500), item('b', 500), rowItem('later', 300, 2)], {
    canvasWidth: 900,
    gapX: 12,
  })
  assert.equal(positions.b.row, 2)
  assert.equal(positions.b.left, 0, 'the spilled one is first')
  assert.equal(positions.later.left, 512, 'and the assigned one follows it')
})

test('a typed row never gives way to what spilled from above', () => {
  // The spilled one is first ON the row; it does not push the row's own
  // widgets off the end of it.
  const { positions } = packRowGroups([item('a', 500), item('b', 500), rowItem('mine', 500, 2)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 10,
  })
  assert.equal(positions.b.row, 2)
  assert.equal(positions.mine.row, 2, 'still row 2, on a second line of it')
  assert.equal(positions.mine.left, 0)
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
    // Per LINE: a row is a band, and a band that wrapped starts again at
    // the left edge on the line below.
    for (const line of row.lines) {
      let edge = 0
      for (const id of line.ids) {
        assert.ok(positions[id].left >= edge - 0.5, `${id} overlaps its neighbour`)
        edge = positions[id].left + positions[id].width + 10
      }
      assert.ok(edge - 10 <= 900.5, `row ${row.row} runs off the canvas`)
    }
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
  const { positions } = packRowGroups(
    [pinned('short', 400, 100), pinned('tall', 400, 300), pinned('next', 400, 120)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
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
    [pinned('short', 300, 60), pinned('tall', 500, 400), pinned('a', 300, 100), pinned('b', 300, 100)],
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
  const { positions, rows } = packRowGroups([pinned('short', 400, 100), pinned('tall', 400, 300)], {
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

// --- a widget that covers several rows -----------------------------------

const at = (id, row, widthPx, estimatedHeight = 100, rowSpan) => ({ id, row, widthPx, estimatedHeight, rowSpan })

test('a span is one row unless somebody says otherwise', () => {
  assert.equal(rowSpanOf({}), 1)
  assert.equal(rowSpanOf({ rowSpan: 1 }), 1)
  assert.equal(rowSpanOf({ rowSpan: 3 }), 3)
  assert.equal(rowSpanOf({ rowSpan: '4' }), 4)
  assert.equal(rowSpanOf({ rowSpan: 0 }), 1, 'and nonsense is one row')
  assert.equal(rowSpanOf({ rowSpan: -2 }), 1)
  assert.equal(rowSpanOf({ rowSpan: 'tall' }), 1)
  assert.equal(rowSpanOf({ rowSpan: 900 }), MAX_ROW_SPAN, 'capped, so it cannot run away')
})

test('a span holds its width in every row it covers', () => {
  // The chart on the left is 400 wide across rows 1-3, so the KPI assigned
  // to row 2 starts after it rather than under it.
  const { positions } = packRowGroups(
    [at('tall', 1, 400, 300, 3), at('k1', 1, 300, 90), at('k2', 2, 300, 90), at('k3', 3, 300, 90)],
    { canvasWidth: 1000, gapX: 12, gapY: 12 }
  )
  assert.equal(positions.tall.left, 0)
  assert.equal(positions.k1.left, 412)
  assert.equal(positions.k2.left, 412, 'row 2 starts past the span, not under it')
  assert.equal(positions.k3.left, 412)
})

test('and is as tall as those rows are together', () => {
  const { positions } = packRowGroups(
    [at('tall', 1, 400, 100, 3), at('k1', 1, 300, 90), at('k2', 2, 300, 90), at('k3', 3, 300, 90)],
    { canvasWidth: 1000, gapX: 12, gapY: 12 }
  )
  // Three rows of 90 with two 12px gaps between them.
  assert.equal(positions.tall.height, 90 * 3 + 12 * 2)
  assert.equal(positions.tall.spanned, true)
  assert.equal(positions.k3.top + 90, positions.tall.top + positions.tall.height, 'bordered by the last row')
})

test('a span does NOT set the height of the row it starts in', () => {
  // Otherwise every row below it would be as tall as the whole span, and
  // the page would grow by the height of the chart three times over.
  const { rows } = packRowGroups(
    [at('tall', 1, 400, 600, 3), at('k1', 1, 300, 90), at('k2', 2, 300, 90), at('k3', 3, 300, 90)],
    { canvasWidth: 1000, gapX: 12, gapY: 12 }
  )
  assert.equal(rows[0].height, 90)
  assert.equal(rows[1].height, 90)
})

test('a span taller than its band pushes only the LAST row down', () => {
  // Slack spread through every row would move things that had no reason to
  // move; the bottom one is where the extra actually is.
  const { rows, positions } = packRowGroups(
    [at('tall', 1, 400, 600, 3), at('k1', 1, 300, 90), at('k2', 2, 300, 90), at('k3', 3, 300, 90)],
    { canvasWidth: 1000, gapX: 12, gapY: 12 }
  )
  assert.equal(rows[0].height, 90)
  assert.equal(rows[1].height, 90)
  assert.equal(rows[2].height, 600 - (90 + 12 + 90 + 12))
  assert.equal(positions.tall.height, 600)
})

test('a row with nothing but a span passing through it still exists', () => {
  const { rows, positions } = packRowGroups([at('tall', 1, 400, 500, 3)], {
    canvasWidth: 1000,
    gapX: 12,
    gapY: 12,
  })
  assert.deepEqual(rows.map((r) => r.row), [1, 2, 3])
  assert.equal(positions.tall.height, 500, 'and the span gets the height it asked for')
})

test('the space a span is holding is not space going spare', () => {
  const { rows, positions } = packRowGroups([at('tall', 1, 400, 300, 2), at('b', 2, 300, 90)], {
    canvasWidth: 1000,
    gapX: 12,
    gapY: 12,
  })
  const slack = rowSlack(rows, positions, 1000, 12)
  // Row 2 holds 400 for the span plus a 300 widget, both with a gap.
  assert.equal(slack.b, 1000 - (400 + 12) - 300)
})

test('no dotted box is drawn over a widget standing there from a row above', () => {
  // A "300 x 90 fits here" label across something already on the page is an
  // invitation to a collision.
  const { rows, positions } = packRowGroups([at('tall', 1, 700, 300, 2), at('b', 2, 100, 90)], {
    canvasWidth: 1000,
    gapX: 12,
    gapY: 12,
  })
  const row2 = rows.find((r) => r.row === 2)
  assert.equal(row2.blocked.length, 1)
  for (const gap of rowGaps(rows, positions, 1000, 12, MIN_WIDTH, 12)) {
    for (const b of rows.find((r) => r.row === gap.row).blocked || []) {
      assert.ok(gap.left + gap.width <= b.left + 0.5 || gap.left >= b.right - 0.5, 'gap overlaps a held stretch')
    }
  }
})

test('a span never stacks into the gap under a short widget', () => {
  // It is meant to reach down through several rows; tucking it under one of
  // them would be the opposite of what was asked for.
  const { positions } = packRowGroups(
    [pinned('wide', 700, 300), pinned('short', 200, 100), { ...at('tall', 1, 200, 100, 2), heightPx: 100 }],
    { canvasWidth: 950, gapX: 12, gapY: 12 }
  )
  assert.equal(positions.tall.stacked, undefined)
  assert.equal(positions.tall.row, 1, 'it took a second line of its own row')
  assert.equal(positions.tall.left, 0)
})

test('a page with no spans lays out exactly as it did before there were any', () => {
  // The guarantee that this feature is invisible until it is used.
  const items = [item('a', 260), item('b', 260, 300), item('c', 500), item('d', 700, 140)]
  const { positions, rows, containerHeight } = packRowGroups(items, { canvasWidth: 812, gapX: 12, gapY: 20 })
  assert.deepEqual(
    items.map((i) => [positions[i.id].left, positions[i.id].top, positions[i.id].width, positions[i.id].height]),
    [
      [0, 0, 260, 100],
      [272, 0, 260, 300],
      [0, 320, 500, 100],
      [0, 440, 700, 140],
    ]
  )
  assert.deepEqual(rows.map((r) => [r.row, r.top, r.height]), [[1, 0, 300], [2, 320, 100], [3, 440, 140]])
  assert.equal(containerHeight, 580)
})

test('every position says how many rows it covers', () => {
  const { positions } = packRowGroups([at('tall', 1, 300, 100, 2), item('b', 300)], {
    canvasWidth: 1000,
    gapX: 12,
    gapY: 12,
  })
  assert.equal(positions.tall.rowSpan, 2)
  assert.equal(positions.b.rowSpan, 1)
})

test('a typed height is honoured exactly on a widget that spans', () => {
  // The box did nothing before: a span is DRAWN at the height of its band,
  // so measuring it read that height straight back and the number the admin
  // typed was outvoted by the consequence of itself.
  const { positions } = packRowGroups(
    [
      { id: 'tall', row: 1, widthPx: 400, rowSpan: 3, heightPx: 260, estimatedHeight: 260 },
      at('k1', 1, 300, 200),
      at('k2', 2, 300, 200),
      at('k3', 3, 300, 200),
    ],
    { canvasWidth: 1000, gapX: 12, gapY: 12, heights: { tall: 624 } }
  )
  assert.equal(positions.tall.height, 260, 'not the 624 it was last drawn at')
  assert.equal(positions.tall.bandHeight, 200 * 3 + 12 * 2, 'and it still knows what the band is')
})

test('a typed height taller than the band grows the band to hold it', () => {
  // So it is still bordered by its rows rather than hanging out of them.
  const { positions, rows } = packRowGroups(
    [{ id: 'tall', row: 1, widthPx: 400, rowSpan: 2, heightPx: 500 }, at('k1', 1, 300, 90), at('k2', 2, 300, 90)],
    { canvasWidth: 1000, gapX: 12, gapY: 12 }
  )
  assert.equal(positions.tall.height, 500)
  assert.equal(rows[0].height + 12 + rows[1].height, 500)
})


test('A TYPED HEIGHT BEATS THE MEASUREMENT, span or no span', () => {
  // Measuring it back makes the packing depend on what the browser happened
  // to draw, and a widget with nothing to show that day draws short -- which
  // is how a page rearranges itself because a sheet was empty on a Monday.
  const { positions } = packRowGroups([{ id: 'a', widthPx: 300, heightPx: 400 }], {
    canvasWidth: 1000,
    heights: { a: 180 },
  })
  assert.equal(positions.a.height, 400)
})

test('a widget with NO typed height is still measured', () => {
  // Its content is the only thing that knows how tall it is.
  const { positions } = packRowGroups([{ id: 'a', widthPx: 300, estimatedHeight: 220 }], {
    canvasWidth: 1000,
    heights: { a: 180 },
  })
  assert.equal(positions.a.height, 180)
})

test('a height too small to be a decision is raised to the floor', () => {
  assert.equal(pinnedHeight({ heightPx: 4 }), MIN_HEIGHT)
  assert.equal(pinnedHeight({ heightPx: 0 }), null)
  assert.equal(pinnedHeight({}), null)
  assert.equal(pinnedHeight({ heightPx: 'tall' }), null)
})

// --- meeting the screen it actually got ----------------------------------

const three = [
  { id: 'a', row: 1, widthPx: 400 },
  { id: 'b', row: 1, widthPx: 400 },
  { id: 'c', row: 1, widthPx: 400 },
]

test('the width a page was designed for is inferred, never typed', () => {
  // It is the widest row's worth of typed widths. Nobody has to record it,
  // it cannot go stale, and it moves on its own as the page is edited.
  assert.equal(wantedWidth(three, 12), 400 * 3 + 24)
  assert.equal(wantedWidth([{ row: 1, widthPx: 500 }, { row: 2, widthPx: 300 }], 12), 500)
})

test('a page of named widths wants nothing in particular', () => {
  // A fraction is already a fraction of whatever room there is.
  assert.equal(wantedWidth([{ width: 'half' }, { width: 'half' }], 12), 0)
  assert.equal(fitFor([{ width: 'half' }], 300, 12).fit, 1)
})

test('when the room is there, nothing is scaled', () => {
  const at = fitFor(three, 1264, 12)
  assert.equal(at.fit, 1)
  assert.equal(at.stacked, false)
})

test('a narrower screen scales EVERY typed width by the same ratio', () => {
  // Scaling everything is the point: it is the only way a row stays a row,
  // and the only way the relative sizes an admin chose survive.
  const { fit } = fitFor(three, 1000, 12)
  const { positions, rows } = packRowGroups(three, { canvasWidth: 1000, gapX: 12, gapY: 12, fit })
  assert.equal(rows.length, 1, 'still one row')
  assert.equal(positions.a.width, positions.b.width)
  assert.equal(positions.b.width, positions.c.width)
  assert.ok(positions.a.width < 400)
})

test('a scaled row never overflows the canvas it was scaled to', () => {
  // The gaps are NOT scaled -- 12 pixels of air is 12 pixels at any size --
  // so a ratio taken over a total that included them would leave every row
  // a few pixels too wide and wrap the last widget off the end.
  for (let canvas = 700; canvas <= 1300; canvas += 1) {
    const { fit, stacked } = fitFor(three, canvas, 12)
    if (stacked) continue
    const { positions, rows } = packRowGroups(three, { canvasWidth: canvas, gapX: 12, gapY: 12, fit })
    const used = three.reduce((sum, i) => sum + positions[i.id].width, 0) + 24
    assert.ok(used <= canvas, `${canvas}: used ${used}`)
    assert.equal(rows.length, 1, `${canvas}: wrapped`)
  }
})

test('the tightest row decides, not the widest one', () => {
  // A row of five has four gaps to pay for and a row of one has none.
  const mixed = [
    { id: 'wide', row: 1, widthPx: 1200 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, row: 2, widthPx: 240 })),
  ]
  const { fit } = fitFor(mixed, 1000, 12)
  const { positions, rows } = packRowGroups(mixed, { canvasWidth: 1000, gapX: 12, gapY: 12, fit })
  assert.equal(rows.length, 2)
  for (const row of rows) {
    const used = row.ids.reduce((sum, id) => sum + positions[id].width, 0) + 12 * (row.ids.length - 1)
    assert.ok(used <= 1000, `row ${row.row}: ${used}`)
  }
})

test('on a phone it stops pretending and goes one to a line', () => {
  // Three across on 360 pixels is three widgets nobody can read, which is
  // worse than three screens of one widget each.
  const at = fitFor(three, 360, 12)
  assert.equal(at.stacked, true)

  const { positions, rows } = packRowGroups(three, { canvasWidth: 360, gapY: 12, stacked: true })
  assert.equal(rows.length, 3)
  for (const item of three) {
    assert.equal(positions[item.id].width, 360)
    assert.equal(positions[item.id].left, 0)
  }
})

test('stacking keeps the order it was arranged in, across rows too', () => {
  const items = [
    { id: 'second', row: 2, widthPx: 300 },
    { id: 'first', row: 1, widthPx: 300 },
    { id: 'alsoFirst', row: 1, widthPx: 300 },
    { id: 'third', row: 3, widthPx: 300 },
  ]
  const { positions } = packRowGroups(items, { canvasWidth: 360, gapY: 12, stacked: true })
  const order = Object.entries(positions)
    .sort((a, b) => a[1].top - b[1].top)
    .map(([id]) => id)
  assert.deepEqual(order, ['first', 'alsoFirst', 'second', 'third'])
})

test('a typed height comes down with the typed width it was chosen against', () => {
  // 600x360 stays that SHAPE. Honouring half the decision is how a widget
  // ends up a letterbox chart with a field of empty card underneath.
  const items = [{ id: 'chart', row: 1, widthPx: 600, heightPx: 360 }]
  const { fit } = fitFor([...items, { id: 'x', row: 1, widthPx: 600 }], 900, 12)
  const { positions } = packRowGroups(items, { canvasWidth: 900, gapX: 12, gapY: 12, fit })
  const box = positions.chart
  assert.ok(Math.abs(box.width / box.height - 600 / 360) < 0.02)
  assert.equal(box.fitted, true, 'and the canvas says it is imposing it')
})

test('stacked, a typed height comes down with the width too', () => {
  const items = [{ id: 'chart', row: 1, widthPx: 600, heightPx: 360 }]
  const { positions } = packRowGroups(items, { canvasWidth: 300, gapY: 12, stacked: true })
  assert.equal(positions.chart.height, 180)
})

test('stacked, a widget wider than it was does NOT grow taller', () => {
  // Its height was a decision, not a ratio waiting to be scaled up.
  const items = [{ id: 'k', row: 1, widthPx: 300, heightPx: 120 }]
  const { positions } = packRowGroups(items, { canvasWidth: 600, gapY: 12, stacked: true })
  assert.equal(positions.k.height, 120)
})

test('a widget with no typed height is left to measure itself', () => {
  // Its content reflows at the new width; a scaled guess would be a worse
  // number than the one the browser is about to produce.
  const items = [{ id: 'auto', row: 1, widthPx: 600, estimatedHeight: 200 }]
  const { positions } = packRowGroups(items, { canvasWidth: 900, gapX: 12, gapY: 12, fit: 0.7 })
  assert.equal(positions.auto.height, 200)
  assert.equal(positions.auto.fitted, undefined)
})

test('a span is only a span while there are rows to span', () => {
  const items = [{ id: 'tall', row: 1, widthPx: 400, rowSpan: 3, heightPx: 300 }]
  const { positions } = packRowGroups(items, { canvasWidth: 360, gapY: 12, stacked: true })
  assert.equal(positions.tall.rowSpan, 1)
})

test('the thresholds are where a phone actually is', () => {
  assert.ok(STACK_WIDTH >= 480 && STACK_WIDTH <= 640)
  assert.ok(MIN_FIT > 0.4 && MIN_FIT < 0.75)
  assert.equal(fitFor(three, STACK_WIDTH - 1, 12).stacked, true)
  assert.equal(fitFor([{ row: 1, widthPx: 600 }], STACK_WIDTH + 40, 12).stacked, false)
})

test('an unmeasured canvas scales nothing rather than everything', () => {
  const at = fitFor(three, 0, 12)
  assert.equal(at.fit, 1)
  assert.equal(at.stacked, false)
})

test('the default is the behaviour this file always had', () => {
  // Every caller that has not thought about the screen gets the typed
  // numbers, which is what keeps the rest of this file's tests honest.
  const plain = packRowGroups(three, { canvasWidth: 1264, gapX: 12, gapY: 12 })
  const explicit = packRowGroups(three, { canvasWidth: 1264, gapX: 12, gapY: 12, fit: 1, stacked: false })
  assert.deepEqual(plain.positions, explicit.positions)
  assert.equal(plain.positions.a.width, 400)
})

// --- a page that does not rearrange itself when the data changes ---------

const PAGE = [
  { id: 'kpi1', row: 1, widthPx: 240, heightPx: 120 },
  { id: 'kpi2', row: 1, widthPx: 240, heightPx: 120 },
  { id: 'chart', row: 1, widthPx: 520, heightPx: 320 },
  { id: 'table', row: 2, widthPx: 700 },
  { id: 'side', row: 2, widthPx: 280, heightPx: 200 },
  { id: 'wide', row: 3, widthPx: 900 },
  { id: 'extra', row: 3, widthPx: 300 },
]

const layoutWith = (heights) =>
  packRowGroups(PAGE, { canvasWidth: 1000, gapX: 12, gapY: 12, heights })

const seats = (out) =>
  PAGE.map((i) => [i.id, out.positions[i.id].row, out.positions[i.id].left, out.positions[i.id].width])

test('LESS DATA MOVES NOTHING', () => {
  // The whole point. A widget with an empty sheet behind it draws short, and
  // a layout that reads that height decides something different -- so a page
  // rearranges itself because a tab was empty on a Monday.
  const busy = layoutWith({ table: 640, wide: 480, chart: 320 })
  const quiet = layoutWith({ table: 60, wide: 60, chart: 320 })
  const empty = layoutWith({})

  assert.deepEqual(seats(quiet), seats(busy))
  assert.deepEqual(seats(empty), seats(busy))
})

test('nothing the data can do changes a seat', () => {
  // A sweep rather than one example: every widget's row, x and width against
  // a hundred different sets of measurements.
  const base = seats(layoutWith({}))
  let seed = 7
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  for (let run = 0; run < 100; run += 1) {
    const heights = {}
    for (const item of PAGE) heights[item.id] = Math.round(40 + next() * 900)
    assert.deepEqual(seats(layoutWith(heights)), base, `run ${run}`)
  }
})

test('a row keeps every widget put in it, whatever the heights are', () => {
  for (const heights of [{}, { table: 30 }, { table: 900, side: 900 }, { wide: 1200 }]) {
    const { positions } = layoutWith(heights)
    for (const item of PAGE) {
      assert.equal(positions[item.id].row, item.row, `${item.id} left row ${item.row}`)
    }
  }
})

test('a widget can only stack into room that TYPED numbers guarantee', () => {
  // Room a measurement happens to leave today is not room, it is weather:
  // something drops into it, the data comes back tomorrow, and the widget
  // is somewhere else.
  const measured = packRowGroups(
    [item('short', 400, 100), item('tall', 400, 300), item('next', 400, 120)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  assert.equal(measured.positions.next.stacked, undefined, 'no measured height stacks')

  const typed = packRowGroups(
    [pinned('short', 400, 100), pinned('tall', 400, 300), pinned('next', 400, 120)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  assert.equal(typed.positions.next.stacked, true)
})

test('room that only exists because a NEIGHBOUR drew tall is not room', () => {
  // The subtle half of it. Both the shelf and the candidate have typed
  // heights, so stacking looks safe -- but the depth under the shelf comes
  // from an unpinned neighbour, and that is a fact about today's data. Take
  // it, and the day the neighbour has nothing to show the widget is gone.
  const { positions } = packRowGroups(
    [pinned('short', 400, 100), item('tall', 400, 300), pinned('next', 400, 120)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  assert.equal(positions.next.stacked, undefined)

  // Pin the neighbour and the room becomes a promise, so it can be taken.
  const firm = packRowGroups(
    [pinned('short', 400, 100), pinned('tall', 400, 300), pinned('next', 400, 120)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  assert.equal(firm.positions.next.stacked, true)
})

test('the room under a short widget is only shown where something could take it', () => {
  // A dotted box offering room that nothing will ever be placed in is worse
  // than no box at all.
  const loose = packRowGroups([item('short', 400, 100), item('tall', 400, 300)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  assert.deepEqual(rowGaps(loose.rows, loose.positions, 900, 12, MIN_WIDTH, 20).filter((g) => g.under), [])

  const firm = packRowGroups([pinned('short', 400, 100), pinned('tall', 400, 300)], {
    canvasWidth: 900,
    gapX: 12,
    gapY: 20,
  })
  assert.equal(rowGaps(firm.rows, firm.positions, 900, 12, MIN_WIDTH, 20).filter((g) => g.under).length, 1)
})

test('a wrapped row reports every line it has', () => {
  const { rows } = packRowGroups(
    [rowItem('a', 400, 1), rowItem('b', 400, 1), rowItem('c', 400, 1)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].lines.length, 2)
  assert.deepEqual(rows[0].lines.map((l) => l.ids), [['a', 'b'], ['c']])
  assert.equal(rows[0].height, 220, 'both lines, and the gap between them')
})

test('the room left over is offered per LINE, not per band', () => {
  // The end of the first line is a different rectangle from the end of the
  // second, and a band that reported one number for both would be pointing
  // at a place nothing fits.
  const { positions, rows } = packRowGroups(
    [rowItem('a', 400, 1), rowItem('b', 400, 1), rowItem('c', 400, 1)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  const gaps = rowGaps(rows, positions, 900, 12, MIN_WIDTH, 20).filter((g) => !g.under)
  assert.equal(gaps.length, 1, 'the first line is full; only the second has room')
  assert.equal(gaps[0].top, 120)
  assert.equal(gaps[0].left, 412)
})

test('slack is counted per line too', () => {
  const { positions, rows } = packRowGroups(
    [rowItem('a', 400, 1), rowItem('b', 400, 1), rowItem('c', 400, 1)],
    { canvasWidth: 900, gapX: 12, gapY: 20 }
  )
  const slack = rowSlack(rows, positions, 900, 12)
  assert.equal(slack.a, 900 - (400 + 12 + 400))
  assert.equal(slack.c, 900 - 400, 'its own line has far more room left')
})
