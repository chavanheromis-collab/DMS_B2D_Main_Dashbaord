import { aggregate, bucketConditions, groupKey, isBlank, normalizeKey } from './dataUtils.js'
import { DEFAULT_DETAILS } from './flowDetails.js'
import { matchesConditions } from './filterEngine.js'
import { DEFAULT_BLEND, blendIsReady, blendRows, blendedHeaders } from './blend.js'

// ---------------------------------------------------------------------
// Flow -- a drill-down flowchart
// ---------------------------------------------------------------------
// Every other widget answers one question at one depth. A KPI says 1,284.
// A chart says 1,284 split by Model. Neither can say "1,284 -- of which 812
// are SPLENDOR, of which 190 are still unallocated, of which 40 have an
// open service job on a completely different tab".
//
// That last sentence is the shape of nearly every real question, and the
// tools that answer it well (Power BI's decomposition tree, funnel reports,
// Sankey flows, drill-through paths) all do the same three things:
//
//   1. Start from ONE number and make everything below it a subset of it,
//      so the arithmetic always reconciles.
//   2. Let the reader open the branch they care about instead of rendering
//      every branch at once -- depth on demand.
//   3. Show each branch's share of its parent, so the drop-off between one
//      level and the next is the thing your eye lands on.
//
// A flow is a ROOT (this widget's tab, plus optional conditions) and an
// ordered list of LEVELS. Each level says how to turn a node into its
// children, and there are only three ways to do that:
//
//   split     break the rows down by a column -- one child per value, top
//             N, with an "Other" bucket so the total still reconciles.
//   rules     branch on admin-written conditions -- the multi-column case
//             ("Hot / Warm / Cold", "over 90 days AND unpaid"). Exclusive
//             by default, which is what makes it read as a decision tree.
//   measures  branch into NUMBERS rather than rows: count here, sum of
//             Amount there, count of the ones that are financed. The rows
//             stay the parent's (narrowed by each measure's own conditions
//             if it has any), so a flow can stop being a census and start
//             being a scorecard at any depth.
//   values    branch by the values listed on a REFERENCE tab, matched
//             against a column here. The one way to show a value with ZERO
//             rows -- a model nobody sold this month does not exist in the
//             sales data, so no amount of grouping will ever reveal it.
//   hop       follow a key column into ANOTHER TAB. The child's rows are
//             the rows of that tab whose key appears in the parent's.
//   tables    bring in other tabs OUTRIGHT, one branch each, related to the
//             parent by nothing at all.
//
// Those last three are why a flow is not "a widget for one table". Only
// `hop` claims a relationship; `values` borrows a list; `tables` claims
// nothing, and says so -- an independent branch reports no share of its
// parent, because it is not part of it and a percentage would be a lie.
//
// Levels are the backbone, applied at every branch, so an admin describes
// depth once instead of drawing a diagram. A single branch can opt out with
// `stop`, which is what gives a real flowchart its asymmetry -- "Lost" does
// not need breaking down five ways.
//
// Two more things a flow is not:
//
//   NOT one tree. A flow widget holds a LIST of trees, side by side on one
//   canvas. Three questions that belong together on a page usually belong
//   together in one picture, and three separate widgets cannot share a
//   canvas, a zoom, or a reader's attention. Each tree has its own table,
//   its own starting number and its own levels; nothing is shared but the
//   frame they are read in.
//
//   NOT limited to the columns a tab happens to have. A tree can BLEND a
//   second tab into its rows first -- the same per-widget join every other
//   widget can do -- so a tree rooted in MASTER can branch on a column that
//   only exists in Quotations. The blend runs once, at the root, and every
//   level below sees the joined columns as if they had always been there.
//
// Nothing here is new vocabulary: conditions are the SAME shape the buttons
// and blend fill-ins use, evaluated by the same `matchesConditions`, the
// measure is the same `aggregate` every KPI uses, and the blend is the same
// `blendRows` the table and chart widgets use.

export const FLOW_LEVEL_KINDS = [
  {
    value: 'split',
    label: 'Break down by a column',
    hint: 'One child per distinct value, biggest first, with an “Other” bucket.',
  },
  {
    value: 'rules',
    label: 'Branch on conditions',
    hint: 'Admin-written branches. Exclusive by default, so it reads as a decision tree.',
  },
  {
    value: 'measures',
    label: 'Show numbers about it',
    hint: 'One branch per number — count, sum, average — each with its own optional conditions.',
  },
  {
    value: 'values',
    label: 'Break down by a list on another tab',
    hint: 'Branches come from a reference tab, so a value with zero rows is still shown.',
  },
  {
    value: 'hop',
    label: 'Follow a key into another tab',
    hint: 'Continue the flow on a second tab, matched on a key column.',
  },
  {
    value: 'tables',
    label: 'Bring in other tabs',
    hint: 'One branch per tab, independent of everything above it. No shares — they are not subsets.',
  },
]

