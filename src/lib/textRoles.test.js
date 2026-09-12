import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_MARK_TEXT,
  TEXT_ROLES,
  hasRoleText,
  markTextClass,
  markTextVars,
  roleTextClass,
  roleTextVars,
  rolesFor,
} from './typography.js'
import { DEFAULT_WIDGET_STYLE, styleClass, styleVars } from './widgetStyle.js'

// ---------------------------------------------------------------------
// The kinds of writing on a widget
// ---------------------------------------------------------------------
// A card is a heading, the small print under it, the figures, and the
// names beside them -- four things read four different ways. One
// control for all of them meant that making a KPI's number big enough
// to read across a room turned its caption into a headline, so nobody
// moved the control at all.
//
// What is worth testing is the wiring between four places that have to
// agree: the table, the stored defaults, the emitted properties, and
// the stylesheet that reads them. A role present in three of them and
// missing from the fourth is a setting that saves and does nothing --
// which is the bug this whole file exists to prevent.

const SRC = path.resolve(import.meta.dirname, '..')
const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const editor = read('pages/admin/StyleEditor.jsx')
const kpi = read('components/widgets/KpiWidget.jsx')

const someText = { text: '#ff0000', font: 'serif', size: 18, weight: 'bold' }

// --- the table is the whole truth ---------------------------------------

test('every role is a distinct setting with a distinct property', () => {
  // Two roles sharing a prefix is one of them silently overwriting the
  // other, and it would look exactly like the control not working.
  const keys = TEXT_ROLES.map((r) => r.key)
  const prefixes = TEXT_ROLES.map((r) => r.prefix)
  assert.equal(new Set(keys).size, keys.length, 'two roles share a key')
  assert.equal(new Set(prefixes).size, prefixes.length, 'two roles share a prefix')
  assert.ok(TEXT_ROLES.length >= 6)
  for (const role of TEXT_ROLES) {
    assert.ok(role.label, role.key)
    assert.ok(role.hint, `${role.key} has no hint`)
  }
})

test('every role is a field the style document actually has', () => {
  // A role the editor can write and the defaults do not know about is a
  // value that vanishes on the next save.
  for (const role of TEXT_ROLES) {
    assert.deepEqual(DEFAULT_WIDGET_STYLE[role.key], DEFAULT_MARK_TEXT, role.key)
  }
})

test('every role has a stylesheet rule for each of its four properties', () => {
  // The end of the chain. A property emitted and never read is the
  // original bug this system was built to fix -- a "Text" picker that
  // saved its value and did nothing at all.
  for (const role of TEXT_ROLES) {
    for (const [suffix, property] of [
      ['ink', `var(--${role.prefix}-text)`],
      ['font', `var(--${role.prefix}-font)`],
      ['size', `var(--${role.prefix}-size)`],
      ['weight', `var(--${role.prefix}-weight)`],
    ]) {
      assert.ok(css.includes(`.${role.prefix}-${suffix}`), `no rule for .${role.prefix}-${suffix}`)
      assert.ok(css.includes(property), `nothing reads ${property}`)
    }
  }
})

// --- what each role is offered on ---------------------------------------

test('a role is offered only where the widget draws it', () => {
  // A pie has no column headings and a KPI has no axis. A control that
  // does nothing is the bug this file exists to fix.
  const names = (type) => rolesFor(type).map((r) => r.key)

  // Every widget has a heading and a caption.
  for (const type of ['kpi', 'chart', 'table', 'flow', 'spin360']) {
    assert.ok(names(type).includes('titleText'), type)
    assert.ok(names(type).includes('captionText'), type)
  }
  // Only a chart has axis text and a legend.
  assert.ok(names('chart').includes('chartText'))
  assert.ok(names('chart').includes('legendText'))
  assert.equal(names('kpi').includes('chartText'), false)
  assert.equal(names('table').includes('legendText'), false)
  // Only something with figures has figures.
  assert.ok(names('kpi').includes('valueText'))
  assert.ok(names('table').includes('valueText'))
  assert.equal(names('chart').includes('valueText'), false, 'a chart’s values are its marks')
  assert.equal(names('flow').includes('labelText'), false)
})

test('an unknown widget still gets the two every card has', () => {
  assert.deepEqual(
    rolesFor('something-new').map((r) => r.key),
    ['titleText', 'captionText']
  )
  assert.deepEqual(rolesFor(undefined).map((r) => r.key), ['titleText', 'captionText'])
})

// --- what gets emitted ---------------------------------------------------

test('a widget nobody has touched emits nothing at all', () => {
  // The stock look is not re-stated, it is absent.
  assert.equal(roleTextVars({}), undefined)
  assert.equal(roleTextVars(null), undefined)
  assert.equal(roleTextClass({}), '')
  assert.equal(hasRoleText({}), false)
})

test('one role set emits that role and no other', () => {
  const vars = roleTextVars({ valueText: someText })
  assert.deepEqual(vars, {
    '--wvalue-text': '#ff0000',
    '--wvalue-font': "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
    '--wvalue-size': '18px',
    '--wvalue-weight': '700',
  })
  assert.equal(roleTextClass({ valueText: someText }), 'wvalue-ink wvalue-font wvalue-size wvalue-weight')
  assert.equal(hasRoleText({ valueText: someText }), true)
})

