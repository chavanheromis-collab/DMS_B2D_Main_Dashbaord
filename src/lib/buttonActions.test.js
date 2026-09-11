import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  ACTION_VALUES,
  BUTTON_ACTIONS,
  actionIsReady,
  actionMeta,
  actionNeeds,
  actionProblem,
  buttonAction,
  isActionButton,
  holdsState,
  isFilterButton,
  isPlainSwitch,
  linkHref,
  opensNewTab,
} from './buttonActions.js'
import { captureView, controlActive, initialValues, splitControls } from './pageControls.js'

// ---------------------------------------------------------------------
// A button that does something other than filter
// ---------------------------------------------------------------------
// Everything here turns on one distinction: a filter button is a TOGGLE
// that narrows the page, and every other action is a ONE-SHOT that fires
// and leaves nothing behind. Getting it wrong is not cosmetic -- a
// one-shot in the engine's button list is a control the page thinks is
// narrowing it, and a one-shot counted as active is a "3 filters on"
// badge sending somebody after a filter that does not exist.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const btn = (extra = {}) => ({ id: 'b', kind: 'button', label: 'Go', ...extra })

// --- what a button is ----------------------------------------------------

test('a button with no action is a filter, exactly as it always was', () => {
  // Every button saved before actions existed has no `action` field.
  assert.equal(buttonAction(btn()), 'filter')
  assert.equal(buttonAction(btn({ action: 'nonsense' })), 'filter')
  assert.equal(buttonAction(null), 'filter')
  assert.equal(isFilterButton(btn()), true)
  assert.equal(isActionButton(btn()), false)
})

test('the two halves never overlap, and only ever describe buttons', () => {
  for (const action of ACTION_VALUES) {
    const control = btn({ action })
    assert.notEqual(isFilterButton(control), isActionButton(control), action)
  }
  // A dropdown is neither, whatever it happens to carry.
  const select = { id: 's', kind: 'select', action: 'link' }
  assert.equal(isFilterButton(select), false)
  assert.equal(isActionButton(select), false)
})

test('there are plenty of them, each with a label and a hint', () => {
  assert.ok(BUTTON_ACTIONS.length >= 11, 'a button should be able to do more than a couple of things')
  const seen = new Set()
  for (const action of BUTTON_ACTIONS) {
    assert.ok(action.label, `${action.value} needs a label`)
    assert.ok(action.hint, `${action.value} needs a hint`)
    assert.equal(seen.has(action.value), false, `${action.value} is listed twice`)
    seen.add(action.value)
  }
  assert.equal(BUTTON_ACTIONS[0].value, 'filter', 'the original stays first, and is the default')
  assert.equal(actionMeta('nope').value, 'filter')
})

// --- a one-shot never behaves like a filter ------------------------------

test('a one-shot is never handed to the filter engine', () => {
  // It has no conditions, so the engine would be evaluating a rule that
  // does not exist -- which it survives by returning every row, while
  // counting a control that is narrowing nothing.
  const controls = [
    { id: 'f', kind: 'select', tab: 'T', column: 'A' },
    btn({ id: 'cond', conditions: [{ tab: 'T', column: 'A', operator: 'is_not_empty' }] }),
    btn({ id: 'link', action: 'link', url: 'https://example.com' }),
    btn({ id: 'nav', action: 'page', pageId: 'p2' }),
  ]
  const { filters, buttons } = splitControls(controls)
  assert.deepEqual(filters.map((c) => c.id), ['f'])
  assert.deepEqual(buttons.map((c) => c.id), ['cond'], 'only the filter button')
})

test('a one-shot is never "on"', () => {
  const link = btn({ id: 'link', action: 'link', url: 'https://example.com' })
  const cond = btn({ id: 'cond' })
  // Even if its id somehow appears in the active list.
  assert.equal(controlActive(link, {}, ['link']), false)
  assert.equal(controlActive(cond, {}, ['cond']), true)
})

test('a one-shot cannot start switched on', () => {
  // "On by default" means nothing to a button that opens a link, and a
  // page that fired one on load would navigate away from itself.
  const controls = [
    btn({ id: 'cond', defaultOn: true }),
    btn({ id: 'nav', action: 'page', pageId: 'p2', defaultOn: true }),
  ]
  assert.deepEqual(initialValues(controls).buttons, ['cond'])
})

