import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  FILTER_COLUMN,
  FILTER_OPERATOR,
  buildNamedFilters,
  describeFilterRef,
  filterNameProblem,
  filterOptionsIn,
  filterWidgetOptions,
  installNamedFilters,
  matchOf,
  namedFilterByName,
  namedFilterByRef,
  namedFiltersOf,
} from './namedFilters.js'
// Imported for its side effect too: the engine lends its matcher to the
// named filters as it loads.
import { matchesConditions, testCondition } from './filterEngine.js'
import { FUNCTIONS, evaluateFormula, parseFormula } from './formula.js'
import { applyComputed, compileComputed, filterNamesIn, namedFilterColumns, unknownFilterNames } from './computed.js'
import { FORMULA_COLUMN, conditionPatch } from './conditionFormula.js'
import { operatorMeta } from './config.js'
import { describeScope } from './userScope.js'

// ---------------------------------------------------------------------
// Named filters: one widget's conditions, reused by name
// ---------------------------------------------------------------------
// "Walk-ins still waiting on a follow-up", written once on a KPI and then
// picked -- by another widget, a page button, a user's row limit, a
// calculated column -- instead of written four slightly different times.
// What must hold: a name is found wherever a widget keeps its conditions,
// it is evaluated exactly as the conditions it names, and a filter that is
// gone or loops says NO rather than everything.

const TAB = 'src_1::LEADS'
const walkIns = { tab: TAB, column: 'Source', operator: 'equals', value: 'WALK-IN' }
const notFollowed = { tab: TAB, column: 'Remarks', operator: 'none_of', value: '2 FOLL, 3 FOLL' }
const uses = (ref) => ({ tab: TAB, column: FILTER_COLUMN, operator: FILTER_OPERATOR, value: ref })

const kpi = {
  id: 'w_kpi',
  type: 'kpi',
  title: 'Walk-ins',
  tab: TAB,
  conditions: [walkIns, notFollowed],
  conditionsMatch: 'all',
  conditionsName: 'Walk-ins pending',
  // Conditions nobody named are the widget's own business.
  secondaryConditions: [walkIns],
  secondaryConditionsName: '  ',
}
const stats = {
  id: 'w_stats',
  title: 'Lead stats',
  tab: TAB,
  stats: [
    {
      id: 's1',
      conditions: [{ tab: TAB, column: 'Source', operator: 'equals', value: 'REFERRAL' }],
      match: 'any',
      conditionsName: 'Referrals',
    },
    { id: 's2', conditions: [] },
  ],
}
const compare = { id: 'w_cmp', title: 'This vs last', tab: TAB, conditionsA: [walkIns], matchA: 'any', conditionsAName: 'Side A' }
const group = {
  id: 'w_group',
  title: 'Group',
  widgets: [{ id: 'w_inner', title: 'Inner', tab: TAB, rowConditions: [walkIns], rowMatch: 'any', rowConditionsName: 'Inner' }],
}
const PAGES = [{ id: 'p1', name: 'Sales', widgets: [kpi, stats, compare, group] }]
const registry = buildNamedFilters(PAGES)

const ROWS = [
  { _row: 2, Source: 'WALK-IN', Remarks: '1ST FOLL', Amount: '5' },
  { _row: 3, Source: 'WALK-IN', Remarks: '2 FOLL', Amount: '20' },
  { _row: 4, Source: 'REFERRAL', Remarks: '', Amount: '30' },
  { _row: 5, Source: 'walk-in', Remarks: '', Amount: '40' },
]
const HEADERS = ['Source', 'Remarks', 'Amount']
const rowsWhere = (conditions, match = 'all') =>
  ROWS.filter((row) => matchesConditions(row, conditions, match)).map((row) => row._row)

// --- what counts as one ------------------------------------------------------

test('a widget’s conditions become a filter only once they are named', () => {
  const found = namedFiltersOf(kpi, PAGES[0])
  assert.equal(found.length, 1)
  assert.equal(found[0].name, 'Walk-ins pending')
  assert.equal(found[0].ref, 'w_kpi:conditions')
  assert.equal(found[0].match, 'all')
  assert.equal(found[0].tab, TAB)
  assert.equal(found[0].pageName, 'Sales')
  assert.equal(namedFiltersOf({ id: 'x', conditions: [walkIns] }).length, 0)
  assert.deepEqual(namedFiltersOf(null), [])
})

