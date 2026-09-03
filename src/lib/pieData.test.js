import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_PIE_OPTIONS,
  PIE_PERCENT_BASES,
  labelledSlices,
  legendScrollStart,
  legendWindowSize,
  listColumns,
  listLayout,
  PIE_LABEL_STYLES,
  PIE_LIST_POSITIONS,
  PIE_LIST_STYLES,
  pieSlices,
  pieWindow,
  rollupNote,
  sliceLabel,
} from './pieData.js'

const many = (n) => Array.from({ length: n }, (_, i) => ({ name: `C${i + 1}`, value: n - i }))

const names = (result) => result.slices.map((s) => s.name)
const sum = (result) => result.slices.reduce((t, s) => t + s.value, 0)

// --- the correctness problem, first --------------------------------------

test('a rolled-up chart still adds up to the whole', () => {
  // The bug this exists to kill: keep the top 12 of 120 and every
  // percentage on screen is a percentage of twelve. A slice reading 34%
  // might be 4% of the data, and nothing says so.
  const result = pieSlices(many(120), { maxSlices: 8 })
  assert.equal(sum(result), result.total)
  assert.equal(
    result.slices.reduce((t, s) => t + s.percent, 0).toFixed(6),
    '1.000000'
  )
})

test('percentages are of the real total, not of what survived', () => {
  const result = pieSlices([{ name: 'A', value: 50 }, { name: 'B', value: 30 }, { name: 'C', value: 20 }], {
    maxSlices: 2,
  })
  assert.equal(result.slices[0].percent, 0.5, 'A is half of everything, not two-thirds of the top two')
})

test('120 categories become a chart you can look at', () => {
  const result = pieSlices(many(120), { maxSlices: 8 })
  assert.equal(result.slices.length, 8)
  assert.equal(result.truncated, true)
  assert.equal(result.rolled, 113)
  assert.match(result.slices.at(-1).name, /^Other \(113\)$/)
})

test('the tail keeps its members, so “other what?” is answerable', () => {
  const result = pieSlices(many(10), { maxSlices: 3 })
  const other = result.slices.at(-1)
  assert.equal(other.isOther, true)
  assert.equal(other.members.length, 8)
  assert.equal(other.members[0].name, 'C3', 'in the same biggest-first order')
})

// --- the judgement calls --------------------------------------------------

test('slices are ordered biggest first, because a pie is read clockwise', () => {
  const result = pieSlices([{ name: 'small', value: 1 }, { name: 'big', value: 9 }], { rollup: false })
  assert.deepEqual(names(result), ['big', 'small'])
})

test('a sliver goes to Other even when there is room for it', () => {
  // Thinner than its own outline, and it would take a label slot that a
  // visible slice needs.
  const result = pieSlices(
    [{ name: 'A', value: 990 }, { name: 'B', value: 5 }, { name: 'C', value: 5 }],
    { maxSlices: 10, minPercent: 1 }
  )
  assert.deepEqual(names(result), ['A', 'Other (2)'])
})

test('one straggler is not worth an “Other (1)”', () => {
  // B is half a percent, so the floor would push it out -- but "Other (1)"
  // says strictly less than the category's own name, so it stays.
  const result = pieSlices([{ name: 'A', value: 995 }, { name: 'B', value: 5 }], { maxSlices: 10, minPercent: 1 })
  assert.deepEqual(names(result), ['A', 'B'])
  assert.equal(result.truncated, false)
})

test('the cap leaves room for Other rather than spending it on a sliver', () => {
  const result = pieSlices(many(20), { maxSlices: 5, minPercent: 0 })
  assert.equal(result.slices.length, 5)
  assert.equal(result.slices.at(-1).isOther, true, 'four real slices and the roll-up')
})

test('a chart that fits is left completely alone', () => {
  const result = pieSlices(many(5), { maxSlices: 8 })
  assert.equal(result.truncated, false)
  assert.equal(result.rolled, 0)
  assert.equal(result.slices.every((s) => !s.isOther), true)
})

test('roll-up can be switched off for someone who wants all 120', () => {
  const result = pieSlices(many(120), { maxSlices: 8, rollup: false })
  assert.equal(result.slices.length, 120)
  assert.equal(result.truncated, false)
})

// --- the awkward inputs ---------------------------------------------------

test('nothing to chart is not an error', () => {
  assert.deepEqual(pieSlices([]).slices, [])
  assert.deepEqual(pieSlices(null).slices, [])
  assert.equal(pieSlices([]).total, 0)
})