test('a saved view does not remember a one-shot', () => {
  // There is no state of it to remember.
  const controls = [btn({ id: 'cond' }), btn({ id: 'nav', action: 'refresh' })]
  const view = captureView({}, ['cond', 'nav'], controls)
  assert.deepEqual(view.buttons, ['cond'])
})

// --- the switch that narrows nothing ------------------------------------

test('a plain switch is a switch, and it needs nothing filled in', () => {
  const sw = btn({ action: 'none', label: 'Finance' })
  assert.equal(isPlainSwitch(sw), true)
  assert.equal(isPlainSwitch(btn()), false)
  assert.equal(isPlainSwitch({ kind: 'select', action: 'none' }), false)

  // Nothing to point it at, so it is never reported as unfinished -- the
  // difference between "a switch" and "a button nobody got round to
  // pointing anywhere".
  assert.equal(actionProblem(sw), '')
  assert.equal(actionIsReady(sw), true)
})

test('it REMEMBERS being pressed, unlike every other action', () => {
  // That is the line: a filter button and a plain switch hold a state; a
  // link or a print button fires and leaves nothing behind.
  assert.equal(holdsState(btn()), true, 'a filter button')
  assert.equal(holdsState(btn({ action: 'none' })), true, 'a plain switch')
  for (const action of ['link', 'page', 'space', 'view', 'widget', 'reset', 'refresh', 'print', 'fullscreen', 'sheet']) {
    assert.equal(holdsState(btn({ action })), false, action)
  }
  assert.equal(holdsState({ kind: 'select' }), false)
})

test('...so it counts, starts on, and is kept by a saved view', () => {
  // All three are questions about STATE, and it has one. A widget's
  // visibility may turn on it, so the reader who set it needs to see it
  // counted and be able to clear it.
  const sw = btn({ id: 'sw', action: 'none' })
  assert.equal(controlActive(sw, {}, ['sw']), true)
  assert.equal(controlActive(sw, {}, []), false)
  assert.deepEqual(initialValues([btn({ id: 'sw', action: 'none', defaultOn: true })]).buttons, ['sw'])
  assert.deepEqual(captureView({}, ['sw'], [sw]).buttons, ['sw'])
})

test('...but it still never reaches the filter engine', () => {
  // It has no conditions. Narrowing is not what it is for.
  assert.deepEqual(splitControls([btn({ id: 'sw', action: 'none' })]).buttons, [])
  assert.equal(isFilterButton(btn({ action: 'none' })), false)
  assert.equal(isActionButton(btn({ action: 'none' })), true)
})

test('it presses and lights like a condition button', () => {
  // Because to the person using it, that is what it is.
  assert.ok(bar.includes('if (isPlainSwitch(control)) {'))
  assert.ok(bar.includes('aria-pressed={isOn}'))
  assert.ok(bar.includes('onClick={onToggleButton}'))
  // Through the same path, so its on/off lives in the one list saved
  // views, Reset and the visibility rules all already read.
  assert.ok(bar.indexOf('isPlainSwitch(control)') < bar.indexOf('!actionIsReady(control)'))
})

test('only a button that holds a state can drive a widget’s visibility', () => {
  // A rule pointing at a link could never be true, so the widget would
  // simply never appear -- and the only way to find out why is to
  // remember writing the rule.
  const panel = read('pages/admin/ControlsPanel.jsx')
  const widgets = read('pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('buttons={controls.filter((c) => c.id !== control.id && holdsState(c))}'))
  assert.ok(widgets.includes('buttons={(pageControls || []).filter(holdsState)}'))
})

// --- being finished ------------------------------------------------------

test('an action that needs a target says so until it has one', () => {
  // Said in the editor. A button whose target was never chosen is
  // otherwise discovered by whoever presses it.
  assert.equal(actionNeeds(btn({ action: 'link' })), 'url')
  assert.equal(actionNeeds(btn({ action: 'reset' })), '')

  assert.match(actionProblem(btn({ action: 'link' })), /address/i)
  assert.match(actionProblem(btn({ action: 'page' })), /page/i)
  assert.match(actionProblem(btn({ action: 'view' })), /view/i)
  assert.match(actionProblem(btn({ action: 'widget' })), /widget/i)
  assert.match(actionProblem(btn({ action: 'sheet' })), /tab/i)

  // The ones that need nothing are ready the moment they are made.
  for (const action of ['filter', 'reset', 'refresh', 'print', 'fullscreen']) {
    assert.equal(actionProblem(btn({ action })), '', action)
    assert.equal(actionIsReady(btn({ action })), true, action)
  }
  assert.equal(actionIsReady(btn({ action: 'page', pageId: 'p2' })), true)
})

// --- links ---------------------------------------------------------------

test('a bare domain is read as https, because that is what was meant', () => {
  assert.equal(linkHref('example.com/price'), 'https://example.com/price')
  assert.equal(linkHref('  https://example.com  '), 'https://example.com/')
})

test('the schemes a dashboard actually needs all work', () => {
  for (const url of ['https://wa.me/919999999999', 'tel:+919999999999', 'mailto:a@b.com', 'sms:+91999']) {
    assert.ok(linkHref(url), url)
  }
})

test('a script cannot be smuggled into a button', () => {
  // `javascript:` in an href runs with the page's own privileges, written
  // by whoever could edit the dashboard. Admins are trusted; "the admin
  // panel is a way to put script in everybody else's browser" is not a
  // property worth having.
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
    assert.equal(linkHref(bad), '', bad)
  }
  assert.equal(linkHref(''), '')
  assert.equal(linkHref(null), '')
  // ...and the editor refuses to call it finished.
  assert.match(actionProblem(btn({ action: 'link', url: 'javascript:alert(1)' })), /does not look like an address/)
})

