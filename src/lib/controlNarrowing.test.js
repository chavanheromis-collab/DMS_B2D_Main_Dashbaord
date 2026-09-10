import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  LISTING_KINDS,
  NARROWABLE_KINDS,
  NARROW_SOURCES,
  RANGE_KINDS,
  controlOptions,
  kindLists,
  kindNarrows,
  narrowHint,
  narrowPatch,
  narrowSourceOf,
  narrowingOf,
  optionRows,
} from './pageControls.js'
import { boundsHolding, dateSpan, numericBounds, numericSpan } from './widgetControls.js'

// ---------------------------------------------------------------------
// Narrowing a control to what the page shows
// ---------------------------------------------------------------------
// A dropdown has narrowed itself to the rest of the page for a long time.
// A slider did not: pick a branch whose biggest order is two lakh and the
// amount track still ran to fifty, so four fifths of every drag filtered
// the page to nothing and nothing on screen said which four fifths.
//
// The switch is now one switch over both shapes, so what is worth testing
// is that they really are the same rule -- narrowed by the same things,
// opted out of by the same flag, and both keeping the way back.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

// --- which kinds the switch is offered on --------------------------------

test('the switch is offered on every kind that reads the rows', () => {
  for (const kind of ['select', 'multi', 'chips', 'slider', 'threshold', 'number', 'date']) {
    assert.equal(kindNarrows(kind), true, `${kind} reads its choices from the rows`)
  }
})

test('...and on none that does not', () => {
  // A text box has nothing to narrow. A button is the thing narrowing.
  // A stepper and a "last N days" slider have stops the ADMIN typed, so a
  // switch on them would be a switch that does nothing -- which this
  // codebase treats as worse than no switch at all.
  for (const kind of ['text', 'button', 'stepper', 'dateslider']) {
    assert.equal(kindNarrows(kind), false, `${kind} reads nothing from the rows`)
  }
  assert.equal(kindNarrows(undefined), false)
})

test('the two shapes are told apart, and together are the whole list', () => {
  assert.equal(kindLists('chips'), true)
  assert.equal(kindLists('slider'), false)
  assert.deepEqual(NARROWABLE_KINDS, [...LISTING_KINDS, ...RANGE_KINDS])
  // No kind is both a list and a range.
  assert.equal(
    LISTING_KINDS.some((k) => RANGE_KINDS.includes(k)),
    false
  )
})

test('narrowingOf answers both halves at once', () => {
  assert.equal(narrowingOf({ kind: 'slider' }), 'page')
  assert.equal(narrowingOf({ kind: 'slider', narrowBy: 'controls' }), 'controls')
  assert.equal(narrowingOf({ kind: 'slider', narrowBy: 'none' }), 'none')
  // A kind with nothing to narrow is never narrowed, whatever it was set to.
  assert.equal(narrowingOf({ kind: 'text' }), 'none')
  assert.equal(narrowingOf({ kind: 'text', narrowBy: 'page' }), 'none')
  assert.equal(narrowingOf(null), 'none')
})

// --- the three settings, and what a page saved last year means -----------

test('a page saved before there was a middle setting behaves as it did', () => {
  // The old flag set meant "never narrow" and still does; its absence meant
  // "narrow to the page" and still does. Nothing is rewritten on read.
  assert.equal(narrowSourceOf({ kind: 'select' }), 'page')
  assert.equal(narrowSourceOf({ kind: 'select', independent: true }), 'none')
  assert.equal(narrowSourceOf({ kind: 'select', independent: false }), 'page')
  assert.equal(narrowSourceOf(null), 'page')
})

test('the new field wins over the old flag, in both directions', () => {
  assert.equal(narrowSourceOf({ narrowBy: 'controls', independent: true }), 'controls')
  assert.equal(narrowSourceOf({ narrowBy: 'none', independent: false }), 'none')
  // Anything unrecognised is the default rather than a control that does
  // something nobody chose.
  assert.equal(narrowSourceOf({ narrowBy: 'sideways' }), 'page')
})

test('setting one writes the old flag in step with it', () => {
  // Or a rollback -- and anything not yet taught the new field -- would
  // disagree about a control the admin has just set.
  assert.deepEqual(narrowPatch('page'), { narrowBy: 'page', independent: false })
  assert.deepEqual(narrowPatch('controls'), { narrowBy: 'controls', independent: false })
  assert.deepEqual(narrowPatch('none'), { narrowBy: 'none', independent: true })
  assert.deepEqual(narrowPatch('nonsense'), { narrowBy: 'page', independent: false })
})

