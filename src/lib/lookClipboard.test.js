import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { clearLook, copiedLook, copyLook, hasCopiedLook, lookOf } from './lookClipboard.js'
import { TRANSPARENT, resolveStyle, styleClass, styleVars } from './widgetStyle.js'

const LOOK = {
  theme: 'glass',
  bg: '#101014',
  borderColor: '#333333',
  borderWidth: 2,
  radius: 8,
  padding: 20,
  shadow: 'lg',
  accent: '#F97316',
  invert: true,
  font: 'serif',
  chartText: { size: 12 },
}

test('a copied look carries everything that describes one', () => {
  // A widget copied for its palette and left with the old typeface is a
  // copy that did not work.
  const out = lookOf(LOOK)
  for (const key of Object.keys(LOOK)) assert.ok(key in out, key)
})

test('and nothing that describes the widget itself', () => {
  // Pasting a look must not move the data, the title or the size with it.
  const out = lookOf({ ...LOOK, tab: 'MASTER', title: 'Sales', column: 'Amount', width: 'half' })
  for (const key of ['tab', 'title', 'column', 'width']) assert.ok(!(key in out), key)
})

test('nothing at all copies nothing', () => {
  assert.equal(lookOf(null), null)
  assert.deepEqual(lookOf({}), {})
})

test('the clipboard survives moving to another widget', () => {
  // Which is the entire point: it is closed in one editor and opened in the
  // next.
  clearLook()
  assert.equal(hasCopiedLook(), false)
  copyLook(LOOK)
  assert.equal(hasCopiedLook(), true)
  assert.equal(copiedLook().bg, '#101014')
})

test('what was copied is a snapshot, not a live reference', () => {
  // Editing the widget it came from must not silently change what gets
  // pasted.
  const source = { ...LOOK, chartText: { size: 12 } }
  copyLook(source)
  source.bg = '#FFFFFF'
  source.chartText.size = 99
  assert.equal(copiedLook().bg, '#101014')
  assert.equal(copiedLook().chartText.size, 12)
})

test('and pasting twice does not hand out one shared object', () => {
  // Two widgets sharing a nested group is one of them editing the other.
  copyLook(LOOK)
  const a = copiedLook()
  const b = copiedLook()
  a.chartText.size = 99
  assert.equal(b.chartText.size, 12)
})

// ---------------------------------------------------------------------
// The two things that were broken
// ---------------------------------------------------------------------

test('a background somebody chose is the background they get', () => {
  // `.card` paints a white sheen down its top 84px -- right for the stock
  // near-white surface, a grey smear on anything darker. There was no way
  // to switch it off: `card-invert` was honoured by the renderer and had no
  // control anywhere in the editor.
  assert.ok(styleClass({ bg: '#101014' }).includes('card-ownbg'))
  assert.ok(!styleClass({ radius: 8 }).includes('card-ownbg'), 'and only when a colour was chosen')
  // A named theme sets a background too, and those were designed WITH the
  // sheen -- reading the resolved value would silently flatten every card
  // already using a preset.
  assert.ok(!styleClass({ theme: 'plain' }).includes('card-ownbg'))
  assert.equal(styleClass({ theme: 'dark' }), 'card-invert')
})

test('the stylesheet actually drops the sheen for one', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  const rule = css.slice(css.indexOf('.card-invert .card,'), css.indexOf('.card-invert .card,') + 200)
  assert.ok(rule.includes('.card-ownbg .card'))
  assert.ok(rule.includes('background: var(--card-bg'))
})

test('light text can be asked for, which it could not before', () => {
  const editor = read('src/pages/admin/StyleEditor.jsx')
  assert.ok(editor.includes('onChange={(v) => setStyle({ invert: v })}'))
  // Offered only once a background is chosen: on the stock near-white
  // surface it makes the card unreadable.
  assert.ok(editor.includes('{style.bg && ('))
  assert.ok(styleClass({ bg: '#101014', invert: true }).includes('card-invert'))
})

test('the 360 viewer is a card like everything else', () => {
  // It was the one widget on the dashboard whose Look tab did nothing at
  // all: `.card` is the element that reads the custom properties, and it
  // did not render one.
  const spin = read('src/components/widgets/Spin360Widget.jsx')
  assert.ok(spin.includes("${widget.bare ? '' : 'card'}"))
})

test('...unless it is asked to stand on the page itself', () => {
  // The only way a vehicle can sit on a showcase page rather than in a box,
  // which is what the transparent photographs are for.
  const spin = read('src/components/widgets/Spin360Widget.jsx')
  assert.ok(spin.includes('widget.bare'))
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('set({ bare: v })'))
})

