import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { POPOVER_MIN_HEIGHT, placePopover } from './popoverPlace.js'

// ---------------------------------------------------------------------
// Putting a menu where it can be read
// ---------------------------------------------------------------------
// The emoji grid was `absolute top-full`, which is fine on the screen it
// was written on and wrong everywhere else: cut off by the editor panel it
// opens inside, off the right edge of a phone, below the fold on a field
// near the bottom. What must hold: always on the screen, never taller than
// the room it has, and below its field unless that genuinely does not fit.

const BOX = { width: 288, height: 360 }
const DESKTOP = { width: 1200, height: 900 }
const PHONE = { width: 390, height: 780 }

test('under the field, when there is room', () => {
  const at = placePopover({ left: 100, top: 100, bottom: 130 }, BOX, DESKTOP)
  assert.equal(at.above, false)
  assert.equal(at.top, 136, 'just under it')
  assert.equal(at.left, 100, 'lined up with it')
  assert.equal(at.width, 288)
  assert.ok(at.maxHeight >= BOX.height, 'and room to be its full height')
})

test('above it, when below does not fit and above does', () => {
  const at = placePopover({ left: 40, top: 300, bottom: 330 }, BOX, { width: 800, height: 400 })
  assert.equal(at.above, true)
  assert.ok(at.top >= 8, 'still on the screen')
  assert.ok(at.top + at.maxHeight <= 400, 'and not over the bottom edge')
  // Not flipped for the sake of it: a tight fit below still opens below.
  assert.equal(placePopover({ left: 40, top: 40, bottom: 70 }, BOX, { width: 800, height: 500 }).above, false)
})

test('never off the side, however narrow the screen', () => {
  // A field near the right edge of a phone.
  const right = placePopover({ left: 350, top: 100, bottom: 130 }, BOX, PHONE)
  assert.equal(right.left, 94)
  assert.ok(right.left + right.width <= PHONE.width - 8)

  // And a screen narrower than the menu wants to be: it gives up width
  // rather than hanging off the edge.
  const tiny = placePopover({ left: 200, top: 100, bottom: 130 }, BOX, { width: 280, height: 700 })
  assert.equal(tiny.width, 264)
  assert.equal(tiny.left, 8)
})

test('never taller than the screen, and never pointlessly short', () => {
  const squeezed = placePopover({ left: 10, top: 120, bottom: 150 }, BOX, { width: 800, height: 200 })
  assert.equal(squeezed.maxHeight, POPOVER_MIN_HEIGHT, 'it scrolls inside what is left')
  assert.ok(squeezed.top >= 8)
  assert.ok(squeezed.maxHeight <= 200 - 16 + 1)

  const tall = placePopover({ left: 10, top: 10, bottom: 40 }, BOX, DESKTOP)
  assert.ok(tall.maxHeight <= DESKTOP.height - 16)
})

test('nonsense in, numbers out', () => {
  // Called once before anything has been measured.
  const at = placePopover(null, null, null)
  for (const key of ['left', 'top', 'width', 'maxHeight']) {
    assert.equal(Number.isFinite(at[key]), true, key)
  }
})

// --- wiring ----------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(import.meta.dirname, '..', p), 'utf8').replace(/\s+/g, ' ')

test('the emoji grid leaves the panel it would be cut off by', () => {
  const picker = read('pages/admin/EmojiPicker.jsx')
  // In <body>, because the on-page editor panel scrolls (EditSplit) and an
  // absolutely positioned child cannot leave a scroll container.
  assert.ok(picker.includes('createPortal('))
  assert.ok(picker.includes('document.body'))
  assert.ok(picker.includes('placePopover('))
  assert.ok(picker.includes("position: 'fixed', top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight"))
  // Measured before it is painted, and again when its own size changes.
  assert.ok(picker.includes('useLayoutEffect'))
  assert.ok(picker.includes('}, [open, data, query, group, recent.length])'))
  assert.ok(picker.includes("window.addEventListener('resize', put)"))
})

test('a click in the grid is not a click outside the picker', () => {
  // The grid is no longer inside the field's own element, so the
  // close-on-outside-click test has to know about both -- or picking an
  // emoji closes the picker before it registers.
  const picker = read('pages/admin/EmojiPicker.jsx')
  assert.ok(picker.includes('const inside = ref.current?.contains(e.target) || menu.current?.contains(e.target)'))
  // Scrolling the page moves the field out from under a fixed menu.
  assert.ok(picker.includes('if (menu.current && e.target && menu.current.contains(e.target)) return'))
})

test('the grid takes the height it is given, rather than a fixed one', () => {
  const picker = read('pages/admin/EmojiPicker.jsx')
  assert.ok(picker.includes("grow ? 'min-h-0 flex-1' : 'max-h-24'"))
  assert.ok(!picker.includes('max-h-52'), 'the old fixed grid height is gone')
})
