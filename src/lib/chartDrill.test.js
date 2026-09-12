import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { AXIS_CLICK_CLASS, axisClickProps, matchCategory, tickCategory } from './chartDrill.js'

// ---------------------------------------------------------------------
// Clicking the words on a chart
// ---------------------------------------------------------------------
// Clicking a bar filtered the page; clicking the name under the bar did
// nothing. That is a strange line to hold -- to the reader they are one
// object, and on a chart of eleven thin bars the word is the bigger
// target of the two.
//
// Two things are worth testing. That the axes which CAN be clicked are
// the ones that mean something (a value axis is a scale, and filtering
// to "20,000" matches no row), and that a label drawn by hand is
// resolved back to real data rather than trusted.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const chart = read('components/widgets/ChartWidget.jsx')
const pie = read('components/widgets/PiePanel.jsx')
const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')

// --- what a tick is ------------------------------------------------------

test('a tick carries the category, whatever type it arrived as', () => {
  assert.equal(tickCategory({ value: 'Nashik' }), 'Nashik')
  // A year axis is numbers, and a filter is a string comparison.
  assert.equal(tickCategory({ value: 2026 }), '2026')
  assert.equal(tickCategory({ value: 0 }), '0')
  assert.equal(tickCategory({ value: '' }), '')
  assert.equal(tickCategory({}), '')
  assert.equal(tickCategory(null), '')
})

test('an axis is only clickable when the page can be filtered at all', () => {
  // A pointer cursor over something that will not respond is worse than
  // no cursor.
  assert.deepEqual(axisClickProps(null), {})
  assert.deepEqual(axisClickProps(undefined), {})
  assert.deepEqual(axisClickProps('not a function'), {})

  const props = axisClickProps(() => {})
  assert.equal(props.className, AXIS_CLICK_CLASS)
  assert.equal(typeof props.onClick, 'function')
})

test('the handler drills by the tick it was fired for', () => {
  // Recharts maps an axis's handlers onto each tick with that tick's own
  // entry, which is what makes this work without a custom renderer.
  const seen = []
  const props = axisClickProps((name) => seen.push(name))
  props.onClick({ value: 'Pune', coordinate: 120 }, 2, {})
  props.onClick({ value: 4 })
  props.onClick(null)
  assert.deepEqual(seen, ['Pune', '4', ''])
})

// --- a label drawn by hand ----------------------------------------------

test('a hand-drawn label is resolved against the data, never trusted', () => {
  // Labels get shortened to fit. Filtering by what a truncated one says
  // would match nothing while looking like it had worked.
  const data = [{ name: 'Nashik' }, { name: 'Maharashtra Regional' }, { name: '2026' }]
  assert.equal(matchCategory('Nashik', data), 'Nashik')
  assert.equal(matchCategory('  Nashik  ', data), 'Nashik')
  assert.equal(matchCategory('Maharashtra Reg…', data), '')
  assert.equal(matchCategory('Nowhere', data), '')
  assert.equal(matchCategory('', data), '')
  assert.equal(matchCategory(null, data), '')
  assert.equal(matchCategory('Nashik', null), '')
  // A numeric category still matches the text of it.
  assert.equal(matchCategory('2026', data), '2026')
})

// --- and how it is wired -------------------------------------------------

test('every category axis is clickable, and no value axis is', () => {
  // The list is the point: six axes across the chart types, and six
  // copies of two props is five chances to leave one out.
  const axes = chart.match(/<(XAxis|YAxis|PolarAngleAxis)[^>]*>/g) || []
  const category = axes.filter((a) => a.includes('dataKey="name"'))
  assert.ok(category.length >= 6, `only ${category.length} category axes found`)
  for (const axis of category) {
    assert.ok(axis.includes('{...axisDrill}'), `not clickable: ${axis}`)
  }
  // A value axis is a scale. "20,000" is not a value any row holds.
  for (const axis of axes.filter((a) => !a.includes('dataKey="name"'))) {
    assert.equal(axis.includes('axisDrill'), false, `a value axis offers a click: ${axis}`)
  }
})

test('the axes get it from one place, so they cannot disagree', () => {
  assert.ok(chart.includes('const axisDrill = axisClickProps(onCrossFilter ? drill : null)'))
})

test('a pie label filters by its slice, not by what it says', () => {
  // The text is truncated to sixteen characters to fit round the pie.
  assert.ok(pie.includes('onDrill(payload || { name })'))
  assert.ok(pie.includes("chart-label-click"))
  // "Other" is a bucket the chart invented, so its label leads nowhere --
  // the same rule the slice itself follows.
  assert.ok(pie.includes("!payload?.isOther"))
})

test('a funnel step name filters, through the data rather than the text', () => {
  assert.ok(chart.includes('drill(matchCategory(e?.target?.textContent, data))'))
})

test('the text says it can be clicked, rather than keeping it a secret', () => {
  // A pointer cursor alone is easy to miss at eleven pixels.
  assert.match(css, /\.chart-axis-click \.recharts-cartesian-axis-tick,/)
  assert.match(css, /\.chart-label-click \{\s*cursor: pointer;/)
  const hover = css.slice(css.indexOf('.chart-axis-click .recharts-cartesian-axis-tick:hover'))
  assert.match(hover.slice(0, 400), /fill: #4f46e5;/)
  assert.match(hover.slice(0, 400), /text-decoration: underline;/)
})

test('clicking the shape still works, and still by position', () => {
  // The chart-level handler is what makes a click anywhere in a
  // category's column count. This adds to it rather than replacing it.
  assert.ok(chart.includes('const onChartClick = onCrossFilter ? (state) => drill(nameFromChartEvent(state)) : undefined'))
})