test('every setting is worded for both shapes a control takes', () => {
  for (const source of NARROW_SOURCES) {
    assert.ok(source.hint, `${source.value} needs wording for a list`)
    assert.ok(source.rangeHint, `${source.value} needs wording for a range`)
  }
  const on = (kind, narrowBy) => narrowHint({ kind, narrowBy })
  assert.notEqual(on('select', 'none'), on('slider', 'none'))
  assert.equal(on('select', 'none'), NARROW_SOURCES.find((s) => s.value === 'none').hint)
  assert.equal(on('slider', 'none'), NARROW_SOURCES.find((s) => s.value === 'none').rangeHint)
})

// --- narrowed BY the controls AND the buttons ----------------------------

const SALES = [
  { _row: 2, Region: 'West', DSE: 'Ravi', Status: 'Open', Amount: '12000' },
  { _row: 3, Region: 'West', DSE: 'Sunil', Status: 'Cancelled', Amount: '5000000' },
  { _row: 4, Region: 'East', DSE: 'Asha', Status: 'Open', Amount: '90000' },
]

const region = { id: 'r', kind: 'select', tab: 'T', column: 'Region' }
const dse = { id: 'd', kind: 'select', tab: 'T', column: 'DSE' }
const amount = { id: 'a', kind: 'slider', tab: 'T', column: 'Amount' }

const live = {
  id: 'b',
  kind: 'button',
  match: 'all',
  conditions: [{ tab: 'T', column: 'Status', operator: 'not_equals', value: 'Cancelled' }],
}

const narrowed = (control, { values = {}, activeIds = [], crossFilters = [], search = '' } = {}) =>
  optionRows(control, {
    rows: SALES,
    tab: 'T',
    filters: [region, dse, amount],
    buttons: [live],
    values,
    activeIds,
    crossFilters,
    search,
  })

/** Somebody clicked the West bar on a chart. */
const clickedWest = [{ kind: 'value', tab: 'T', column: 'Region', value: 'West' }]

test('a condition button narrows a list, exactly as a dropdown does', () => {
  // The switch says "what the page shows", and a button pressed is as much
  // of what the page shows as a dropdown picked.
  assert.deepEqual(controlOptions(dse, narrowed(dse)), ['Asha', 'Ravi', 'Sunil'])
  assert.deepEqual(controlOptions(dse, narrowed(dse, { activeIds: ['b'] })), ['Asha', 'Ravi'])
})

test('a condition button narrows a range too', () => {
  // The cancelled fifty-lakh order was the top of the track. With the
  // button on, dragging above ninety thousand can only ever match nothing.
  assert.deepEqual(numericBounds(narrowed(amount), 'Amount'), { min: 12000, max: 5000000 })
  assert.deepEqual(numericBounds(narrowed(amount, { activeIds: ['b'] }), 'Amount'), {
    min: 12000,
    max: 90000,
  })
})

test('a range narrows to the other controls, but never to itself', () => {
  const byRegion = narrowed(amount, { values: { r: 'East' } })
  // One row left, so the track would have no width -- numericBounds opens
  // it by one rather than handing back something undraggable.
  assert.deepEqual(numericBounds(byRegion, 'Amount'), { min: 90000, max: 90001 })

  // Its own value is left out, or the track would shrink to whatever is
  // already picked and there would be no way to widen it again.
  const bySelf = narrowed(amount, { values: { a: { from: '80000', to: '95000' } } })
  assert.deepEqual(numericBounds(bySelf, 'Amount'), { min: 12000, max: 5000000 })
})

// --- the middle setting: what was SET, not what was glanced at ----------

test('"only the controls and buttons" still follows both of those', () => {
  // It is the narrower setting, not a weaker one: everything somebody
  // deliberately set still counts, exactly as on "what the page shows".
  const only = { ...dse, narrowBy: 'controls' }
  assert.deepEqual(controlOptions(only, narrowed(only, { values: { r: 'West' } })), ['Ravi', 'Sunil'])
  assert.deepEqual(controlOptions(only, narrowed(only, { activeIds: ['b'] })), ['Asha', 'Ravi'])
})

