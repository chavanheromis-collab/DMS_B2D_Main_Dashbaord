import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_STAGE_WIDTH,
  MAX_DEPTH,
  MAX_STAGE_HEIGHT,
  MAX_STAGE_WIDTH,
  MIN_STAGE_WIDTH,
  ascend,
  descend,
  hasSubStages,
  livePath,
  opensSubStages,
  stageBox,
  stageNumberClass,
  stagePath,
  KPI_SCOPES,
  followsStage,
  kpiDrill,
  kpiSummary,
  kpiTab,
  stagePercent,
  stageSummary,
  stagesAt,
  subStages,
} from './pipelineNav.js'
import { chainDrill, getStageRows } from './pipelineStageData.js'

const TAB = 'src_a1::MASTER'

const cond = (column, value, operator = 'equals') => ({ tab: TAB, column, operator, value })

const STAGES = [
  {
    id: 'enq',
    label: 'Enquiry',
    tab: TAB,
    match: 'all',
    conditions: [cond('Stage', 'Enquiry')],
  },
  {
    id: 'booked',
    label: 'Booked',
    tab: TAB,
    match: 'all',
    conditions: [cond('Stage', 'Booked')],
    stages: [
      { id: 'fin', label: 'Finance', tab: TAB, match: 'all', conditions: [cond('Finance', 'Yes')] },
      {
        id: 'rto',
        label: 'RTO',
        tab: TAB,
        match: 'all',
        conditions: [cond('RTO', 'Done')],
        stages: [{ id: 'hsrp', label: 'HSRP', tab: TAB, match: 'all', conditions: [cond('HSRP', 'Yes')] }],
      },
    ],
  },
]

// ---------------------------------------------------------------------
// Where you are
// ---------------------------------------------------------------------

test('a stage can own stages, and most do not', () => {
  assert.equal(hasSubStages(STAGES[0]), false)
  assert.equal(hasSubStages(STAGES[1]), true)
  assert.deepEqual(subStages(STAGES[1]).map((s) => s.id), ['fin', 'rto'])
  assert.deepEqual(subStages(undefined), [], 'and asking about nothing is not a crash')
})

test('an empty path is the top level', () => {
  assert.deepEqual(stagesAt(STAGES, []).map((s) => s.id), ['enq', 'booked'])
  assert.deepEqual(stagePath(STAGES, []), [])
})

test('a path names the stages leading to a level', () => {
  assert.deepEqual(stagePath(STAGES, ['booked']).map((s) => s.id), ['booked'])
  assert.deepEqual(stagesAt(STAGES, ['booked']).map((s) => s.id), ['fin', 'rto'])
  assert.deepEqual(stagesAt(STAGES, ['booked', 'rto']).map((s) => s.id), ['hsrp'])
})

test('a stale id puts the reader back at the last real level', () => {
  // An admin deletes a stage while somebody has it open, or a saved page
  // names one that no longer exists. Resolving stops where it can, rather
  // than showing an empty card.
  assert.deepEqual(stagePath(STAGES, ['booked', 'gone', 'rto']).map((s) => s.id), ['booked'])
  assert.deepEqual(stagesAt(STAGES, ['booked', 'gone']).map((s) => s.id), ['fin', 'rto'])
  assert.deepEqual(livePath(STAGES, ['booked', 'gone', 'rto']), ['booked'], 'and the path is trimmed to match')
  assert.deepEqual(livePath(STAGES, ['nope']), [])
})

test('descending only works where there is something to descend into', () => {
  assert.deepEqual(descend(STAGES, [], 'booked'), ['booked'])
  assert.deepEqual(descend(STAGES, [], 'enq'), [], 'a leaf stays put')
  assert.deepEqual(descend(STAGES, [], 'nonsense'), [])
  assert.deepEqual(descend(STAGES, ['booked'], 'rto'), ['booked', 'rto'])
  assert.deepEqual(descend(STAGES, ['booked'], 'enq'), ['booked'], 'and only into stages at THIS level')
})

