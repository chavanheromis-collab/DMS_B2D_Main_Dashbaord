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
  stagePercent,
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
    widget.includes('{renderStage({ stage, count, trend, index: i, pct: stagePercent(count, { base, total }) })}'),
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
  assert.ok(body.includes('{depth + 1 < MAX_DEPTH ? ('), 'and the Add button stops at the cap')
})

test('a sub-stage is pinned to the tab whose rows it divides', () => {
  const at = editor.indexOf('function StageList(')
  const body = editor.slice(at, at + 6000)
  assert.ok(body.includes('tabs={depth > 0 ? tabs.filter((t) => optValue(t) === parentTab) : tabs}'))
  assert.ok(body.includes('parentTab={stage.tab}'))
})

test('a stage that owns stages is not offered KPIs it can never show', () => {
  const at = editor.indexOf('function StageList(')
  const body = editor.slice(at, at + 6000)
  assert.ok(body.includes('{kids.length === 0 && ( <StageKpiEditor'))
})