test('...and ignores a clicked chart segment and the search box', () => {
  // The reason the setting exists. Click a bar to see what is in it and a
  // page-narrowed dropdown quietly loses forty names -- so the next thing
  // you meant to pick is not on the list, and nothing says why.
  const only = { ...dse, narrowBy: 'controls' }
  const glanced = { crossFilters: clickedWest, search: 'Ravi' }
  assert.deepEqual(controlOptions(only, narrowed(only, glanced)), ['Asha', 'Ravi', 'Sunil'])

  // The default setting is unchanged: there, a glance does narrow.
  assert.deepEqual(controlOptions(dse, narrowed(dse, { crossFilters: clickedWest })), ['Ravi', 'Sunil'])
  assert.deepEqual(controlOptions(dse, narrowed(dse, { search: 'Ravi' })), ['Ravi'])
})

test('a range on the middle setting keeps its ends off the glances too', () => {
  const only = { ...amount, narrowBy: 'controls' }
  const glanced = { crossFilters: clickedWest, search: 'Asha' }
  assert.deepEqual(numericBounds(narrowed(only, glanced), 'Amount'), { min: 12000, max: 5000000 })
  // ...while a button, which somebody pressed on purpose, still moves them.
  assert.deepEqual(numericBounds(narrowed(only, { ...glanced, activeIds: ['b'] }), 'Amount'), {
    min: 12000,
    max: 90000,
  })
})

test('independent opts a range out, the same flag that opts a list out', () => {
  const fixedTrack = { ...amount, independent: true }
  const rows = optionRows(fixedTrack, {
    rows: SALES,
    tab: 'T',
    filters: [region, fixedTrack],
    values: { r: 'East' },
  })
  assert.equal(rows.length, 3, 'measuring the whole tab, not the current view')
})

// --- the way back --------------------------------------------------------

test('a narrowed track still reaches the value it is holding', () => {
  // The same rule that keeps a selected value on a narrowed dropdown. Set
  // the slider wide, then pick a branch that narrows it, and without this
  // the track no longer contains its own handle: still filtering, still
  // visibly filtering, and no way to drag it back.
  const held = boundsHolding({ min: 12000, max: 90000 }, { from: '0', to: '5000000' })
  assert.deepEqual(held, { min: 0, max: 5000000 })
})

test('a threshold holds a bare number, and is read the same way', () => {
  assert.deepEqual(boundsHolding({ min: 0, max: 100 }, 400), { min: 0, max: 400 })
  assert.deepEqual(boundsHolding({ min: 0, max: 100 }, -20), { min: -20, max: 100 })
})

test('a value already on the track changes nothing', () => {
  const bounds = { min: 0, max: 100 }
  assert.equal(boundsHolding(bounds, { from: '10', to: '90' }), bounds, 'same object, no re-render')
  assert.equal(boundsHolding(bounds, undefined), bounds)
  assert.equal(boundsHolding(bounds, {}), bounds)
  assert.equal(boundsHolding(bounds, ''), bounds)
})

// --- saying what is there, without inventing it --------------------------

test('an empty column has no span, and says so', () => {
  // numericBounds must invent 0-100 -- a track has to be draggable. A
  // LABEL must not: "0 - 100" over a column with no numbers reads as data.
  assert.deepEqual(numericBounds([{ A: 'x' }], 'A'), { min: 0, max: 100 })
  assert.deepEqual(numericSpan([{ A: 'x' }], 'A'), { min: null, max: null })
  assert.deepEqual(numericSpan([], 'A'), { min: null, max: null })
  assert.deepEqual(dateSpan([{ A: 'not a date' }], 'A'), { min: null, max: null })
})

test('a span is the real ends, unrounded', () => {
  // Unlike the bounds, which floor and ceil so the track lands on whole
  // numbers. A hint saying 12,000 when the smallest order is 12,000.40 is
  // a hint that is wrong.
  assert.deepEqual(numericSpan([{ A: '12000.4' }, { A: '90000.6' }], 'A'), {
    min: 12000.4,
    max: 90000.6,
  })
})

test('a date span is read in the page own date order', () => {
  const rows = [{ D: '05/06/2024' }, { D: '11/01/2024' }]
  // 5 June and 11 January read as DMY; 5 May and 1 November read as MDY.
  assert.equal(dateSpan(rows, 'D', 'DMY').min.getMonth(), 0)
  assert.equal(dateSpan(rows, 'D', 'DMY').max.getMonth(), 5)
  assert.equal(dateSpan(rows, 'D', 'MDY').min.getMonth(), 4)
  assert.equal(dateSpan(rows, 'D', 'MDY').max.getMonth(), 10)
})

