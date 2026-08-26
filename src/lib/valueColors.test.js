import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PALETTE } from './config.js'
import { colorForDatum } from './chartOptions.js'
import { seriesColor } from './seriesData.js'
import {
  ROLLUP_COLOR,
  buildRoster,
  clashingPins,
  colorKey,
  needsRoster,
  nextPinColor,
  paletteFor,
  pinnedColor,
  seatOf,
  valueColor,
} from './valueColors.js'

// ---------------------------------------------------------------------
// A colour belongs to a value
// ---------------------------------------------------------------------

test('a pin wins, and matches the way a sheet actually spells things', () => {
  const pins = [{ value: 'Cancelled', color: '#ff0000' }]
  assert.equal(valueColor('Cancelled', 3, { assignments: pins }), '#ff0000')
  assert.equal(valueColor('  cancelled ', 3, { assignments: pins }), '#ff0000', 'case and spaces')
})

test('a pin with no colour is ignored rather than blanking the value', () => {
  assert.equal(valueColor('A', 0, { assignments: [{ value: 'A', color: '' }] }), PALETTE[0])
})

test('a roll-up bucket is grey even when it is pinned', () => {
  // "Other" is a bucket the chart invented out of a tail it could not draw.
  // Painting it like a category would have the chart claim a category that
  // no row holds.
  const pins = [{ value: 'Other', color: '#ff0000' }]
  assert.equal(valueColor('Other', 0, { assignments: pins }), ROLLUP_COLOR)
  assert.equal(valueColor('Not in view', 0, { assignments: pins }), ROLLUP_COLOR)
})

test('blank and null are values like any other, not roll-ups', () => {
  assert.equal(colorKey(null), '')
  assert.equal(valueColor('(blank)', 1), PALETTE[1])
})

// --- the seating plan ----------------------------------------------------

test('unfiltered, the roster hands out exactly what the index used to', () => {
  // The guarantee that nobody's existing dashboard changes colour: with
  // nothing filtered the roster order IS the render order.
  const names = ['North', 'South', 'East', 'West']
  const roster = buildRoster(names)
  names.forEach((name, i) => {
    assert.equal(valueColor(name, i, { roster }), PALETTE[i])
  })
})

test('FILTERING DOES NOT REPAINT WHAT IS LEFT', () => {
  // The whole point. South is drawn second unfiltered and first once North
  // and East are filtered away -- and stays its own colour either way.
  const roster = buildRoster(['North', 'South', 'East', 'West'])

  const before = ['North', 'South', 'East', 'West'].map((n, i) => valueColor(n, i, { roster }))
  const after = ['South', 'West'].map((n, i) => valueColor(n, i, { roster }))

  assert.deepEqual(after, [before[1], before[3]])
})

test('without a roster, filtering DOES repaint -- which is the bug', () => {
  // Kept as a test so the fix cannot quietly be undone: this is what every
  // chart did before there was a roster.
  const before = ['North', 'South'].map((n, i) => valueColor(n, i))
  const after = ['South'].map((n, i) => valueColor(n, i))
  assert.notEqual(after[0], before[1])
})

test('a value the roster never saw sits BEHIND everyone it knows', () => {
  // A chart capped at 12 categories has a roster of 12, and a filter can
  // lift a 13th into view. Seating it where it is drawn would drop it on
  // top of whoever holds that seat.
  const roster = buildRoster(['A', 'B', 'C'])
  assert.equal(seatOf('Z', 0, roster), 3)
  assert.equal(seatOf('Z', 2, roster), 5)
  assert.equal(seatOf('B', 0, roster), 1, 'while a known value keeps its own seat')
})

test('seats wrap around the palette, in both directions', () => {
  const roster = buildRoster(Array.from({ length: PALETTE.length + 2 }, (_, i) => `v${i}`))
  assert.equal(valueColor(`v${PALETTE.length}`, 0, { roster }), PALETTE[0])
  assert.equal(valueColor('missing', -3, { assignments: [] }), PALETTE[PALETTE.length - 3])
})