export const FLOW_SORTS = [
  { value: 'value_desc', label: 'Biggest first' },
  { value: 'value_asc', label: 'Smallest first' },
  { value: 'name_asc', label: 'A → Z' },
  { value: 'name_desc', label: 'Z → A' },
]

export const FLOW_PERCENT_BASES = [
  { value: 'parent', label: 'Its parent (conversion at each step)' },
  { value: 'root', label: 'The starting number (share of the whole)' },
]

/**
 * Aggregations whose parts sum to their whole.
 *
 * A share only means something when they do. The average of a branch is not
 * a share of the average of its parent, so for those the bar and the
 * percentage fall back to the ROW COUNT, which is always additive. Showing
 * "avg 42 = 130% of parent" would be worse than showing nothing.
 */
const ADDITIVE = new Set(['count', 'count_filled', 'count_empty', 'count_distinct', 'sum'])

export const DEFAULT_FLOW = {
  label: '',
  // The flow's own starting tab. Empty means "the widget's tab", which is
  // what every flow used before a flow could start anywhere.
  tab: '',
  // Several trees on one canvas. Absent means "one tree, described by the
  // fields on the flow itself" -- which is every flow written before this
  // existed, and still the shape of a flow with a single tree.
  trees: null,
  blend: null,
  match: 'all',
  conditions: [],
  measure: { aggregation: 'count', column: null, format: 'comma' },
  metrics: [],
  levels: [],
  percentBase: 'parent',
  showDropOff: true,
  showBars: true,
  view: 'tree',
  orientation: 'vertical',
  diagramHeight: 420,
  autoExpand: 1,
  // A ceiling on how many nodes one render may build. Depth is multiplicative
  // -- five levels of eight children is 32,768 nodes -- so "expand all" on a
  // deep flow has to stop somewhere rather than lock the tab.
  maxNodes: 400,
  // Which rows sit behind a branch, and which of their columns are worth
  // showing. Off until an admin says otherwise -- see lib/flowDetails.js.
  ...DEFAULT_DETAILS,
}

export const DEFAULT_FLOW_LEVEL = {
  kind: 'split',
  column: '',
  sort: 'value_desc',
  top: 6,
  otherBucket: true,
  otherLabel: 'Other',
  includeBlanks: true,
  blankLabel: '(blank)',
  allowChange: false,
  exclusive: true,
  elseBranch: true,
  elseLabel: 'Everything else',
  branches: [],
  // measures
  measures: [],
  // values (a reference list on another tab)
  matchColumn: '',
  showZero: true,
  unmatchedBucket: true,
  unmatchedLabel: 'Not on the list',
  // hop
  tab: '',
  fromKey: '',
  toKey: '',
  // tables
  sources: [],
  label: '',
}

/** Does this level measure its children differently from their parent? */
function levelMeasure(level, inherited) {
  const m = level?.measure
  if (!m || !m.aggregation) return inherited
  return { aggregation: m.aggregation, column: m.column ?? null, format: m.format || inherited?.format || 'comma' }
}

function sameMeasure(a, b) {
  return (a?.aggregation || 'count') === (b?.aggregation || 'count') && (a?.column || '') === (b?.column || '')
}

/** Is this flow configured enough to draw anything? */
export function flowIsReady(widget) {
  return Boolean(widget?.flow?.tab || widget?.tab)
}

/** The tab a flow starts on, which need not be the widget's own. */
export function flowRootTab(widget) {
  return widget?.flow?.tab || widget?.tab || ''
}

/** What one tree looks like before an admin has said anything about it. */
export function defaultFlowTree(id, tab = '') {
  return {
    id,
    label: '',
    icon: '',
    color: '',
    tab,
    match: 'all',
    conditions: [],
    measure: { aggregation: 'count', column: null, format: 'comma' },
    blend: { ...DEFAULT_BLEND },
    levels: [],
  }
}

/**
 * The trees a flow holds, however it happens to be stored.
 *
 * A flow written before there could be more than one keeps describing its
 * single tree on the flow object itself. Rather than migrate those pages,
 * that shape is read AS a one-tree list -- so both forms stay valid for
 * ever, and an admin who never wants a second tree never sees the concept.
 */
export function flowTrees(widget) {
  const flow = { ...DEFAULT_FLOW, ...(widget?.flow || {}) }
  const list = Array.isArray(flow.trees) ? flow.trees.filter(Boolean) : null

  if (!list || list.length === 0) {
    return [
      {
        ...defaultFlowTree('t0', flowRootTab(widget)),
        label: flow.label || '',
        match: flow.match || 'all',
        conditions: flow.conditions || [],
        measure: flow.measure,
        blend: flow.blend,
        levels: flow.levels || [],
      },
    ]
  }

  return list.map((tree, i) => {
    const tab = tree.tab || flowRootTab(widget)
    return {
      ...defaultFlowTree(tree.id || `t${i}`, tab),
      ...tree,
      tab,
      // Several trees cannot all be called by the widget's title, so an
      // unnamed one is called after its table.
      label: tree.label || (list.length > 1 ? tab : ''),
    }
  })
}

