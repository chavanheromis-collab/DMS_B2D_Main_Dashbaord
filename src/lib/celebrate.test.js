import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  CELEBRATION_COLOURS,
  CELEBRATION_COUNT,
  CONFETTI_SHAPES,
  celebrates,
  celebrationDuration,
  celebrationFor,
  celebrationPieces,
} from './celebrate.js'
import {
  DEFAULT_ENTRANCE,
  ITEM_KINDS,
  entranceDuration,
  logoBox,
  resolveBrand,
} from './branding.js'
import { backdropOf, themeOf } from './entranceThemes.js'
import {
  ENTRANCE_WAIT_MS,
  entranceIsKnown,
  entranceIsSettled,
  rememberLook,
  rememberedLook,
} from './entranceMemory.js'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// =====================================================================
// The entrance opening on the right ground
// =====================================================================

test('“still reading” and “nothing saved” are different answers', () => {
  // They were the same value, and that is the whole bug: an entrance set to
  // Sand opened on Midnight -- the default for "no entrance" -- and then
  // corrected itself in front of the reader.
  assert.equal(entranceIsKnown(undefined), false)
  assert.equal(entranceIsKnown(null), true, 'no entrance document IS an answer')
  assert.equal(entranceIsKnown({ theme: 'sand' }), true)
})

test('the wait for a first visit is short enough to read as loading', () => {
  // It only applies to a browser that has never opened this dashboard.
  // Everyone else has the answer on the first frame.
  assert.ok(ENTRANCE_WAIT_MS > 0 && ENTRANCE_WAIT_MS <= 1000, `${ENTRANCE_WAIT_MS}ms`)
})

test('a browser with no storage at all simply has no memory', () => {
  // Private mode, blocked site data. The first-visit path already works, so
  // the honest answer is "nothing remembered", never a thrown error.
  const original = globalThis.window
  globalThis.window = undefined
  try {
    assert.equal(rememberedLook('main'), null)
    assert.equal(rememberLook('main', { theme: 'sand' }), false)
  } finally {
    globalThis.window = original
  }
})

test('what comes back paints exactly what went in', () => {
  // The bug this replaces, and the reason it is a ROUND TRIP rather than a
  // list of field names: the list was written before the logo could be
  // resized, `logoSize` and `logoGap` were added later, and nobody added
  // them to it. The entrance opened at the stock 96px, held there while
  // Firestore answered, and then jumped to the size the admin had chosen --
  // the exact flash the memory exists to prevent.
  //
  // Asking "does it draw the same?" cannot go stale that way. A look
  // setting added next year is covered by this test on the day it is added.
  const store = new Map()
  const original = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
  }
  try {
    const live = {
      ...DEFAULT_ENTRANCE,
      theme: 'sand',
      logoBackdrop: 'plate',
      logoUrl: 'https://drive.google.com/file/d/abc/view',
      logoSize: 220,
      logoGap: -40,
      brandName: 'Chavan Udyog Samuh',
      tagline: 'Business Intelligence',
      durationMs: 3400,
      items: [{ id: 'a', kind: 'campaign', title: 'Ends Friday' }],
    }
    rememberLook('main', live)
    const look = rememberedLook('main')

    // Every function the entrance draws itself with must agree.
    assert.deepEqual(logoBox(look), logoBox(live), 'the logo would resize once the read lands')
    assert.deepEqual(themeOf(look), themeOf(live), 'the ground would change colour')
    assert.deepEqual(backdropOf(look), backdropOf(live), 'what is behind the logo would change')
    assert.deepEqual(resolveBrand(look, 'X', 'Y'), resolveBrand(live, 'X', 'Y'), 'the wordmark would change')
    assert.equal(entranceDuration(look, 0), entranceDuration(live, 0), 'the entrance would change length')
  } finally {
    globalThis.window = original
  }
})

