import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHART_VISUAL_KEYS,
  CHART_VISUAL_PRESETS,
  DEFAULT_CHART_VISUALS,
  GRID_STYLES,
  LIMITS,
  autoFillLabels,
  barGapProps,
  barRadius,
  chartVisualClass,
  chartVisualVars,
  clearChartVisuals,
  fillLabelColor,
  gridProps,
  hasChartVisuals,
  mergeVisuals,
  resolveVisuals,
} from './chartVisuals.js'

const classes = (v) => new Set(chartVisualClass(v).split(' ').filter(Boolean))

// --- the property that must not break -----------------------------------

test('a chart nobody has touched emits nothing at all', () => {
  // The whole feature has to be invisible until it is used. Emitting a
  // style attribute full of defaults would re-state the stock look rather
  // than inherit it, and every existing dashboard would shift the day this
  // shipped.
  assert.equal(chartVisualVars(DEFAULT_CHART_VISUALS), undefined)
  assert.equal(chartVisualClass(DEFAULT_CHART_VISUALS), '')
  assert.equal(resolveVisuals(DEFAULT_CHART_VISUALS), null)
  assert.equal(hasChartVisuals(DEFAULT_CHART_VISUALS), false)
  assert.equal(barRadius(DEFAULT_CHART_VISUALS), undefined)
  assert.equal(barGapProps(DEFAULT_CHART_VISUALS), undefined)
  assert.equal(gridProps(DEFAULT_CHART_VISUALS), undefined)
})

test('null and undefined are as quiet as an untouched object', () => {
  for (const empty of [null, undefined]) {
    assert.equal(chartVisualVars(empty), undefined)
    assert.equal(chartVisualClass(empty), '')
    assert.equal(barRadius(empty), undefined)
    assert.equal(gridProps(empty), undefined)
  }
})

test('one setting emits one property and one class, not twenty', () => {
  // A class per DECISION. One class for the lot would mean setting only the
  // bar radius also reset every grid colour to a variable nobody defined.
  const vars = chartVisualVars({ barRadius: 8 })
  assert.equal(vars, undefined, 'a radius is a prop, not a property')

  const only = chartVisualVars({ fillOpacity: 60 })
  assert.deepEqual(Object.keys(only), ['--chartv-fill-opacity'])
  assert.deepEqual([...classes({ fillOpacity: 60 })], ['cv-fill'])
})

// --- presets -------------------------------------------------------------

test('every preset only names fields that exist', () => {
  // A preset naming `barRadis` would silently do nothing, and would keep
  // doing nothing for as long as nobody looked.
  const known = new Set(CHART_VISUAL_KEYS)
  for (const p of CHART_VISUAL_PRESETS) {
    if (!p.preset) continue
    for (const key of Object.keys(p.preset)) {
      assert.ok(known.has(key), `${p.value} sets unknown field ${key}`)
    }
  }
})

test('every preset value is one the limits or the lists allow', () => {
  const gridStyles = new Set(GRID_STYLES.map((g) => g.value))
  for (const p of CHART_VISUAL_PRESETS) {
    if (!p.preset) continue
    for (const [key, value] of Object.entries(p.preset)) {
      if (LIMITS[key]) {
        const [lo, hi] = LIMITS[key]
        assert.ok(value >= lo && value <= hi, `${p.value}.${key} = ${value} is outside ${lo}..${hi}`)
      }
      if (key === 'gridStyle') assert.ok(gridStyles.has(value), `${p.value} gridStyle ${value}`)
    }
  }
})

test('every preset actually draws something different', () => {
  for (const p of CHART_VISUAL_PRESETS) {
    if (!p.value) continue
    const applied = { ...DEFAULT_CHART_VISUALS, preset: p.value }
    assert.ok(hasChartVisuals(applied), `${p.value} changes nothing`)
    assert.ok(chartVisualClass(applied).length > 0, `${p.value} switches no rule on`)
  }
})

