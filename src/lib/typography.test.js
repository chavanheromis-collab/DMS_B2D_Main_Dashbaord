import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  CARD_FONTS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TYPOGRAPHY_KEYS,
  MARK_SIZE_MAX,
  MARK_SIZE_MIN,
  clearTypography,
  hasChartText,
  hasTypography,
  markTextClass,
  markTextVars,
  typographyClass,
  typographyVars,
} from './typography.js'
import { DEFAULT_WIDGET_STYLE, hasCustomStyle, styleClass, styleVars } from './widgetStyle.js'
import { DEFAULT_DESIGN, designClass, designVars, isDefaultDesign } from './pageDesign.js'

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
const paint = read('components/WidgetPaint.jsx')
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
  // Five: the ink, the muted, the weight, the chart's axis text, and a
  // control's chrome -- `.control-skin.card-ink` contains `.card-ink`, so
  // it is counted here too. The count is the canary: a sixth means somebody
  // swept another set of classes in, and this is where they say so.
  assert.equal(rules.length, 5)
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
  assert.ok(paint.includes('<TypographyFields value={s} onChange={set} />'))
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

// ---------------------------------------------------------------------
// The two kinds of writing inside a chart
// ---------------------------------------------------------------------

test('a chart’s text and its legend are two separate decisions', () => {
  // One control for both would mean enlarging a legend enlarged forty axis
  // ticks with it, and the chart lost the space it was drawn in.
  const vars = styleVars({
    chartText: { text: '#111111', size: 13 },
    legendText: { text: '#ff0000', weight: 'bold' },
  })
  assert.equal(vars['--chart-text'], '#111111')
  assert.equal(vars['--chart-size'], '13px')
  assert.equal(vars['--legend-text'], '#ff0000')
  assert.equal(vars['--legend-weight'], '700')
  assert.equal(vars['--legend-size'], undefined, 'the legend took no size from the chart')
})

test('each property switches on its own rule', () => {
  // `font-size: var(--chart-size, inherit)` under one class would reset
  // every tick to its parent's size the moment somebody picked a typeface.
  assert.equal(markTextClass({ font: 'serif' }, 'chart'), 'chart-font')
  assert.equal(markTextClass({ size: 12 }, 'chart'), 'chart-size')
  assert.equal(markTextClass({ text: '#111' }, 'legend'), 'legend-ink')
  assert.equal(markTextClass({}, 'chart'), '')
})

test('a chart text size is clamped to something readable', () => {
  assert.equal(markTextVars({ size: 900 }, 'chart')['--chart-size'], `${MARK_SIZE_MAX}px`)
  assert.equal(markTextVars({ size: 1 }, 'chart')['--chart-size'], `${MARK_SIZE_MIN}px`)
  assert.equal(markTextVars({ size: 'big' }, 'chart'), undefined)
})

test('this is only offered on widgets that draw a chart', () => {
  // A control that does nothing is the bug this whole file exists to fix.
  for (const type of ['chart', 'trend', 'stacked', 'combo', 'scatter']) {
    assert.ok(hasChartText(type), type)
  }
  for (const type of ['kpi', 'table', 'pivot', 'flow', 'text', 'leaderboard', undefined]) {
    assert.ok(!hasChartText(type), String(type))
  }
})

test('an empty text group is not a decision', () => {
  // The editor writes both groups on every save. Counting their presence
  // would report every widget on the page as restyled.
  assert.equal(hasCustomStyle({ ...DEFAULT_WIDGET_STYLE }), false)
  assert.equal(styleVars({ ...DEFAULT_WIDGET_STYLE }), undefined)
  assert.equal(hasCustomStyle({ ...DEFAULT_WIDGET_STYLE, chartText: { text: '#111' } }), true)
})

test('a stock design loaded back from storage is still stock', () => {
  // Two objects that say the same nothing are not the same object, and
  // comparing them by identity would grey out the Reset button's opposite.
  assert.equal(isDefaultDesign(JSON.parse(JSON.stringify(DEFAULT_DESIGN))), true)
  assert.equal(isDefaultDesign({ ...DEFAULT_DESIGN, legendText: { size: 14 } }), false)
})