test('the look is remembered and the announcements are not', () => {
  const store = new Map()
  const original = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
  }
  try {
    // Reports whether it landed, so the caller is not lied to.
    assert.equal(
      rememberLook('main', { theme: 'sand', logoBackdrop: 'plate', brandName: 'Chavan Udyog' }),
      true
    )
    rememberLook('main', {
      theme: 'sand',
      logoBackdrop: 'plate',
      brandName: 'Chavan Udyog',
      items: [{ id: 'a', kind: 'campaign', title: 'Ends Friday' }],
    })
    const look = rememberedLook('main')
    assert.equal(look.theme, 'sand')
    assert.equal(look.brandName, 'Chavan Udyog')
    // A campaign has dates on it. A cached one could flash up a week after
    // it ended, which is the kind of small lie a dashboard must never tell.
    assert.equal(look.items, undefined, 'an announcement was cached')

    // Per dashboard: each has its own entrance.
    assert.equal(rememberedLook('other'), null)
    rememberLook('other', { theme: 'ocean' })
    assert.equal(rememberedLook('main').theme, 'sand', 'one dashboard overwrote another')
    assert.equal(rememberedLook('other').theme, 'ocean')
  } finally {
    globalThis.window = original
  }
})

test('the entrance appears whole, not in pieces', () => {
  // Three stages, which is what "not stable" looked like: the logo, then
  // the wordmark, then the announcements landing a fraction of a second
  // later and shoving both up the screen as the column re-centred.
  //
  // The memory says WHAT to paint and cannot say whether the announcements
  // are in -- it deliberately does not cache them. So the entrance waits
  // for the real read, and the memory's job is to make that first shown
  // frame correct rather than to make it early.
  assert.equal(entranceIsSettled(undefined), false)
  assert.equal(entranceIsSettled({ theme: 'sand', remembered: true }), false, 'a memory is treated as the article')
  assert.equal(entranceIsSettled({ theme: 'sand' }), true)
  assert.equal(entranceIsSettled(null), true, 'no entrance document IS a finished answer')

  // ...and a memory is marked as one, or nothing can tell them apart.
  const store = new Map()
  const original = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
  }
  try {
    rememberLook('main', { theme: 'sand' })
    assert.equal(rememberedLook('main').remembered, true)
  } finally {
    globalThis.window = original
  }
})

test('the splash paints nothing until it knows what to paint', () => {
  const splash = read('components/SplashScreen.jsx')
  assert.ok(splash.includes('entranceIsSettled(entrance) || waited'), 'it draws before the read has landed')
  assert.ok(splash.includes('opacity: ready ? 1 : 0'), 'the wrong theme is painted while it waits')
  // And the clock starts when it is on screen: a splash that spent half its
  // life invisible would be gone before it was read.
  assert.ok(splash.includes('if (!ready) return undefined'), 'the timer runs while it is hidden')
})

test('the look is kept as it arrives, or the next load flashes too', () => {
  const hook = read('hooks/useWorkspace.js')
  // TWICE: once to seed the first paint, once when the dashboard changes.
  // Losing either one brings the flash back -- on the first load, or on the
  // switch to another dashboard.
  assert.equal(
    (hook.match(/rememberedLook\(spaceId\) \?\? undefined/g) || []).length,
    2,
    'the memory is not read on both the first paint and the switch'
  )
  assert.ok(hook.includes('rememberLook(spaceId, data)'), 'the memory is never written')
  // A failed read must resolve rather than hold an empty screen for ever.
  assert.ok(hook.includes('setEntrance((current) => current ?? null)'), 'a failed read leaves it waiting')
})

// =====================================================================
// The celebration
// =====================================================================

test('an achievement gets the screen and nothing else does', () => {
  // The restraint IS the feature: confetti on every announcement is
  // confetti on nothing, and the card that matters stops standing out.
  assert.equal(celebrates({ kind: 'achievement' }), true)
  for (const kind of ITEM_KINDS.map((k) => k.value).filter((k) => k !== 'achievement')) {
    assert.equal(celebrates({ kind }), false, kind)
  }
  assert.equal(celebrates(null), false)
  assert.equal(celebrates({}), false)
})

