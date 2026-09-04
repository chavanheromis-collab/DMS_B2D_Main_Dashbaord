import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  BASE_ENDS,
  DEFAULT_PROCESS,
  DEFAULT_PYRAMID,
  DEFAULT_RINGS,
  NUMBER_STYLES,
  PROCESS_SHAPES,
  PYRAMID_SHAPES,
  RING_BASES,
  RING_CENTRES,
  processSteps,
  pyramidLayers,
  rank,
  ringBasisIsMeaningful,
  ringStats,
  stepNumber,
} from './infographics.js'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// Four categories, deliberately lopsided, plus a long tail -- so "top 3"
// and "share of everything" can disagree.
const ROWS = [
  ...Array.from({ length: 50 }, () => ({ Stage: 'Enquiry', Amount: '10' })),
  ...Array.from({ length: 25 }, () => ({ Stage: 'Test ride', Amount: '20' })),
  ...Array.from({ length: 15 }, () => ({ Stage: 'Booked', Amount: '30' })),
  ...Array.from({ length: 6 }, () => ({ Stage: 'Delivered', Amount: '40' })),
  { Stage: 'Lost', Amount: '1' },
  { Stage: 'Cancelled', Amount: '2' },
  { Stage: 'Deferred', Amount: '3' },
]

// --- the ranking every one of them shares --------------------------------

test('a share is a share of everything, not of what fitted', () => {
  // The bug this whole module is arranged around. Top 3 of 99 rows: if the
  // total were taken after the cut, Enquiry would read 67% instead of 51%
  // and nothing on the card would say which.
  const top = rank(ROWS, { groupBy: 'Stage' }, { limit: 3 })
  assert.equal(top.total, 99)
  assert.equal(top.items.length, 3)
  assert.equal(Math.round(top.items[0].share), 51)


  const all = rank(ROWS, { groupBy: 'Stage' }, { limit: 0 })
  assert.equal(all.total, top.total, 'the total moved when fewer were drawn')
  assert.equal(all.items[0].share, top.items[0].share)
})

test('what did not fit is counted, so the card can say so', () => {
  const top = rank(ROWS, { groupBy: 'Stage' }, { limit: 3 })
  assert.equal(top.hidden, 4)
  assert.equal(top.hiddenValue, 6 + 1 + 1 + 1)
  // And the shares of the drawn ones plus the hidden value make the whole.
  const drawn = top.items.reduce((sum, item) => sum + item.value, 0)
  assert.equal(drawn + top.hiddenValue, top.total)
})

test('the biggest is the biggest of the column, not of the drawn few', () => {
  // Whichever "against the largest" ring is showing, its yardstick has to
  // stay put when somebody shows one fewer category.
  assert.equal(rank(ROWS, { groupBy: 'Stage' }, { limit: 2 }).max, 50)
  assert.equal(rank(ROWS, { groupBy: 'Stage' }, { limit: 7 }).max, 50)
  // And the case that tells the two apart: an order where the biggest is
  // not among the drawn ones at all. Taken off the drawn few, this would
  // be 15 -- and every ring would be measured against a category that is
  // nowhere on the card.
  assert.equal(rank(ROWS, { groupBy: 'Stage', sort: 'name_asc' }, { limit: 2 }).max, 50)
})

test('no column, nothing drawn -- and no crash on the way there', () => {
  const empty = rank(ROWS, { groupBy: '' })
  assert.equal(empty.ready, false)
  assert.deepEqual(empty.items, [])
  assert.equal(rank(null, { groupBy: 'Stage' }).total, 0)
  assert.equal(rank([], { groupBy: 'Stage' }).ready, true)
})

test('the measure follows the aggregation, not just the row count', () => {
  const counted = rank(ROWS, { groupBy: 'Stage' }, { limit: 2 })
  const summed = rank(ROWS, { groupBy: 'Stage', aggregation: 'sum', column: 'Amount' }, { limit: 2 })
  assert.equal(counted.items[0].value, 50)
  assert.equal(summed.items[0].value, 500)
  // And summing changes who is biggest, which is the point of offering it.
  assert.equal(summed.items[1].name, 'Test ride')
  assert.equal(summed.items[1].value, 500)
})

// --- rings ---------------------------------------------------------------

