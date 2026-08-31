import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { appliedFilters, filterSummary, printStamp, valueText } from './printView.js'

const TAB = 'src_a1::MASTER'
const control = (extra) => ({ id: 'c1', kind: 'select', tab: TAB, label: 'Branch', column: 'Branch', ...extra })

// ---------------------------------------------------------------------
// What a value looks like written down
// ---------------------------------------------------------------------

test('a multi-choice control reads as a list, not as an array', () => {
  assert.equal(valueText(['Pune', 'Nashik']), 'Pune, Nashik')
  assert.equal(valueText(['Pune', '', null]), 'Pune', 'and blanks are not values')
})

test('a range writes only the ends that were actually set', () => {
  // "up to 500" is a real filter. "0 to 500" would be a different, wronger
  // claim about what the reader asked for.
  assert.equal(valueText({ min: 100, max: 500 }), '100 – 500')
  assert.equal(valueText({ max: 500 }), 'up to 500')
  assert.equal(valueText({ min: 100 }), 'from 100')
  assert.equal(valueText({ from: '2026-01-01', to: '2026-03-31' }), '2026-01-01 – 2026-03-31')
  assert.equal(valueText({ days: 30 }), 'last 30 days')
})

test('nothing is nothing, whatever shape it arrives in', () => {
  assert.equal(valueText(null), '')
  assert.equal(valueText(undefined), '')
  assert.equal(valueText(''), '')
  assert.equal(valueText({}), '')
  assert.equal(valueText([]), '')
})

// ---------------------------------------------------------------------
// Every narrowing in force
// ---------------------------------------------------------------------

test('what the paper says was applied is what the bar says is applied', () => {
  // Through `controlActive`, the same function that lights a control up --
  // so a control that looks applied on screen appears on the page.
  const controls = [control(), control({ id: 'c2', kind: 'multi', label: 'Model' })]
  const lines = appliedFilters(controls, { c1: 'Pune', c2: ['A', 'B'] })
  assert.deepEqual(lines.map((l) => `${l.label}: ${l.value}`), ['Branch: Pune', 'Model: A, B'])
})

test('a control doing nothing is not printed as though it were', () => {
  const lines = appliedFilters([control(), control({ id: 'c2', label: 'Model' })], { c1: 'Pune' })
  assert.equal(lines.length, 1)
  assert.deepEqual(appliedFilters([control()], {}), [])
})

test('a button says it is on, because that is all a button has', () => {
  const btn = { id: 'b1', kind: 'button', label: 'Pending only' }
  assert.deepEqual(appliedFilters([btn], {}, ['b1']), [{ label: 'Pending only', value: 'on', fixed: false }])
  assert.deepEqual(appliedFilters([btn], {}, []), [], 'and an unpressed one is not mentioned')
})

test('a FIXED control is disclosed, and marked as one', () => {
  // It is a rule of the page the reader never sees and cannot turn off,
  // which is exactly what a printout has to disclose.
  const fixed = control({ mode: 'fixed', label: 'Dealer' })
  const [line] = appliedFilters([fixed], { c1: 'B2D' })
  assert.equal(line.value, 'B2D')
  assert.equal(line.fixed, true)
})

test('a drill is printed too — nothing in the bar shows it', () => {
  // It is the filter the reader made by clicking, and the one most likely
  // to be forgotten.
  const lines = appliedFilters([], {}, [], [{ label: 'West · Ravi' }])
  assert.deepEqual(lines, [{ label: 'Drilled into', value: 'West · Ravi', drilled: true }])
})

test('a drill with no label falls back to its value', () => {
  const [line] = appliedFilters([], {}, [], [{ value: 'Booked' }])
  assert.equal(line.value, 'Booked')
  assert.deepEqual(appliedFilters([], {}, [], [{}]), [], 'and one with neither is not a line')
})

test('a hidden control is not on the paper', () => {
  assert.deepEqual(appliedFilters([control({ hidden: true })], { c1: 'Pune' }), [])
})

test('nothing at all says so, rather than printing an empty line', () => {
  // A blank space where the filters go reads as "the filters did not print",
  // which is the doubt this header exists to remove.
  assert.equal(filterSummary([]), 'No filters applied — the whole dataset')
  assert.equal(filterSummary(null), 'No filters applied — the whole dataset')
  assert.equal(filterSummary([{ label: 'Branch', value: 'Pune' }]), 'Branch: Pune')
})

// ---------------------------------------------------------------------
// When it was taken
// ---------------------------------------------------------------------