test('named conditions are found wherever a widget keeps them', () => {
  // A stat's own conditions, a comparison side, a widget inside a group --
  // found by walking, not by a list of fields that the next editor misses.
  assert.deepEqual(
    registry.list.map((f) => f.ref).sort(),
    ['w_cmp:conditionsA', 'w_inner:rowConditions', 'w_kpi:conditions', 'w_stats:stats.s1.conditions']
  )
  // Each one matched by its own ALL/ANY field, however that is spelled.
  assert.equal(namedFilterByRef('w_stats:stats.s1.conditions', registry).match, 'any')
  assert.equal(namedFilterByRef('w_cmp:conditionsA', registry).match, 'any')
  assert.equal(namedFilterByRef('w_inner:rowConditions', registry).match, 'any')
  assert.equal(matchOf({ matchNow: 'any' }, 'conditionsNow'), 'any')
  assert.equal(matchOf({ targetMatch: 'any' }, 'targetConditions'), 'any')
  assert.equal(matchOf({}, 'conditions'), 'all')
  // A widget inside a group is listed as itself, not as the group.
  assert.equal(namedFilterByRef('w_inner:rowConditions', registry).widgetTitle, 'Inner')
})

test('a name is found however it is typed, and a clash is said out loud', () => {
  assert.equal(namedFilterByName('  walk-ins PENDING ', registry).ref, 'w_kpi:conditions')
  assert.equal(namedFilterByName('nobody', registry), null)
  assert.equal(filterNameProblem('Walk-ins pending', registry), '')

  // Two widgets, one name: a formula cannot know which one it means.
  const clash = buildNamedFilters([{ id: 'p', widgets: [kpi, { ...kpi, id: 'w_copy' }] }])
  assert.match(filterNameProblem('walk-ins pending', clash), /already called/)
  assert.equal(namedFilterByName('Walk-ins pending', clash).ref, 'w_kpi:conditions', 'the first one wins meanwhile')

  // A formula puts the name in quotes.
  assert.match(filterNameProblem('Say "hi"', registry), /double quote/)
  assert.equal(filterNameProblem('', registry), '')
})

test('the pickers offer a widget, then its filters, on the same tab', () => {
  const widgets = filterWidgetOptions(registry)
  assert.ok(widgets.some((w) => w.value === 'w_kpi' && w.label === 'Sales › Walk-ins'))
  assert.equal(new Set(widgets.map((w) => w.value)).size, widgets.length, 'each widget once')
  assert.deepEqual(filterOptionsIn(registry, 'w_kpi'), [
    { value: 'w_kpi:conditions', label: 'Walk-ins pending', name: 'Walk-ins pending' },
  ])
  // A filter about another tab's columns is not offered.
  assert.deepEqual(filterWidgetOptions(registry, { tab: 'src_1::OTHER' }), [])
  assert.equal(filterWidgetOptions(registry, { tab: TAB }).length, widgets.length)

  assert.equal(describeFilterRef('w_kpi:conditions', registry), 'in filter “Walk-ins pending”')
  assert.match(describeFilterRef('w_gone:conditions', registry), /no longer exists/)
})

// --- using one in a condition ------------------------------------------------

test('a condition can be another widget’s named filter', () => {
  installNamedFilters(registry)
  // WALK-IN in any case, and not on a 2nd or 3rd follow-up.
  assert.deepEqual(rowsWhere([uses('w_kpi:conditions')]), [2, 5])
  assert.deepEqual(rowsWhere([uses('w_kpi:conditions'), { tab: TAB, column: 'Amount', operator: 'gt', value: '10' }]), [5])
  assert.deepEqual(rowsWhere([uses('w_kpi:conditions'), uses('w_stats:stats.s1.conditions')], 'any'), [2, 4, 5])
  assert.deepEqual(
    ROWS.filter((row) => testCondition(row, uses('w_stats:stats.s1.conditions'))).map((r) => r._row),
    [4]
  )
  // Kept even without the column the builder gives it -- an empty list
  // would match every row.
  assert.deepEqual(rowsWhere([{ operator: FILTER_OPERATOR, value: 'w_kpi:conditions' }]), [2, 5])
})

test('a filter that is gone, or that loops, matches nothing', () => {
  installNamedFilters(registry)
  assert.deepEqual(rowsWhere([uses('w_deleted:conditions')]), [])

  // A uses B, B uses A: asked forever, unless a loop says no.
  const loop = buildNamedFilters([
    {
      id: 'p',
      widgets: [
        { id: 'a', conditionsName: 'A', conditions: [uses('b:conditions')] },
        { id: 'b', conditionsName: 'B', conditions: [uses('a:conditions')] },
      ],
    },
  ])
  installNamedFilters(loop)
  assert.deepEqual(rowsWhere([uses('a:conditions')]), [])

  // Before any screen has installed a set, there is nothing to find.
  installNamedFilters(null)
  assert.deepEqual(rowsWhere([uses('w_kpi:conditions')]), [])
  installNamedFilters(registry)
})