test('a chart of zeroes cannot divide by zero', () => {
  const result = pieSlices([{ name: 'A', value: 0 }, { name: 'B', value: 0 }])
  assert.deepEqual(result.slices, [])
  assert.equal(result.total, 0)
})

test('rows that are not numbers are dropped rather than poisoning the total', () => {
  const result = pieSlices([{ name: 'A', value: 10 }, { name: 'B', value: 'oops' }, null])
  assert.equal(result.total, 10)
  assert.deepEqual(names(result), ['A'])
})

// --- labels ---------------------------------------------------------------

test('only slices with room get a label on the chart', () => {
  const result = pieSlices(many(20), { maxSlices: 20, minPercent: 0, rollup: false })
  const labelled = labelledSlices(result.slices, 5)
  assert.ok(labelled.length < result.slices.length)
  assert.equal(labelled.every((s) => s.percent >= 0.05), true)
})

test('dropping a label never drops the category', () => {
  const result = pieSlices(many(20), { maxSlices: 20, minPercent: 0, rollup: false })
  assert.equal(result.slices.length, 20, 'all twenty are still slices, still hoverable, still in the legend')
})

test('a label says what the admin asked it to', () => {
  const slice = { name: 'SPLENDOR', value: 1284, percent: 0.4235 }
  const fmt = (v) => v.toLocaleString('en-IN')
  assert.equal(sliceLabel(slice, 'name_percent', fmt), 'SPLENDOR 42%')
  assert.equal(sliceLabel(slice, 'percent', fmt), '42%')
  assert.equal(sliceLabel(slice, 'value', fmt), '1,284')
  assert.equal(sliceLabel(slice, 'name_value', fmt), 'SPLENDOR 1,284')
  assert.equal(sliceLabel(slice, 'value_percent', fmt), '1,284 · 42%')
  assert.equal(sliceLabel(slice, 'name', fmt), 'SPLENDOR')
})

test('a tiny percentage keeps a decimal rather than rounding to nothing', () => {
  assert.equal(sliceLabel({ name: 'x', value: 1, percent: 0.004 }, 'percent'), '0.4%')
})

// --- saying so ------------------------------------------------------------

test('the caption says what was rolled up and how much of the total it was', () => {
  const result = pieSlices(many(120), { maxSlices: 8 })
  const note = rollupNote(result, (v) => String(v))
  assert.match(note, /^113 smaller categories grouped into Other/)
  assert.match(note, /% of the total$/)
})

test('a chart that hid nothing says nothing', () => {
  assert.equal(rollupNote(pieSlices(many(3))), '')
  assert.equal(rollupNote(null), '')
})

test('the defaults are the ones a 120-slice pie needs', () => {
  assert.ok(DEFAULT_PIE_OPTIONS.maxSlices <= 12)
  assert.ok(DEFAULT_PIE_OPTIONS.rollup)
})

// --- scrolling through them instead of rolling them up -------------------

const hundredPlus = Array.from({ length: 120 }, (_, i) => ({ name: `C${i}`, value: 120 - i }))

test('the pie draws the slices the legend is showing', () => {
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const win = pieWindow(all, { start: 0, count: 8 })
  assert.deepEqual(win.slices.slice(0, 8).map((s) => s.name), all.slice(0, 8).map((s) => s.name))
})

test('scrolling the legend moves the pie through the data', () => {
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const later = pieWindow(all, { start: 40, count: 8 })
  assert.equal(later.slices[0].name, all[40].name)
  assert.equal(later.start, 40)
})

test('the circle is filled by the values on screen', () => {
  // Eight slices worth 1% between them, drawn against a 99% grey wedge, is
  // a chart of nothing. Filling the circle with them is what makes the tail
  // of a hundred and twenty categories readable at all.
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const win = pieWindow(all, { start: 100, count: 8 })
  const drawn = win.slices.reduce((sum, s) => sum + s.percentShown, 0)
  assert.ok(Math.abs(drawn - 1) < 1e-9, `${drawn}`)
  assert.ok(!win.slices.some((s) => s.isRest), 'no grey wedge when the circle is filled')
})

test('and it says what fraction of everything that circle is', () => {
  // The number that stops a filled circle being a lie.
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const win = pieWindow(all, { start: 100, count: 8 })
  assert.ok(win.shownShare > 0 && win.shownShare < 0.2)
  assert.ok(Math.abs(win.shownValue / win.total - win.shownShare) < 1e-9)
})

test('the honest share of everything is on every slice as well', () => {
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const win = pieWindow(all, { start: 100, count: 8 })
  for (const slice of win.slices) {
    assert.ok(slice.percent < slice.percentShown, 'a slice is a smaller part of everything than of the window')
  }
})