test('a printout carries the moment it was taken', () => {
  // A photograph of a live dashboard with no date on it is the beginning of
  // an argument.
  const stamp = printStamp(new Date('2026-08-29T10:05:00'))
  assert.ok(stamp.includes('2026'), 'the year')
  assert.ok(/\b29\b/.test(stamp), 'the day')
  assert.ok(/\d{1,2}:\d{2}/.test(stamp), 'and the TIME -- two prints of the same day are two different pages')
})

test('a broken date does not print as "Invalid Date"', () => {
  assert.ok(!printStamp(new Date('nonsense')).includes('Invalid'))
  assert.ok(!printStamp('not a date').includes('Invalid'))
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

const dashboard = read('src/pages/Dashboard.jsx')
const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')

test('the export IS the page, not a second drawing of it', () => {
  // The browser's own dialogue, which is also its Save as PDF -- so there
  // is no second implementation of the page to fall behind the first.
  assert.ok(dashboard.includes('onClick={() => window.print()}'))
  assert.ok(dashboard.includes('title="Print, or save as PDF"'))
})

test('the paper is told which filters were on', () => {
  assert.ok(dashboard.includes('<div className="print-header">'))
  assert.ok(dashboard.includes('appliedFilters(pageControls, effectiveValues, effectiveButtonIds, crossFilters)'))
  assert.ok(dashboard.includes('printStamp()'))
  assert.ok(dashboard.includes('No filters applied'))
})

test('it reads the EFFECTIVE values, so a fixed rule is disclosed', () => {
  // The user's own values alone would print a page as though the admin's
  // rules were not there.
  const at = dashboard.indexOf('const printFilters = useMemo(')
  assert.ok(at > 0)
  const body = dashboard.slice(at, at + 260)
  assert.ok(body.includes('effectiveValues'))
  assert.ok(!body.includes('filterValues,'), 'not the raw ones')
})

test('the header is paper-only, and the chrome is screen-only', () => {
  assert.ok(css.includes('.print-header {\n  display: none;\n}'))
  assert.ok(css.includes('@media print'))
  const at = css.indexOf('@media print')
  assert.ok(css.slice(at).includes('.no-print {\n    display: none !important;\n  }'))
})

test('the marker is put on real elements, not guessed at from the stylesheet', () => {
  // A selector that matches nothing is dead CSS that looks like a working
  // rule.
  const files = ['src/pages/Dashboard.jsx', 'src/components/EditSplit.jsx', 'src/components/ArrangeBar.jsx']
  for (const f of files) {
    assert.ok(read(f).includes('no-print'), f)
  }

  // The sidebar is TWO elements -- an in-flow rail on a desktop and a drawer
  // over the page on a phone -- and marking one leaves the other printing
  // down the side of every sheet.
  const sidebar = read('src/components/Sidebar.jsx')
  assert.equal((sidebar.match(/no-print/g) || []).length, 2)
})

test('a pinned height does not clip its own widget on paper', () => {
  // The constraint on screen is the layout; on paper it is the sheet, and a
  // pinned height would print a chart cut in half.
  const at = css.indexOf('@media print')
  const block = css.slice(at)
  assert.ok(block.includes('.widget-sized {\n    height: auto !important;\n  }'))
  assert.ok(block.includes('.widget-sized > .card {\n    overflow: visible !important;\n  }'))

  // And anything that scrolled INSIDE a widget too, or the printout shows
  // the first screenful and silently drops the rest -- which is the failure
  // mode where a printed table is wrong rather than merely short.
  assert.ok(block.includes("  .card [class*='overflow-'],"))
  assert.ok(block.includes('max-height: none !important'))
})

test('a card is never split across two sheets', () => {
  const block = css.slice(css.indexOf('@media print'))
  assert.ok(block.includes('break-inside: avoid'))
  assert.ok(block.includes('page-break-inside: avoid'), 'and the older spelling, for the browsers that want it')
})

test('the colours print, because a red bar IS the finding', () => {
  const block = css.slice(css.indexOf('@media print'))
  assert.ok(block.includes('print-color-adjust: exact'))
  assert.ok(block.includes('-webkit-print-color-adjust: exact'), 'and Safari wants the prefix')
})

test('the sheet is landscape, said plainly', () => {
  // A `var()` in @page is a declaration the browser drops, which would leave
  // the default silently unchanged and look like the rule was working.
  const at = css.indexOf('@page {')
  assert.ok(at > 0)
  const rule = css.slice(at, css.indexOf('}', at))
  assert.ok(rule.includes('size: landscape'))
  assert.ok(!rule.includes('var('), 'and nothing @page cannot read')
  assert.ok(rule.includes('margin:'), 'with a margin, or a chart runs to the paper edge')
})
