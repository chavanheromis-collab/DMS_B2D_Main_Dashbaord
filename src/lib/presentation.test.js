import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  backgroundIsSet,
  backgroundLayers,
  safeImageUrl,
  sidebarSurface,
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

// ---------------------------------------------------------------------
// The sidebar sitting WITH the page rather than beside it
// ---------------------------------------------------------------------

test('a page with a colour lends it to the sidebar', () => {
  // A white panel against a deep navy dashboard reads as two applications
  // open at once.
  assert.deepEqual(sidebarSurface({ mode: 'color', color: '#0F172A' }), {
    background: '#0F172A',
    light: true,
  })
})

test('and a pale page keeps dark writing in the sidebar', () => {
  const out = sidebarSurface({ mode: 'color', color: '#F8FAFC' })
  assert.equal(out.background, '#F8FAFC')
  assert.equal(out.light, false)
})

test('a gradient lends its starting colour, not the whole gradient', () => {
  // Running one gradient down a narrow column beside a wide one shows two
  // different slices of it, which reads as a mismatch rather than a match.
  const out = sidebarSurface({ mode: 'gradient', gradientFrom: '#1E293B', gradientTo: '#0EA5E9' })
  assert.equal(out.background, '#1E293B')
  assert.ok(!String(out.background).includes('gradient'))
})

test('a page nobody has restyled leaves the sidebar exactly as it is', () => {
  // The stock look is what the page has, so it is what the sidebar has.
  assert.equal(sidebarSurface(null), null)
  assert.equal(sidebarSurface({}), null)
  assert.equal(sidebarSurface({ mode: 'color', color: '' }), null)
})

test('an image mode with no image lends nothing, colour or not', () => {
  // The PAGE is showing the app default here -- `backgroundIsSet` says a
  // picture mode with no picture is no backdrop at all -- so the sidebar
  // must show the app default too. Reading the colour behind the missing
  // image would paint the sidebar for a backdrop nobody can see.
  assert.equal(sidebarSurface({ mode: 'image', imageUrl: '' }), null)
  assert.equal(sidebarSurface({ mode: 'image', imageUrl: '', color: '#111827' }), null)
})

test('a photograph is not a colour, so nothing is guessed', () => {
  // Guessing wrong is worse than not guessing.
  assert.equal(sidebarSurface({ mode: 'image', imageUrl: 'https://example.com/a.jpg' }), null)
})

test('...unless a colour was set behind it, which is a decision somebody made', () => {
  const out = sidebarSurface({ mode: 'image', imageUrl: 'https://example.com/a.jpg', color: '#111827' })
  assert.equal(out.background, '#111827')
})

test('the admin can still overrule what the sidebar works out', () => {
  // `textMode` is the existing override for the page chrome; the sidebar
  // answers to it too rather than having a second switch of its own.
  assert.equal(sidebarSurface({ mode: 'color', color: '#0F172A', textMode: 'dark' }).light, false)
  assert.equal(sidebarSurface({ mode: 'color', color: '#F8FAFC', textMode: 'light' }).light, true)
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const readSrc = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('the page hands the sidebar its own colour', () => {
  const dash = readSrc('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('surface={sidebarSurface(page?.background)}'))
  const shell = readSrc('src/components/AppShell.jsx')
  assert.ok(shell.includes('surface={surface}'))
})

test('and the sidebar wears it, on the desktop panel and the drawer alike', () => {
  // Two elements, and forgetting one leaves a white drawer sliding over a
  // navy dashboard.
  const bar = readSrc('src/components/Sidebar.jsx')
  assert.equal(bar.split('surface ? { background: surface.background } : null').length, 3)
  assert.equal(bar.split("surface?.light ? 'sidebar-invert' : ''").length, 3)
})

test('a page with no backdrop keeps the stock panel', () => {
  // The stock look is what the page has, so it is what the sidebar has.
  const bar = readSrc('src/components/Sidebar.jsx')
  assert.ok(bar.includes("surface ? 'sidebar-skin' : 'bg-white/85'"))
  assert.ok(bar.includes("surface ? 'sidebar-skin' : 'bg-white'"))
})

test('the frosting goes with the colour', () => {
  // A frosted panel over a solid colour is a lighter smear of that colour,
  // not the colour.
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  const flat = css.replace(/\s+/g, ' ')
  assert.ok(flat.includes('.sidebar-skin { backdrop-filter: none; }'))
})

test('a dark page brings the sidebar writing with it', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  assert.ok(css.includes('.sidebar-invert :where(.text-ink, .text-slate-900'))
  assert.ok(css.includes('.sidebar-invert :where(.text-slate-500'))
  // The same list the cards use: only the neutral greys, so an error stays
  // legible instead of vanishing.
  const rules = css.match(/\.sidebar-invert :where\([^)]*\)/g) || []
  for (const rule of rules) assert.ok(!/rose|emerald|amber|red|green/.test(rule), rule)
})