test('choosing it gives the condition its column, and leaving it takes the id away', () => {
  assert.deepEqual(conditionPatch({ column: 'Source', value: 'X' }, { operator: FILTER_OPERATOR }), {
    operator: FILTER_OPERATOR,
    column: FILTER_COLUMN,
    value: '',
  })
  assert.deepEqual(conditionPatch({ column: FILTER_COLUMN, value: 'w_kpi:conditions' }, { operator: 'equals' }), {
    operator: 'equals',
    column: '',
    value: '',
  })
  // A widget's id is not a formula.
  assert.deepEqual(conditionPatch({ column: FILTER_COLUMN, value: 'w_kpi:conditions' }, { operator: 'formula' }), {
    operator: 'formula',
    column: FORMULA_COLUMN,
    value: '',
  })
  // And a formula keeps its words exactly as it always did.
  assert.deepEqual(conditionPatch({ column: 'Source', value: '[A] > 1' }, { operator: 'formula' }), {
    operator: 'formula',
    column: FORMULA_COLUMN,
  })

  const meta = operatorMeta(FILTER_OPERATOR)
  assert.equal(meta.value, FILTER_OPERATOR)
  assert.equal(meta.filterRef, true)
  assert.equal(meta.arity, 0, 'picked, not typed')
})

test('a user’s row limit names the filter it uses', () => {
  installNamedFilters(registry)
  const scope = { match: 'all', conditions: [uses('w_kpi:conditions')] }
  assert.equal(describeScope(scope), `${TAB} · in filter “Walk-ins pending”`)
})

// --- using one in a formula ------------------------------------------------

test('a calculated column can ask a named filter by name', () => {
  installNamedFilters(registry)
  assert.ok(FUNCTIONS.INFILTER)
  const { ast } = parseFormula('IF(INFILTER("Walk-ins pending"), "Pending", "Done")')
  assert.deepEqual(
    ROWS.map((row) => evaluateFormula(ast, row)),
    ['Pending', 'Done', 'Done', 'Pending']
  )
  // A name nobody has given a filter is NO.
  assert.equal(evaluateFormula(parseFormula('INFILTER("nobody")').ast, ROWS[0]), false)

  const out = applyComputed(ROWS, [{ id: 'c1', name: 'Pending', formula: 'INFILTER("Walk-ins pending")' }], {
    headers: HEADERS,
  })
  assert.deepEqual(out.map((row) => row.Pending), [true, false, false, true])
})

test('a formula condition can use a named filter too', () => {
  installNamedFilters(registry)
  const condition = {
    tab: TAB,
    column: FORMULA_COLUMN,
    operator: 'formula',
    value: 'INFILTER("Walk-ins pending") AND [Amount] > 10',
  }
  assert.deepEqual(ROWS.filter((row) => testCondition(row, condition)).map((r) => r._row), [5])
})

test('a column built from a filter waits for the columns that filter reads', () => {
  // "Big" reads Double, which is itself calculated -- and listed AFTER the
  // column that uses the filter, on purpose.
  const big = buildNamedFilters([
    {
      id: 'p',
      widgets: [
        { id: 'w_big', tab: TAB, conditionsName: 'Big', conditions: [{ tab: TAB, column: 'Double', operator: 'gt', value: '50' }] },
      ],
    },
  ])
  installNamedFilters(big)
  const defs = [
    { id: 'd', name: 'Is big', formula: 'IF(INFILTER("Big"), "yes", "no")' },
    { id: 'c', name: 'Double', formula: '[Amount] * 2' },
  ]
  const { columns, errors } = compileComputed(defs, HEADERS)
  assert.deepEqual(errors, [])
  assert.deepEqual(columns.map((c) => c.name), ['Double', 'Is big'])
  assert.deepEqual(applyComputed(ROWS, defs, { headers: HEADERS }).map((r) => r['Is big']), ['no', 'no', 'yes', 'yes'])

  // A filter about a column this tab lacks says no; it does not cost the
  // column its place.
  const elsewhere = buildNamedFilters([
    {
      id: 'p',
      widgets: [{ id: 'w_x', conditionsName: 'Elsewhere', conditions: [{ tab: 'src_2::X', column: 'Nope', operator: 'equals', value: '1' }] }],
    },
  ])
  installNamedFilters(elsewhere)
  const kept = compileComputed([{ id: 'e', name: 'E', formula: 'INFILTER("Elsewhere")' }], HEADERS)
  assert.deepEqual(kept.errors, [])
  assert.equal(kept.columns.length, 1)
  installNamedFilters(registry)
})