test('a ring against the total is that category’s share', () => {
  const data = ringStats({ groupBy: 'Stage', maxRings: 4 }, { rows: ROWS })
  assert.equal(data.rings.length, 4)
  assert.equal(Math.round(data.rings[0].percent), 51)
  assert.equal(Math.round(data.rings[0].percent), Math.round(data.rings[0].share))
})

test('a ring against the biggest fills the biggest one completely', () => {
  const data = ringStats({ groupBy: 'Stage', basis: 'max', maxRings: 3 }, { rows: ROWS })
  assert.equal(data.rings[0].fraction, 1)
  assert.equal(data.rings[1].fraction, 0.5)
  // Which is a different reading from the share -- 25 of 99 is not half.
  assert.notEqual(Math.round(data.rings[1].percent), Math.round(data.rings[1].share))
})

test('a ring against a target is measured against the target', () => {
  const data = ringStats({ groupBy: 'Stage', basis: 'target', target: 100, maxRings: 2 }, { rows: ROWS })
  assert.equal(data.rings[0].fraction, 0.5)
  assert.equal(data.rings[1].fraction, 0.25)
})

test('a target that is beaten still draws a full ring, not two laps', () => {
  const data = ringStats({ groupBy: 'Stage', basis: 'target', target: 10, maxRings: 1 }, { rows: ROWS })
  assert.equal(data.rings[0].fraction, 1)
})

test('asking for a target and typing none is called out rather than drawn full', () => {
  // Every ring full reads as every category having hit its number.
  assert.equal(ringBasisIsMeaningful({ basis: 'target', target: null }), false)
  assert.equal(ringBasisIsMeaningful({ basis: 'target', target: 0 }), false)
  assert.equal(ringBasisIsMeaningful({ basis: 'target', target: 250 }), true)
  assert.equal(ringBasisIsMeaningful({ basis: 'share' }), true)
  assert.equal(ringBasisIsMeaningful({ basis: 'max' }), true)
})

test('every basis and centre the picker offers is one the card can draw', () => {
  for (const basis of RING_BASES) {
    const data = ringStats({ groupBy: 'Stage', basis: basis.value, target: 100 }, { rows: ROWS })
    assert.ok(data.rings.length > 0, `${basis.value} draws nothing`)
    for (const ring of data.rings) {
      assert.ok(ring.fraction >= 0 && ring.fraction <= 1, `${basis.value}: ${ring.fraction}`)
    }
  }
  assert.ok(RING_CENTRES.length >= 3)
  for (const centre of RING_CENTRES) assert.ok(centre.value && centre.label)
})

// --- process -------------------------------------------------------------

test('steps are numbered from one, in the style asked for', () => {
  // Nobody labels the first step of a process 0.
  assert.equal(stepNumber(0), '01')
  assert.equal(stepNumber(9), '10')
  assert.equal(stepNumber(0, 'plain'), '1')
  assert.equal(stepNumber(3, 'roman'), 'IV')
  assert.equal(stepNumber(0, 'none'), '')
  // Past the end of the numerals rather than an empty badge.
  assert.equal(stepNumber(30, 'roman'), '31')
  for (const style of NUMBER_STYLES) {
    assert.equal(typeof stepNumber(2, style.value), 'string')
  }
})

test('steps from a column are the ranked values', () => {
  const data = processSteps({ groupBy: 'Stage', maxSteps: 3 }, { rows: ROWS })
  assert.deepEqual(data.steps.map((s) => s.name), ['Enquiry', 'Test ride', 'Booked'])
  assert.deepEqual(data.steps.map((s) => s.number), ['01', '02', '03'])
  assert.equal(Math.round(data.steps[0].share), 51)
  assert.equal(data.hidden, 4)
})

test('typed steps keep the order they were typed in', () => {
  // The whole reason for typing them. Ranking a process by size would put
  // the last stage first the moment it got busy.
  const widget = {
    source: 'manual',
    steps: [
      { id: 'a', label: 'Enquiry', caption: 'Walk-in or call' },
      { id: 'b', label: 'Test ride' },
      { id: 'c', label: 'Delivery', value: 12 },
    ],
  }
  const data = processSteps(widget, { rows: ROWS })
  assert.deepEqual(data.steps.map((s) => s.name), ['Enquiry', 'Test ride', 'Delivery'])
  assert.equal(data.steps[0].caption, 'Walk-in or call')
  assert.equal(data.steps[2].value, 12)
})

