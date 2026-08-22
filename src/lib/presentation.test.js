import test from 'node:test'
import assert from 'node:assert/strict'

import {
  backgroundIsSet,
  backgroundLayers,
  safeImageUrl,
} from './pageBackground.js'
import {
  entranceDuration,
  itemIsLive,
  liveEntranceItems,
  resolveBrand,
} from './branding.js'
import { canvasLabelFor, navLabelFor } from './workspace.js'

// --- canvas tab naming --------------------------------------------------

test('a canvas tab follows the sidebar label unless it opts out', () => {
  const page = { name: 'Sales Performance — FY25', navLabel: 'Sales' }
  assert.equal(canvasLabelFor(page), 'Sales')
  assert.equal(canvasLabelFor({ ...page, tabUsesPageName: true }), 'Sales Performance — FY25')
})

test('opting into the page title still degrades to the nav label if there is no title', () => {
  assert.equal(canvasLabelFor({ name: '', navLabel: 'Sales', tabUsesPageName: true }), 'Sales')
  // And the sidebar is unaffected by the tab's choice either way.
  assert.equal(navLabelFor({ name: 'Long', navLabel: 'Short', tabUsesPageName: true }), 'Short')
})

// --- background ---------------------------------------------------------

test('an unset background renders nothing at all', () => {
  assert.equal(backgroundIsSet(null), false)
  assert.equal(backgroundIsSet({ mode: '' }), false)
  assert.equal(backgroundLayers(null), null)
  assert.equal(backgroundLayers({ mode: '' }), null)
})

test('an image mode with no usable URL falls back to the app default', () => {
  // A typo should leave the standard backdrop, never a blank slab.
  assert.equal(backgroundIsSet({ mode: 'image', imageUrl: '' }), false)
  assert.equal(backgroundLayers({ mode: 'image', imageUrl: 'not-a-url' }), null)
})

test('only http(s) and data:image URLs reach the CSS', () => {
  assert.equal(safeImageUrl('https://example.com/a-b_c.jpg?x=1&y=2'), 'https://example.com/a-b_c.jpg?x=1&y=2')
  assert.equal(safeImageUrl('http://example.com/i.png'), 'http://example.com/i.png')
  assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')

  // Hyphens and query strings are ordinary URL characters and must survive.
  assert.ok(safeImageUrl('https://cdn.example.com/my-photo-2024.jpg'))

  // Anything that could break out of url(...) is rejected outright.
  assert.equal(safeImageUrl('https://e.com/a.jpg");background:red;("'), '')
  assert.equal(safeImageUrl("https://e.com/a'.jpg"), '')
  assert.equal(safeImageUrl('https://e.com/a b.jpg'), '')
  assert.equal(safeImageUrl('javascript:alert(1)'), '')
  assert.equal(safeImageUrl('data:text/html,<script>'), '')
  assert.equal(safeImageUrl(''), '')
})

test('opacity and blur land on the backdrop layer, not the content', () => {
  const layers = backgroundLayers({ mode: 'color', color: '#FF0000', opacity: 40, blur: 8 })
  assert.equal(layers.base.opacity, 0.4)
  assert.equal(layers.base.filter, 'blur(8px)')
  // Scaled up so the blur doesn't sample past its own edges into a halo.
  assert.equal(layers.base.transform, 'scale(1.06)')
  assert.equal(layers.base.background, '#FF0000')
})

test('out-of-range values are clamped rather than trusted', () => {
  assert.equal(backgroundLayers({ mode: 'color', opacity: 900 }).base.opacity, 1)
  assert.equal(backgroundLayers({ mode: 'color', opacity: -50 }).base.opacity, 0)
  assert.equal(backgroundLayers({ mode: 'color', blur: 999 }).base.filter, 'blur(40px)')
  const angled = backgroundLayers({ mode: 'gradient', angle: 5000, gradientFrom: '#000', gradientTo: '#fff' })
  assert.ok(angled.base.background.startsWith('linear-gradient(360deg'))
})

test('the tint layer only exists when it would actually show', () => {
  assert.equal(backgroundLayers({ mode: 'color', overlayOpacity: 0 }).overlay, null)
  const tinted = backgroundLayers({ mode: 'color', overlayOpacity: 50, overlayColor: '#000000' })
  assert.equal(tinted.overlay.opacity, 0.5)
  assert.equal(tinted.overlay.background, '#000000')
})

// --- entrance content ---------------------------------------------------

const base = { id: 'i1', title: 'Record quarter', active: true, startDate: '', endDate: '' }

test('an announcement needs to be active and to say something', () => {
  assert.equal(itemIsLive(base), true)
  assert.equal(itemIsLive({ ...base, active: false }), false)
  assert.equal(itemIsLive({ ...base, title: '   ' }), false)
})

test('date windows open and close on their own', () => {
  const now = new Date(2026, 2, 15) // 15 March 2026

  assert.equal(itemIsLive({ ...base, startDate: '2026-03-01' }, now), true)
  assert.equal(itemIsLive({ ...base, startDate: '2026-04-01' }, now), false)
  assert.equal(itemIsLive({ ...base, endDate: '2026-03-31' }, now), true)
  assert.equal(itemIsLive({ ...base, endDate: '2026-03-01' }, now), false)
  assert.equal(itemIsLive({ ...base, startDate: '2026-03-01', endDate: '2026-03-31' }, now), true)
})

test('the end date is inclusive to the last moment of the day', () => {
  // "Ends 31 March" plainly means it should still show on 31 March.
  const lateOnTheLastDay = new Date(2026, 2, 31, 23, 30)
  assert.equal(itemIsLive({ ...base, endDate: '2026-03-31' }, lateOnTheLastDay), true)

  const nextMorning = new Date(2026, 3, 1, 0, 1)
  assert.equal(itemIsLive({ ...base, endDate: '2026-03-31' }, nextMorning), false)
})

test('a disabled entrance shows nothing, however many items it holds', () => {
  const entrance = { enabled: false, items: [base] }
  assert.deepEqual(liveEntranceItems(entrance), [])
})

test('the entrance shows at most four announcements', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ ...base, id: `i${i}` }))
  assert.equal(liveEntranceItems({ enabled: true, items }).length, 4)
})

test('saved branding beats the build-time default, blank falls back', () => {
  assert.deepEqual(resolveBrand({ brandName: 'Acme', tagline: 'Go' }, 'Env', 'EnvTag'), {
    name: 'Acme',
    tagline: 'Go',
  })
  assert.deepEqual(resolveBrand({ brandName: '  ' }, 'Env', 'EnvTag'), { name: 'Env', tagline: 'EnvTag' })
  assert.deepEqual(resolveBrand(null, 'Env', 'EnvTag'), { name: 'Env', tagline: 'EnvTag' })
})

test('an admin cannot lock people out with a huge duration', () => {
  assert.equal(entranceDuration({ durationMs: 2600 }, 0), 2600)
  // Each announcement buys reading time...
  assert.equal(entranceDuration({ durationMs: 2600 }, 2), 4000)
  // ...but the base and the total are both capped.
  assert.equal(entranceDuration({ durationMs: 600000 }, 0), 6000)
  assert.equal(entranceDuration({ durationMs: 600000 }, 4), 8800)
  assert.ok(entranceDuration({ durationMs: 600000 }, 99) <= 9000)
  // And a nonsense value falls back to the default rather than to zero.
  assert.equal(entranceDuration({ durationMs: 'abc' }, 0), 2600)
})
