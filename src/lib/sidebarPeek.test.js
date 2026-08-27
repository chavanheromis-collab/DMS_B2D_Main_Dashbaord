import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CLOSE_DELAY, EDGE, OPEN_DELAY, canPeek, contentOffset } from './sidebarPeek.js'

// ---------------------------------------------------------------------
// The sidebar that comes when called
// ---------------------------------------------------------------------

test('a peek is only possible while the sidebar is collapsed', () => {
  // Pinned open is pinned open. Nothing the mouse does may undo a click.
  assert.equal(canPeek({ collapsed: true }), true)
  assert.equal(canPeek({ collapsed: false }), false)
})

test('no peek where there is no hover', () => {
  // On a touch screen a hot zone is a strip of the page that swallows taps.
  assert.equal(canPeek({ collapsed: true, hasHover: false }), false)
})

test('no peek while the drawer is the navigation', () => {
  assert.equal(canPeek({ collapsed: true, mobileOpen: true }), false)
})

test('no peek where the sidebar is not in the layout', () => {
  assert.equal(canPeek({ collapsed: true, wide: false }), false)
})

test('leaving by accident is the more expensive mistake', () => {
  // Leaving costs you the thing you were reaching for; arriving costs a
  // sidebar you can ignore. The cheaper mistake gets the shorter fuse.
  assert.ok(CLOSE_DELAY > OPEN_DELAY)
  assert.ok(OPEN_DELAY >= 60 && OPEN_DELAY <= 200, 'long enough to be meant, short enough to feel instant')
  assert.ok(CLOSE_DELAY >= 200 && CLOSE_DELAY <= 500, 'long enough for a diagonal path to the third page')
})

test('the hot strip is narrow enough to be an edge and wide enough to hit', () => {
  assert.ok(EDGE >= 6 && EDGE <= 24)
})

test('THE PAGE NEVER MOVES WHEN THE SIDEBAR PEEKS', () => {
  // A peek overlays. Reflowing a page of charts every time the pointer
  // crosses the left edge is how a feature like this earns its reputation.
  assert.equal(contentOffset({ collapsed: true, rail: 64, full: 248 }), 64)
  assert.equal(contentOffset({ collapsed: false, rail: 64, full: 248 }), 248)
  // Handed a peek explicitly, it still answers with the rail.
  assert.equal(contentOffset({ collapsed: true, rail: 64, full: 248, peeking: true }), 64)
})

test('the offset function is not even told about the peek', () => {
  // The strongest way to promise it: it cannot use what it cannot see.
  const src = fs.readFileSync(path.join(path.resolve(import.meta.dirname), 'sidebarPeek.js'), 'utf8')
  const body = src.slice(src.indexOf('export function contentOffset'))
  assert.ok(!body.includes('peek'))
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

const shell = read('components/AppShell.jsx')
const sidebar = read('components/Sidebar.jsx')

test('the strip only exists where a peek is possible', () => {
  // A real element rather than a document listener: no mousemove handler
  // running on every frame of every dashboard.
  assert.ok(shell.includes('{allowed && ('))
  assert.ok(shell.includes('onPointerEnter={openLater}'))
  assert.ok(shell.includes('onPointerLeave={closeLater}'))
  assert.ok(shell.includes('style={{ width: EDGE }}'))
  assert.ok(!shell.includes("addEventListener('mousemove'"))
})

test('the sidebar itself keeps the peek alive while you are in it', () => {
  // The whole point is to reach something in it.
  assert.ok(sidebar.includes('onPointerEnter={onPeekEnter}'))
  assert.ok(sidebar.includes('onPointerLeave={onPeekLeave}'))
  assert.ok(shell.includes('onPeekEnter={allowed || peeking ? keepOpen : undefined}'))
})

test('a peek draws at full width without moving the content', () => {
  assert.ok(sidebar.includes('width: collapsed && !peeking ? SIDEBAR_RAIL : SIDEBAR_WIDTH'))
  assert.ok(sidebar.includes('renderBody(collapsed && !peeking)'))
  assert.ok(shell.includes("contentOffset({ collapsed, rail: SIDEBAR_RAIL, full: SIDEBAR_WIDTH })"))
})

test('the pinned state and the peek are two different things', () => {
  // `peeking && collapsed`: a peek cannot exist over an already-open
  // sidebar, so the two ideas of "open" can never both be running.
  assert.ok(shell.includes('peeking={peeking && collapsed}'))
  assert.ok(shell.includes('if (!allowed && peeking) setPeeking(false)'))
})

test('the button is still there, and says what it will do', () => {
  // A hover is a nice thing to have and a terrible thing to depend on.
  assert.ok(sidebar.includes('onClick={onToggleCollapsed}'))
  assert.ok(sidebar.includes("title={peeking ? 'Keep the sidebar open' : 'Collapse sidebar'}"))
})

test('the timer is cleared when the shell goes away', () => {
  // A timeout that fires into an unmounted component is a warning in the
  // console and a state update nobody asked for.
  assert.ok(shell.includes('useEffect(() => () => clearTimeout(peekTimer.current), [])'))
})

test('no hover machinery on a touch device', () => {
  assert.ok(shell.includes("window.matchMedia('(hover: hover) and (pointer: fine)').matches"))
})