test('a page can set the chart text for every chart on it', () => {
  const vars = designVars({ ...DEFAULT_DESIGN, legendText: { size: 14 } })
  assert.equal(vars['--legend-size'], '14px')
  assert.ok(designClass({ ...DEFAULT_DESIGN, legendText: { size: 14 } }).includes('legend-size'))
})

// --- the rules, and the classes they are aimed at ------------------------

const chartWidget = read('components/widgets/ChartWidget.jsx')
const pie = read('components/widgets/PiePanel.jsx')
const analytics = read('components/widgets/AnalyticsWidgets.jsx')

test('every recharts class these rules aim at still exists in recharts', () => {
  // A recharts upgrade that renamed one of these would otherwise turn the
  // whole feature off silently.
  const dir = path.resolve(SRC, '..', 'node_modules', 'recharts', 'lib')
  if (!fs.existsSync(dir)) return

  const names = [...new Set(css.match(/recharts-[a-z-]+/g) || [])]
  assert.ok(names.length >= 6)

  const walk = (at) =>
    fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(at, e.name)
      return e.isDirectory() ? walk(full) : e.name.endsWith('.js') ? [full] : []
    })
  const source = walk(dir)
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')

  for (const name of names) assert.ok(source.includes(name), `${name} is gone from recharts`)
})

test('a label drawn INSIDE a bar keeps its own colour', () => {
  // It is white because it sits on the bar's fill. A colour picked against
  // a white card would disappear into it.
  assert.ok(chartWidget.includes('className="label-on-fill"'))
  const rules = css.match(/\.chart-(ink|font|size|weight) :where\([^)]*\)/g) || []
  assert.equal(rules.length, 4)
  for (const rule of rules) assert.ok(rule.includes(':not(.label-on-fill)'), rule)
})

test('the app’s own legends are legends too', () => {
  // Not every legend here is drawn by recharts: the pie's scrolls, and the
  // trend chart's toggles series on and off.
  assert.ok(pie.includes('className={`chart-legend'))
  assert.ok(analytics.includes('chart-legend mt-1 flex flex-wrap'))
  assert.ok(chartWidget.includes('className="chart-legend max-h-full'))
})

test('the legend rules are written after the card’s, so they win the tie', () => {
  // A legend sits inside the card, so the card's own text rules match it
  // too. This is the more specific INTENT even where it is not the more
  // specific selector.
  assert.ok(css.indexOf('.legend-ink') > css.indexOf('.card-muted'))
})

test('chart text can be set on the widget, in the admin panel, and on the page', () => {
  assert.ok(paint.includes('<MarkTextFields label="Chart text"'))
  assert.ok(paint.includes('<MarkTextFields label="Legend"'))
  assert.ok(editor.includes('value={style.chartText}'))
  assert.ok(editor.includes('value={style.legendText}'))
  assert.ok(designPanel.includes('value={d.chartText}'))
  assert.ok(designPanel.includes('value={d.legendText}'))
})

test('the widget’s own panel only offers it where there is a chart', () => {
  assert.ok(bar.includes('chartText={hasChartText(widgetType)}'))
  assert.ok(paint.includes('{chartText && ('))
  assert.ok(dashboard.includes('widgetType={widget.type}'))
  assert.ok(editor.includes('{hasChartText(widget.type) && ('))
})

// --- the accent, on the widgets that were offered one --------------------

test('AN ACCENT IS HONOURED BY MORE THAN ONE WIDGET TYPE', () => {
  // The picker is on every widget's paint panel and six named themes set
  // one. Exactly one widget type read it -- everywhere else it was a colour
  // you could choose and never see.
  assert.ok(styleClass({ accent: '#ff0000' }).includes('card-accented'))
  assert.equal(styleVars({ accent: '#ff0000' })['--card-accent'], '#ff0000')
})

test('no accent, no class -- an untouched widget is untouched', () => {
  assert.equal(styleClass({ bg: '#fff' }).includes('card-accented'), false)
})

test('the accent colours the control that is ON', () => {
  // What an accent means inside a widget is "the thing that is currently
  // narrowing it".
  const controlsSrc = read('components/WidgetControls.jsx')
  assert.ok(controlsSrc.includes("const live = 'control-live border-indigo-300"))
  assert.ok(css.includes('.card-accented :where(.control-live)'))
})

