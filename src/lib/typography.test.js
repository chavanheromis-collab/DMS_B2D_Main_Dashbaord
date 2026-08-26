import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  CARD_FONTS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TYPOGRAPHY_KEYS,
  clearTypography,
  hasTypography,
  typographyClass,
  typographyVars,
} from './typography.js'
import { DEFAULT_WIDGET_STYLE, styleClass, styleVars } from './widgetStyle.js'
import { DEFAULT_DESIGN, designClass, designVars } from './pageDesign.js'

// ---------------------------------------------------------------------
// The admin decides what the text looks like
// ---------------------------------------------------------------------

test('the Text colour finally does something', () => {
  // It was on the paint panel, it saved its value, and nothing ever turned
  // it into a property anything read. This is that bug, kept as a test.
  assert.equal(styleVars({ text: '#123456' })['--card-text'], '#123456')
  assert.ok(styleClass({ text: '#123456' }).includes('card-ink'))
})

test('an untouched widget still emits nothing at all', () => {
  // The stock look is absent, not re-stated -- which is what makes this
  // feature incapable of drifting an existing dashboard.
  assert.equal(styleVars({ ...DEFAULT_WIDGET_STYLE }), undefined)
  assert.equal(styleClass({ ...DEFAULT_WIDGET_STYLE }), '')
  assert.equal(typographyVars({}), undefined)
  assert.equal(typographyClass({}), '')
  assert.equal(hasTypography({}), false)
})

test('only what was actually chosen is emitted', () => {
  assert.deepEqual(typographyVars({ align: 'center' }), { '--card-align': 'center' })
})

test('every text decision has somewhere to go', () => {
  const vars = typographyVars({
    text: '#111111',
    textMuted: '#888888',
    font: 'serif',
    textScale: 1.25,
    tracking: 'wide',
    align: 'right',
    weight: 'bold',
  })
  assert.deepEqual(Object.keys(vars).sort(), [
    '--card-align',
    '--card-font',
    '--card-text',
    '--card-text-muted',
    '--card-tracking',
    '--card-weight',
    '--card-zoom',
  ])
  assert.equal(vars['--card-weight'], '700')
  assert.equal(vars['--card-tracking'], '0.03em')
})

test('headings and captions are two decisions, not one', () => {
  // The greys exist to create a hierarchy. One class for both would mean
  // that using the feature at all flattened it.
  assert.equal(typographyClass({ text: '#111111' }), 'card-ink')
  assert.equal(typographyClass({ textMuted: '#888888' }), 'card-muted')
  const both = typographyClass({ text: '#111111', textMuted: '#888888' })
  assert.ok(both.includes('card-ink') && both.includes('card-muted'))
})

test('a size of exactly 100% is not a zoom', () => {
  // Emitting zoom:1 would put every widget in its own compositing layer for
  // the sake of saying nothing.
  assert.equal(typographyVars({ textScale: 1 }), undefined)
  assert.equal(typographyClass({ textScale: 1 }), '')
})

test('a size is clamped to something readable', () => {
  assert.equal(typographyVars({ textScale: 12 })['--card-zoom'], TEXT_SCALE_MAX)
  assert.equal(typographyVars({ textScale: 0.01 })['--card-zoom'], TEXT_SCALE_MIN)
  assert.equal(typographyVars({ textScale: 'big' }), undefined)
  assert.equal(typographyVars({ textScale: -2 }), undefined)
})

test('an unknown font is inherited rather than written into the page', () => {
  assert.equal(typographyVars({ font: 'comic' }), undefined)
  assert.equal(typographyVars({ font: '' }), undefined)
})