test('the same board celebrates the same way every time it opens', () => {
  // React re-renders the splash several times while it plays. A celebration
  // dealt from Math.random() would deal a new hand each time and teleport
  // every piece of paper mid-flight.
  const opts = { seed: 'a|b', durationMs: 4000 }
  assert.deepEqual(celebrationPieces(opts), celebrationPieces(opts))
  assert.notDeepEqual(celebrationPieces(opts), celebrationPieces({ ...opts, seed: 'c' }))
})

test('the celebration is the whole screen, not a puff beside a card', () => {
  // The reason for putting an achievement on the entrance is that everyone
  // should see it, and paper confined to a 190px box is a puff nobody
  // notices.
  const pieces = celebrationPieces({ seed: 'x', durationMs: 4000 })
  assert.equal(pieces.length, CELEBRATION_COUNT)

  const falls = pieces.filter((p) => p.mode === 'fall')
  // Every quarter of the width, so it is a screen of paper and not a
  // column of it. `x` reaches 100, so the last quarter is clamped rather
  // than becoming a fifth bucket of one.
  const across = new Set(falls.map((p) => Math.min(3, Math.floor(p.x / 25))))
  assert.equal(across.size, 4, 'the paper falls down one part of the screen only')
})

test('cannons fire from both corners, inward and upward', () => {
  // A birthday, not a firework display. Paper that goes straight up is a
  // fountain; paper thrown across the screen is a party popper.
  const shots = celebrationPieces({ seed: 'x', durationMs: 4000 }).filter((p) => p.mode === 'shot')
  assert.ok(shots.length > 20, `${shots.length} shots is not a bang`)

  const left = shots.filter((p) => p.x < 50)
  const right = shots.filter((p) => p.x > 50)
  assert.ok(left.length > 0 && right.length > 0, 'only one corner fires')
  assert.ok(left.every((p) => p.dx > 0), 'the left cannon fires off the screen')
  assert.ok(right.every((p) => p.dx < 0), 'the right cannon fires off the screen')
  for (const p of shots) {
    assert.ok(p.dy < 0, `a shot went downward: ${p.dy}`)
    assert.ok(p.drop > 0, 'nothing comes back down')
    // Fired near the start: paper thrown at the end has no time to land.
    assert.ok(p.delay < 4000 * 0.35, `a cannon fired at ${p.delay}ms of 4000`)
  }
})

test('the fall lasts as long as the entrance does', () => {
  // The bug this replaces: a burst over in the first second, with two more
  // seconds of entrance left and nothing happening in them.
  for (const span of [2000, 4700, 9000]) {
    const falls = celebrationPieces({ seed: 'x', durationMs: span }).filter((p) => p.mode === 'fall')
    const last = Math.max(...falls.map((p) => p.delay))
    assert.ok(last > span * 0.5, `the last piece starts at ${last}ms of ${span}`)
    // ...but not so late that it appears for an instant and is faded out.
    assert.ok(last < span, `${last}ms is past the end of a ${span}ms entrance`)
  }
})

test('a longer entrance is not a denser one', () => {
  // The paper is spread over the time, not multiplied by it: an admin who
  // types 6000 into the duration box should get a longer celebration, not
  // one that melts the laptop.
  assert.equal(
    celebrationPieces({ seed: 'x', durationMs: 1500 }).length,
    celebrationPieces({ seed: 'x', durationMs: 9000 }).length
  )
})

test('every piece is drawable, and the celebration ends', () => {
  for (const p of celebrationPieces({ seed: 'y', durationMs: 3000 })) {
    assert.ok(p.size > 0 && p.duration > 0, 'a piece with no size or no flight')
    assert.ok(CELEBRATION_COLOURS.includes(p.colour))
    assert.ok(CONFETTI_SHAPES.includes(p.shape))
    assert.ok(Number.isFinite(p.spin))
    assert.ok(['shot', 'fall'].includes(p.mode))
  }
  assert.ok(celebrationDuration(celebrationPieces({ seed: 'y', durationMs: 3000 })) > 1000)
  assert.equal(celebrationDuration([]), 0)
})