test('it falls back to what the control looked like before', () => {
  // Where `color-mix` is unsupported the declaration is dropped and the
  // indigo underneath stands -- which is the right thing to land on,
  // because it is what was there.
  const rule = css.slice(css.indexOf('.card-accented :where(.control-live)'))
  assert.ok(rule.slice(0, 260).includes('color-mix(in srgb, var(--card-accent)'))
  const controlsSrc = read('components/WidgetControls.jsx')
  assert.ok(controlsSrc.includes('border-indigo-300 bg-indigo-50 text-indigo-700'), 'the fallback is still there')
})

test('every custom property this app emits is read by something', () => {
  // The bug class this whole area keeps producing: a picker that saves a
  // value nothing ever draws. `--page-gap-*` are published for authors and
  // deliberately have no rule of their own.
  const emitted = new Set()
  for (const file of ['lib/widgetStyle.js', 'lib/typography.js', 'lib/pageDesign.js']) {
    const src = fs.readFileSync(path.join(SRC, file), 'utf8')
    for (const m of src.matchAll(/'(--[a-z0-9-]+)'/g)) emitted.add(m[1])
  }
  const consumers = [css, read('components/widgets/FilterPanelWidget.jsx')].join('\n')
  const unread = [...emitted].filter((p) => !consumers.includes(`var(${p}`) && !p.startsWith('--page-gap'))
  assert.deepEqual(unread, [])
})

// ---------------------------------------------------------------------
// A colour somebody chose beats one the theme chose for them
// ---------------------------------------------------------------------

test('a dark theme does not overrule a text colour the admin picked', () => {
  // This was the whole of "the text colour does nothing": almost every
  // theme sets `invert`, `.card-invert .card` is two classes to
  // `.card-ink`'s one, and so the theme's grey won every time.
  const css = read('index.css')
  assert.ok(css.includes('.card-invert:not(.card-ink) .card :where(.text-ink'))
  assert.ok(css.includes('.card-invert:not(.card-muted) .card :where(.text-slate-500'))
  // ...and the plain form is gone, or it would go on winning.
  assert.ok(!css.includes('.card-invert .card :where(.text-ink'))
  assert.ok(!css.includes('.card-invert .card :where(.text-slate-500'))
})

test('both classes are on the same element, or the :not could never fire', () => {
  const both = styleClass({ theme: 'ocean', text: '#ff0000' })
  assert.ok(both.includes('card-invert'))
  assert.ok(both.includes('card-ink'))
})

test('the widget text colour reaches the chart as well', () => {
  // A chart is SVG, so its writing takes `fill` and not `color`. Setting
  // the text colour used to change everything on the card except the axis
  // labels, and having to say it twice reads as it not working.
  // `read` collapses whitespace, so the multi-line selector arrives on one
  // line -- which is the shape to match against.
  const flat = read('index.css')
  const at = flat.indexOf('.card-ink :where( .recharts-cartesian-axis-tick-value')
  assert.ok(at > 0, 'the widget colour is offered to the chart')
  assert.ok(flat.slice(at, at + 400).includes('fill: var(--card-text)'))
  // A fallback, not the rule: the chart's own colour is declared further
  // down and wins on source order.
  assert.ok(flat.indexOf('.chart-ink :where(') > at, 'the chart own colour still wins')
})

test('a widget heading follows the chosen text colour', () => {
  // The heading carries its own class rather than a Tailwind grey, so the
  // remap that catches every other piece of text on the card never reached
  // it: the title was the one thing the colour picker did not move.
  const flat = read('index.css')
  const at = flat.indexOf('.widget-title { ')
  assert.ok(at > 0)
  assert.ok(flat.slice(at, at + 300).includes('color: var(--card-text, #1e293b)'))
})

test('...and is legible on a dark card that has no chosen colour', () => {
  // Near-black on near-black was what it did before, which is what made
  // the chart headings in a dark theme almost invisible.
  const flat = read('index.css')
  assert.ok(flat.includes('.text-slate-600, .widget-title) { color: #e2e8f0'))
})
