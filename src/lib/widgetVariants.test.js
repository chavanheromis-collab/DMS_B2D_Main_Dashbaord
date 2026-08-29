import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CHART_TYPES, WIDGET_TYPES } from './config.js'
import {
  WIDGET_VARIANTS,
  hasVariants,
  variantHint,
  variantOf,
  variantPatch,
  variantTitle,
  variantsFor,
} from './widgetVariants.js'

// ---------------------------------------------------------------------
// One name, several shapes
// ---------------------------------------------------------------------

test('every chart style is offered, not just the ones somebody remembered', () => {
  // The list is BUILT from CHART_TYPES rather than copied beside it, so a
  // style added to the editor cannot go missing from the palette.
  assert.equal(variantsFor('chart').length, CHART_TYPES.length)
  assert.deepEqual(variantsFor('chart').map((v) => v.value), CHART_TYPES.map((t) => t.value))
})

test('most types have no shapes behind them and simply add', () => {
  assert.equal(hasVariants('kpi'), false)
  assert.equal(hasVariants('table'), false)
  assert.equal(hasVariants('note'), false)
  assert.equal(hasVariants(undefined), false)
  assert.equal(hasVariants('chart'), true)
  assert.equal(hasVariants('stacked'), true)
})

test('a family of one is not a family', () => {
  // A palette that opens into a single button is a click that did nothing.
  for (const [type, family] of Object.entries(WIDGET_VARIANTS)) {
    assert.ok(family.options.length > 1, type)
  }
})

test('every variant belongs to a type that exists', () => {
  const types = new Set(WIDGET_TYPES.map((t) => t.value))
  for (const type of Object.keys(WIDGET_VARIANTS)) assert.ok(types.has(type), type)
})

// ---------------------------------------------------------------------
// A variant is a type plus a patch
// ---------------------------------------------------------------------

test('picking a shape adds the ordinary widget, configured', () => {
  // Exactly what picking Chart and then changing the dropdown produces --
  // so every editor, saved page and renderer already understands it.
  assert.deepEqual(variantPatch('chart', 'donut'), { chartType: 'donut' })
  assert.deepEqual(variantPatch('chart', 'treemap'), { chartType: 'treemap' })
})

test('a stacked bar chart has three genuinely different pictures', () => {
  // A stack is a total broken up, a 100% stack is a mix, and grouped bars
  // are a comparison. Reading that off the words "Stacked / Grouped" is not
  // something anybody does.
  assert.deepEqual(variantPatch('stacked', 'stacked'), { layout: 'stacked', percentStack: false })
  assert.deepEqual(variantPatch('stacked', 'percent'), { layout: 'stacked', percentStack: true })
  assert.deepEqual(variantPatch('stacked', 'grouped'), { layout: 'grouped', percentStack: false })
})

test('a shape that no longer exists patches nothing', () => {
  // The type's own default, not its first shape: a page written before a
  // style was removed should add what it always added.
  assert.deepEqual(variantPatch('chart', 'holographic'), {})
  assert.deepEqual(variantPatch('kpi', 'anything'), {})
  assert.equal(variantOf('chart', 'nope'), null)
})

// ---------------------------------------------------------------------
// What it is drawn as
// ---------------------------------------------------------------------

test('every variant names a sketch, in its family’s namespace', () => {
  for (const [type, family] of Object.entries(WIDGET_VARIANTS)) {
    for (const v of family.options) {
      assert.ok(v.preview.startsWith(`${type}:`), `${type}/${v.value} → ${v.preview}`)
    }
  }
})

test('shapes that look the same at thumbnail size share one drawing', () => {
  // A bar and a cylinder bar differ by a rounded top, which is not a
  // difference worth two sketches.
  const previews = variantsFor('chart').map((v) => v.preview)
  assert.ok(new Set(previews).size < previews.length, 'some are shared')
  assert.equal(variantOf('chart', 'cylinder').preview, variantOf('chart', 'bar').preview)
  assert.equal(variantOf('chart', 'step').preview, variantOf('chart', 'line').preview)
  assert.equal(variantOf('chart', 'rose').preview, variantOf('chart', 'pie').preview)
})

test('shapes that answer different questions are drawn differently', () => {
  const distinct = ['bar', 'hbar', 'line', 'area', 'pie', 'donut', 'radar', 'treemap', 'funnel', 'histogram']
  const seen = distinct.map((v) => variantOf('chart', v).preview)
  assert.equal(new Set(seen).size, distinct.length)
})

test('the palette has something to call the level it opened', () => {
  assert.equal(variantTitle('chart'), 'Charts')
  assert.ok(variantHint('chart').length > 0)
  assert.equal(variantTitle('kpi'), '', 'and nothing to say about a type with no level')
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
const preview = read('src/components/WidgetTypePreview.jsx')

test('a type with shapes OPENS; every other one adds', () => {
  assert.ok(
    dashboard.includes('onClick={() => (hasVariants(t.value) ? setAddFamily(t.value) : addWidgetHere(t.value))}')
  )
})

test('and it says which it will do, before you click', () => {
  // One click in the row doing something other than what every click beside
  // it does, with nothing on screen saying so, is the failure mode.
  assert.ok(dashboard.includes('{hasVariants(t.value) && ('))
  assert.ok(dashboard.includes('{variantsFor(t.value).length}'))
})

test('opening one type hides every other', () => {
  assert.ok(dashboard.includes('{addFamily ? ('))
  const at = dashboard.indexOf('{addFamily ? (')
  const branch = dashboard.slice(at, dashboard.indexOf(') : (', at))
  assert.ok(!branch.includes('WIDGET_TYPES.map'), 'the main list is not drawn beside the shapes')
  assert.ok(branch.includes('{variantsFor(addFamily).map((v) => ('))
})

test('there is a way back, and it is the first thing in the row', () => {
  const at = dashboard.indexOf('{addFamily ? (')
  const branch = dashboard.slice(at, at + 700)
  assert.ok(branch.includes('onClick={() => setAddFamily(null)}'))
  assert.ok(branch.indexOf('setAddFamily(null)') < branch.indexOf('variantsFor(addFamily).map'))
})

test('each shape is DRAWN, not just named', () => {
  assert.ok(dashboard.includes('<WidgetTypePreview type={v.preview} />'))
  assert.ok(dashboard.includes('onClick={() => addWidgetHere(addFamily, v.patch)}'))
})

test('the patch actually reaches the widget that gets made', () => {
  // Otherwise every shape in the palette adds the same default chart, and
  // the twenty-one drawings are twenty-one lies.
  assert.ok(dashboard.includes('const born = patch ? { ...made, ...patch } : made'))
  assert.ok(dashboard.includes('atLevel((list) => [...list, born])'), 'and it is what gets stored')
})

test('adding closes the level it was picked from', () => {
  // Leaving the palette showing donuts after a donut has been added is a
  // palette that has forgotten what just happened.
  const at = dashboard.indexOf('async function addWidgetHere(')
  assert.ok(dashboard.slice(at, at + 900).includes('setAddFamily(null)'))
})

test('the sketch map knows the shapes the variants name', () => {
  for (const family of Object.values(WIDGET_VARIANTS)) {
    for (const v of family.options) {
      assert.ok(preview.includes(`'${v.preview}'`), `no sketch for ${v.preview}`)
    }
  }
})

test('an undrawn shape falls back to its family, not to a bar chart', () => {
  assert.ok(preview.includes("VARIANTS[type] || SKETCHES[type] || SKETCHES[String(type).split(':')[0]] || SKETCHES.chart"))
})