test('the nesting has a floor', () => {
  // The last stage has children of its own, so the ONLY thing stopping the
  // descent is the cap -- otherwise this passes for the wrong reason.
  const deep = Array.from({ length: MAX_DEPTH }, (_, i) => `d${i}`)
  const tree = deep.reduceRight((child, id) => [{ id, stages: child }], [
    { id: 'last', stages: [{ id: 'deeper' }] },
  ])

  assert.deepEqual(stagesAt(tree, deep).map((s) => s.id), ['last'], 'it IS reachable and it DOES have children')
  assert.equal(descend(tree, deep, 'last').length, deep.length, 'and past the cap, nothing happens')
  assert.deepEqual(descend(tree, deep.slice(0, -1), deep[deep.length - 1]), deep, 'one shy of it still works')
})

test('climbing back: -1 is the top, 0 the first crumb', () => {
  assert.deepEqual(ascend(['booked', 'rto'], -1), [])
  assert.deepEqual(ascend(['booked', 'rto'], 0), ['booked'])
  assert.deepEqual(ascend(['booked', 'rto'], 1), ['booked', 'rto'])
})

test('sub-stages win the click', () => {
  // A stage with both is asking two things of one click, and the pop-up is
  // the smaller answer -- the breadcrumb still offers the level as a filter.
  assert.equal(opensSubStages(STAGES[1]), true)
  assert.equal(opensSubStages({ ...STAGES[0], kpis: [{ id: 'k' }] }), false)
})

// ---------------------------------------------------------------------
// How big a box is
// ---------------------------------------------------------------------

test('unset is the size it has always been', () => {
  assert.deepEqual(stageBox({}), { width: DEFAULT_STAGE_WIDTH, height: 0 })
  assert.deepEqual(stageBox(undefined), { width: DEFAULT_STAGE_WIDTH, height: 0 })
  assert.equal(stageBox({ stageWidth: 0 }).width, DEFAULT_STAGE_WIDTH)
})

test('a number typed into a box cannot make a page nobody can read', () => {
  assert.equal(stageBox({ stageWidth: 5 }).width, MIN_STAGE_WIDTH)
  assert.equal(stageBox({ stageWidth: 99999 }).width, MAX_STAGE_WIDTH)
  assert.equal(stageBox({ stageHeight: 99999 }).height, MAX_STAGE_HEIGHT)
  assert.equal(stageBox({ stageWidth: 'wide' }).width, DEFAULT_STAGE_WIDTH)
  assert.equal(stageBox({ stageWidth: -40 }).width, DEFAULT_STAGE_WIDTH)
  assert.equal(stageBox({ stageWidth: 200.4 }).width, 200, 'and half a pixel is not a size')
})

test('a narrow box steps the number down rather than clipping it', () => {
  // And the DEFAULT width keeps the size it has always had: making every
  // untouched pipeline in the workspace shrink would be a redesign nobody
  // asked for.
  assert.equal(stageNumberClass(DEFAULT_STAGE_WIDTH), 'text-2xl')
  assert.equal(stageNumberClass(300), 'text-2xl')
  assert.equal(stageNumberClass(120), 'text-xl')
  assert.equal(stageNumberClass(90), 'text-lg')
})

test('one percentage rule, so a stage reads the same on both sides of a click', () => {
  // A parent that says 40% in the row and 100% once you are inside it would
  // be telling the reader the descent had done something to the data.
  assert.equal(stagePercent(25, { base: 100, total: 50 }), 25, 'a funnel measures against the first stage')
  assert.equal(stagePercent(25, { base: null, total: 50 }), 50, 'null means measure against its own rows')
  assert.equal(stagePercent(25, { base: undefined, total: 50 }), 50)
  assert.equal(stagePercent(3, { base: 0, total: 0 }), 0, 'and nothing is not a division by zero')
  assert.equal(
    stagePercent(5, { base: 0, total: 50 }),
    0,
    'a funnel whose first stage is empty has no percentage -- it does not quietly switch to the other rule'
  )
  assert.equal(stagePercent(1, { base: 3, total: 9 }), 33, 'rounded, not truncated')
  assert.equal(stagePercent(2, { base: 3, total: 9 }), 67)
})

// ---------------------------------------------------------------------
// What a closed stage says about itself
// ---------------------------------------------------------------------

