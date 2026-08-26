// ---------------------------------------------------------------------
// Laying widgets out by the space they actually need
// ---------------------------------------------------------------------
// Every layout problem on this project came from the same place: the canvas
// was divided into a fixed number of columns, a widget had to claim whole
// ones, and a widget pinned to 260px where the columns were 316px therefore
// claimed 316 and left 56px beside it that nothing could ever fill. Three in
// a row was a strip of nothing, and the wider widget below could not fit in
// the gap the row left behind, so the hole was permanent.
//
// There are no columns here. A widget asks for a width in pixels and gets
// exactly that, and it is placed in the ROW it was put in -- left to right,
// each starting where the one before it ended. When a row runs out of width
// the next widget spills into the row below rather than being squashed.
//
// A row is a real thing an admin assigns a widget to, not just whatever
// happened to fit on one line. A page where nobody has set one behaves
// exactly as it always did, because unset means row 1 and row 1 spills.
//
// That is the whole model, and it has the three properties the column grid
// could not have at the same time:
//
//   NOTHING IS ROUNDED UP. A widget occupies the space it asked for and not
//   one pixel more, so there is no dead strip beside anything.
//
//   THE ORDER IS THE ORDER. Nothing is ever moved past anything else to fill
//   a hole, so what an admin arranged is what a reader reads.
//
//   IT ADAPTS BY ITSELF. The row breaks wherever the canvas happens to end,
//   so the same page reflows on a laptop, a monitor and a phone with nobody
//   configuring breakpoints.
//
// Pure: numbers in, numbers out, no DOM.

/** Below this a widget is a sliver rather than a decision. */
export const MIN_WIDTH = 80
export const MIN_HEIGHT = 60

/** What a widget takes when it has not been given a pixel width. */
export const NAMED_FRACTIONS = {
  quarter: 0.25,
  third: 1 / 3,
  half: 0.5,
  twothird: 2 / 3,
  full: 1,
}

/**
 * How wide this widget is asking to be, on a canvas this wide.
 *
 * A pinned pixel width is honoured exactly. Anything else falls back to the
 * named width it was built with, as a fraction -- so a page nobody has ever
 * sized still looks like the page it always was.
 *
 * Never wider than the canvas: a 900px widget on a phone is the phone's
 * width, not a horizontal scrollbar across the whole page.
 */
export function requiredWidth(item, canvasWidth, fit = 1) {
  const canvas = Math.max(1, canvasWidth || 0)
  const pinned = Number(item?.widthPx)
  if (Number.isFinite(pinned) && pinned > 0) {
    // `fit` is how much of the width this arrangement was designed for the
    // canvas actually has. A typed pixel width is a decision about the
    // widget's size RELATIVE TO THE OTHERS, so on a narrower screen it is
    // scaled rather than clamped -- clamping only the ones that no longer
    // fit is what turns a row of three equal charts into two equal ones and
    // a stub.
    const ratio = Number.isFinite(fit) && fit > 0 ? Math.min(1, fit) : 1
    // Floored rather than rounded when scaling: a row is a sum, and three
    // widths each rounded UP is a row two pixels too wide, which wraps --
    // losing the arrangement for the sake of half a pixel each.
    const want = ratio === 1 ? Math.round(pinned) : Math.floor(pinned * ratio)
    return Math.min(canvas, Math.max(MIN_WIDTH, want))
  }

  // A named width is already a fraction of whatever room there is, so it
  // needs no help being responsive.
  const fraction = NAMED_FRACTIONS[item?.width] ?? 1
  return Math.min(canvas, Math.max(MIN_WIDTH, Math.round(canvas * fraction)))
}

/**
 * The width this arrangement was DESIGNED for.
 *
 * Nobody types it: it is the widest row's worth of typed widths, gaps
 * included, which is exactly the canvas the admin had in front of them when
 * they typed those numbers. Inferring it means it is never stale, never a
 * setting to get wrong, and it moves on its own as the page is edited.
 *
 * Only pinned widths count. A named width is a fraction of the canvas and
 * has no fixed size to want.
 */
