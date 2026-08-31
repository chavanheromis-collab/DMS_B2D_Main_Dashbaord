import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// The page survives its own widgets
// ---------------------------------------------------------------------
// Four things this file pins, all of them found by auditing rather than by
// anybody reporting them:
//
//   a render error took the whole page down
//   the admin panel shipped to readers who cannot open it
//   "Loading…" in grey on white is indistinguishable from a page that died
//   two dialogues had a close button a screen reader announced as "button"

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const raw = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const boundary = read('src/components/ErrorBoundary.jsx')
const dashboard = read('src/pages/Dashboard.jsx')
const app = read('src/App.jsx')
const booting = read('src/components/Booting.jsx')

// ---------------------------------------------------------------------
// One widget failing is one widget failing
// ---------------------------------------------------------------------

test('every widget is drawn inside a boundary', () => {
  // React's answer to a render error is to unmount the whole tree, so any
  // one of thirty widget types could turn the page white and take the
  // twenty-nine that were fine with it.
  assert.ok(dashboard.includes('<ErrorBoundary label={widget.title || \'This widget\'} resetKey={widget}>'))
  assert.ok(dashboard.includes('</ErrorBoundary>'))
})

test('the boundary is INSIDE the edit chrome, not around it', () => {
  // A widget that cannot draw is exactly the one an admin needs to open, so
  // its Edit pill has to survive the failure that broke the widget.
  const at = dashboard.indexOf('<ErrorBoundary label={widget.title')
  const editPill = dashboard.indexOf("title={`Edit ${widget.title || 'this widget'}`}")
  const arrangeBar = dashboard.indexOf('<ArrangeBar')
  assert.ok(at > 0 && editPill > 0 && arrangeBar > 0)
  assert.ok(editPill < at, 'the Edit pill is rendered before the boundary opens')
  assert.ok(arrangeBar < at, 'and so is the arrange pill')
  // The widgets themselves are all inside it.
  assert.ok(dashboard.indexOf('<WidgetControls') > at)
  assert.ok(dashboard.indexOf("{widget.type === 'kpi'") > at)
})

test('fixing the widget clears the error', () => {
  // Without a reset the card stays stuck on the error it threw a minute
  // ago: the config is right, the data is right, and only a reload shows it.
  assert.ok(boundary.includes('static getDerivedStateFromProps(props, state)'))
  assert.ok(boundary.includes('if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey }'))
  // The widget OBJECT, because every save builds a new one.
  assert.ok(dashboard.includes('resetKey={widget}'))
})

test('the failure is reported, not swallowed', () => {
  // A card saying "something went wrong" and a developer with nothing to go
  // on is two problems.
  assert.ok(boundary.includes('componentDidCatch(error, info)'))
  assert.ok(boundary.includes('console.error('))
})

test('the card says which widget, and what the rest of the page is doing', () => {
  // The widget's OWN name. `PageErrorBoundary` says "This page could not be
  // drawn" a few lines below, so a bare substring test passes on the wrong one.
  assert.ok(boundary.includes("{this.props.label || 'This widget'} could not be drawn"))
  assert.ok(boundary.includes('The rest of the page is unaffected'))
  assert.ok(boundary.includes('Try again'))
})

test('the message is shown, not the stack', () => {
  // An admin reading "Cannot read properties of undefined" can often tell
  // which setting is empty. Forty minified frames tell nobody anything.
  assert.ok(boundary.includes('String(error?.message || error).slice(0, 200)'))
  assert.ok(!boundary.includes('error.stack'))
})

test('the page scaffolding has a boundary of its own', () => {
  // A widget boundary cannot catch a failure in the layout, the control bar
  // or the header -- and that failure is the one that produces the white
  // screen.
  assert.ok(app.includes('<PageErrorBoundary>'))
  assert.ok(boundary.includes('export function PageErrorBoundary('))
  assert.ok(boundary.includes('window.location.reload()'), 'and a way out of it')
})

// ---------------------------------------------------------------------
// What a reader downloads
// ---------------------------------------------------------------------

test('the admin panel is fetched, not shipped', () => {
  // The largest thing in the app, landing in the bundle every visitor
  // downloads before seeing a number -- most of them readers who cannot
  // open it at all.
  assert.ok(app.includes("const Admin = lazy(() => import('./pages/Admin.jsx'))"))
  assert.ok(!app.includes("import Admin from './pages/Admin.jsx'"), 'never eagerly')
})

test('and so are the editor panels the page itself uses', () => {
  // They are shared with the admin route, so lazy-loading one and not the
  // other leaves the whole editor tree in the main bundle regardless.
  for (const panel of ['WidgetsPanel', 'ControlsPanel']) {
    assert.ok(dashboard.includes(`const ${panel} = lazy(() => import('./admin/${panel}.jsx'))`), panel)
  }
  assert.ok(dashboard.includes("lazy(() => import('./admin/PagesPanel.jsx').then((m) => ({ default: m.PageSettings })))"))
  assert.ok(!dashboard.includes("import WidgetsPanel from './admin/WidgetsPanel.jsx'"))
})