test('enough to find the one you came for, and no more', () => {
  assert.equal(stageSummary({ conditions: [{ column: 'Stage' }], kpis: [1, 2] }), '1 rule · 2 KPIs')
  assert.equal(stageSummary({ conditions: [{ column: 'a' }, { column: 'b' }] }), '2 rules')
})

test('no conditions is "every row", not "0 rules"', () => {
  // A stage with no conditions counts its ENTIRE tab. That looks like a
  // half-finished stage and reads like a bug, so it says what it does.
  assert.equal(stageSummary({ conditions: [] }), 'every row')
  assert.equal(stageSummary({ conditions: [{ column: '' }] }), 'every row', 'and a blank condition is no condition')
  assert.equal(stageSummary(undefined), 'every row')
})

test('KPIs go unmentioned once a stage has stages inside it', () => {
  // The pop-up they belong to never opens; counting them would advertise
  // something that cannot happen.
  const parent = { conditions: [{ column: 'a' }], kpis: [1, 2, 3], stages: [{ id: 'x' }, { id: 'y' }] }
  assert.equal(stageSummary(parent), '1 rule · 2 inside')
})

test('one of a thing is not "1 rules"', () => {
  assert.equal(stageSummary({ conditions: [{ column: 'a' }], kpis: [1] }), '1 rule · 1 KPI')
})

test('a collapsed KPI says what it measures, and of what', () => {
  const aggs = [
    { value: 'count', label: 'Count of rows' },
    { value: 'sum', label: 'Sum (numeric)' },
  ]
  assert.equal(kpiSummary({ aggregation: 'sum', column: 'Amount' }, aggs), 'Sum (numeric) · Amount · whole stage')
  assert.equal(kpiSummary({ aggregation: 'count' }, aggs), 'Count of rows · whole stage')
  assert.equal(
    kpiSummary({ aggregation: 'count', conditions: [{ column: 'Stage' }, { column: '' }] }, aggs),
    'Count of rows · 1 rule',
    'a blank condition narrows nothing'
  )
})

test('a KPI follows the stage unless it is told not to', () => {
  // Absent means "stage", so nothing written before the setting existed
  // changes what it measures.
  assert.equal(followsStage({}), true)
  assert.equal(followsStage(undefined), true)
  assert.equal(followsStage({ scope: 'stage' }), true)
  assert.equal(followsStage({ scope: 'own' }), false)
  assert.deepEqual(KPI_SCOPES.map((s) => s.value), ['stage', 'own'])
})

test('a stage-scoped KPI reads the stage’s tab, whatever it says otherwise', () => {
  // It is narrowing rows the stage already matched, and rows from another
  // sheet are not those rows.
  const stage = { tab: 's1::MASTER' }
  assert.equal(kpiTab({ tab: 's2::OTHER' }, stage), 's1::MASTER')
  assert.equal(kpiTab({ scope: 'own', tab: 's2::OTHER' }, stage), 's2::OTHER')
  assert.equal(kpiTab({ scope: 'own' }, stage), 's1::MASTER', 'and falls back to the stage’s')
})

test('an independent KPI drills by itself, not by the stage', () => {
  // It is not describing the stage, so filtering by the stage as well would
  // contradict the number that was clicked.
  const stage = { tab: 's1::MASTER' }
  const own = kpiDrill({ scope: 'own', tab: 's2::TARGETS', conditions: [{ column: 'Year', operator: 'equals', value: '2026' }] }, stage)
  assert.equal(own.withinStage, false)
  assert.equal(own.tab, 's2::TARGETS')
  assert.deepEqual(own.conditions, [{ column: 'Year', operator: 'equals', value: '2026', tab: 's2::TARGETS' }])

  const inside = kpiDrill({ conditions: [{ column: 'Finance', operator: 'equals', value: 'Yes' }] }, stage)
  assert.equal(inside.withinStage, true)
  assert.equal(inside.tab, 's1::MASTER')
})

test('a KPI condition that named no tab inherits the one it is written against', () => {
  // Or the cross-filter engine drops it and the drill filters nothing.
  const out = kpiDrill({ scope: 'own', tab: 's2::X', conditions: [{ column: 'a' }, { column: '' }] }, { tab: 's1::M' })
  assert.deepEqual(out.conditions, [{ column: 'a', tab: 's2::X' }])
})