/** Is this flow drawing more than one tree? */
export function flowIsMultiTree(widget) {
  return flowTrees(widget).length > 1
}

const uniq = (list) => Array.from(new Set(list))

/** Labels are used inside node paths, so they must not contain the separator. */
function pathSafe(label) {
  return String(label ?? '').replace(/\//g, '∕')
}

function measureOf(rows, measure) {
  return aggregate(rows, measure?.column, measure?.aggregation || 'count')
}

/** Conditions authored against a node's tab, with the tab filled in. */
function ownConditions(conditions, tab) {
  return (conditions || [])
    .filter((c) => c && c.column)
    .map((c) => ({ ...c, tab: c.tab || tab }))
}

/**
 * One node of the tree.
 *
 * `conditions` is the ACCUMULATED chain from the root -- what the node means
 * in filter terms -- and `mergeable` records whether that chain is still an
 * honest description. See `flowCrossFilter`.
 */
function makeNode({
  path,
  level,
  label,
  icon,
  color,
  kind,
  tab,
  rows,
  parent,
  ctx,
  conditions,
  mergeable,
  hop,
  measure,
  independent,
}) {
  const own = measure || parent?.measure || ctx.flow.measure
  const additive = ADDITIVE.has(own?.aggregation || 'count')
  const value = measureOf(rows, own)
  const count = rows.length

  const node = {
    path,
    level,
    label,
    icon: icon || '',
    color: color || '',
    kind,
    tab,
    rows,
    count,
    value,
    measure: own,
    additive,
    // A branch that is not part of its parent cannot own a share of it.
    independent: Boolean(independent),
    trail: parent ? [...parent.trail, label] : [label],
    conditions,
    mergeable,
    // The column on THIS tab that carries the join key, once a hop has
    // established one. Descendants inherit it: they are still addressed by
    // the same key even though they are narrower.
    keyColumn: hop ? hop.toKey : parent?.keyColumn || null,
    keyPairs: hop
      ? [...(parent?.keyPairs || []), { tab: parent.tab, column: hop.fromKey }, { tab: hop.tab, column: hop.toKey }]
      : parent?.keyPairs || [],
    hopped: Boolean(hop) || Boolean(parent?.hopped),
    stop: false,
    metrics: (ctx.flow.metrics || [])
      .filter((m) => m && m.label)
      .map((m) => ({
        id: m.id,
        label: m.label,
        color: m.color || '',
        format: m.format || 'comma',
        aggregation: m.aggregation || 'count',
        value: aggregate(rows, m.column, m.aggregation || 'count'),
      })),
    children: [],
    hasChildren: false,
    open: false,
    truncated: false,
  }

  // A share is only arithmetic when the two numbers are the same KIND of
  // number. Comparing this branch's sum of Amount to its parent's row count
  // would produce a percentage that means nothing, so wherever the measures
  // differ -- or wherever they are not additive at all -- the share falls
  // back to counting rows, which always reconciles.
  const comparable = (a, b) => additive && sameMeasure(a, b)

  if (node.independent || !parent) {
    node.share = parent ? null : 1
    node.shareOfRoot = null
    node.dropOff = 0
    return node
  }

  const byValue = comparable(own, parent.measure)
  const base = byValue ? parent.value : parent.count
  node.share = base ? (byValue ? value : count) / base : 0

  const rootByValue = comparable(own, ctx.flow.measure)
  const rootBase = rootByValue ? ctx.rootValue : ctx.rootCount
  node.shareOfRoot = rootBase ? (rootByValue ? value : count) / rootBase : 0
  node.dropOff = 1 - node.share

  return node
}

// --- the ways a node becomes children ---------------------------------

/** Orders a level's branches. Shared, so every kind sorts identically. */
function sortItems(items, sort) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const out = [...items]
  if (sort === 'value_desc') out.sort((a, b) => b.value - a.value)
  else if (sort === 'value_asc') out.sort((a, b) => a.value - b.value)
  else if (sort === 'name_asc') out.sort((a, b) => collator.compare(a.label, b.label))
  else if (sort === 'name_desc') out.sort((a, b) => collator.compare(b.label, a.label))
  return out
}

/**
 * The conditions that select one branch of a split.
 *
 * A plain value is an equals. A BUCKET is whatever the bucket stands for --
 * a band is a pair of bounds, a month is a date range -- which is the only
 * form the filter engine can act on, since the label itself appears in no
 * row anywhere.
 */
function splitConditions(tab, column, label, spec, dateOrder) {
  const fromBucket = spec ? bucketConditions(column, label, spec, dateOrder) : null
  return (fromBucket || [{ column, operator: 'equals', value: label }]).map((c) => ({ ...c, tab }))
}