test('the editor knows which names a formula uses, and which nobody has', () => {
  installNamedFilters(registry)
  assert.deepEqual([...filterNamesIn(parseFormula('OR(INFILTER("A"), INFILTER("B"))').ast)], ['A', 'B'])
  assert.deepEqual(unknownFilterNames('INFILTER("Walk-ins pending") AND INFILTER("Ghost")'), ['Ghost'])
  assert.deepEqual(unknownFilterNames('[Amount] > 1'), [])
  assert.deepEqual(unknownFilterNames('not a formula ((('), [])
  assert.deepEqual([...namedFilterColumns(namedFilterByName('Walk-ins pending'))].sort(), ['Remarks', 'Source'])
})

// --- wiring ------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\s+/g, ' ')

test('every widget condition panel can be named, beside the list it names', () => {
  // `<list>Name` next to `<list>` is what the walk looks for; a panel that
  // stored its name anywhere else would name nothing.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  for (const key of ['rowConditions', 'conditions', 'secondaryConditions']) {
    assert.ok(panel.includes(`onName={(${key}Name) => set({ ${key}Name })}`), key)
  }
  const editors = read('pages/admin/WidgetEditors.jsx')
  assert.ok(editors.includes('onName={(conditionsName) => setStage({ conditionsName })}'))
  assert.ok(editors.includes('onName={(conditionsName) => update(kpi.id, { conditionsName })}'))
  assert.ok(editors.includes('onName={(conditionsName) => set({ conditionsName })}'))
  assert.ok(editors.includes('onName={(v) => set({ [`conditions${side}Name`]: v })}'))
  const metric = read('pages/admin/MetricEditors.jsx')
  for (const [holder, key] of [
    ['stat', 'conditions'],
    ['stat', 'compareConditions'],
    ['line', 'conditions'],
    ['line', 'targetConditions'],
  ]) {
    assert.ok(metric.includes(`onName={(${key}Name) => ops.update(${holder}.id, { ${key}Name })}`), `${holder} ${key}`)
  }
  for (const key of ['conditionsNow', 'conditionsBefore']) {
    assert.ok(metric.includes(`onName={(${key}Name) => set({ ${key}Name })}`), key)
  }
})

test('a condition picks a widget, then its filter, and the builder names its own', () => {
  const builder = read('pages/admin/ConditionBuilder.jsx')
  assert.ok(builder.includes('{meta.filterRef ? ('))
  assert.ok(builder.includes('<NamedFilterPicker value={value} onChange={(v) => onChange({ value: v })} tab={tab} />'))
  // Choosing the widget chooses its first filter, so a half-made pick is
  // never an empty condition.
  assert.ok(builder.includes("onChange={(id) => onChange(filterOptionsIn(registry, id, { tab })[0]?.value || '')}"))
  assert.ok(builder.includes('{onName && <FilterNameField name={name} onName={onName} />}'))
  assert.ok(builder.includes('<Bookmark size={11} /> named filter'))
})

test('a calculated column picks a widget’s filter rather than spelling it', () => {
  const columns = read('pages/admin/ComputedColumns.jsx')
  assert.ok(columns.includes("onInsert={(name) => update(def.id, { formula: `${def.formula || ''}INFILTER(\"${name}\")` })}"))
  assert.ok(columns.includes('{unknownFilterNames(def.formula).map((name) => ('))
  assert.ok(read('pages/admin/DataSourcesPanel.jsx').includes('<ComputedColumns sourceId={source.id}'))
})

test('the screens that evaluate install the set, and the columns follow it', () => {
  const dash = read('pages/Dashboard.jsx')
  const installed = dash.indexOf('const namedFilters = useNamedFilters(allPages)')
  assert.ok(installed >= 0)
  assert.ok(installed < dash.indexOf('const computedByRef = useMemo('), 'before the columns are worked out')
  assert.ok(dash.includes('}, [editedByRef, sourcesById, dateOrder, namedFilters])'))

  const admin = read('pages/Admin.jsx')
  assert.ok(admin.includes('const namedFilters = useNamedFilters(livePages)'))
  // The page being edited counts as it stands, unsaved.
  assert.ok(admin.includes('{ ...p, widgets: draft.widgets || [] }'))

  assert.ok(read('lib/filterEngine.js').includes('registerFilterTester(matchesConditions)'))
})