test('a KPI with no conditions measures the WHOLE stage, and says so', () => {
  // Which is what the field below it has always promised. "0 rules" would
  // read as unfinished rather than as the default it is.
  assert.ok(kpiSummary({}, []).endsWith('whole stage'))
  assert.ok(!kpiSummary({}, []).includes('0'))
})

test('an independent KPI says so, so its number is not read as the stage’s', () => {
  const aggs = [{ value: 'count', label: 'Count of rows' }]
  assert.equal(kpiSummary({ scope: 'own', aggregation: 'count' }, aggs), 'Count of rows · own rows')
  assert.equal(
    kpiSummary({ scope: 'own', aggregation: 'count', conditions: [{ column: 'Year' }] }, aggs),
    'Count of rows · own rows · 1 rule'
  )
  assert.ok(!kpiSummary({ scope: 'own' }, aggs).includes('whole stage'), 'and never claims the stage')
})

test('an aggregation with no label falls back to its own name', () => {
  // The list is passed in, so it can be missing or stale; a summary reading
  // "undefined · Amount" would be worse than a raw key.
  assert.equal(kpiSummary({ aggregation: 'p90', column: 'Days' }, []), 'p90 · Days · whole stage')
  assert.equal(kpiSummary(undefined, []), 'count · whole stage')
})

// ---------------------------------------------------------------------
// A sub-stage divides its parent's rows
// ---------------------------------------------------------------------

const ROWS = [
  { _row: 2, Stage: 'Booked', Finance: 'Yes', RTO: 'Done' },
  { _row: 3, Stage: 'Booked', Finance: 'No', RTO: 'Done' },
  { _row: 4, Stage: 'Booked', Finance: 'Yes', RTO: '' },
  { _row: 5, Stage: 'Enquiry', Finance: 'Yes', RTO: 'Done' },
]
const byTab = { [TAB]: ROWS }

test('a sub-stage counts only rows already inside its parent', () => {
  // Otherwise "Finance done" under "Booked" counts the enquiry that is
  // financed too, and the four sub-stages do not add up to the number that
  // was clicked to reach them.
  const booked = STAGES[1]
  const finance = subStages(booked)[0]

  const alone = getStageRows({ stage: finance, widget: {}, rowsByTab: byTab })
  const inside = getStageRows({ stage: finance, ancestors: [booked], widget: {}, rowsByTab: byTab })

  assert.equal(alone.count, 3, 'on its own it sees every financed row')
  assert.equal(inside.count, 2, 'inside Booked it sees only the booked ones')
  assert.deepEqual(inside.matchedRows.map((r) => r._row), [2, 4])
})

test('the denominator follows, so a percentage is of the level you are on', () => {
  const booked = STAGES[1]
  const finance = subStages(booked)[0]
  const out = getStageRows({ stage: finance, ancestors: [booked], widget: {}, rowsByTab: byTab })
  assert.equal(out.total, 3, "Booked's rows, not the whole tab's four")
  assert.equal(getStageRows({ stage: booked, widget: {}, rowsByTab: byTab }).total, 4, 'and at the top it is the tab')
})

test('two levels down, both parents narrow', () => {
  const booked = STAGES[1]
  const rto = subStages(booked)[1]
  const hsrp = subStages(rto)[0]
  const rows = [
    { _row: 2, Stage: 'Booked', RTO: 'Done', HSRP: 'Yes' },
    { _row: 3, Stage: 'Enquiry', RTO: 'Done', HSRP: 'Yes' },
    { _row: 4, Stage: 'Booked', RTO: '', HSRP: 'Yes' },
  ]
  const out = getStageRows({ stage: hsrp, ancestors: [booked, rto], widget: {}, rowsByTab: { [TAB]: rows } })
  assert.deepEqual(out.matchedRows.map((r) => r._row), [2])
})

test('no ancestors is exactly what it always was', () => {
  const before = getStageRows({ stage: STAGES[0], widget: {}, rowsByTab: byTab })
  const after = getStageRows({ stage: STAGES[0], ancestors: [], widget: {}, rowsByTab: byTab })
  assert.deepEqual(before, after)
  assert.equal(before.count, 1)
})