test('a preset is a starting point, not a cage', () => {
  const soft = { ...DEFAULT_CHART_VISUALS, preset: 'soft' }
  assert.equal(resolveVisuals(soft).barRadius, 10)

  // Square off the corners without losing the rest of it.
  const squared = { ...soft, barRadius: 0 }
  const resolved = resolveVisuals(squared)
  assert.equal(resolved.barRadius, 0)
  assert.equal(resolved.gridStyle, 'dotted', 'everything else the preset said still stands')
  assert.deepEqual(barRadius(squared), undefined, 'zero is no rounding, not "unset"')
})

test('an unknown preset is ignored rather than crashing', () => {
  assert.equal(resolveVisuals({ ...DEFAULT_CHART_VISUALS, preset: 'no-such-look' }), null)
})

// --- clamping ------------------------------------------------------------

test('numbers are clamped on the way OUT, not just on the way in', () => {
  // A value edited by hand, or saved before a limit existed, must not be
  // able to produce a chart that cannot be drawn.
  const wild = chartVisualVars({ fillOpacity: 5000, strokeWidth: -9, tooltipRadius: 999 })
  assert.equal(wild['--chartv-fill-opacity'], '1')
  assert.equal(wild['--chartv-stroke-width'], '0px')
  assert.equal(wild['--chartv-tooltip-radius'], '24px')
})

test('nonsense is dropped rather than emitted as NaN', () => {
  const vars = chartVisualVars({ fillOpacity: 'lots', strokeWidth: null, pointSize: '' })
  assert.equal(vars, undefined)
})

test('zero is a decision, not an absence', () => {
  // The bug this guards: `if (value)` treats 0 as unset, so "no rounding"
  // and "no opinion about rounding" become the same thing and a square bar
  // is impossible to ask for.
  const vars = chartVisualVars({ fillOpacity: 0, separatorWidth: 0 })
  assert.equal(vars['--chartv-fill-opacity'], '0')
  assert.equal(vars['--chartv-separator-width'], '0px')
  assert.ok(classes({ separatorWidth: 0 }).has('cv-sep-width'))
})

// --- the grid ------------------------------------------------------------

test('hiding the grid says so rather than colouring it invisible', () => {
  const props = gridProps({ gridLines: 'none' })
  assert.equal(props.hidden, true)
  assert.ok(classes({ gridLines: 'none' }).has('cv-grid-off'))
})

test('one direction of rules is drawn and the other is not', () => {
  assert.deepEqual(gridProps({ gridLines: 'horizontal' }), { horizontal: true, vertical: false })
  assert.deepEqual(gridProps({ gridLines: 'vertical' }), { horizontal: false, vertical: true })
  assert.deepEqual(gridProps({ gridLines: 'both' }), { horizontal: true, vertical: true })
})

test('a grid style becomes the dash array the chart wants', () => {
  assert.equal(gridProps({ gridStyle: 'dotted' }).strokeDasharray, '1 4')
  assert.equal(gridProps({ gridStyle: 'solid' }).strokeDasharray, '0', 'solid is a dash array of nothing')
  assert.equal(gridProps({ gridStyle: '' }), undefined)
})

// --- bars ----------------------------------------------------------------

test('only the end a bar grows towards is rounded', () => {
  // Rounding all four corners makes a bar look like it is floating off its
  // own axis rather than standing on it.
  assert.deepEqual(barRadius({ barRadius: 6 }), [6, 6, 0, 0])
  assert.deepEqual(barRadius({ barRadius: 6 }, { horizontal: true }), [0, 6, 6, 0])
})

test('a radius of zero is no radius at all', () => {
  assert.equal(barRadius({ barRadius: 0 }), undefined, 'so the chart keeps its own square corners')
})

test('a bar gap is a percentage the chart understands', () => {
  assert.deepEqual(barGapProps({ barGap: 25 }), { barCategoryGap: '25%' })
  assert.deepEqual(barGapProps({ barGap: 0 }), { barCategoryGap: '0%' })
  assert.equal(barGapProps({}), undefined)
})

