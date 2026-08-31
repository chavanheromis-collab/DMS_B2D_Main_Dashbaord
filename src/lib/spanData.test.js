import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SPAN_SORT, SPAN_SORTS, sortSpans, spanDomain, spanRows, spanTally } from './spanData.js'
import { WIDGET_TYPES } from './config.js'
import { makeWidget } from './newWidget.js'

const ROWS = [
  { Branch: 'Pune', Q: '1', B: '1' },
  { Branch: 'Pune', Q: '1', B: '' },
  { Branch: 'Pune', Q: '1', B: '' },
  { Branch: 'Delhi', Q: '1', B: '1' },
  { Branch: 'Delhi', Q: '1', B: '1' },
  { Branch: 'Agra', Q: '1', B: '' },
]

const opts = (extra) => ({
  groupBy: 'Branch',
  fromColumn: 'Q',
  fromAggregation: 'count_filled',
  toColumn: 'B',
  toAggregation: 'count_filled',
  limit: 0,
  ...extra,
})

// ---------------------------------------------------------------------
// The gap
// ---------------------------------------------------------------------

test('each row is where it starts, where it ends, and how far that is', () => {
  const byName = Object.fromEntries(spanRows(ROWS, opts()).map((r) => [r.name, r]))
  assert.deepEqual(
    { from: byName.Pune.from, to: byName.Pune.to, gap: byName.Pune.gap },
    { from: 3, to: 1, gap: -2 }
  )
  assert.deepEqual({ from: byName.Delhi.from, to: byName.Delhi.to, gap: byName.Delhi.gap }, { from: 2, to: 2, gap: 0 })
})

test('the gap is SIGNED, because the direction is half the finding', () => {
  // 96 → 140 and 140 → 96 are the same distance and opposite meanings.
  const up = spanRows([{ g: 'a', f: '', t: '1' }], { groupBy: 'g', fromColumn: 'f', fromAggregation: 'count_filled', toColumn: 't', toAggregation: 'count_filled', limit: 0 })
  assert.equal(up[0].gap, 1)
  const down = spanRows([{ g: 'a', f: '1', t: '' }], { groupBy: 'g', fromColumn: 'f', fromAggregation: 'count_filled', toColumn: 't', toAggregation: 'count_filled', limit: 0 })
  assert.equal(down[0].gap, -1)
  assert.equal(down[0].spread, 1, 'and the distance is unsigned')
})

test('the widest gap leads, which is the reason the chart exists', () => {
  assert.equal(DEFAULT_SPAN_SORT, 'gap_desc')
  assert.deepEqual(spanRows(ROWS, opts()).map((r) => r.name), ['Pune', 'Agra', 'Delhi'])
})

test('a gap that points the other way is still a wide gap', () => {
  // The ordering is by distance, not by direction -- a branch that fell 40
  // is as interesting as one that rose 40.
  const list = [
    { name: 'up', from: 0, to: 40, gap: 40, spread: 40 },
    { name: 'down', from: 40, to: 0, gap: -40, spread: 40 },
    { name: 'small', from: 0, to: 1, gap: 1, spread: 1 },
  ]
  assert.equal(sortSpans([...list], 'gap_desc')[2].name, 'small')
})

test('every order the picker offers is one the sorter knows', () => {
  const list = () => [
    { name: 'b', from: 1, to: 9, gap: 8, spread: 8 },
    { name: 'a', from: 5, to: 6, gap: 1, spread: 1 },
  ]
  assert.deepEqual(sortSpans(list(), 'gap_asc').map((r) => r.name), ['a', 'b'])
  assert.deepEqual(sortSpans(list(), 'to_desc').map((r) => r.name), ['b', 'a'])
  assert.deepEqual(sortSpans(list(), 'from_desc').map((r) => r.name), ['a', 'b'])
  assert.deepEqual(sortSpans(list(), 'name_asc').map((r) => r.name), ['a', 'b'])
  assert.deepEqual(sortSpans(list(), 'name_desc').map((r) => r.name), ['b', 'a'])
  for (const s of SPAN_SORTS) assert.ok(typeof s.label === 'string' && s.label.length > 0, s.value)
})

test('the cap falls AFTER the ordering', () => {
  // Otherwise "the widest gaps" would mean "the widest gaps among whichever
  // twelve groups happened to be biggest".
  const rows = [
    ...Array.from({ length: 20 }, () => ({ g: 'big', f: '1', t: '1' })),
    { g: 'wide', f: '1', t: '' },
    { g: 'wide', f: '1', t: '' },
    { g: 'wide', f: '1', t: '' },
  ]
  const out = spanRows(rows, {
    groupBy: 'g',
    fromColumn: 'f',
    fromAggregation: 'count_filled',
    toColumn: 't',
    toAggregation: 'count_filled',
    limit: 1,
  })
  assert.deepEqual(out.map((r) => r.name), ['wide'])
})