test('two roles set do not collide', () => {
  // The whole point: a big number and a small caption on one card.
  const vars = roleTextVars({ valueText: { size: 40 }, captionText: { size: 9 } })
  assert.equal(vars['--wvalue-size'], '40px')
  assert.equal(vars['--wcaption-size'], '9px')
  const classes = roleTextClass({ valueText: { size: 40 }, captionText: { size: 9 } })
  assert.ok(classes.includes('wvalue-size'))
  assert.ok(classes.includes('wcaption-size'))
})

test('one property set does not reset the three beside it', () => {
  // A class per property, because `font-size: var(--x, inherit)` under
  // one class resets the size the moment somebody picks only a typeface.
  assert.equal(roleTextClass({ titleText: { font: 'mono' } }), 'wtitle-font')
  assert.deepEqual(Object.keys(roleTextVars({ titleText: { font: 'mono' } })), ['--wtitle-font'])
})

test('the roles reach a widget through the style it is given', () => {
  const style = { valueText: { size: 30 }, chartText: { size: 12 } }
  const vars = styleVars(style)
  assert.equal(vars['--wvalue-size'], '30px')
  assert.equal(vars['--chart-size'], '12px')
  const classes = styleClass(style)
  assert.ok(classes.includes('wvalue-size'))
  assert.ok(classes.includes('chart-size'))
  // And a widget with no styling still emits nothing.
  assert.equal(styleVars({}), undefined)
})

test('the chart roles behave exactly as they did before the table', () => {
  // They were the first two to be separated, written out by hand. The
  // table has to produce the same thing or every existing chart moves.
  const t = { text: '#123456', size: 14 }
  assert.deepEqual(roleTextVars({ chartText: t }), markTextVars(t, 'chart'))
  assert.equal(roleTextClass({ legendText: t }), markTextClass(t, 'legend'))
})

// --- and how it is wired -------------------------------------------------

test('the editor lists whatever the table says, rather than two by hand', () => {
  // Two hard-coded blocks were how a third kind of writing came to be
  // saved by the editor and read by nothing.
  assert.ok(editor.includes('{rolesFor(widget.type).map((role) => ('))
  assert.ok(editor.includes('value={style[role.key]}'))
  assert.ok(editor.includes('label={role.label}'))
  assert.ok(editor.includes('hint={role.hint}'))
})

test('the style plumbing reads the table too', () => {
  const plumbing = read('lib/widgetStyle.js')
  assert.ok(plumbing.includes('...(roleTextVars(s) || {})'))
  assert.ok(plumbing.includes('roleTextClass(s)'))
  // The two it used to name by hand are gone from it.
  assert.equal(plumbing.includes("markTextVars(s.chartText, 'chart')"), false)
})

test('a widget says which of its text is a figure and which is a name', () => {
  // The stylesheet cannot tell a KPI's number from its label by
  // position, so the card says so.
  assert.ok(kpi.includes('widget-value'))
  assert.ok(kpi.includes('widget-label'))
  assert.ok((kpi.match(/widget-value/g) || []).length >= 5, 'only some shapes marked their figure')
  assert.ok((kpi.match(/widget-label/g) || []).length >= 5, 'only some shapes marked their name')
})

test('a table needs no class on every cell to be covered', () => {
  // They are generated in a loop; the rule carries a structural
  // fallback beside the explicit hook.
  assert.match(css, /\.wvalue-size :where\(\.widget-value, tbody td\)/)
  assert.match(css, /\.wlabel-size :where\(\.widget-label, thead th\)/)
})

test('each role is sized within limits that suit it', () => {
  // 36px is right for an axis tick and absurd for a KPI's number, which
  // is read across a room. One ceiling for both meant the Values
  // setting stopped responding a third of the way along.
  assert.equal(roleTextVars({ valueText: { size: 40 } })['--wvalue-size'], '40px')
  assert.equal(roleTextVars({ chartText: { size: 40 } })['--chart-size'], '36px')
  assert.equal(roleTextVars({ captionText: { size: 40 } })['--wcaption-size'], '28px')
  // Every ceiling is still a ceiling.
  assert.equal(roleTextVars({ valueText: { size: 9999 } })['--wvalue-size'], '140px')
  // ...and the floor is the floor everywhere.
  assert.equal(roleTextVars({ valueText: { size: 1 } })['--wvalue-size'], '6px')
})

test('a measured size gives way to a stated one', () => {
  // An inline font-size beats a stylesheet rule, so a KPI writing its
  // measured size straight into `style` would silently override the
  // Values setting -- a control that saves and does nothing, which is
  // the bug this whole system exists to prevent. The measured size is
  // the FALLBACK of the variable instead.
  assert.ok(kpi.includes('var(--wvalue-size,'))
  assert.ok(kpi.includes('var(--wlabel-size,'))
  assert.equal(/fontSize: \`\$\{scale/.test(kpi), false, 'a measured size is written straight in')
})