test('the grey wedge is still there when the circle is NOT filled', () => {
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const win = pieWindow(all, { start: 0, count: 8, fill: false })
  const rest = win.slices.at(-1)
  assert.equal(rest.isRest, true)
  assert.equal(rest.hidden, 112)
  const drawn = win.slices.reduce((sum, s) => sum + s.percent, 0)
  assert.ok(Math.abs(drawn - 1) < 1e-9, 'and then the circle adds up to the whole')
})

test('a label can read either percentage, and the admin picks which', () => {
  const slice = { name: 'A', value: 5, percent: 0.01, percentShown: 0.4 }
  assert.equal(sliceLabel(slice, 'percent', String, 'total'), '1.0%', 'a small share keeps a decimal')
  assert.equal(sliceLabel(slice, 'percent', String, 'shown'), '40%')
  assert.equal(sliceLabel(slice, 'name_percent', String, 'shown'), 'A 40%')
  assert.equal(sliceLabel(slice, 'value', String, 'shown'), '5', 'a value is a value either way')
})

test('every percentage base offered is one the label understands', () => {
  const slice = { name: 'A', value: 5, percent: 0.25, percentShown: 0.5 }
  for (const { value } of PIE_PERCENT_BASES) {
    assert.ok(sliceLabel(slice, 'percent', String, value).endsWith('%'), value)
  }
})

test('a percentage is a share of the whole, not of the window', () => {
  // The number beside a slice means the same thing however the list happens
  // to be scrolled.
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const first = pieWindow(all, { start: 0, count: 8 }).slices[0]
  const same = pieWindow(all, { start: 0, count: 40 }).slices[0]
  assert.equal(first.percent, same.percent)
})

test('when everything fits there is no rest wedge at all', () => {
  const few = pieSlices([{ name: 'A', value: 3 }, { name: 'B', value: 1 }], { rollup: false }).slices
  const win = pieWindow(few, { start: 0, count: 8 })
  assert.equal(win.slices.length, 2)
  assert.equal(win.restCount, 0)
})

test('scrolling past the end shows the last full window rather than a gap', () => {
  const all = pieSlices(hundredPlus, { rollup: false }).slices
  const win = pieWindow(all, { start: 900, count: 8 })
  assert.equal(win.start, 112)
  assert.equal(win.slices.length, 8, 'the last eight, not an empty circle')
})

test('an empty list is an empty pie, not a crash', () => {
  const win = pieWindow([], { start: 0, count: 8 })
  assert.deepEqual(win.slices, [])
  assert.equal(win.total, 0)
})

test('the window is sized from the room the legend has', () => {
  assert.equal(legendWindowSize(220, 22), 10)
  assert.equal(legendWindowSize(0, 22), 3, 'never fewer than a few')
  assert.equal(legendWindowSize(45, 22), 3)
})

test('the first row in view is worked out from the scroll', () => {
  assert.equal(legendScrollStart(0, 22), 0)
  assert.equal(legendScrollStart(44, 22), 2)
  assert.equal(legendScrollStart(50, 22), 2, 'the nearest row, not a fraction of one')
})

// ---------------------------------------------------------------------
// What the category list beside the pie shows
// ---------------------------------------------------------------------

test('the list shows all three columns unless somebody has said otherwise', () => {
  // What it has always drawn. Anything else here would silently change
  // every pie in the workspace the day this option shipped.
  assert.deepEqual(listColumns(undefined), { name: true, value: true, percent: true })
  assert.deepEqual(listColumns('name_value_percent'), { name: true, value: true, percent: true })
})

test('and an unknown style falls back to all three rather than to nothing', () => {
  // A row with no columns is an empty list, which reads as "no data".
  assert.deepEqual(listColumns('nonsense'), { name: true, value: true, percent: true })
})

test('each style asks for exactly the columns it names', () => {
  assert.deepEqual(listColumns('name'), { name: true, value: false, percent: false })
  assert.deepEqual(listColumns('value'), { name: false, value: true, percent: false })
  assert.deepEqual(listColumns('percent'), { name: false, value: false, percent: true })
  assert.deepEqual(listColumns('name_value'), { name: true, value: true, percent: false })
  assert.deepEqual(listColumns('name_percent'), { name: true, value: false, percent: true })
  assert.deepEqual(listColumns('value_percent'), { name: false, value: true, percent: true })
})