test('a typed step with no figure carries none rather than a nought', () => {
  // On a chevron, 0 and "no number given" look identical and mean the
  // opposite of each other.
  const data = processSteps({ source: 'manual', steps: [{ label: 'Enquiry' }] }, {})
  assert.equal(data.steps[0].value, null)
  assert.equal(processSteps({ source: 'manual', steps: [{ label: 'x', value: 0 }] }, {}).steps[0].value, 0)
})

test('an empty typed list is not a widget waiting to be drawn', () => {
  assert.equal(processSteps({ source: 'manual', steps: [] }, {}).ready, false)
  assert.equal(processSteps({ source: 'manual', steps: [{ label: '  ' && '' }] }, {}).ready, false)
})

test('typed steps are capped like every other list here', () => {
  const steps = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, label: `Step ${i}` }))
  const data = processSteps({ source: 'manual', steps, maxSteps: 4 }, {})
  assert.equal(data.steps.length, 4)
  assert.equal(data.hidden, 5)
})

// --- pyramid -------------------------------------------------------------

test('a pyramid is widest at the bottom and the widest layer is the biggest', () => {
  const data = pyramidLayers({ groupBy: 'Stage', maxLayers: 4 }, { rows: ROWS })
  assert.deepEqual(data.layers.map((l) => l.name), ['Delivered', 'Booked', 'Test ride', 'Enquiry'])
  const widths = data.layers.map((l) => l.width)
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b), 'the taper is not monotonic')
  assert.equal(widths[widths.length - 1], 100)
  assert.equal(data.layers[data.layers.length - 1].name, 'Enquiry')
})

test('turning it over puts the biggest at the top and nothing else changes', () => {
  const down = pyramidLayers({ groupBy: 'Stage', baseAt: 'top', maxLayers: 4 }, { rows: ROWS })
  assert.equal(down.layers[0].name, 'Enquiry')
  assert.equal(down.layers[0].width, 100)
  assert.equal(down.total, pyramidLayers({ groupBy: 'Stage', maxLayers: 4 }, { rows: ROWS }).total)
})

test('a funnel’s width is the value; a pyramid’s is not, and it says so', () => {
  // The single most common way this shape lies: an even taper that looks
  // proportional. Both are offered, and only one of them claims to mean
  // anything.
  const funnel = pyramidLayers({ groupBy: 'Stage', shape: 'funnel', baseAt: 'top', maxLayers: 4 }, { rows: ROWS })
  const pyramid = pyramidLayers({ groupBy: 'Stage', shape: 'pyramid', baseAt: 'top', maxLayers: 4 }, { rows: ROWS })

  assert.equal(funnel.meaningful, true)
  assert.equal(pyramid.meaningful, false)

  // Enquiry is twice Test ride, and only the funnel draws it that way --
  // measured off the floor the widths start from.
  const floor = 34
  const [a, b] = funnel.layers
  assert.equal(Math.round(((a.width - floor) / (b.width - floor)) * 10) / 10, 2)
  // Measured against the BIGGEST layer, so the widest band fills the card.
  // Against the total instead, the ratios would survive and the whole
  // funnel would quietly shrink to two thirds of the width.
  assert.equal(a.width, 100)
  assert.notEqual(pyramid.layers[0].width - pyramid.layers[1].width, a.width - b.width)
})

test('stacked bands are all one width, so there is nothing to misread', () => {
  const data = pyramidLayers({ groupBy: 'Stage', shape: 'steps', maxLayers: 4 }, { rows: ROWS })
  assert.deepEqual(new Set(data.layers.map((l) => l.width)), new Set([100]))
  assert.equal(data.meaningful, true)
})

test('one layer on its own is full width rather than a division by zero', () => {
  const one = pyramidLayers({ groupBy: 'Stage', maxLayers: 2 }, { rows: [{ Stage: 'Only' }] })
  assert.equal(one.layers.length, 1)
  assert.equal(one.layers[0].width, 100)
})

test('every shape the picker offers draws a width that can be used', () => {
  for (const shape of PYRAMID_SHAPES) {
    const data = pyramidLayers({ groupBy: 'Stage', shape: shape.value }, { rows: ROWS })
    for (const layer of data.layers) {
      assert.ok(layer.width > 0 && layer.width <= 100, `${shape.value}: ${layer.width}`)
    }
  }
  for (const end of BASE_ENDS) assert.ok(end.value && end.label)
})