test('the roster collapses repeats and folds case, keeping first appearance', () => {
  const roster = buildRoster(['North', 'north', 'South', 'NORTH'])
  assert.equal(roster.size, 2)
  assert.equal(roster.get('north'), 0)
  assert.equal(roster.get('south'), 1)
})

test('no roster is built when nothing is filtered', () => {
  const rows = [{ a: 1 }, { a: 2 }]
  assert.equal(needsRoster(rows, rows), false)
  assert.equal(needsRoster(rows.slice(0, 1), rows), true)
  assert.equal(needsRoster(undefined, rows), false, 'and never on rows that are not there')
})

// --- what the editor leans on -------------------------------------------

test('the next pin offered is a colour nobody has taken', () => {
  assert.equal(nextPinColor([], 'default'), PALETTE[0])
  assert.equal(nextPinColor([{ color: PALETTE[0] }], 'default'), PALETTE[1])
  assert.equal(nextPinColor([{ color: PALETTE[0].toUpperCase() }], 'default'), PALETTE[1], 'ignoring case')
})

test('once every palette colour is pinned it cycles rather than returning nothing', () => {
  const all = PALETTE.map((color) => ({ color }))
  assert.ok(PALETTE.includes(nextPinColor(all, 'default')))
})

test('two values pinned to one colour are reported', () => {
  const clashes = clashingPins([
    { value: 'Cancelled', color: '#ff0000' },
    { value: 'Lost', color: '#FF0000' },
    { value: 'Won', color: '#00ff00' },
  ])
  assert.equal(clashes.length, 1)
  assert.deepEqual(clashes[0], ['Cancelled', 'Lost'])
})

test('the same value pinned twice is a duplicate row, not a clash', () => {
  assert.deepEqual(
    clashingPins([
      { value: 'Cancelled', color: '#ff0000' },
      { value: 'cancelled', color: '#ff0000' },
      { value: '', color: '#ff0000' },
    ]),
    []
  )
})

test('a palette can be named or handed over as a list', () => {
  assert.equal(paletteFor('nonsense'), paletteFor('default'))
  assert.deepEqual(paletteFor(['#111111']), ['#111111'])
  assert.equal(paletteFor([]), paletteFor('default'), 'an empty list is not a palette')
})

test('pinnedColor reports nothing rather than a colour when there is no pin', () => {
  assert.equal(pinnedColor('A', []), null)
  assert.equal(pinnedColor('A', null), null)
})

// --- the charts ----------------------------------------------------------

test('A PIN BEATS THE COLOUR MODE, in every mode', () => {
  // Otherwise pinning a colour would mean something different in every
  // chart on the page, which is the opposite of what pinning is for.
  const data = [
    { name: 'Cancelled', value: 1 },
    { name: 'Won', value: 99 },
  ]
  const pins = [{ value: 'Cancelled', color: '#ff0000' }]
  const book = { assignments: pins }

  for (const colorMode of ['single', 'palette', 'scale', 'rank', 'rules']) {
    const widget = { colorMode, colorRules: [{ operator: 'gte', value: 0, color: '#00ff00' }] }
    assert.equal(colorForDatum(widget, data[0], 0, data, book), '#ff0000', colorMode)
  }
})

test('an unpinned bar still follows its mode', () => {
  const data = [{ name: 'Won', value: 99 }]
  const book = { assignments: [{ value: 'Cancelled', color: '#ff0000' }] }
  assert.equal(colorForDatum({ colorMode: 'single', color: '#123456' }, data[0], 0, data, book), '#123456')
})

test('palette mode reads the roster, so a filtered bar keeps its colour', () => {
  const roster = buildRoster(['North', 'South', 'East'])
  const widget = { colorMode: 'palette' }
  const entry = { name: 'East', value: 5 }
  assert.equal(colorForDatum(widget, entry, 0, [entry], { roster }), PALETTE[2])
})