test('every style offered is a style that resolves to something', () => {
  // The dropdown and the resolver are two lists that have to agree, and
  // the way they stop agreeing is somebody adding to one of them.
  for (const { value } of PIE_LIST_STYLES) {
    const cols = listColumns(value)
    assert.ok(cols.name || cols.value || cols.percent, `${value} draws nothing`)
  }
})

test('the list offers everything the slice labels do, and all three besides', () => {
  const labels = PIE_LABEL_STYLES.map((o) => o.value)
  const list = PIE_LIST_STYLES.map((o) => o.value)
  for (const value of labels) assert.ok(list.includes(value), value)
  assert.ok(list.includes('name_value_percent'))
  assert.equal(list.length, labels.length + 1)
})

test('the option the list defaults to is the first one offered', () => {
  // The default has to be reachable by picking it, or somebody who changes
  // their mind cannot get back to it.
  assert.equal(PIE_LIST_STYLES[0].value, 'name_value_percent')
})

// ---------------------------------------------------------------------
// Where the category list sits
// ---------------------------------------------------------------------

test('beside the circle on the right is what it has always done', () => {
  // Anything else here would move the list on every existing pie the day
  // this shipped.
  const right = listLayout('right')
  assert.deepEqual(listLayout(undefined), right)
  assert.deepEqual(listLayout('nonsense'), right)
  assert.ok(right.wrap.includes('sm:flex-row'))
  assert.ok(!right.wrap.includes('reverse'))
})

test('the other side reverses the pair rather than moving the pie', () => {
  assert.ok(listLayout('left').wrap.includes('sm:flex-row-reverse'))
})

test('above and below stack, and never turn into a row', () => {
  // A column of names next to a circle on a phone leaves neither of them
  // readable, so these two stack at every width.
  assert.ok(listLayout('bottom').wrap.includes('flex-col'))
  assert.ok(!listLayout('bottom').wrap.includes('flex-row'))
  assert.ok(listLayout('top').wrap.includes('flex-col-reverse'))
  assert.ok(!listLayout('top').wrap.includes('flex-row'))
})

test('a stacked list takes the width and gives up the height', () => {
  // ...and a list beside it does the opposite. The pair has to agree, which
  // is why one function decides both.
  for (const pos of ['top', 'bottom']) {
    const out = listLayout(pos)
    assert.ok(out.list.includes('w-full'), pos)
    assert.ok(out.list.includes('max-h-'), `${pos} is capped so it cannot crowd out the circle`)
    assert.ok(!out.list.includes('sm:w-'), pos)
  }
  for (const pos of ['left', 'right']) {
    assert.ok(listLayout(pos).list.includes('sm:w-[42%]'), pos)
  }
})

test('a narrow screen stacks whichever side was chosen', () => {
  for (const pos of ['left', 'right']) {
    // The row only starts at `sm:`; below that the flex column stands.
    assert.ok(listLayout(pos).wrap.startsWith('flex-col'), pos)
  }
})

test('every position offered is one the layout knows', () => {
  // The dropdown and the resolver are two lists that have to agree.
  const right = listLayout('right')
  for (const { value } of PIE_LIST_POSITIONS) {
    if (value === 'right') continue
    assert.notDeepEqual(listLayout(value), right, `${value} lands on the default`)
  }
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

test('the pie asks where its list should go', () => {
  const pie = read('src/components/widgets/PiePanel.jsx')
  assert.ok(pie.includes('const listAt = listLayout(widget.pieListPos)'))
})

test('and both halves of the answer are used', () => {
  // One decides which way the pair stacks and the other how much room the
  // list may take. Using one without the other is a list beside the circle
  // that still behaves as though it were underneath it.
  const pie = read('src/components/widgets/PiePanel.jsx')
  assert.ok(pie.includes('<div className={`flex min-h-0 flex-1 ${listAt.wrap}`}>'))
  assert.ok(pie.includes('box={listAt.list}'))
  assert.ok(pie.includes('className={`chart-legend shrink-0 overflow-y-auto pr-1 ${box}`}'))
})

test('the admin picks it, and it is saved where the pie reads it', () => {
  // The row-content picker sits directly above this one and takes a value
  // of the same shape, so a picker wired to the wrong field would look
  // like it worked and change the wrong thing.
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes("value={widget.pieListPos || 'right'}"))
  assert.ok(panel.includes('onChange={(v) => set({ pieListPos: v })}'))
  assert.ok(panel.includes('options={PIE_LIST_POSITIONS}'))
})

test('and it is only offered when there is a list to place', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  const at = panel.indexOf('{widget.pieLegend !== false && (')
  assert.ok(at > 0)
  assert.ok(panel.slice(at, at + 900).includes('pieListPos'))
})