// --- the setting this was all for ---------------------------------------

test('by default a label on a mark works its own colour out', () => {
  assert.equal(autoFillLabels(null), true)
  assert.equal(autoFillLabels({ fillLabelMode: '' }), true)
  assert.equal(autoFillLabels({ fillLabelMode: 'fixed' }), false)
})

test('automatic ink is readable on both a pale mark and a deep one', () => {
  // The reason the automatic mode is the default: a fixed white is right on
  // an indigo bar and invisible on a pale yellow one, and an admin who
  // picks a palette has not agreed to check the contrast of every colour
  // in it.
  assert.equal(fillLabelColor(null, '#FEF3C7'), '#0F172A', 'dark ink on a pale bar')
  assert.equal(fillLabelColor(null, '#4338CA'), '#FFFFFF', 'light ink on a deep one')
  assert.equal(fillLabelColor(null, '#0000FF'), '#FFFFFF', 'a saturated blue is dark, whatever it looks like')
})

test('a pinned colour emits no per-mark attribute, so the stylesheet wins', () => {
  const pinned = { fillLabelMode: 'fixed', fillLabelColor: '#FF0000' }
  assert.equal(fillLabelColor(pinned, '#FEF3C7'), null)
  assert.equal(chartVisualVars(pinned)['--chartv-fill-text'], '#FF0000')
  assert.ok(classes(pinned).has('cv-fill-text'))
})

test('pinning the mode without a colour still produces a usable one', () => {
  assert.equal(chartVisualVars({ fillLabelMode: 'fixed' })['--chartv-fill-text'], '#FFFFFF')
})

test('automatic mode emits no colour property, because there is no one colour', () => {
  const vars = chartVisualVars({ fillLabelMode: '', fillLabelSize: 12 })
  assert.equal(vars['--chartv-fill-text'], undefined)
  assert.equal(vars['--chartv-fill-text-size'], '12px')
  assert.ok(!classes({ fillLabelSize: 12 }).has('cv-fill-text'))
})

// --- the cascade ---------------------------------------------------------

test('a page and a widget merge field by field, not all or nothing', () => {
  // Unlike a THEME, which is one decision and is kept entire. These are
  // twenty separate ones, and a page that set a grid colour while a widget
  // set a bar radius should end up with both.
  const page = { gridColor: '#FF0000', fillOpacity: 50 }
  const widget = { fillOpacity: 90 }
  const merged = mergeVisuals(page, widget)

  assert.equal(merged.gridColor, '#FF0000', 'the page still has its say')
  assert.equal(merged.fillOpacity, 90, 'where they disagree, the widget wins')
})

test('merging nothing with nothing is nothing', () => {
  assert.equal(mergeVisuals(null, null), null)
  assert.equal(mergeVisuals(DEFAULT_CHART_VISUALS, DEFAULT_CHART_VISUALS), null)
})

test('a merged result can be fed straight back in', () => {
  // It is handed to barRadius() and gridProps(), which resolve again --
  // so resolving an already-resolved object has to be a no-op.
  const merged = mergeVisuals({ preset: 'soft' }, { barRadius: 3 })
  assert.deepEqual(barRadius(merged), [3, 3, 0, 0])
  assert.equal(gridProps(merged).strokeDasharray, '1 4', 'the preset survived the round trip')
})

test('a widget with nothing set inherits the page entirely', () => {
  const merged = mergeVisuals({ preset: 'bold' }, DEFAULT_CHART_VISUALS)
  assert.equal(merged.strokeWidth, 4)
})

// --- clearing ------------------------------------------------------------

test('clearing hands every field back without disturbing its neighbours', () => {
  const cleared = clearChartVisuals({ preset: 'bold', fillOpacity: 30, somethingElse: 'kept' })
  assert.equal(hasChartVisuals(cleared), false)
  assert.equal(cleared.somethingElse, 'kept')
})