test('a link opens a new tab, except where that would leave litter', () => {
  // A dashboard on a showroom screen that navigates away is one somebody
  // has to find their way back to. `tel:` hands off to another
  // application, and a blank tab left behind is litter.
  assert.equal(opensNewTab(btn({ action: 'link', url: 'https://example.com' })), true)
  assert.equal(opensNewTab(btn({ action: 'link', url: 'https://example.com', sameTab: true })), false)
  assert.equal(opensNewTab(btn({ action: 'link', url: 'tel:+919999999999' })), false)
  assert.equal(opensNewTab(btn({ action: 'link', url: 'mailto:a@b.com' })), false)
  assert.equal(opensNewTab(btn({ action: 'link', url: 'javascript:x' })), false)
})

// --- still wired ---------------------------------------------------------

const bar = read('components/ControlBar.jsx')
const dash = read('pages/Dashboard.jsx')
const panel = read('pages/admin/ControlsPanel.jsx')

test('a link is a real anchor, not a click handler that navigates', () => {
  // An anchor is what makes middle-click, ctrl-click and "copy link
  // address" work -- the three things somebody does with a link on a
  // dashboard they are about to share.
  assert.match(bar, /<a href=\{linkHref\(control\.url\)\}/)
  // Both, and not just one: `noopener` stops the opened page reaching back
  // through `window.opener`, `noreferrer` stops it being told where it
  // came from.
  assert.match(bar, /rel=\{newTab \? 'noopener noreferrer' : undefined\}/)
})

test('an unfinished button is shown as unavailable, not as a dud', () => {
  assert.match(bar, /if \(!actionIsReady\(control\)\) \{/)
  assert.match(bar, /cursor-not-allowed opacity-40/)
})

test('the page performs the action, because the page owns all of it', () => {
  // Where it navigates, when it re-reads, whether it is full screen. A bar
  // that did this itself would need the router, the workspace and the
  // spaces context handed down for one click.
  assert.match(dash, /const runButton = useCallback\(/)
  for (const action of ["case 'page'", "case 'space'", "case 'view'", "case 'widget'", "case 'reset'", "case 'refresh'", "case 'print'", "case 'fullscreen'", "case 'sheet'"]) {
    assert.ok(dash.includes(action), action)
  }
  assert.match(dash, /onAction=\{runButton\}/)
})

test('the scroll target exists on the canvas', () => {
  // A "jump to this widget" button that queried for an attribute nothing
  // renders would silently do nothing.
  const canvas = read('components/WidgetCanvas.jsx')
  assert.equal((canvas.match(/data-widget-id=\{item\.id\}/g) || []).length, 2, 'both branches of the canvas')
  assert.match(dash, /\[data-widget-id="\$\{control\.widgetId\}"\]/)
  assert.match(dash, /data-page-canvas/)
})

test('the admin picks the action, and is told what is missing', () => {
  assert.match(panel, /options=\{BUTTON_ACTIONS\}/)
  assert.match(panel, /onChange=\{\(v\) => set\(\{ action: v \}\)\}/)
  assert.match(panel, /isButton\(control\) && actionProblem\(control\)/)
})