function splitChildren(parent, level, ctx) {
  const column = level.column
  if (!column) return []
  const measure = levelMeasure(level, parent.measure)

  // A level can bucket, exactly as every other place that groups by a
  // column does: four hundred dates read as four years, and a break down by
  // Amount reads as bands rather than four hundred distinct numbers.
  const spec = level.bucket ? level : null
  const dateOrder = ctx?.dateOrder || 'DMY'

  const buckets = new Map()
  const blanks = []
  for (const row of parent.rows) {
    const raw = row[column]
    if (isBlank(raw)) {
      blanks.push(row)
      continue
    }
    const key = spec ? groupKey(row, column, spec, dateOrder) : String(raw).trim()
    // A value the bucket cannot read -- a date that is not one -- is blank
    // for this purpose rather than a bucket of its own called "null".
    if (key === null || key === undefined || key === '') {
      blanks.push(row)
      continue
    }
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }

  let items = Array.from(buckets.entries()).map(([label, rows]) => ({
    label,
    rows,
    value: measureOf(rows, measure),
  }))

  items = sortItems(items, level.sort || 'value_desc')

  const top = Number(level.top) > 0 ? Number(level.top) : items.length
  const kept = items.slice(0, top)
  const rest = items.slice(top)

  const children = kept.map((item) =>
    makeNode({
      path: `${parent.path}/${pathSafe(item.label)}`,
      level: parent.level + 1,
      label: item.label,
      kind: 'split',
      tab: parent.tab,
      rows: item.rows,
      parent,
      ctx,
      // "May 2024" is not a value in the date column, so a bucketed branch
      // drills by the conditions that DEFINE its bucket. Without this the
      // click would filter to nothing and the branch would look broken.
      conditions: [...parent.conditions, ...splitConditions(parent.tab, column, item.label, spec, dateOrder)],
      mergeable: parent.mergeable,
      measure,
    })
  )

  // The tail is rolled up rather than dropped, so a level always adds up to
  // its parent. A truncated breakdown that silently loses 300 rows is how a
  // dashboard ends up being quietly wrong.
  if (rest.length && level.otherBucket !== false) {
    const rows = rest.flatMap((item) => item.rows)
    children.push(
      makeNode({
        path: `${parent.path}/__other`,
        level: parent.level + 1,
        label: `${level.otherLabel || 'Other'} (${rest.length})`,
        kind: 'other',
        tab: parent.tab,
        rows,
        parent,
        ctx,
        conditions: [
          ...parent.conditions,
          { tab: parent.tab, column, operator: 'none_of', value: kept.map((i) => i.label).join(', ') },
        ],
        // "None of these" is a statement about VALUES, and a bucket label is
        // not one. A bucketed Other therefore drills by its own rows rather
        // than by a condition that would match everything.
        mergeable: spec ? false : parent.mergeable,
        measure,
      })
    )
  }

  // Blanks get a node of their own instead of vanishing. A chart drops them
  // silently; here the reader can see exactly how much of the parent has no
  // value at all, which is usually the most actionable branch on the screen.
  if (blanks.length && level.includeBlanks !== false) {
    children.push(
      makeNode({
        path: `${parent.path}/__blank`,
        level: parent.level + 1,
        label: level.blankLabel || '(blank)',
        kind: 'blank',
        tab: parent.tab,
        rows: blanks,
        parent,
        ctx,
        conditions: [...parent.conditions, { tab: parent.tab, column, operator: 'is_empty', value: '' }],
        mergeable: parent.mergeable,
        measure,
      })
    )
  }

  return children
}

function ruleChildren(parent, level, ctx) {
  const measure = levelMeasure(level, parent.measure)
  const branches = (level.branches || []).filter((b) => b && (b.conditions || []).some((c) => c.column))
  const exclusive = level.exclusive !== false
  const taken = new Set()
  const children = []

  branches.forEach((branch, i) => {
    const conds = ownConditions(branch.conditions, parent.tab)
    const rows = []
    for (const row of parent.rows) {
      if (exclusive && taken.has(row)) continue
      if (matchesConditions(row, conds, branch.match || 'all', ctx.dateOrder)) {
        rows.push(row)
        // Doubles as "some branch claimed this row", which is exactly what
        // the "everything else" branch needs in either mode.
        taken.add(row)
      }
    }

    // Two things stop the accumulated chain from being an honest filter:
    // an ANY branch (a flat AND list cannot express OR), and any branch
    // after the first on an EXCLUSIVE level (its real meaning includes
    // "...and not the branches above", which has no flat form either).
    // Those nodes drill by row identity instead -- see `flowCrossFilter`.
    const mergeable =
      parent.mergeable && (branch.match || 'all') === 'all' && (!exclusive || i === 0)

    children.push(
      makeNode({
        path: `${parent.path}/${pathSafe(branch.id || branch.label || i)}`,
        level: parent.level + 1,
        label: branch.label || `Branch ${i + 1}`,
        icon: branch.icon,
        color: branch.color,
        kind: 'rule',
        tab: parent.tab,
        rows,
        parent,
        ctx,
        conditions: [...parent.conditions, ...conds],
        mergeable,
        measure,
      })
    )
    children[children.length - 1].stop = Boolean(branch.stop)
  })

  if (level.elseBranch !== false) {
    const rows = parent.rows.filter((row) => !taken.has(row))
    if (rows.length) {
      children.push(
        makeNode({
          path: `${parent.path}/__else`,
          level: parent.level + 1,
          label: level.elseLabel || 'Everything else',
          kind: 'else',
          tab: parent.tab,
          rows,
          parent,
          ctx,
          conditions: parent.conditions,
          mergeable: false,
          measure,
        })
      )
    }
  }

  return children
}

