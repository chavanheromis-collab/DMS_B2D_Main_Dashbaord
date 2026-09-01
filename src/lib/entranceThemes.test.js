import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_BACKDROP,
  DEFAULT_THEME,
  ENTRANCE_THEMES,
  LOGO_BACKDROPS,
  backdropClass,
  backdropOf,
  themeOf,
  themeVars,
} from './entranceThemes.js'
import { DEFAULT_ENTRANCE } from './branding.js'

// ---------------------------------------------------------------------
// The themes themselves
// ---------------------------------------------------------------------

test('there are enough of them to be a choice', () => {
  assert.ok(ENTRANCE_THEMES.length >= 8, `${ENTRANCE_THEMES.length} themes`)
  assert.ok(ENTRANCE_THEMES.length <= 12, 'and few enough to pick from at a glance')
})

test('every theme is complete', () => {
  // A theme missing one colour is a theme with a hole in it -- the variable
  // falls back to the original's, and the entrance comes out half one look
  // and half another.
  for (const t of ENTRANCE_THEMES) {
    for (const key of ['value', 'label', 'hint', 'bg', 'orbA', 'orbB', 'grid', 'rule']) {
      assert.ok(t[key], `${t.value || '?'} has no ${key}`)
    }
    assert.equal(typeof t.dark, 'boolean', `${t.value} does not say whether it is dark`)
  }
})

test('no two themes are the same theme', () => {
  const values = ENTRANCE_THEMES.map((t) => t.value)
  assert.equal(new Set(values).size, values.length)
  const labels = ENTRANCE_THEMES.map((t) => t.label)
  assert.equal(new Set(labels).size, labels.length)
  const grounds = ENTRANCE_THEMES.map((t) => t.bg)
  assert.equal(new Set(grounds).size, grounds.length)
})

test('a business whose identity is light has a choice too', () => {
  // MORE THAN ONE light theme, not "at least one". A single token light
  // option is not a choice, and stated as a disjunction over ten themes the
  // claim also could not be broken by any one edit -- flipping one left the
  // other and the test went green.
  assert.ok(ENTRANCE_THEMES.filter((t) => t.dark).length >= 6)
  assert.ok(ENTRANCE_THEMES.filter((t) => !t.dark).length >= 2, 'at least two light ones')
})

test('a dark theme has a dark ground and a light one a light ground', () => {
  // `dark` decides the text colour. A theme that says dark and is not is a
  // theme whose tagline cannot be read.
  const lum = (hex) => {
    const n = parseInt(String(hex).slice(1), 16)
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  }
  for (const t of ENTRANCE_THEMES) {
    if (t.dark) assert.ok(lum(t.bg) < 0.3, `${t.value} claims dark but its ground is light`)
    else assert.ok(lum(t.bg) > 0.8, `${t.value} claims light but its ground is dark`)
  }
})

test('the default is one that exists', () => {
  assert.ok(ENTRANCE_THEMES.some((t) => t.value === DEFAULT_THEME))
  assert.equal(themeOf({ theme: DEFAULT_THEME }).value, DEFAULT_THEME)
})

test('a theme this build has never heard of still draws an entrance', () => {
  // A config written by a newer deploy, or a typo in the database. The
  // entrance must not come out as a blank white rectangle.
  assert.equal(themeOf({ theme: 'chartreuse' }).value, ENTRANCE_THEMES[0].value)
  assert.equal(themeOf({}).value, ENTRANCE_THEMES[0].value)
  assert.equal(themeOf(null).value, ENTRANCE_THEMES[0].value)
})

test('the first theme is the one the entrance always had', () => {
  // It is the fallback for everything, so it had better be the familiar
  // one rather than whichever got typed first.
  assert.equal(ENTRANCE_THEMES[0].value, 'midnight')
  assert.equal(ENTRANCE_THEMES[0].bg, '#020617', 'slate-950, as before')
})

// ---------------------------------------------------------------------
// What the stylesheet is handed
// ---------------------------------------------------------------------

test('every variable the stylesheet reads is supplied', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  const used = new Set([...css.matchAll(/var\((--splash-[\w-]+)/g)].map((m) => m[1]))
  const supplied = new Set(Object.keys(themeVars(ENTRANCE_THEMES[0])))
  for (const name of used) {
    assert.ok(supplied.has(name), `${name} is read by the stylesheet and never set`)
  }
  assert.ok(used.size >= 3, 'the stylesheet must actually read the theme')
})

test('every variable is supplied for every theme', () => {
  const keys = Object.keys(themeVars(ENTRANCE_THEMES[0]))
  for (const t of ENTRANCE_THEMES) {
    const vars = themeVars(t)
    for (const k of keys) assert.ok(vars[k], `${t.value} has no ${k}`)
  }
})

test('the text follows the ground', () => {
  // An entrance whose tagline is unreadable is worse than a plain one.
  const dark = themeVars(ENTRANCE_THEMES.find((t) => t.dark))
  const light = themeVars(ENTRANCE_THEMES.find((t) => !t.dark))
  assert.equal(dark['--splash-title'], '#ffffff')
  assert.notEqual(light['--splash-title'], '#ffffff')
})

test('nothing at all still yields a usable set', () => {
  const vars = themeVars(undefined)
  assert.ok(vars['--splash-bg'])
  assert.ok(vars['--splash-title'])
})

// ---------------------------------------------------------------------
// Behind the logo
// ---------------------------------------------------------------------