// --- tooltips ------------------------------------------------------------

test('any one tooltip decision switches the tooltip rule on', () => {
  // The surface, the border and the radius are one visual object, so they
  // share a class -- a border colour with no rule to hang it on would do
  // nothing at all.
  for (const key of ['tooltipBg', 'tooltipText', 'tooltipBorder']) {
    assert.ok(classes({ [key]: '#123456' }).has('cv-tooltip'), key)
  }
  assert.ok(classes({ tooltipRadius: 4 }).has('cv-tooltip'))
  assert.ok(classes({ tooltipSize: 14 }).has('cv-tooltip-size'))
  assert.ok(classes({ cursorColor: '#eee' }).has('cv-cursor'))
})

test('the on-dark preset changes the tooltip as well as the marks', () => {
  // The point of that preset: a chart on a dark card needs its tooltip
  // dark too, and a preset that restyles only the bars leaves a white box
  // floating over them.
  const vars = chartVisualVars({ ...DEFAULT_CHART_VISUALS, preset: 'onDark' })
  assert.equal(vars['--chartv-tooltip-bg'], '#0F172A')
  assert.equal(vars['--chartv-tooltip-text'], '#E2E8F0')
  assert.ok(classes({ ...DEFAULT_CHART_VISUALS, preset: 'onDark' }).has('cv-tooltip'))
})

// ---------------------------------------------------------------------
// The rules, and the wiring
// ---------------------------------------------------------------------
// The same shape of guard lib/typography.test.js already uses. A property
// with no rule to read it, or a rule with no class to switch it on, is a
// control that saves its value and does nothing -- which is exactly the bug
// that whole module exists to have fixed once.

import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const css = read('index.css')

test('every class the module emits has a rule that reads it', () => {
  // Everything reachable, gathered by actually asking the module rather
  // than by keeping a second list here that would drift.
  const emitted = new Set()
  const probes = [
    { fillOpacity: 50 }, { strokeWidth: 3 }, { pointSize: 4 },
    { gridColor: '#fff' }, { gridStyle: 'dotted' },
    { gridLines: 'none' }, { gridLines: 'horizontal' }, { gridLines: 'vertical' },
    { axisColor: '#fff' }, { axisLines: false }, { tickMarks: false },
    { fillLabelMode: 'fixed', fillLabelColor: '#fff' },
    { fillLabelSize: 12 }, { fillLabelWeight: 700 },
    { separatorColor: '#fff' }, { separatorWidth: 2 },
    { tooltipBg: '#fff' }, { tooltipSize: 12 }, { cursorColor: '#fff' },
  ]
  for (const p of probes) chartVisualClass(p).split(' ').filter(Boolean).forEach((c) => emitted.add(c))

  assert.ok(emitted.size >= 15, `only ${emitted.size} classes exercised`)
  for (const cls of emitted) {
    assert.ok(css.includes(`.${cls} `), `.${cls} is emitted but no rule reads it`)
  }
})

test('every property a rule reads is one the module can emit', () => {
  // The other direction: a rule reading `--chartv-typo` would be dead code
  // that looks like a working feature.
  const used = new Set(css.match(/--chartv-[a-z-]+/g) || [])
  assert.ok(used.size >= 12, `only ${used.size} properties found in the CSS`)

  const emitted = new Set()
  for (const p of [
    { fillOpacity: 50, strokeWidth: 3, pointSize: 4, gridColor: '#fff', gridStyle: 'dotted' },
    { axisColor: '#fff', separatorColor: '#fff', separatorWidth: 2 },
    { fillLabelMode: 'fixed', fillLabelColor: '#fff', fillLabelSize: 12, fillLabelWeight: 700 },
    { tooltipBg: '#a', tooltipText: '#b', tooltipBorder: '#c', tooltipRadius: 4, tooltipSize: 12, cursorColor: '#d' },
  ]) {
    Object.keys(chartVisualVars(p) || {}).forEach((k) => emitted.add(k))
  }

  for (const prop of used) {
    assert.ok(emitted.has(prop), `${prop} is read by a rule but nothing emits it`)
  }
})