test('the context stays eager, because it is not the heavy part', () => {
  // A few lines of context object, and the provider wraps the page whether
  // or not anything is being edited.
  assert.ok(dashboard.includes("import { WorkspaceCtx } from './admin/ui.jsx'"))
})

test('a fetch in progress says so rather than showing nothing', () => {
  assert.ok(app.includes('<Suspense fallback={<Booting label="Opening the admin panel" />}>'))
  assert.ok(dashboard.includes('Opening the editor…'))
})

// ---------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------

test('no bare "Loading…" is left anywhere a person can see it', () => {
  // Grey on white, centred, with no motion: indistinguishable from a page
  // that gave up.
  for (const f of ['src/App.jsx', 'src/pages/Dashboard.jsx']) {
    assert.ok(
      !/>\s*Loading…\s*</.test(raw(f)),
      `${f} still shows a bare Loading…`
    )
  }
})

test('a wait says which part is slow', () => {
  // Auth, then the workspace, then every tab of every sheet. "Loading" for
  // all three explains none of them.
  assert.ok(app.includes('<Booting label="Signing you in" />'))
  assert.ok(app.includes('<Booting label="Finding that page" />'))
  assert.ok(booting.includes('{label}…'))
})

test('a canvas waiting for widgets shows the shape of one', () => {
  // A spinner says "wait"; a skeleton says "a card is coming and this is
  // where it goes".
  assert.ok(dashboard.includes('<CanvasSkeleton />'))
  assert.ok(booting.includes('export function CanvasSkeleton()'))
  assert.ok(booting.includes('export function CardSkeleton('))
})

test('the skeleton moves, and stops for anyone who asked it to', () => {
  const css = raw('src/index.css')
  // Both halves: a `@keyframes` nothing uses animates nothing, and renaming
  // it leaves a rule that still contains the old name as a prefix.
  assert.ok(css.includes('animation: skeleton-sheen 1.4s ease-in-out infinite'))
  assert.ok(/@keyframes skeleton-sheen\s*\{/.test(css), 'a static grey block reads as a card that rendered empty')
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(at > 0)
  assert.ok(css.slice(at).includes('.skeleton {\n    animation: none;\n  }'))
})

test('a skeleton is decoration, and says so', () => {
  // It is a picture of a card, not a card. A screen reader reading out its
  // shape would be reading out nothing. BOTH of them -- marking the row and
  // not the card leaves every card inside it announced.
  assert.ok(booting.includes('<div className={`card ${className}`} aria-hidden>'))
  assert.ok(booting.includes('lg:grid-cols-3" aria-hidden>'))
})

// ---------------------------------------------------------------------
// Reachable controls
// ---------------------------------------------------------------------

test('a dialogue you can open is a dialogue you can close', () => {
  // Both of these were an icon in a button and nothing else, which a screen
  // reader announces as "button". The BUTTON, not the backdrop that also
  // takes an onClose -- a decorative overlay wants no label.
  for (const f of ['src/components/RowDetailPanel.jsx', 'src/components/StageKpiPopup.jsx']) {
    const src = read(f)
    const at = src.indexOf('<button onClick={onClose}')
    assert.ok(at > 0, `${f}: no close button`)
    assert.ok(src.slice(at, at + 160).includes('aria-label="Close"'), f)
  }
})

test('and by pressing Escape, which is the way people actually close one', () => {
  for (const f of ['src/components/RowDetailPanel.jsx', 'src/components/StageKpiPopup.jsx']) {
    assert.ok(read(f).includes("if (e.key === 'Escape') onClose()"), f)
  }
})

test('no icon-only button is left without a name', () => {
  // The scan that found those two, kept so the next one is caught before it
  // ships rather than after somebody cannot use it.
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.jsx')) files.push(p)
    }
  }
  walk('src')

  const unnamed = []
  for (const f of files) {
    const src = raw(f)
    for (const m of src.matchAll(/<button((?:(?!<\/button>)[\s\S])*?)<\/button>/g)) {
      const body = m[1]
      const gt = body.indexOf('>')
      if (gt === -1) continue
      const attrs = body.slice(0, gt)
      const inner = body.slice(gt + 1)
      const text = inner.replace(/<[^>]*>/g, '').replace(/\{[^{}]*\}/g, '').trim()
      const hasIcon = /<[A-Z]\w*[\s/]/.test(inner)
      const named = attrs.includes('title=') || attrs.includes('aria-label')
      // A button whose only content is an expression may well render text;
      // only the ones that are demonstrably an icon and nothing else count.
      const onlyIcon = hasIcon && !text && !/\{[^{}]*\}/.test(inner.replace(/<[^>]*>/g, ''))
      if (onlyIcon && !named) unnamed.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(unnamed, [], `unnamed icon buttons: ${unnamed.join(', ')}`)
})