test('a hand-edited entrance cannot ask for a thousand pieces or a minute of them', () => {
  assert.equal(celebrationPieces({ count: 9999 }).length, 240)
  assert.equal(celebrationPieces({ count: 0 }).length, 0)
  assert.equal(celebrationPieces({ count: -5 }).length, 0)
  const wild = celebrationPieces({ seed: 'x', durationMs: 999999 })
  assert.ok(Math.max(...wild.map((p) => p.delay)) <= 12000)
  assert.equal(celebrationPieces({ seed: 'x', durationMs: 0 }).length, CELEBRATION_COUNT)
})

test('it fires for the achievements on the board, and not otherwise', () => {
  assert.equal(celebrationFor([]), null)
  assert.equal(celebrationFor(null), null)
  assert.equal(celebrationFor([{ kind: 'notice', id: 'n' }, { kind: 'campaign', id: 'c' }]), null)

  const one = celebrationFor([{ kind: 'notice', id: 'n' }, { kind: 'achievement', id: 'a' }])
  assert.equal(one.count, 1)
  assert.equal(one.seed, 'a')
  // Seeded on the achievements themselves, so a different board looks
  // different and the same one is the same every time.
  assert.equal(celebrationFor([{ kind: 'achievement', id: 'a' }, { kind: 'achievement', id: 'b' }]).seed, 'a|b')
})

// --- the wiring ----------------------------------------------------------

test('the screen celebrates, and only once the entrance is on it', () => {
  const splash = read('components/SplashScreen.jsx')
  assert.ok(splash.includes('const celebration = celebrationFor(items)'), 'nothing decides whether to celebrate')
  assert.ok(splash.includes('{celebration && ready && <Celebration'), 'paper is thrown behind a hidden splash')
  // As long as the entrance, which is what `duration` is.
  assert.ok(splash.includes('durationMs={duration}'), 'the celebration does not follow the entrance')
  // The card still gets its own shove, so the celebration reads as being
  // ABOUT that announcement rather than merely at the same time as it.
  assert.ok(splash.includes('const won = celebrates(item)'))
  assert.ok(splash.includes("won ? 'splash-item-win' : ''"))
})

test('the travel and the tumble are on separate elements', () => {
  // Both on one element is two `transform` animations on one property, and
  // the last declared silently wins: the paper would spin on the spot, or
  // fly without turning.
  const layer = read('components/Celebration.jsx')
  assert.match(layer, /className=\{`celebrate-piece celebrate-\$\{p\.mode\}`\}/)
  assert.match(layer, /<i className=/, 'the tumble has no element of its own')
  const css = read('index.css')
  assert.match(css, /\.celebrate-piece > i \{/)
})

test('both animations exist, and stop for anyone who asked for less motion', () => {
  const css = read('index.css')
  // The brace matters: `confetti-shots` contains `confetti-shot`, so a
  // prefix match calls a renamed keyframe present -- and the animation that
  // referred to the old name silently does nothing.
  assert.match(css, /@keyframes confetti-shot \{/, 'the cannons are gone')
  assert.match(css, /@keyframes confetti-fall \{/, 'the fall is gone')
  assert.match(css, /@keyframes confetti-spin \{/)
  // And each one is actually referred to by a rule.
  for (const name of ['confetti-shot', 'confetti-fall', 'confetti-spin']) {
    assert.ok(css.includes(`animation: ${name} `), `${name} is declared and never used`)
  }
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.celebrate')))
  assert.match(reduced.slice(0, 200), /\.celebrate \{ display: none/)
})

test('the paper falls behind the wordmark, not over it', () => {
  // A brand name read through falling confetti is a brand name nobody
  // reads. The content wrapper is `position: relative` with no z-index of
  // its own, so anything above 0 on the layer paints over it.
  const css = read('index.css')
  const at = css.indexOf('.celebrate {')
  const rule = css.slice(at, css.indexOf('}', at))
  assert.match(rule, /z-index: 0/, 'the celebration covers the wordmark')
  assert.match(rule, /pointer-events: none/, 'the paper swallows the click that dismisses the entrance')
  assert.match(rule, /overflow: hidden/, 'a shot off the edge would stretch the page')
})