// ---------------------------------------------------------------------
// A chain, as a filter
// ---------------------------------------------------------------------

test('a chain of one is a lone stage, unchanged', () => {
  const out = chainDrill([STAGES[0]])
  assert.deepEqual(out.conditions, [cond('Stage', 'Enquiry')])
  assert.equal(out.match, 'all')
  assert.equal(out.tab, TAB)
  assert.deepEqual(out.stacked, [])
  assert.equal(out.label, 'Enquiry')
})

test('a chain of ANDs collapses into one filter', () => {
  const booked = STAGES[1]
  const out = chainDrill([booked, subStages(booked)[0]])
  assert.deepEqual(out.conditions, [cond('Stage', 'Booked'), cond('Finance', 'Yes')])
  assert.deepEqual(out.stacked, [], 'one chip, one thing to clear')
  assert.equal(out.label, 'Booked · Finance')
})

test('an OR in the chain cannot be flattened, so it stacks', () => {
  // "(booked or delivered) and financed" is not one flat condition list, and
  // flattening it anyway would widen the filter to rows the stage never
  // counted.
  const parent = {
    id: 'p',
    label: 'Open',
    tab: TAB,
    match: 'any',
    conditions: [cond('Stage', 'Booked'), cond('Stage', 'Delivered')],
  }
  const child = { id: 'c', label: 'Financed', tab: TAB, match: 'all', conditions: [cond('Finance', 'Yes')] }
  const out = chainDrill([parent, child])

  assert.deepEqual(out.conditions, [cond('Finance', 'Yes')])
  assert.equal(out.match, 'all')
  assert.equal(out.stacked.length, 1)
  assert.equal(out.stacked[0].stage.id, 'p')
  assert.equal(out.stacked[0].match, 'any')
})

test('and nothing folds INTO an OR either', () => {
  const parent = { id: 'p', label: 'Booked', tab: TAB, match: 'all', conditions: [cond('Stage', 'Booked')] }
  const child = {
    id: 'c',
    label: 'Stuck',
    tab: TAB,
    match: 'any',
    conditions: [cond('RTO', ''), cond('HSRP', '')],
  }
  const out = chainDrill([parent, child])
  assert.equal(out.match, 'any')
  assert.deepEqual(out.conditions, child.conditions)
  assert.deepEqual(out.stacked.map((x) => x.stage.id), ['p'], 'the AND parent travels separately')
})

test('a chain link with no conditions adds nothing', () => {
  const parent = { id: 'p', label: 'Everything', tab: TAB, match: 'all', conditions: [] }
  const out = chainDrill([parent, STAGES[0]])
  assert.deepEqual(out.conditions, [cond('Stage', 'Enquiry')])
  assert.deepEqual(out.stacked, [])
})