/**
 * Numbers about the parent, rather than a breakdown of it.
 *
 * Each branch is a label plus its own aggregation, and optionally its own
 * conditions -- "of these, how many were financed, and what were they
 * worth". The rows stay a subset of the parent's, so a measure branch can
 * still be opened, drilled, and broken down further like anything else; what
 * changes is only which number it reports.
 */
function measureChildren(parent, level, ctx) {
  const items = (level.measures || []).filter((m) => m && m.label)

  return items.map((m, i) => {
    const conds = ownConditions(m.conditions, parent.tab)
    const rows = conds.length
      ? parent.rows.filter((row) => matchesConditions(row, conds, m.match || 'all', ctx.dateOrder))
      : parent.rows

    return makeNode({
      path: `${parent.path}/__m:${pathSafe(m.id || m.label || i)}`,
      level: parent.level + 1,
      label: m.label,
      icon: m.icon,
      color: m.color,
      kind: 'measure',
      tab: parent.tab,
      rows,
      parent,
      ctx,
      conditions: [...parent.conditions, ...conds],
      mergeable: parent.mergeable && (m.match || 'all') === 'all',
      measure: {
        aggregation: m.aggregation || 'count',
        column: m.column ?? null,
        format: m.format || parent.measure?.format || 'comma',
      },
    })
  })
}

/**
 * Branches taken from a list that lives on another tab.
 *
 * The difference from a plain breakdown is the whole reason this exists: a
 * value with no rows cannot appear in a grouping of those rows. Group this
 * month's sales by Model and a model nobody sold is simply absent -- and
 * "absent" is exactly the thing somebody needed to see. Reading the branches
 * from a reference tab instead makes the zero visible.
 *
 * Values are matched the forgiving way keys are (case, padding, 1,001 vs
 * 1001), because a reference list and a transaction sheet are typed by
 * different people on different days.
 */
function valueChildren(parent, level, ctx) {
  const { tab, column, matchColumn } = level
  if (!tab || !column || !matchColumn) return []
  const measure = levelMeasure(level, parent.measure)

  // The list, de-duplicated but in the reference tab's own order.
  const listed = new Map()
  for (const row of ctx.rowsByTab?.[tab] || []) {
    const raw = row[column]
    if (isBlank(raw)) continue
    const key = normalizeKey(raw)
    if (key !== null && !listed.has(key)) listed.set(key, String(raw).trim())
  }

  const buckets = new Map()
  const unmatched = []
  for (const row of parent.rows) {
    const key = normalizeKey(row[matchColumn])
    if (key === null || !listed.has(key)) {
      unmatched.push(row)
      continue
    }
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }

  let items = Array.from(listed.entries())
    .map(([key, label]) => ({ label, rows: buckets.get(key) || [] }))
    .filter((item) => item.rows.length > 0 || level.showZero !== false)
    .map((item) => ({ ...item, value: measureOf(item.rows, measure) }))

  items = sortItems(items, level.sort || 'value_desc')
  const top = Number(level.top) > 0 ? Number(level.top) : items.length
  items = items.slice(0, top)

  const children = items.map((item) =>
    makeNode({
      path: `${parent.path}/__v:${pathSafe(item.label)}`,
      level: parent.level + 1,
      label: item.label,
      kind: 'value',
      tab: parent.tab,
      rows: item.rows,
      parent,
      ctx,
      conditions: [...parent.conditions, { tab: parent.tab, column: matchColumn, operator: 'equals', value: item.label }],
      // The bucketing is more forgiving than any single condition can be, so
      // the chain stops being an exact description here and the branch
      // drills by row identity instead.
      mergeable: false,
      measure,
    })
  )

  // What the list does not account for. Without it the level would not add
  // up, and a typo'd model would be invisible in both directions.
  if (unmatched.length && level.unmatchedBucket !== false) {
    children.push(
      makeNode({
        path: `${parent.path}/__unlisted`,
        level: parent.level + 1,
        label: level.unmatchedLabel || 'Not on the list',
        kind: 'other',
        tab: parent.tab,
        rows: unmatched,
        parent,
        ctx,
        conditions: parent.conditions,
        mergeable: false,
        measure,
      })
    )
  }

  return children
}

/**
 * Other tabs, brought in whole.
 *
 * Nothing relates these to the branch above them, and the model says so:
 * they carry no share and no drop-off, because a percentage of something
 * they are not part of would be an invention. What they are for is the
 * flow that is a MAP rather than a decomposition -- sales, then service,
 * then reviews, each opening into its own levels underneath.
 */