export function rowTotals(items) {
  const rows = new Map()
  for (const item of items || []) {
    const pinned = Number(item?.widthPx)
    if (!Number.isFinite(pinned) || pinned <= 0) continue
    const row = rowOf(item)
    const at = rows.get(row) || { total: 0, count: 0 }
    at.total += Math.max(MIN_WIDTH, Math.round(pinned))
    at.count += 1
    rows.set(row, at)
  }
  return [...rows.values()]
}

export function wantedWidth(items, gapX = 12) {
  let widest = 0
  for (const { total, count } of rowTotals(items)) {
    widest = Math.max(widest, total + gapX * Math.max(0, count - 1))
  }
  return widest
}

/** A canvas narrower than this is a phone, whatever the arithmetic says. */
export const STACK_WIDTH = 560

/** Below this, scaling stops being "smaller" and starts being "unreadable". */
export const MIN_FIT = 0.55

/**
 * How this arrangement should meet the screen it got.
 *
 * Three answers, and they are the three that actually exist:
 *
 *   THE ROOM IS THERE -- draw the typed numbers, unchanged.
 *   SOMEWHAT NARROWER -- scale every typed width by the same ratio. The
 *     rows, the order and the relative sizes all survive; the page is the
 *     same page, smaller. Scaling everything is the point: it is the only
 *     way a row stays a row.
 *   A PHONE -- stop pretending. One widget per line, full width, in the
 *     order they were arranged in. A three-across row squeezed onto 360
 *     pixels is three widgets nobody can read, which is worse than three
 *     screens of one widget each.
 */
export function fitFor(items, canvasWidth, gapX = 12) {
  const canvas = Math.max(0, canvasWidth || 0)
  const wanted = wantedWidth(items, gapX)

  // The tightest row decides, and the GAPS are not scaled with it -- 12
  // pixels of air is 12 pixels of air at any size, and taking the ratio
  // over a total that included them would leave every row a few pixels too
  // wide and wrap the last widget off the end of it.
  let raw = 1
  if (canvas > 0) {
    for (const { total, count } of rowTotals(items)) {
      if (total <= 0) continue
      const room = canvas - gapX * Math.max(0, count - 1)
      raw = Math.min(raw, room / total)
    }
  }
  raw = Math.max(0, raw)

  const stacked = canvas > 0 && (canvas < STACK_WIDTH || raw < MIN_FIT)
  return {
    wanted,
    stacked,
    // Rounded down to the thousandth, so a one-pixel resize is not a
    // different layout and the rounding can never round UP into an overflow.
    fit: stacked ? 1 : Math.floor(Math.min(1, raw) * 1000) / 1000,
    raw,
  }
}

/**
 * Every widget on its own line, full width, in the order they were arranged.
 *
 * A pinned height comes down with the width it was chosen against, so a
 * chart typed as 600x360 stays that shape rather than becoming a 340-wide
 * letterbox with 360 pixels of empty card under the axis.
 */
export function stackRows(items, { canvasWidth = 0, gapY = 12, heights = {}, fallback = 220 } = {}) {
  const canvas = Math.max(1, canvasWidth || 0)
  // Stable, so within a row the admin's order is kept and the rows follow
  // one another exactly as they read across on a wide screen.
  const order = (items || []).map((item, i) => ({ item, i }))
  order.sort((a, b) => rowOf(a.item) - rowOf(b.item) || a.i - b.i)

  const positions = {}
  const rows = []
  let top = 0

  for (const { item } of order) {
    const pin = pinnedHeight(item)
    const was = Number(item?.widthPx)
    const shape = pin && Number.isFinite(was) && was > 0 ? Math.min(1, canvas / was) : 1
    const height = pin
      ? Math.max(MIN_HEIGHT, Math.round(pin * shape))
      : Math.max(MIN_HEIGHT, Math.round(heights[item.id] ?? item.estimatedHeight ?? fallback))

    positions[item.id] = {
      left: 0,
      top,
      width: canvas,
      height,
      row: rows.length + 1,
      rowSpan: 1,
      // A span means nothing when every widget already has the whole width.
      fitted: Boolean(pin),
      stacked: true,
    }
    rows.push({ row: rows.length + 1, top, height, ids: [item.id], shelves: [], blocked: [] })
    top += height + gapY
  }

  return { positions, rows, spans: [], containerHeight: Math.max(0, top - gapY) }
}