test('a blank cell is not the beginning of time', () => {
  const rows = [{ D: '' }, { D: '20/03/2026' }, { D: null }]
  const { min, max } = dateSpan(rows, 'D')
  assert.equal(min.getFullYear(), 2026)
  assert.equal(max.getFullYear(), 2026)
})

// --- still wired ---------------------------------------------------------

const bar = read('components/ControlBar.jsx')
const dashboard = read('pages/Dashboard.jsx')
const panel = read('pages/admin/ControlsPanel.jsx')

test('the dashboard builds narrowed rows from the kind list, not a copy of it', () => {
  // A second hardcoded ['select','multi','chips'] here is how the sliders
  // came to be left out of this in the first place.
  assert.match(dashboard, /kindNarrows\(c\.kind\)/)
  assert.equal(/listing = viewFilters\.filter\(\(c\) => \['select'/.test(dashboard), false)
})

test('every kind of control reads its own description from the narrowed rows', () => {
  assert.match(bar, /const listRows = optionRows \?\? rows/)
  assert.match(bar, /numericBounds\(listRows, control\.column, control\)/)
  assert.match(bar, /rangeEnds\(control, listRows, dateOrder, fmt\)/)
  // ...and nothing still reaches around it to the raw tab.
  assert.equal(/numericBounds\(rows,/.test(bar), false)
  assert.equal(/controlOptions\(control, optionRows \?\? rows/.test(bar), false)
})

test('a narrowed track cannot lose its handle', () => {
  assert.match(bar, /const bounds = dataBounds && boundsHolding\(dataBounds, value\)/)
})

test('...without dragging four thousand rows along with the handle', () => {
  // Both row scans are memoised on the ROWS. Putting `value` in those deps
  // would re-read every row of the tab on every frame of a drag, which is
  // the difference between a slider and a slideshow.
  assert.match(bar, /numericBounds\(listRows, control\.column, control\) : null, \[control, listRows\]/)
  assert.match(bar, /rangeEnds\(control, listRows, dateOrder, fmt\) : null\),[^[]*\[control, listRows, dateOrder\]/)
})

test('the range hint never becomes a restriction', () => {
  // min/max attributes on the two boxes would refuse a range the reader
  // meant to ask for -- which they will, the moment they are about to
  // clear the filter that narrowed it.
  assert.match(bar, /placeholder=\{span\.from \|\| 'min'\}/)
  assert.match(bar, /placeholder=\{span\.to \|\| 'max'\}/)
  assert.equal(/onChange=\{\(e\) => onChange\(\{ \.\.\.v, from[^}]*\}\)\} [^>]*\bmin=/.test(bar), false)
})

test('a date control still shows what its rows cover', () => {
  // The hint moved into the picker when the boxes did, but it has to still
  // exist: without it the Narrowing setting on a date control would be a
  // setting that does nothing, which is the thing this panel refuses to
  // offer anywhere else.
  const picker = read('components/DateRange.jsx')
  assert.match(bar, /dataSpan=\{span\}/)
  assert.match(picker, /dataSpan\?\.label &&/)
})

test('the admin setting is offered on every narrowable kind', () => {
  assert.match(panel, /kindNarrows\(control\.kind\) && \(/)
  assert.match(panel, /options=\{NARROW_SOURCES\}/)
  assert.match(panel, /onChange=\{\(v\) => set\(narrowPatch\(v\)\)\}/)
  // The old hardcoded list is gone from THIS setting (the joined-columns
  // and bucket fields keep theirs -- they really are list-only).
  assert.equal(
    /\['select', 'multi', 'chips'\]\.includes\(control\.kind\) && \( <div className="pb-1\.5">/.test(panel),
    false
  )
})

test('the wording the admin asked to keep is still the wording', () => {
  assert.equal(
    NARROW_SOURCES.find((s) => s.value === 'page').label,
    'Narrow its values to what the page shows'
  )
  assert.equal(
    NARROW_SOURCES.find((s) => s.value === 'controls').label,
    'Narrow by the other controls and buttons only'
  )
})