function tableChildren(parent, level, ctx) {
  const sources = (level.sources || []).filter((src) => src && src.tab)

  return sources.map((src, i) => {
    const all = ctx.rowsByTab?.[src.tab] || []
    const conds = ownConditions(src.conditions, src.tab)
    const rows = conds.length
      ? all.filter((row) => matchesConditions(row, conds, src.match || 'all', ctx.dateOrder))
      : all

    return makeNode({
      path: `${parent.path}/__t:${pathSafe(src.id || src.tab || i)}`,
      level: parent.level + 1,
      label: src.label || src.tab,
      icon: src.icon || '🗂️',
      color: src.color,
      kind: 'table',
      tab: src.tab,
      rows,
      parent,
      ctx,
      // Its conditions are the whole truth about it -- there is no chain to
      // inherit, because there is no relationship to inherit it through.
      conditions: conds,
      mergeable: true,
      measure: levelMeasure(level, parent.measure),
      independent: true,
    })
  })
}

function hopChildren(parent, level, ctx) {
  const { tab, fromKey, toKey } = level
  if (!tab || !fromKey || !toKey) return []

  const wanted = new Set(parent.rows.map((r) => normalizeKey(r[fromKey])).filter((k) => k !== null))
  const rows = (ctx.rowsByTab?.[tab] || []).filter((r) => wanted.has(normalizeKey(r[toKey])))

  // A hop is a node, not a silent change of subject: seeing "1,284 vehicles
  // → 3,402 service jobs" IS the finding. Fan-out and fan-in are invisible
  // if the jump does not draw itself.
  return [
    makeNode({
      path: `${parent.path}/__hop:${pathSafe(tab)}`,
      level: parent.level + 1,
      label: level.label || tab,
      icon: level.icon || '🔗',
      color: level.color,
      kind: 'hop',
      tab,
      rows,
      parent,
      ctx,
      // Conditions written against the old tab say nothing about this one,
      // so the chain restarts here: from now on the KEY carries which
      // parents these rows belong to, and any conditions added below carry
      // which of their rows the branch is. Both halves travel together.
      conditions: [],
      mergeable: true,
      measure: levelMeasure(level, parent.measure),
      hop: { tab, fromKey, toKey },
    }),
  ]
}

function childrenOf(parent, level, ctx) {
  if (level.kind === 'rules') return ruleChildren(parent, level, ctx)
  if (level.kind === 'measures') return measureChildren(parent, level, ctx)
  if (level.kind === 'values') return valueChildren(parent, level, ctx)
  if (level.kind === 'hop') return hopChildren(parent, level, ctx)
  if (level.kind === 'tables') return tableChildren(parent, level, ctx)
  return splitChildren(parent, level, ctx)
}

/**
 * Could this level produce children at all? Asked before expanding, so the
 * chevron does not appear on a node that has nothing under it.
 */
function levelIsConfigured(level) {
  if (!level) return false
  if (level.kind === 'rules') return (level.branches || []).some((b) => (b.conditions || []).some((c) => c.column))
  if (level.kind === 'measures') return (level.measures || []).some((m) => m && m.label)
  if (level.kind === 'values') return Boolean(level.tab && level.column && level.matchColumn)
  if (level.kind === 'hop') return Boolean(level.tab && level.fromKey && level.toKey)
  if (level.kind === 'tables') return (level.sources || []).some((src) => src && src.tab)
  return Boolean(level.column)
}

// --- the tree ----------------------------------------------------------

/**
 * Builds the visible tree.
 *
 * Only expanded branches are materialised. That is not an optimisation
 * detail -- it is the interaction: the reader chooses the depth, and the
 * cost follows the choice rather than the configuration.
 *
 * `open` state is expressed as two sets rather than one so that "levels 0-1
 * open by default" and "but I closed this one" can both be true.
 */