/**
 * Every widget placed into its row, spilling into the next when it will not
 * fit.

/**
 * Which row a widget has been put in.
 *
 * Unset means row 1, which is not a special case: everything starts in the
 * first row and spills into the second, the second into the third, and a
 * page nobody has assigned rows to behaves exactly as it always did. Setting
 * a number is how an admin says "this one belongs on the second row", and
 * everything else still flows around it.
 */
export function rowOf(item) {
  const n = Number(item?.row)
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1
}

/**
 * Whether a row is something somebody CHOSE, or just where this ended up.
 *
 * Blank means row 1 for the purposes of packing, but it does not mean an
 * admin said "row 1" -- and the difference decides what happens when the
 * row runs out of width. A widget that was put in a row stays in it; a
 * widget that was never given one flows.
 */
export function hasRow(item) {
  const n = Number(item?.row)
  return Number.isFinite(n) && n >= 1
}

/**
 * The height somebody typed for this widget, if they typed one.
 *
 * Worth asking separately from the measurement because a widget that spans
 * is DRAWN at the height of the rows it covers -- so once it has been drawn
 * once, measuring it just reads that height back, and the number the admin
 * typed would be quietly outvoted by the consequence of itself.
 */
export function pinnedHeight(item) {
  const n = Number(item?.heightPx)
  return Number.isFinite(n) && n > 0 ? Math.max(MIN_HEIGHT, Math.round(n)) : null
}

/** A widget cannot span more rows than a page plausibly has. */
export const MAX_ROW_SPAN = 12

/**
 * How many rows a widget was told to cover.
 *
 * One is the answer for everything nobody has spanned, so a page that has
 * never heard of this behaves exactly as it did. A number greater than one
 * says "hold this width all the way down through those rows, and be as tall
 * as they are together" -- which is the tall chart beside three stacked
 * KPIs, the layout a single row could never express.
 */
export function rowSpanOf(item) {
  const n = Number(item?.rowSpan)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(MAX_ROW_SPAN, Math.round(n))
}

/**
 * Every widget placed into its row, spilling into the next when it will not
 * fit.
 *
 * A row is a real thing an admin can put a widget IN, not just whatever
 * happened to fit on one line. The rule is the one anybody would guess:
 *
 *   go through the rows in order;
 *   put each widget in the row it asked for, if there is room left in it;
 *   if there is not, it goes to the next row, ahead of whatever was
 *   already assigned there, because it came first.
 *
 * So a widget can be pinned to row 2 and stay there whatever happens above
 * it, and a row that runs out of width overflows downward instead of
 * silently squashing anything.
 *
 * Rows are as tall as their tallest widget, so they line up -- which is the
 * thing that makes a page of rows readable and a masonry not.
 *
 * `fit` and `stacked` come from `fitFor` -- how this arrangement meets the
 * screen it got. They default to "the room is there", so every caller that
 * has not thought about it gets exactly the behaviour it always had.
 */