test('a series band is the same colour as the bar of that name beside it', () => {
  const roster = buildRoster(['North', 'South'])
  assert.equal(seriesColor('South', 0, [], 'default', roster), valueColor('South', 0, { roster }))
})

// ---------------------------------------------------------------------
// Wiring: every chart family actually consults the book
// ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const chart = read('components/widgets/ChartWidget.jsx')
const comparison = read('components/widgets/ComparisonWidgets.jsx')
const analytics = read('components/widgets/AnalyticsWidgets.jsx')
const editor = read('pages/admin/WidgetEditors.jsx')
const panel = read('pages/admin/WidgetsPanel.jsx')

test('bars, pies and every round style go through the book', () => {
  assert.ok(chart.includes('const colorBook = { assignments: widget.seriesColors, palette: widget.palette, roster }'))
  assert.ok(chart.includes('return valueColor(entry.name, i, colorBook)'), 'the round styles')
  assert.ok(chart.includes('return colorForDatum(widget, entry, i, data, colorBook)'), 'and the cartesian ones')
})

test('the pie takes its slice colours from the same place the bars do', () => {
  // PiePanel is handed `colorFor` rather than reaching for a palette itself.
  const pie = read('components/widgets/PiePanel.jsx')
  assert.ok(!/PALETTE/.test(pie))
  assert.ok(pie.includes('colorFor(slice, i)'))
})

test('stacked, trend and scatter each seat their series', () => {
  assert.ok(comparison.includes('seriesColor(key, i, widget.seriesColors, widget.palette, roster)'), 'stacked')
  assert.ok(comparison.includes('seriesColor(s.name, i, widget.seriesColors, widget.palette, roster)'), 'scatter')
  assert.ok(analytics.includes('seriesColor(name, i, widget.seriesColors, widget.palette, roster)'), 'trend')
})

test('every roster is built from the UNFILTERED rows', () => {
  // A roster built from the filtered rows would be the bug wearing a hat.
  for (const [name, src] of [
    ['chart', chart],
    ['comparison', comparison],
    ['analytics', analytics],
  ]) {
    const built = src.match(/buildRoster\([^)]*\)/g) || []
    assert.ok(built.length > 0, name)
    for (const call of built) assert.ok(/unfilteredRows|built\.series/.test(call), `${name}: ${call}`)
  }
})

test('the trend chart seats its series even when nothing is filtered', () => {
  // Switching a series off in the legend narrows the chart too, and that
  // one costs nothing to fix -- the full series list is already computed.
  assert.ok(analytics.includes('needsRoster(source, unfilteredRows) ? shape(unfilteredRows).series : built.series'))
})

test('the roster is skipped when nothing is filtered', () => {
  assert.ok(chart.includes('if (!needsRoster(source, unfilteredRows)) return null'))
  assert.equal((comparison.match(/if \(!needsRoster\(rows, unfilteredRows\)\) return null/g) || []).length, 2)
})

test('an admin can turn the whole thing off', () => {
  assert.ok(editor.includes('onChange={(v) => set({ lockColors: v })}'))
  assert.ok(editor.includes('checked={widget.lockColors !== false}'), 'on unless switched off')
  for (const src of [chart, comparison, analytics]) {
    assert.ok(src.includes('if (widget.lockColors === false) return null'))
  }
})

test('pins can be set on a plain chart, not only on the series ones', () => {
  assert.ok(panel.includes('<ValueColorEditor widget={widget} set={set} />'))
  assert.ok(panel.includes('onChange={(v) => set({ palette: v })}'), 'and it says which palette they come from')
})

test('the editor offers a free colour and warns when two values clash', () => {
  assert.ok(editor.includes('color: nextPinColor(rules, widget.palette)'))
  assert.ok(editor.includes('const clashes = clashingPins(rules)'))
  assert.ok(editor.includes('{clashes.map('))
})