test('a transparent logo can be given something to sit on', () => {
  // Transparent is the right thing to upload, but transparent means the ink
  // is whatever the designer chose: a dark logo disappears on a dark
  // background, a white one on a light background.
  assert.ok(LOGO_BACKDROPS.length >= 4)
  for (const value of ['glow', 'none', 'light', 'dark']) {
    assert.ok(LOGO_BACKDROPS.some((b) => b.value === value), value)
  }
})

test('every backdrop says what it is for', () => {
  for (const b of LOGO_BACKDROPS) {
    assert.ok(b.label && b.hint, b.value)
  }
})

test('the default is the glow, which is what it always did', () => {
  assert.equal(DEFAULT_BACKDROP, 'glow')
  assert.equal(backdropOf({}).value, 'glow')
  assert.equal(backdropOf({ logoBackdrop: 'nonsense' }).value, 'glow')
  assert.ok(backdropClass(backdropOf({})).includes('drop-shadow'))
})

test('"none" really is nothing, and the plates really are plates', () => {
  assert.equal(backdropClass('none'), '')
  assert.ok(backdropClass('light').includes('bg-white'))
  assert.ok(backdropClass('dark').includes('bg-slate-900'))
  // Both plates need padding, or the logo touches the edge of its panel.
  assert.ok(backdropClass('light').includes('p-4'))
  assert.ok(backdropClass('dark').includes('p-4'))
})

test('a backdrop can be named or passed whole', () => {
  // The splash passes the object, the admin preview passes a value.
  assert.equal(backdropClass({ value: 'none' }), backdropClass('none'))
  assert.equal(backdropClass({ value: 'light' }), backdropClass('light'))
})

test('the stored default names both, rather than relying on order', () => {
  assert.equal(DEFAULT_ENTRANCE.theme, DEFAULT_THEME)
  assert.equal(DEFAULT_ENTRANCE.logoBackdrop, DEFAULT_BACKDROP)
})

// ---------------------------------------------------------------------
// The logo that would not load
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const splash = read('src/components/SplashScreen.jsx')
const icon = read('src/components/PageIcon.jsx')
const hook = read('src/hooks/useImageFallback.js')
const panel = read('src/pages/admin/EntrancePanel.jsx')

test('the entrance logo keeps trying, instead of hiding itself', () => {
  // It took the single best Drive URL and hid the image on failure, so a
  // file whose CDN copy had not been generated yet simply never appeared.
  assert.ok(splash.includes('const logo = useImageFallback(entrance?.logoUrl, 260)'))
  assert.ok(splash.includes('onError={logo.onError}'))
  assert.ok(!splash.includes("e.currentTarget.style.display = 'none'"))
})

test('and it asks Google without a referrer', () => {
  // Google refuses image requests carrying a referrer from an origin it does
  // not know, which is every deployment of this dashboard. Without this a
  // perfectly public file 403s -- the other half of "it does not load".
  const img = splash.slice(splash.indexOf('{logo.url && !logo.exhausted ? ('))
  assert.ok(img.slice(0, 600).includes('referrerPolicy="no-referrer"'))
  assert.ok(panel.includes('referrerPolicy="no-referrer"'), 'and so does the admin preview')
})

test('the default mark comes back only when every endpoint has refused', () => {
  // Not on the first failure, which would show the generic logo over a
  // perfectly good one that just needed the next URL.
  assert.ok(splash.includes('{logo.url && !logo.exhausted ? ('))
})

test('one retry loop, not two', () => {
  // The second copy is what let the entrance quietly do without it.
  assert.ok(icon.includes("import { useImageFallback } from '../hooks/useImageFallback'"))
  assert.ok(splash.includes("import { useImageFallback } from '../hooks/useImageFallback'"))
  for (const file of [icon, splash]) {
    assert.ok(!file.includes('imageCandidates('), 'the loop lives in the hook')
  }
})

test('a fresh source starts again from the best endpoint', () => {
  // Without this, fixing a typo leaves the fallback showing until a reload.
  assert.ok(hook.includes('useEffect(() => { setAttempt(0) }, [candidates.join(\'|\')])'))
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

test('the entrance is painted by the theme, not by a fixed class', () => {
  assert.ok(splash.includes("style={{ ...themeVars(theme), background: 'var(--splash-bg)' }}"))
  assert.ok(!splash.includes('bg-slate-950'))
})

test('the logo gets whatever backdrop was chosen', () => {
  assert.ok(splash.includes('${backdropClass(backdrop)}'))
  assert.ok(splash.includes('const backdrop = backdropOf(entrance)'))
})

test('the admin picks a theme by looking at it', () => {
  // Ten names in a dropdown is ten names. The swatch is the theme.
  // Per BLOCK: the backdrop buttons below carry `aria-pressed` too, so a
  // bare search for it is satisfied with the swatches' own gone.
  const swatches = panel.slice(
    panel.indexOf('{ENTRANCE_THEMES.map((t) => {'),
    panel.indexOf('{LOGO_BACKDROPS.map((b) => {')
  )
  assert.ok(swatches.length > 0)
  assert.ok(swatches.includes('style={{ background: t.bg }}'))
  assert.ok(swatches.includes('style={{ background: t.orbA }}'))
  assert.ok(swatches.includes('aria-pressed={on}'))
})

test('the logo preview uses the theme actually chosen', () => {
  // A preview on a colour the entrance does not use answers the wrong
  // question.
  assert.ok(panel.includes('style={{ background: themeOf(draft).bg }}'))
  assert.ok(panel.includes('backdropClass({ value: draft.logoBackdrop || DEFAULT_BACKDROP })'))
})

test('the admin is told what transparency costs, where the choice is made', () => {
  assert.ok(panel.includes('transparent PNG or SVG is the right thing to upload'))
  assert.ok(panel.includes('disappears on a dark background'))
})