export function packRowGroups(
  items,
  { canvasWidth = 0, gapX = 12, gapY = 12, heights = {}, fallback = 220, fit = 1, stacked = false } = {}
) {
  if (stacked) return stackRows(items, { canvasWidth, gapY, heights, fallback })

  const canvas = Math.max(1, canvasWidth || 0)
  const list = items || []

  // What each row has been asked to hold, in the admin's own order.
  const queued = new Map()
  for (const item of list) {
    const row = rowOf(item)
    if (!queued.has(row)) queued.set(row, [])
    queued.get(row).push(item)
  }

  const positions = {}
  const rows = []
  let overflow = []
  let rowNumber = 1
  const highest = Math.max(1, ...list.map(rowOf))

  // Widgets still holding their width in the rows BELOW the one they start
  // in. A span is a vertical reservation: rows keep filling left to right
  // around it, and it is as tall as the rows it covers are together.
  const spans = []
  const heldIn = (row) => spans.filter((sp) => sp.startRow < row && sp.lastRow >= row)
  const lastHeld = () => spans.reduce((m, sp) => Math.max(m, sp.lastRow), 0)

  while (rowNumber <= highest || overflow.length > 0 || lastHeld() >= rowNumber) {
    // Whatever spilled from above comes first: it was earlier in the sort.
    const waiting = [...overflow, ...(queued.get(rowNumber) || [])]
    overflow = []

    // The stretches of this row somebody upstairs is still standing in.
    const blocked = heldIn(rowNumber)
      .map((sp) => ({ left: sp.left, right: sp.left + sp.width }))
      .sort((a, b) => a.left - b.left)

    // The first x at or after `from` where `width` clears every one of them.
    // Sorted ascending and only ever moving right, so one pass is enough.
    const clear = (from, width) => {
      let x = from
      for (const b of blocked) {
        if (x < b.right && x + width > b.left) x = b.right + gapX
      }
      return x
    }

    // A row is a BAND, and a band can hold more than one line. When the
    // widgets put in a row do not fit across it they wrap onto a second
    // line inside the same band rather than spilling into the row below --
    // because a row an admin typed is an instruction, and an instruction
    // that a widget can be evicted from by having less data that day is not
    // one.
    //
    // A widget that was never given a row still flows: blank is row 1 for
    // packing, but it is not somebody saying "row 1", so a page nobody has
    // assigned rows to behaves exactly as it always did.
    const lines = []
    // `typed` is the tallest TYPED height on the line, and it is the only
    // depth stacking is allowed to use: room a measurement happens to leave
    // today is not room, it is weather.
    let line = { top: 0, height: 0, typed: 0, ids: [], shelves: [] }
    let x = 0

    const breakLine = () => {
      if (line.ids.length === 0) return
      lines.push(line)
      line = { top: line.top + line.height + gapY, height: 0, typed: 0, ids: [], shelves: [] }
      x = 0
    }

    const placed = []

    for (let i = 0; i < waiting.length; i += 1) {
      const item = waiting[i]
      const width = requiredWidth(item, canvas, fit)
      const span = rowSpanOf(item)
      const pin = pinnedHeight(item)
      // A spanning widget is drawn at the height of its band, so measuring
      // it reads that height straight back. A typed height has to be taken
      // as read or it could never change anything.
      // A typed height comes down with the width it was chosen against. The
      // two were one decision -- "this chart is 600 by 360" -- and honouring
      // half of it on a narrower screen is how a widget ends up as a
      // letterbox chart with a field of empty card underneath.
      const scaled = pin && fit < 1 ? Math.max(MIN_HEIGHT, Math.round(pin * fit)) : null
      // A TYPED height is used as typed. Measuring it back would make the
      // packing depend on what the browser happened to draw, and a widget
      // with nothing to show that day draws short -- which is how a page
      // rearranges itself because a sheet was empty on a Monday.
      const h = pin
        ? (scaled ?? pin)
        : Math.max(MIN_HEIGHT, Math.round(heights[item.id] ?? item.estimatedHeight ?? fallback))

      let left = clear(x, width)
      let atTop = line.top

      if (left + width > canvas + 0.5) {
        // No room along the line. Before giving up on it, look UNDER what is
        // already here: a widget half the height of the one beside it has
        // left a rectangle, and a rectangle that fits is not a rectangle
        // anybody wants left empty.
        //
        // Only tried when the line is full, so the reading order still runs
        // left to right -- nothing jumps into a hole ahead of its turn.
        //
        // BOTH heights have to be TYPED. Measured, the rectangle is a fact
        // about today's data: a widget with nothing to show is short, the
        // hole under it opens, something drops into it, and tomorrow the
        // data comes back and that widget is somewhere else. Stacking is a
        // layout decision or it is not worth having.
        const shelf =
          span > 1 || !pin
            ? null
            : line.shelves.find(
                (sh) => sh.pinned && sh.width >= width - 0.5 && line.typed - (sh.bottom - line.top) - gapY >= h - 0.5
              )

        if (shelf) {
          left = shelf.left
          atTop = line.top + (shelf.bottom - line.top) + gapY
          shelf.bottom = atTop + h
          positions[item.id] = { left, top: atTop, width, height: h, row: rowNumber, rowSpan: 1, stacked: true }
          placed.push(item.id)
          line.ids.push(item.id)
          continue
        }

        if (hasRow(item) && line.ids.length > 0) {
          breakLine()
          left = clear(0, width)
          atTop = line.top
        }

        // Still nothing. Only a span from a row above can do that, by
        // holding width this widget needs -- and a span's width is typed, so
        // this is stable too, not a thing today's data decided.
        if (left + width > canvas + 0.5) {
          overflow = waiting.slice(i)
          break
        }
      }

      positions[item.id] = {
        left,
        top: atTop,
        width,
        height: h,
        row: rowNumber,
        rowSpan: span,
        // The canvas is imposing this height rather than reading it, so it
        // has to be applied -- see WidgetCanvas.
        ...(scaled !== null ? { fitted: true } : null),
      }
      placed.push(item.id)
      line.ids.push(item.id)
      x = left + width + gapX

      if (span > 1) {
        // Deliberately not a shelf and not part of this row's height: a
        // spanning widget is measured against the rows it covers, and
        // letting it set the height of the first one would make every row
        // below it as tall as the whole span.
        spans.push({
          id: item.id,
          left,
          width,
          height: h,
          pinned: Boolean(pin),
          startRow: rowNumber,
          lastRow: rowNumber + span - 1,
        })
        continue
      }

      line.shelves.push({ left, width, bottom: atTop + h, pinned: Boolean(pin) })
      line.height = Math.max(line.height, h)
      if (pin) line.typed = Math.max(line.typed, h)
    }

    if (line.ids.length > 0) lines.push(line)

    const height = lines.length > 0 ? lines[lines.length - 1].top + lines[lines.length - 1].height : 0
    const shelves = lines.flatMap((l) => l.shelves)

    // A row nothing was placed in is still a real row while a span is
    // reaching through it -- that is the room the span is being given.
    if (placed.length > 0 || blocked.length > 0) {
      rows.push({ row: rowNumber, top: 0, height, ids: placed, shelves, blocked, lines })
    }
    rowNumber += 1
  }

  // --- how tall the rows a span covers have to be ------------------------
  //
  // The rows it passes through are sized by everything ELSE in them, and
  // only if that leaves the span short is the last of them grown to make up
  // the difference. So three KPIs beside a chart set the height, the chart
  // fills it, and a chart taller than all three pushes only the bottom row
  // down rather than spreading slack through rows that did not need it.
  const covered = (sp) => rows.filter((r) => r.row >= sp.startRow && r.row <= sp.lastRow)
  for (const sp of [...spans].sort((a, b) => a.lastRow - b.lastRow || a.startRow - b.startRow)) {
    const band = covered(sp)
    if (band.length === 0) continue
    const available = band.reduce((sum, r) => sum + r.height, 0) + gapY * (band.length - 1)
    if (sp.height > available + 0.5) band[band.length - 1].height += sp.height - available
  }

  // --- and now, finally, where each row starts ---------------------------
  let top = 0
  for (const row of rows) {
    row.top = top
    for (const shelf of row.shelves) shelf.bottom += top
    top += row.height + gapY
  }

  const rowAt = new Map(rows.map((r) => [r.row, r]))
  for (const box of Object.values(positions)) {
    box.top += rowAt.get(box.row)?.top || 0
  }

  // A span is as tall as its band, so it is bordered by the rows it covers
  // rather than floating in the middle of them.
  for (const sp of spans) {
    const band = covered(sp)
    const box = positions[sp.id]
    if (!box || band.length === 0) continue
    const last = band[band.length - 1]
    const bandHeight = Math.round(last.top + last.height - box.top)
    // A typed height is exact -- it is the one number on this widget the
    // admin chose rather than inherited, and stretching past it would make
    // the box do nothing on precisely the widgets it matters most on. The
    // band grew to hold it above, so it still sits inside its rows.
    box.height = sp.pinned ? sp.height : Math.max(box.height, bandHeight)
    box.bandHeight = bandHeight
    box.spanned = true
  }

  return { positions, rows, spans, containerHeight: Math.max(0, top - gapY) }
}