test('no group column is no chart, not a crash', () => {
  assert.deepEqual(spanRows(ROWS, opts({ groupBy: '' })), [])
  assert.deepEqual(spanRows(null, opts()), [])
  assert.deepEqual(spanRows(ROWS, undefined), [])
})

// ---------------------------------------------------------------------
// The axis
// ---------------------------------------------------------------------

test('the axis covers both ends of every row, with room for the dots', () => {
  const [low, high] = spanDomain([{ from: 10, to: 50 }, { from: 20, to: 30 }])
  assert.ok(low < 10 && high > 50)
})

test('the axis is NOT anchored at zero', () => {
  // The chart is about the distance between two numbers. Forcing zero in
  // compresses every gap into the same short line -- and this is the one
  // case where a truncated axis is honest, because there are no bars
  // claiming to be proportional.
  const [low] = spanDomain([{ from: 1000, to: 1010 }])
  assert.ok(low > 900, `axis started at ${low}`)
})

test('one value everywhere still draws a chart', () => {
  const [low, high] = spanDomain([{ from: 5, to: 5 }, { from: 5, to: 5 }])
  assert.ok(low < 5 && high > 5, 'a zero-width axis draws every dot on top of itself')
})

test('nothing to plot is a domain, not a NaN', () => {
  assert.deepEqual(spanDomain([]), [0, 1])
  assert.deepEqual(spanDomain(null), [0, 1])
  const [low, high] = spanDomain([{ from: 0, to: 0 }])
  assert.ok(Number.isFinite(low) && Number.isFinite(high) && low < high)
})

// ---------------------------------------------------------------------
// The caption
// ---------------------------------------------------------------------

test('how many rose, how many fell, how many held', () => {
  const tally = spanTally([{ gap: 3 }, { gap: -1 }, { gap: 0 }, { gap: 8 }])
  assert.deepEqual(tally, { up: 2, down: 1, flat: 1, total: 4 })
  assert.deepEqual(spanTally([]), { up: 0, down: 0, flat: 0, total: 0 })
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

const widget = read('src/components/widgets/RelationWidgets.jsx')
const dashboard = read('src/pages/Dashboard.jsx')
const panel = read('src/pages/admin/WidgetsPanel.jsx')
const editor = read('src/pages/admin/RelationEditors.jsx')
const preview = read('src/components/WidgetTypePreview.jsx')

test('the type is in the catalogue, and can be added', () => {
  const entry = WIDGET_TYPES.find((t) => t.value === 'dumbbell')
  assert.ok(entry, 'no palette entry')
  assert.ok(entry.icon && entry.hint, 'a name with nothing beside it is a name nobody picks')
})

test('a new one arrives configured enough to draw something', () => {
  // A widget that lands on the page blank is one somebody has to be taught
  // to fill in before they can tell whether they wanted it.
  const made = makeWidget({ type: 'dumbbell', tab: 't', name: 'Sales', cols: ['Branch', 'Booked'] })
  assert.equal(made.type, 'dumbbell')
  assert.equal(made.groupBy, 'Branch')
  assert.equal(made.spanSort, 'gap_desc')
  assert.ok(made.aggregation && made.secondaryAggregation, 'both ends have a measure')
})

test('it is drawn by hand, not by three recharts components pretending to be one', () => {
  assert.ok(widget.includes('export default function DumbbellWidget('))
  assert.ok(widget.includes('spanRows(sourceRows(widget, rows, unfilteredRows)'))
  assert.ok(widget.includes('const [low, high] = useMemo(() => spanDomain(data), [data])'))
})

test('every row shares ONE axis, or the gaps cannot be compared', () => {
  // That is the whole trick: the domain is worked out once, for all of them.
  const at = widget.indexOf('const at = (v) =>')
  assert.ok(at > 0)
  assert.ok(widget.slice(at, at + 120).includes('(v - low) / (high - low'))
  assert.ok(widget.includes('high - low || 1'), 'and a zero-width axis does not divide by zero')
})

test('the gap is said in numbers as well as drawn', () => {
  // Reading a distance off a line is exactly what this chart is meant to
  // save you from doing.
  assert.ok(widget.includes("{row.gap > 0 ? '+' : ''}"))
  assert.ok(widget.includes('{fmt(row.gap)}'))
})

test('it has an editor, and the page draws it', () => {
  assert.ok(editor.includes('export function DumbbellEditor('))
  assert.ok(panel.includes("{widget.type === 'dumbbell' && <DumbbellEditor"))
  assert.ok(dashboard.includes("{widget.type === 'dumbbell' && ("))
  assert.ok(dashboard.includes('<DumbbellWidget {...common}'))
})

test('and a sketch, so it can be told apart before it is added', () => {
  assert.ok(preview.includes('dumbbell: () => ('))
})