test('the fill-label rules carry !important, because they beat an attribute', () => {
  // The colour being overridden is an inline `fill` the chart wrote per
  // element. An inline style beats any selector however specific, so there
  // is no winning this one on specificity.
  const rule = css.match(/\.cv-fill-text :where\(\.label-on-fill\)\s*\{[^}]*\}/)
  assert.ok(rule, 'the fixed-colour rule is missing')
  assert.ok(rule[0].includes('!important'))
})

test('the hover band is excluded from the mark rules', () => {
  // Recharts builds the tooltip cursor from the same Rectangle the bars
  // are, so it carries `recharts-rectangle` too -- and without the
  // exclusion, turning a chart's fill down faded the highlight with it.
  for (const cls of ['cv-fill', 'cv-sep-color', 'cv-sep-width']) {
    // Read to the opening brace rather than pattern-matching the selector:
    // the very thing being checked for is a nested paren, which is exactly
    // what makes a regex for this fiddly enough to get wrong.
    const at = css.indexOf(`.${cls} :where(`)
    assert.ok(at >= 0, `${cls} rule is missing`)
    const selector = css.slice(at, css.indexOf('{', at))
    assert.ok(
      selector.includes('.recharts-rectangle:not(.recharts-tooltip-cursor)'),
      `${cls} would repaint the hover band`
    )
  }
})

test('a pie’s labels are reachable at all', () => {
  // The bug this feature was asked for: the pie label is drawn by a custom
  // renderer, so it arrived with no class and no rule could see it. Every
  // other piece of chart text obeyed the admin's colour and the pie's did
  // not.
  const pie = read('components/widgets/PiePanel.jsx')
  assert.ok(pie.includes('className="recharts-pie-label-text"'))
  assert.ok(css.includes('.recharts-pie-label-text'), 'and a rule aims at that name')
})

test('the labels drawn on a mark say so, so they can be coloured', () => {
  const chart = read('components/widgets/ChartWidget.jsx')
  // Every text that sits on a fill: nested circles, both treemap lines,
  // the radial bar and the funnel.
  assert.ok(chart.match(/label-on-fill/g).length >= 5, 'some on-mark text is still unreachable')
})

test('the drawing settings are offered wherever the text settings are', () => {
  const editor = read('pages/admin/StyleEditor.jsx')
  const designPanel = read('components/PageDesignPanel.jsx')
  assert.ok(editor.includes('value={style.chartVisuals}'))
  assert.ok(designPanel.includes('value={d.chartVisuals}'))
})

test('the settings CSS cannot reach are actually threaded to the charts', () => {
  // A corner radius and a bar gap arrive as props. If Dashboard stopped
  // passing them, every other setting would keep working and these two
  // would silently do nothing -- the hardest kind of bug to notice.
  const dash = read('pages/Dashboard.jsx')
  assert.ok(dash.includes('mergeVisuals(design.chartVisuals'), 'page and widget are merged')
  assert.ok(dash.includes('chartVisuals,'), 'and handed to the widgets')

  for (const file of [
    'components/widgets/ChartWidget.jsx',
    'components/widgets/ComparisonWidgets.jsx',
    'components/widgets/AnalyticsWidgets.jsx',
  ]) {
    assert.ok(read(file).includes('chartVisuals'), `${file} never reads them`)
  }
})

test('the preview is drawn by the same functions as the page', () => {
  // If the preview had its own idea of what a setting looks like, it would
  // be a picture of a chart that does not exist.
  const fields = read('components/ChartVisualFields.jsx')
  for (const fn of ['chartVisualClass', 'chartVisualVars', 'barRadius', 'barGapProps', 'gridProps', 'fillLabelColor']) {
    assert.ok(fields.includes(fn), `the preview does not use ${fn}`)
  }
})