/**
 * The empty rectangle at the end of each row -- where it is, and what would
 * fit in it.
 *
 * A number in a corner ("340 free") tells an admin there is room. A dotted
 * box exactly where the room is, labelled with the width and height that
 * would fit in it, tells them what to type -- which is the actual question
 * anybody has while arranging a page.
 *
 * Rows with less than a gap's worth left over produce nothing: a strip
 * narrower than the space between two widgets is not somewhere a widget
 * could go, and drawing it would be noise.
 */
export function rowGaps(rows, positions, canvasWidth, gapX = 12, minimum = MIN_WIDTH, gapY = 12) {
  const out = []
  for (const row of rows || []) {
    // Per LINE. A row is a band, and a band that wrapped has a different
    // rectangle left at the end of each of its lines -- one number for both
    // would point at a place nothing fits.
    const lines = row.lines?.length ? row.lines : [{ top: 0, height: row.height, ids: row.ids }]

    for (const line of lines) {
      let edge = 0
      for (const id of line.ids) {
        const box = positions[id]
        if (box) edge = Math.max(edge, box.left + box.width)
      }

      // The space at the END of the line -- which ends early if a widget
      // from a row above is still standing in it. A dotted box drawn across
      // something already there would be an invitation to a collision.
      const left = edge + gapX
      let limit = canvasWidth
      for (const b of row.blocked || []) {
        if (b.left >= left) limit = Math.min(limit, b.left - gapX)
      }
      const width = Math.round(limit - left)
      if (width >= minimum) {
        out.push({ row: row.row, left, top: row.top + line.top, width, height: line.height })
      }
    }

    // And the space UNDER anything shorter than the row it is on. This is
    // the room a widget could actually be moved into, so it is worth as much
    // as the space at the end -- and it is invisible unless it is drawn.
    //
    // Only under a TYPED height. Under a measured one the rectangle is a
    // fact about today's data, nothing will ever be placed in it (see the
    // packer), and a dotted box offering room that cannot be taken is worse
    // than no box at all.
    for (const shelf of row.shelves || []) {
      if (!shelf.pinned) continue
      const free = Math.round(row.top + row.height - shelf.bottom - gapY)
      if (free < MIN_HEIGHT) continue
      out.push({
        row: row.row,
        left: shelf.left,
        top: shelf.bottom + gapY,
        width: Math.round(shelf.width),
        height: free,
        under: true,
      })
    }
  }
  return out
}

/**
 * How much of a row is left over.
 *
 * Not used to stretch anything -- a widget gets the width it asked for and
 * that is the point of this file. It is reported so the arrange bar can say
 * "there are 340px going spare on this row", which is the number somebody
 * needs in order to decide what to type into the width box.
 */
export function rowSlack(rows, positions, canvasWidth, gapX = 12) {
  const out = {}
  for (const row of rows || []) {
    // Space a widget from a row above is holding is not space going spare,
    // however empty it looks from down here.
    const held = (row.blocked || []).reduce((sum, b) => sum + (b.right - b.left) + gapX, 0)
    // Per line: the room left at the end of a wrapped row's second line has
    // nothing to do with how full its first line was.
    const lines = row.lines?.length ? row.lines : [{ ids: row.ids }]

    for (const line of lines) {
      const used =
        line.ids.reduce((sum, id) => sum + (positions[id]?.width || 0), 0) +
        gapX * Math.max(0, line.ids.length - 1) +
        held
      const spare = Math.max(0, Math.round(canvasWidth - used))
      for (const id of line.ids) out[id] = spare
    }
  }
  return out
}