test('no font here is downloaded', () => {
  // A dashboard that waits on a webfont shows a page of invisible text
  // first, and picking a typeface from a dropdown is not agreement to that
  // on behalf of forty readers.
  for (const f of CARD_FONTS) {
    if (!f.css) continue
    assert.ok(!/url\(|@import|https?:/i.test(f.css), f.value)
  }
})

test('clearing the text leaves everything around it alone', () => {
  const style = { ...DEFAULT_WIDGET_STYLE, bg: '#fff', text: '#111', font: 'serif', radius: 8 }
  const cleared = clearTypography(style)
  assert.equal(cleared.bg, '#fff')
  assert.equal(cleared.radius, 8)
  for (const key of TYPOGRAPHY_KEYS) assert.equal(cleared[key], null, key)
  assert.equal(hasTypography(cleared), false)
})

// --- where it is set -----------------------------------------------------

test('a widget carries its own text, alongside its surface', () => {
  const vars = styleVars({ bg: '#fff', text: '#111111', font: 'mono' })
  assert.equal(vars['--card-bg'], '#fff')
  assert.equal(vars['--card-text'], '#111111')
  assert.ok(vars['--card-font'].includes('mono'))
})

test('a dark theme still inverts, and can be typed on top of', () => {
  const cls = styleClass({ theme: 'dark', font: 'serif' })
  assert.ok(cls.includes('card-invert'))
  assert.ok(cls.includes('card-typo'))
})

test('a page sets the text for everything on it, controls included', () => {
  const vars = designVars({ ...DEFAULT_DESIGN, text: '#222222', font: 'serif' })
  assert.equal(vars['--card-text'], '#222222')
  assert.ok(designClass({ ...DEFAULT_DESIGN, text: '#222222' }).includes('card-ink'))
})

test('a page nobody has restyled adds no text classes', () => {
  assert.equal(designClass({ ...DEFAULT_DESIGN }), '')
  const vars = designVars({ ...DEFAULT_DESIGN })
  for (const key of Object.keys(vars)) assert.ok(!key.startsWith('--card-text'), key)
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
const bar = read('components/ArrangeBar.jsx')
const editor = read('pages/admin/StyleEditor.jsx')
const designPanel = read('components/PageDesignPanel.jsx')
const dashboard = read('pages/Dashboard.jsx')
const controls = read('components/WidgetControls.jsx')

test('the chosen colours are remapped onto the greys the widgets hard-code', () => {
  assert.ok(css.includes('.card-ink :where(.text-ink, .text-slate-900'))
  assert.ok(css.includes('.card-muted :where(.text-slate-500, .text-slate-400'))
})

test('ONLY the neutral greys are remapped', () => {
  // An error stays rose and a KPI keeps its accent. Choosing a text colour
  // is not a request for your errors to become invisible.
  const rules = css.match(/\.card-(ink|muted|weight) :where\([^)]*\)/g) || []
  assert.equal(rules.length, 3)
  for (const rule of rules) {
    assert.ok(!/rose|emerald|amber|indigo|red|green/.test(rule), rule)
  }
})

test('the size never lands on the element the canvas measures', () => {
  // The packer would be reading a height in a different coordinate space
  // from the one it is placing.
  assert.ok(css.includes('.page-canvas .card-typo :where(.card, .widget-controls)'))
  assert.ok(css.includes('zoom: calc(var(--font-scale, 1) * var(--card-zoom, 1))'), 'and it multiplies with the page')
})

test('a widget’s own controls are part of the same decision', () => {
  assert.ok(controls.includes('className="widget-controls mb-1.5'))
})

test('text can be set on the widget, in the admin panel, and on the page', () => {
  assert.ok(bar.includes('<TypographyFields value={s} onChange={set} />'))
  assert.ok(editor.includes('<TypographyFields value={style} onChange={(patch) => setStyle(patch)} />'))
  assert.ok(designPanel.includes('<TypographyFields value={d} onChange={set} showSize={false}'))
})

test('the page hands its text decisions to the canvas', () => {
  assert.ok(dashboard.includes('${designClass(design)}'))
  assert.ok(dashboard.includes('designClass, designVars'))
})

test('the admin panel’s preview is drawn by the same code as the page', () => {
  // A preview with its own idea of how a style is applied is a preview that
  // will one day be confidently wrong.
  assert.ok(editor.includes('className={`flex-1 ${styleClass(style)}`} style={styleVars(style)}'))
})