export function buildFlow({
  widget,
  tree,
  rowsByTab,
  headersByTab,
  dateOrder = 'DMY',
  expanded = new Set(),
  collapsed = new Set(),
  autoExpand,
  levelOverrides = {},
  keyPrefix = '',
}) {
  const flow = { ...DEFAULT_FLOW, ...(widget?.flow || {}) }
  // One tree, whether it came from a list of them or from the flow itself.
  const spec = tree || flowTrees(widget)[0]
  const levels = (spec.levels || [])
    .filter(Boolean)
    .map((l) => ({ ...DEFAULT_FLOW_LEVEL, ...l, ...(levelOverrides[l.id] || {}) }))

  const rootTab = spec.tab || flowRootTab(widget)
  const blend = spec.blend
  const blended = blendIsReady(blend)

  // The join happens ONCE, before anything else: conditions, levels, splits
  // and measures all see the joined row, so a blended column is not a
  // special case anywhere below this line.
  const all = blended
    ? blendRows(
        rowsByTab?.[rootTab] || [],
        rowsByTab?.[blend.ref] || [],
        blend,
        headersByTab?.[blend.ref] || [],
        dateOrder
      )
    : rowsByTab?.[rootTab] || []

  const rootConditions = ownConditions(spec.conditions, rootTab)
  const rows = rootConditions.length
    ? all.filter((row) => matchesConditions(row, rootConditions, spec.match || 'all', dateOrder))
    : all

  const measure = spec.measure || flow.measure

  const ctx = {
    flow: { ...flow, measure },
    levels,
    rowsByTab,
    headersByTab,
    dateOrder,
    rootValue: measureOf(rows, measure),
    rootCount: rows.length,
    budget: Number(flow.maxNodes) > 0 ? Number(flow.maxNodes) : DEFAULT_FLOW.maxNodes,
    spent: 0,
    truncated: false,
  }

  const root = makeNode({
    path: '',
    level: 0,
    label: spec.label || flow.label || widget?.title || 'All rows',
    icon: spec.icon,
    color: spec.color,
    kind: 'root',
    tab: rootTab,
    rows,
    parent: null,
    ctx,
    conditions: rootConditions,
    // A blended row carries columns that exist on NEITHER tab under that
    // name, so no chain built from them can describe anything to the page.
    // What can: the key the blend joined on. Every drill in a blended tree
    // therefore travels as a key set -- the same way a blended chart's does.
    mergeable: !blended,
    measure,
  })

  if (blended) {
    root.keyColumn = blend.leftKey
    root.keyPairs = [
      { tab: rootTab, column: blend.leftKey },
      { tab: blend.ref, column: blend.rightKey },
    ]
  }

  const depth = autoExpand === undefined ? Number(flow.autoExpand) || 0 : autoExpand

  // Paths are unique within a tree but not between them, so a canvas with
  // several trees namespaces them. One set of open branches for the whole
  // widget keeps "expand all" and "collapse" honest across all of it.
  const key = (node) => `${keyPrefix}${node.path}`
  const isOpen = (node) => {
    if (collapsed.has(key(node))) return false
    return expanded.has(key(node)) || node.level < depth
  }

  ;(function grow(node) {
    const next = levels[node.level]
    if (!next || node.stop || !levelIsConfigured(next)) return
    node.hasChildren = true
    if (!isOpen(node)) return

    if (ctx.spent >= ctx.budget) {
      node.truncated = true
      ctx.truncated = true
      return
    }

    node.open = true
    node.children = childrenOf(node, next, ctx)
    ctx.spent += node.children.length
    for (const child of node.children) grow(child)
  })(root)

  return {
    root,
    tree: spec,
    levels,
    blended,
    depth: levels.length,
    truncated: ctx.truncated,
    total: root.value,
    tabs: uniq([
      rootTab,
      blended ? blend.ref : '',
      ...levels.filter((l) => (l.kind === 'hop' || l.kind === 'values') && l.tab).map((l) => l.tab),
      ...levels.flatMap((l) => (l.sources || []).map((src) => src.tab)),
    ]).filter(Boolean),
  }
}

/**
 * Every tree this widget draws.
 *
 * Each is an independent `buildFlow`, which is what makes them independent
 * in fact and not just on screen: separate table, separate blend, separate
 * measure, separate levels, separate budget. They share the canvas and the
 * set of open branches, and nothing else.
 */
export function buildFlowTrees({ widget, rowsByTab, headersByTab, dateOrder, expanded, collapsed, autoExpand, levelOverrides }) {
  const trees = flowTrees(widget)

  const built = trees.map((tree, i) =>
    buildFlow({
      widget,
      tree,
      rowsByTab,
      headersByTab,
      dateOrder,
      expanded,
      collapsed,
      autoExpand,
      levelOverrides,
      keyPrefix: trees.length > 1 ? `${tree.id || i}::` : '',
    })
  )

  return {
    trees: built,
    multi: built.length > 1,
    depth: Math.max(0, ...built.map((b) => b.depth)),
    truncated: built.some((b) => b.truncated),
    tabs: uniq(built.flatMap((b) => b.tabs)),
  }
}

/** The columns a tree's rows will actually have, blend included. */
export function flowTreeColumns(tree, headersByTab) {
  const base = headersByTab?.[tree?.tab] || []
  if (!blendIsReady(tree?.blend)) return base
  return blendedHeaders(base, headersByTab?.[tree.blend.ref] || [], tree.blend)
}

/** Walks the built tree for one node, by path. */
export function findFlowNode(root, path) {
  if (!root) return null
  if (root.path === path) return root
  for (const child of root.children || []) {
    const hit = findFlowNode(child, path)
    if (hit) return hit
  }
  return null
}

/** Every node currently materialised, depth-first -- what "expand all" acts on. */
export function flattenFlow(node, into = []) {
  if (!node) return into
  into.push(node)
  for (const child of node.children || []) flattenFlow(child, into)
  return into
}