test('the pyramid does not offer a sort, because its shape IS the sort', () => {
  // A triangle whose layers are in alphabetical order is a sawtooth.
  assert.equal(DEFAULT_PYRAMID.sort, 'value_desc')
  assert.ok(!read('pages/admin/InfographicEditors.jsx').match(/sort:\s*v/), 'a sort control crept in')
})

// --- the defaults draw something the moment the widget lands -------------

test('every default is a complete widget bar the column', () => {
  for (const [name, defaults, run] of [
    ['rings', DEFAULT_RINGS, ringStats],
    ['process', DEFAULT_PROCESS, processSteps],
    ['pyramid', DEFAULT_PYRAMID, pyramidLayers],
  ]) {
    assert.equal(run(defaults, { rows: ROWS }).ready, false, `${name} draws without a column`)
    const ready = run({ ...defaults, groupBy: 'Stage' }, { rows: ROWS })
    assert.equal(ready.ready, true, `${name} draws nothing with a column`)
    assert.ok(defaults.palette, `${name} has no palette`)
    assert.ok(defaults.format, `${name} has no number format`)
  }
  assert.ok(PROCESS_SHAPES.length >= 3)
})

// --- the wiring ----------------------------------------------------------

test('the three of them are on the palette, with a shape and a sentence', () => {
  const config = read('lib/config.js')
  for (const type of ['rings', 'process', 'pyramid']) {
    assert.ok(config.includes(`value: '${type}'`), `${type} is not offered`)
  }
})

test('the ring is drawn by the geometry the KPI card uses, not by arithmetic here', () => {
  // Two implementations of "how much of a circle is 80%" is two answers
  // the day one of them is corrected.
  const widget = read('components/widgets/InfographicWidgets.jsx')
  assert.ok(widget.includes('ringGeometry('), 'the circle is worked out by hand')
  assert.ok(widget.includes('strokeDashoffset={geo.offset}'), 'the fill is not driven by the geometry')
  assert.ok(widget.includes('rotate(${geo.rotation}deg)'), 'a gauge would open at three o’clock')
  // And no second copy of the sums the module already does.
  assert.ok(!/2 \* Math\.PI/.test(widget), 'a circumference is computed in the component')
})

test('what the card left out is said on the card', () => {
  // "Top 4" with nothing to say the other fourteen exist is the same lie as
  // a truncated pie.
  const widget = read('components/widgets/InfographicWidgets.jsx')
  const at = widget.indexOf('function Rest(')
  assert.ok(at >= 0, 'nothing says what was left out')

  // The BODY, not just the name: a `Rest` that returns null passes every
  // check that only looks for the call.
  const body = widget.slice(at, widget.indexOf('\n}', at))
  assert.match(body, /\{hidden\}/, 'the count is not printed')
  assert.match(body, /formatNumber\(hiddenValue/, 'the value behind it is not printed')
  assert.match(body, /if \(!hidden\) return null/, 'it would print "+0 more" on a complete card')

  assert.equal((widget.match(/<Rest /g) || []).length, 3, 'not every one of the three says it')
})

test('a process running down is still drawn as the shape that was picked', () => {
  // The quiet half-failure: "Down" saves, the chevrons become plain blocks,
  // and nothing anywhere says the shape was dropped.
  const widget = read('components/widgets/InfographicWidgets.jsx')
  assert.ok(widget.includes('CHEVRON_DOWN'), 'a downward process loses its notches')
  assert.ok(widget.includes('chevron && down'), 'the downward shape is never applied')
})

test('the editors write the fields the modules read', () => {
  const editors = read('pages/admin/InfographicEditors.jsx')
  for (const field of ['groupBy', 'basis', 'target', 'centre', 'shape', 'baseAt', 'steps', 'numberStyle']) {
    assert.ok(editors.includes(`${field}:`), `nothing sets ${field}`)
  }
  // The two settings that make the picture mean something else entirely
  // are the two that carry a hint.
  assert.ok(editors.includes('RING_BASES.find'), 'the basis is offered without saying what it means')
  assert.ok(editors.includes('PYRAMID_SHAPES.find'), 'the shape is offered without saying what it means')
})

test('an editor warns where a setting makes the picture meaningless', () => {
  const editors = read('pages/admin/InfographicEditors.jsx')
  assert.ok(editors.includes('ringBasisIsMeaningful(widget)'), 'a target-less target ring is not called out')
  assert.ok(editors.includes("shape === 'pyramid' && ("), 'the decorative taper is not called out')
})