test('a condition that never named its tab still inherits one down a chain', () => {
  const parent = { id: 'p', label: 'Booked', tab: TAB, match: 'all', conditions: [{ column: 'Stage', operator: 'equals', value: 'Booked' }] }
  const child = { id: 'c', label: 'Fin', tab: TAB, match: 'all', conditions: [{ column: 'Finance', operator: 'equals', value: 'Yes' }] }
  const out = chainDrill([parent, child])
  assert.equal(out.conditions.length, 2)
  assert.ok(out.conditions.every((c) => c.tab === TAB), 'or the engine drops it and the drill filters nothing')
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

const widget = read('src/components/widgets/PipelineWidget.jsx')
const editor = read('src/pages/admin/WidgetEditors.jsx')

test('clicking a stage with sub-stages opens them instead of drilling', () => {
  assert.ok(widget.includes('if (hasSubStages(stage)) {'))
  const at = widget.indexOf('if (hasSubStages(stage)) {')
  const body = widget.slice(at, at + 160)
  assert.ok(body.includes('setOpenPath(descend(stages, path, stage.id))'))
  assert.ok(body.indexOf('return') < body.indexOf('const hasKpis'), 'and the old path is not also taken')
})

test('the level on screen is the level that is counted', () => {
  // `stages` is the whole tree; drawing or measuring it while descended
  // would put the top level's boxes under the sub-level's breadcrumb.
  assert.ok(widget.includes('return level.map((stage) => {'))
  assert.ok(widget.includes('const openStage = level.find((s) => s.id === openStageId)'))
  assert.equal(
    (widget.match(/ancestors: chain,/g) || []).length,
    2,
    'the boxes AND the pop-up behind them are both scoped to the chain'
  )
})

test('the stage you opened stays on the row, in front of its parts', () => {
  // A whole you cannot see is a sum with nothing to check it against.
  assert.ok(widget.includes('const parentInfo = useMemo('))
  assert.ok(widget.includes('{renderStage({ ...parentInfo, isParent: true })}'))
  const at = widget.indexOf('{parentInfo && (')
  const subs = widget.indexOf('{computed.map(')
  assert.ok(at > 0 && at < subs, 'and it is drawn BEFORE them')
})

test('the parent is the same box it was a click ago, not a second design of one', () => {
  assert.equal((widget.match(/function renderStage\(/g) || []).length, 1, 'one renderer')
  assert.ok(widget.includes('{renderStage({ ...parentInfo, isParent: true })}'), 'the parent goes through it')
  assert.ok(
    widget.includes('{renderStage({ stage, count, trend, pct: stagePercent(count, { base, total }) })}'),
    'and so does every stage of the level'
  )
  assert.ok(!widget.includes('min-w-[132px]'))
  assert.equal(
    (widget.match(/className=\{`group relative flex shrink-0 flex-col/g) || []).length,
    1,
    'and there is exactly one box in the file, not two that must be kept in step'
  )
})

test('the parent is measured at its OWN level, siblings and all', () => {
  const at = widget.indexOf('const parentInfo = useMemo(')
  const body = widget.slice(at, at + 1200)
  assert.ok(body.includes('const ancestors = chain.slice(0, -1)'))
  assert.ok(body.includes('const siblings = stagesAt(stages, path.slice(0, -1))'))
  assert.ok(body.includes('rowsOf(siblings[0]).count'), 'the funnel base is its own level’s first stage')
  assert.ok(body.includes('stagePercent(own.count,'), 'through the same rule the row uses')
  assert.equal((widget.match(/stagePercent\(/g) || []).length, 2, 'and nobody writes the formula out by hand')
})

test('the parent filters, because it cannot open what is already open', () => {
  assert.ok(widget.includes('onClick={(e) => (isParent ? drill(stage, chain.slice(0, -1)) : handleClick(stage, e))}'))
})

test('and the trail does not offer a second button for the same thing', () => {
  const at = widget.indexOf('All stages')
  const crumbs = widget.slice(at, at + 900)
  assert.ok(!crumbs.includes('Filtering'), 'the parent box IS the filter control now')
})

test('the share sits in the corner, apart from the count', () => {
  const at = widget.indexOf('{pct}%')
  assert.ok(at > 0)
  const around = widget.slice(at - 300, at)
  assert.ok(around.includes('justify-between'), 'pushed to the far side of the top row')
  assert.ok(around.includes('rounded-full'), 'as a chip, not as part of the number')
  assert.ok(
    widget.indexOf('{pct}%') < widget.indexOf("{count.toLocaleString('en-IN')}"),
    'and above the count, not beside it'
  )
})

test('a stage box is not numbered', () => {
  // The step number was a second ordinal in a row that is already ordered
  // left to right, and it cost the icon its corner.
  assert.ok(!widget.includes("String(index + 1).padStart(2, '0')"))
  assert.ok(!/renderStage\(\{[^}]*index/.test(widget), 'and nothing is passed a position any more')
  const body = widget.slice(widget.indexOf('<span className="absolute left-0 top-0'), widget.indexOf('</button>'))
  assert.ok(!body.includes('tabular-nums opacity-30'))
})

test('a box says "inside" once, not twice', () => {
  // A count chip in the corner and the arrow along the bottom were the same
  // thing in the same box. The tooltip may still say it -- that is not on
  // screen next to itself.
  const body = widget.slice(widget.indexOf('<span className="absolute left-0 top-0'), widget.indexOf('</button>'))
  assert.equal((body.match(/\{children\}/g) || []).length, 1, 'one visible marker in the box')
  assert.ok(body.includes('{children} inside'), 'and it is the arrow line')
  assert.ok(!widget.includes('<Layers'), 'the duplicate chip is gone')
  assert.ok(!/^import \{[^}]*Layers/m.test(widget), 'and so is its import')
})

test('the box is sized by the admin, not by a hard-coded class', () => {
  assert.ok(!widget.includes('min-w-[132px]'), 'the old fixed width is gone')
  assert.ok(widget.includes('const box = stageBox(widget)'))
  assert.ok(widget.includes('width: box.width,'))
  assert.ok(widget.includes('...(box.height ? { height: box.height } : {}),'))
  assert.ok(widget.includes('stageNumberClass(box.width)'))
})

test('the editor asks for both dimensions', () => {
  assert.ok(editor.includes('set({ stageWidth: Number(v) || null })'))
  assert.ok(editor.includes('set({ stageHeight: Number(v) || null })'))
})

test('the sub-stage form is the SAME form, not a second one', () => {
  // Two forms mean two things to keep in step, and the nested one always
  // ends up missing whatever the other one gained.
  assert.ok(editor.includes('function StageList('))
  const at = editor.indexOf('function StageList(')
  const body = editor.slice(at, at + 6000)
  assert.ok(body.includes('<StageList'), 'it renders itself')
  assert.ok(body.includes('depth={depth + 1}'))
  assert.ok(body.includes('{depth < MAX_DEPTH ? ('), 'and the Add button stops at the cap')
})

test('a sub-stage is pinned to the tab whose rows it divides', () => {
  const at = editor.indexOf('function StageList(')
  const body = editor.slice(at, at + 6000)
  assert.ok(body.includes('tabs={depth > 0 ? tabs.filter((t) => optValue(t) === parentTab) : tabs}'))
  assert.ok(body.includes('parentTab={stage.tab}'))
})

test('the pop-up is three things, so it is three buttons', () => {
  // Stacked, the KPIs, the pivot and the leaderboard were two hundred lines
  // under one stage -- and a stage is already one of six.
  const at = editor.indexOf('export function StageKpiEditor(')
  const body = editor.slice(at, at + 3000)
  assert.ok(body.includes("{ key: 'kpis', label: 'KPIs', badge: kpis.length }"))
  assert.ok(body.includes("{ key: 'pivot', label: 'Pivot'"))
  assert.ok(body.includes("{ key: 'board', label: 'Leaderboard'"))
  assert.ok(body.includes('<SectionTabs sections={sections} active={part} onPick={setPart} />'))
  for (const key of ['kpis', 'pivot', 'board']) {
    assert.ok(editor.includes(`here === '${key}'`), `${key} has a panel`)
  }
})

test('a pivot is configured or it is not -- there is no count to print', () => {
  const at = editor.indexOf('export function StageKpiEditor(')
  const body = editor.slice(at, at + 3000)
  assert.ok(body.includes('badge: Boolean(pivotConfig.rowColumn && pivotConfig.colColumn)'))
  assert.ok(body.includes('badge: Boolean(leaderboardConfig.groupBy)'))
})

test('the KPIs are an accordion too, one at a time', () => {
  const at = editor.indexOf('export function StageKpiEditor(')
  const body = editor.slice(at, at + 6000)
  assert.ok(body.includes('const [openKpi, setOpenKpi] = useState(null)'))
  assert.ok(body.includes('setOpenKpi(open ? null : kpi.id)'))
  assert.ok(body.includes('{kpiSummary(kpi, AGGREGATIONS)}'), 'and a closed one says what it measures')
  assert.ok(body.includes('setOpenKpi(fresh.id)'), 'a new KPI opens')
  assert.ok(
    body.includes('{open && ( <div className="space-y-1.5 border-t border-slate-100 p-2">'),
    'and a closed one renders no form at all -- the whole point of collapsing it'
  )
})

test('the pop-up no longer collapses itself behind its own toggle', () => {
  // It is already behind the stage's Pop-up button; a second disclosure was
  // a click that revealed nothing new.
  assert.ok(!editor.includes('Pop-up KPIs ('))
  assert.ok(!editor.includes('defaultOpen'))
})

test('the pop-up can read rows the stage did not match', () => {
  const popup = read('src/components/StageKpiPopup.jsx')
  assert.ok(popup.includes('const own = !followsStage(kpi) && rowsFor'))
  assert.ok(popup.includes('const from = own ? rowsFor(kpiTab(kpi, stage)) || [] : baseRows'))
  assert.ok(popup.includes('of: from.length,'), 'and works out what it is out of')
  assert.ok(
    popup.includes("of {kpi.of.toLocaleString('en-IN')}"),
    'and prints THAT, not the stage’s total, which the number is not over'
  )
  assert.ok(popup.includes("{kpi.independent ? ' · own rows' : ' rows'}"), 'and says which')
})

test('the widget hands over every tab’s rows, honouring its own filter setting', () => {
  assert.ok(widget.includes('const rowsFor = useCallback('))
  assert.ok(widget.includes('(tab) => (widget.ignoreFilters ? rawRowsByTab : rowsByTab)?.[tab] || []'))
  assert.ok(widget.includes('rowsFor={rowsFor}'))
})

test('an independent KPI’s drill carries no stage', () => {
  const at = widget.indexOf('function drillKpi(')
  const body = widget.slice(at, at + 700)
  assert.ok(body.includes('const { tab, match, conditions, withinStage } = kpiDrill(kpi, stage)'))
  assert.ok(body.includes('if (!withinStage) {'))
  assert.ok(body.indexOf('return') < body.indexOf('narrowWithinStage'), 'it returns before the stage is added')
})

test('the editor offers the choice, and the tab that comes with it', () => {
  const at = editor.indexOf('export function StageKpiEditor(')
  const body = editor.slice(at, at + 6000)
  assert.ok(body.includes('options={KPI_SCOPES}'))
  assert.ok(body.includes('{!followsStage(kpi) && ('), 'the tab picker only where it means something')
  assert.ok(body.includes('tabs={[kpiTab(kpi, stage)]}'), 'and its conditions are written against that tab')
  assert.ok(!body.includes('tabs={[stage.tab]}'), 'not against the stage’s regardless')
})

test('changing the tab clears conditions written against the old one', () => {
  // A column name from another sheet is a condition that matches nothing,
  // silently, and looks exactly like one that legitimately matches nothing.
  const at = editor.indexOf('export function StageKpiEditor(')
  const body = editor.slice(at, at + 6000)
  assert.ok(body.includes('update(kpi.id, { tab: v, conditions: [] })'))
})

test('a stage that owns stages is not offered KPIs it can never show', () => {
  const at = editor.indexOf('function StageList(')
  const body = editor.slice(at, at + 9000)
  assert.ok(
    body.includes("kids.length === 0 && { key: 'popup'"),
    'the tab is not even offered'
  )
  assert.ok(body.includes("{here === 'popup' && kids.length === 0 && ("), 'and the panel cannot be reached either')
})

test('a long form is a row of buttons, and one stage at a time', () => {
  // Six stages with their conditions, KPIs and sub-stages all unrolled is a
  // form nobody can see the end of -- and the thing an admin does most is
  // find ONE stage, not read them all.
  const at = editor.indexOf('function StageList(')
  const body = editor.slice(at, at + 9000)
  assert.ok(body.includes('const [openId, setOpenId] = useState(null)'), 'nothing is open to begin with')
  assert.ok(body.includes('setOpenId(open ? null : stage.id)'), 'and opening one closes the last')
  assert.ok(body.includes('<SectionTabs sections={sections}'), 'the rest is behind buttons')
  assert.ok(body.includes('{open && ('), 'a closed stage renders no form at all')
  assert.ok(body.includes('{stageSummary(stage)}'), 'and says enough closed to be found')
})

test('adding a stage opens it', () => {
  // The one moment you certainly do want it unrolled.
  const at = editor.indexOf('function StageList(')
  const body = editor.slice(at, at + 9000)
  const add = body.slice(body.indexOf('function add()'), body.indexOf('function add()') + 400)
  assert.ok(add.includes('setOpenId(fresh.id)'))
  assert.ok(add.includes("setSection('rules')"), 'at the tab it needs first')
})