/**
 * The cross-filter a node click puts on the page.
 *
 * Three shapes, most readable first:
 *
 *  - `conditions` whenever the chain from the root is still an honest flat
 *    AND. It reads well as a chip, it narrows every widget on that tab, and
 *    because it is a description rather than a snapshot, removing some other
 *    filter WIDENS it again instead of leaving it stuck.
 *  - `keys` on the join key once the flow has hopped tabs. This is the same
 *    mechanism a blended drill uses, so it reaches every tab that carries
 *    the key -- the whole page follows the flow across the spreadsheet
 *    boundary.
 *  - `keys` on `_row` for the nodes no flat AND can describe (an ANY branch,
 *    or a later branch of an exclusive level, whose real meaning includes
 *    "and none of the branches above"). The sheet row number is an exact
 *    identity, and naming only this tab in `keyColumns` keeps a row number
 *    from being matched against an unrelated tab's row numbers.
 *
 * The hopped shape carries BOTH halves of the branch's meaning: the keys say
 * which parents these rows belong to, and travel to every tab; the
 * conditions say which of those rows the branch is, and apply only on the
 * tab they were written against.
 */
export function flowNodeCanDrill(node) {
  if (!node) return false
  if (node.keyColumn && node.keyPairs?.length) return true
  if (node.conditions?.length) return true
  // Left: the untouched root, and a whole tab brought in with no conditions
  // on it. Filtering the page to "everything" is not a filter, so neither
  // offers the button rather than offering one that does nothing.
  return node.level > 0 && !node.independent
}

export function flowCrossFilter(widget, node) {
  if (!node || !flowNodeCanDrill(node)) return null
  const label = node.trail.slice(1).join(' → ') || node.label

  // A key exists after a hop, and also at the root of a blended tree. Both
  // mean the same thing here: this branch is addressable by something every
  // tab understands, which is strictly better than anything else on offer.
  if (node.keyColumn && node.keyPairs?.length) {
    const column = node.keyColumn
    return {
      id: `flow_${widget.id}`,
      kind: 'keys',
      value: node.path,
      keys: uniq(node.rows.map((row) => normalizeKey(row[column])).filter((k) => k !== null)),
      keyColumns: node.keyPairs,
      keyNames: uniq(node.keyPairs.map((p) => p.column)),
      // The half of the branch that only makes sense on its own tab. Without
      // it, "PDI jobs" would reach the page as "vehicles with a PDI job",
      // and the service table would show their other jobs too.
      conditions: node.mergeable ? node.conditions : [],
      match: 'all',
      icon: '🔗',
      label,
    }
  }

  if (node.mergeable && node.conditions.length) {
    return {
      id: `flow_${widget.id}`,
      kind: 'conditions',
      tab: node.tab,
      match: 'all',
      conditions: node.conditions,
      // Two different nodes are two different selections, so the page
      // REPLACES rather than stacks; clicking the same one again clears it.
      value: node.path,
      icon: '🔀',
      label,
    }
  }

  // Nothing describable left: fall back to the sheet row number, which is
  // an exact identity. Only this tab is named, because a row number means
  // nothing on another one.
  const keys = uniq(node.rows.map((row) => normalizeKey(row._row)).filter((k) => k !== null))

  return {
    id: `flow_${widget.id}`,
    kind: 'keys',
    value: node.path,
    keys,
    keyColumns: [{ tab: node.tab, column: '_row' }],
    keyNames: [],
    icon: '🔀',
    label,
  }
}

/** Is this node the one currently driving the page? */
export function flowNodeIsDrilled(widget, node, crossFilters) {
  return (crossFilters || []).some((cf) => cf.id === `flow_${widget.id}` && cf.value === node.path)
}

/**
 * A one-line summary of the path a flow takes, for the admin's widget card
 * and the dashboard subtitle -- so the shape is readable without expanding
 * anything.
 */
export function describeFlow(widget, labelFor = (t) => t) {
  return flowTrees(widget)
    .map((tree) => describeFlowTree(tree, labelFor))
    .join('  ·  ')
}

function describeFlowTree(tree, labelFor = (t) => t) {
  const parts = [labelFor(tree.tab) || 'root']
  if (blendIsReady(tree.blend)) parts[0] += ` + ${labelFor(tree.blend.ref)}`

  for (const level of tree.levels || []) {
    switch (level.kind) {
      case 'hop':
        parts.push(`🔗 ${labelFor(level.tab) || 'another tab'}`)
        break
      case 'tables':
        parts.push(`🗂️ ${(level.sources || []).map((s) => labelFor(s.tab)).filter(Boolean).join(' + ') || 'other tabs'}`)
        break
      case 'rules':
        parts.push(`${(level.branches || []).length} branches`)
        break
      case 'measures':
        parts.push(`${(level.measures || []).length} numbers`)
        break
      case 'values':
        parts.push(`${level.matchColumn || 'values'} from ${labelFor(level.tab) || 'a list'}`)
        break
      default:
        if (level.column) parts.push(level.column)
    }
  }
  return parts.join(' → ')
}