test('every widget renders the element the look is applied to', () => {
  // The mechanism is a wrapper publishing custom properties and a `.card`
  // reading them. A widget without one is a widget whose Look tab is a lie,
  // and that is exactly how the 360 viewer shipped.
  const dir = path.join(ROOT, 'src/components/widgets')
  // Pieces used INSIDE a widget, never rendered as one -- they sit within
  // their parent's card and drawing a second would be a card in a card.
  const skip = new Set([
    'Sparkline.jsx',
    'PiePanel.jsx',
    'FlowPeek.jsx',
    'FlowDiagram.jsx',
    // A window OVER a widget rather than one on the canvas. It is portalled
    // to the body and placed against the row it was opened from, so a card
    // around it would be a card floating in the middle of the screen.
    'FlowRowDetails.jsx',
  ])
  const missing = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.jsx') || skip.has(file)) continue
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    // Plain strings rather than a regex spanning a template literal, which
    // is a regex nobody can read. Three shapes are all a card:
    //
    //   className="card …"                     the common one
    //   className={`card … ${…}`}              one with a conditional bit
    //   className={`… ${bare ? '' : 'card'}`}  one that can drop the card
    //
    // The third is the 360 viewer, which can be asked to stand on the page
    // rather than in a box and is still a widget that renders one.
    const hasCard =
      text.includes('className="card') ||
      text.includes('className={`card') ||
      text.includes("'card'")
    if (!hasCard) missing.push(file)
  }
  assert.deepEqual(missing, [])
})

test('everything the editor can set is a property the stylesheet reads', () => {
  // A field an admin can change that nothing renders is a control that does
  // not work, and it looks identical to one that does.
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  const read_ = new Set([...css.matchAll(/var\((--card-[\w-]+)/g)].map((m) => m[1]))
  const emitted = Object.keys(
    styleVars({
      bg: '#111',
      borderColor: '#333',
      borderWidth: 2,
      radius: 8,
      padding: 20,
      accent: '#f00',
      shadow: 'lg',
    })
  )
  for (const name of emitted) assert.ok(read_.has(name), `${name} is set and never read`)
})

test('a widget nobody restyled emits nothing at all', () => {
  // The stock look is not re-specified, it is absent -- which is what stops
  // this feature drifting the look of an existing dashboard.
  assert.equal(styleVars({}), undefined)
  assert.equal(styleVars(null), undefined)
  // And one whose only settings are class-level: `invert` resolves to a
  // real style but emits no custom properties, and an empty object here
  // would still put a `style` attribute on every such widget.
  assert.equal(styleVars({ invert: true }), undefined)
  assert.equal(styleClass({}), '')
  assert.equal(resolveStyle({}), null)
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('the editor offers copy, and paste once there is something to paste', () => {
  const editor = read('src/pages/admin/StyleEditor.jsx')
  assert.ok(editor.includes('copyLook(style)'))
  assert.ok(editor.includes('{hasCopiedLook() && ('))
  assert.ok(editor.includes('set({ style: { ...DEFAULT_WIDGET_STYLE, ...copiedLook() } })'))
})

test('pasting starts from the defaults, so it replaces rather than layers', () => {
  // Merged onto the widget's existing style, a paste would leave whatever
  // the old look set and the new one did not -- half of each.
  const editor = read('src/pages/admin/StyleEditor.jsx')
  assert.ok(editor.includes('...DEFAULT_WIDGET_STYLE, ...copiedLook()'))
  assert.ok(!editor.includes('...style, ...copiedLook()'))
})

test('the clipboard lives outside React, or it would not survive the move', () => {
  const lib = read('src/lib/lookClipboard.js')
  assert.ok(lib.includes('let clipboard = null'))
  assert.ok(!lib.includes('useState'))
})

// ---------------------------------------------------------------------
// A viewer that filtered itself out of existence
// ---------------------------------------------------------------------

test('the viewer walks the list from before its own selection', () => {
  // Set to filter the page, it narrowed its own tab along with every
  // other -- so the moment somebody pressed Next, the list it walks
  // collapsed to the one vehicle it had just picked and the button
  // disappeared.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('rows={undrivenRowsByLabel[widget.tab] || rows}'))
  assert.ok(dash.includes('crossFilters: crossFiltersByRef.filter((c) => !c.pinned),'))
})

test('but every other filter still narrows what it can walk', () => {
  // Narrowing to Nashik and then walking the bikes in Nashik is exactly
  // what somebody would expect.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('if (drivenBy.length === 0) return rowsByLabel'))
  assert.ok(dash.includes('const drivenBy = useMemo(() => crossFilters.filter((c) => c.pinned)'))
})

// ---------------------------------------------------------------------
// A card nobody can restyle
// ---------------------------------------------------------------------

test('no widget spells out its own card surface', () => {
  // The KPI card did: `rounded-2xl border bg-white p-4 shadow-…` on its
  // outer element. `.card` is what reads an admin's colours, so a
  // hard-coded `bg-white` painted straight over them -- and because the
  // text remapping is scoped to `.card-invert .card`, the text did not
  // change either. One cause, both symptoms.
  //
  // The file-level check above did not catch it: KpiWidget.jsx does contain
  // a `.card`, in the branch that renders when the tab cannot be read.
  //
  // The signature is a WHITE FILL, a SHADOW and CARD-SIZED PADDING
  // together. Chrome inside a widget -- a tooltip, a dropdown, a graph node
  // -- has the first two often enough, and never `p-4`. That is what this
  // can see; it cannot tell an outer element from an inner one, so a widget
  // that hand-rolled a card with `p-3` would still get past.
  const dir = path.join(ROOT, 'src/components/widgets')
  const offenders = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.jsx')) continue
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const line of text.split('\n')) {
      if (!line.includes('className')) continue
      if (!line.includes('bg-white')) continue
      if (!line.includes('shadow-')) continue
      if (!/\bp-[456]\b/.test(line)) continue
      offenders.push(`${file}: ${line.trim().slice(0, 70)}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the KPI card is a card, and adds only its own behaviour to it', () => {
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.ok(kpi.includes('className={`card group relative overflow-hidden'))
  // The lift and the drilled ring are what it adds; the surface is not.
  assert.ok(kpi.includes('hover:-translate-y-0.5'))
  assert.ok(kpi.includes("isDrilled ? 'ring-2 ring-offset-1' : ''"))
  assert.ok(!kpi.includes('rounded-2xl border bg-white p-4'))
})

test('light text reaches the words inside a card, not just the surface', () => {
  // Which is the half that only works because the outer element IS a
  // `.card` -- the rules are scoped to `.card-invert .card :where(…)`.
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  // `:not(.card-ink)` because the inversion is a DEFAULT: it dresses the
  // text a dark card would otherwise make unreadable, and stands aside for
  // a colour the admin actually chose.
  const flat = css.replace(/\s+/g, ' ')
  assert.ok(flat.includes('.card-invert:not(.card-ink) .card :where(.text-ink, .text-slate-900'))
  assert.ok(flat.includes('.card-invert:not(.card-muted) .card :where(.text-slate-500'))
  // The heading too. It carries its own class rather than a Tailwind grey,
  // so it is the one piece of text on a card the remap does not reach by
  // accident -- and on a dark card it was near-black on near-black.
  assert.ok(flat.includes('.text-slate-600, .widget-title)'))
})

// ---------------------------------------------------------------------
// Nothing at all, as a colour
// ---------------------------------------------------------------------

test('a background can be set to nothing', () => {
  // Absence already means something else here -- every field defaults to
  // null for "inherit the theme" -- so transparency needs a word of its own.
  assert.equal(TRANSPARENT, 'transparent')
  assert.equal(styleVars({ bg: TRANSPARENT })['--card-bg'], 'transparent')
  assert.equal(styleVars({ borderColor: TRANSPARENT })['--card-border-color'], 'transparent')
})

test('and a see-through card is not frosted', () => {
  // `backdrop-filter` on a transparent card is a blurred smear of the page
  // rather than the page.
  assert.ok(styleClass({ bg: TRANSPARENT }).includes('card-clear'))
  assert.ok(!styleClass({ bg: '#101014' }).includes('card-clear'))
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  const rule = css.slice(css.indexOf('.card-clear .card {'), css.indexOf('.card-clear .card {') + 140)
  assert.ok(rule.includes('backdrop-filter: none'))
  // A shadow cast by something invisible is a grey cloud on the canvas.
  assert.ok(rule.includes('box-shadow: var(--card-shadow, none)'))
})

test('transparent still counts as a colour somebody chose', () => {
  // So the white sheen comes off it too -- otherwise a transparent card is
  // a white gradient on the page.
  assert.ok(styleClass({ bg: TRANSPARENT }).includes('card-ownbg'))
})

test('the editor offers it, and can take it back', () => {
  const editor = read('src/pages/admin/StyleEditor.jsx')
  assert.ok(editor.includes('const clear = style[key] === TRANSPARENT'))
  assert.ok(editor.includes('setStyle({ [key]: clear ? null : TRANSPARENT })'))
  // A colour input cannot display "none", so it is swapped for a chequer.
  assert.ok(editor.includes('{clear ? ('))
})

// ---------------------------------------------------------------------
// A KPI that says one thing
// ---------------------------------------------------------------------

test('the share bar and its small print are off unless asked for', () => {
  // It used to appear by itself on every KPI the moment a page had any
  // filter on it, and there was no way to stop it.
  const kpi = read('src/components/widgets/KpiWidget.jsx')
  assert.ok(kpi.includes('widget.showShare === true && !widget.ignoreFilters'))
})

test('...and there is a switch for anybody who wants it', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('set({ showShare: v })'))
  assert.ok(panel.includes('of N unfiltered'))
})
