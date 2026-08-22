import { aggregate, isBlank, normalizeKey } from './dataUtils.js'
import { matchesConditions } from './filterEngine.js'

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
//   split  break the rows down by a column -- one child per value, top N,
//          with an "Other" bucket so the total still reconciles.
//   rules  branch on admin-written conditions -- the multi-column case
//          ("Hot / Warm / Cold", "over 90 days AND unpaid"). Exclusive by
//          default, which is what makes it read as a decision tree.
//   hop    follow a key column into ANOTHER TAB. This is what lets one
//          flow cross spreadsheets: the child's rows are the rows of the
//          other tab whose key appears in the parent's rows.
//
// Levels are the backbone, applied at every branch, so an admin describes
// depth once instead of drawing a diagram. A single branch can opt out with
// `stop`, which is what gives a real flowchart its asymmetry -- "Lost" does
// not need breaking down five ways.
//
// Nothing here is new vocabulary: conditions are the SAME shape the buttons
// and blend fill-ins use, evaluated by the same `matchesConditions`, and the
// measure is the same `aggregate` every KPI uses.

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
    value: 'hop',
    label: 'Follow a key into another tab',
    hint: 'Continue the flow on a second tab, matched on a key column.',
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
  match: 'all',
  conditions: [],
  measure: { aggregation: 'count', column: null, format: 'comma' },
  metrics: [],
  levels: [],
  percentBase: 'parent',
  showDropOff: true,
  showBars: true,
  autoExpand: 1,
  // A ceiling on how many nodes one render may build. Depth is multiplicative
  // -- five levels of eight children is 32,768 nodes -- so "expand all" on a
  // deep flow has to stop somewhere rather than lock the tab.
  maxNodes: 400,
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
  tab: '',
  fromKey: '',
  toKey: '',
  label: '',
}

/** Is this flow configured enough to draw anything? */
export function flowIsReady(widget) {
  return Boolean(widget?.tab)
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
function makeNode({ path, level, label, icon, color, kind, tab, rows, parent, ctx, conditions, mergeable, hop }) {
  const measure = ctx.flow.measure
  const additive = ADDITIVE.has(measure?.aggregation || 'count')
  const value = measureOf(rows, measure)
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
    additive,
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

  const base = additive ? parent?.value : parent?.count
  const mine = additive ? value : count
  node.share = parent ? (base ? mine / base : 0) : 1
  const rootBase = additive ? ctx.rootValue : ctx.rootCount
  node.shareOfRoot = rootBase ? mine / rootBase : 0
  node.dropOff = parent ? 1 - node.share : 0

  return node
}

// --- the three ways a node becomes children ---------------------------

function splitChildren(parent, level, ctx) {
  const column = level.column
  if (!column) return []

  const buckets = new Map()
  const blanks = []
  for (const row of parent.rows) {
    const raw = row[column]
    if (isBlank(raw)) {
      blanks.push(row)
      continue
    }
    const key = String(raw).trim()
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }

  let items = Array.from(buckets.entries()).map(([label, rows]) => ({
    label,
    rows,
    value: measureOf(rows, ctx.flow.measure),
  }))

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const sort = level.sort || 'value_desc'
  if (sort === 'value_desc') items.sort((a, b) => b.value - a.value)
  else if (sort === 'value_asc') items.sort((a, b) => a.value - b.value)
  else if (sort === 'name_asc') items.sort((a, b) => collator.compare(a.label, b.label))
  else if (sort === 'name_desc') items.sort((a, b) => collator.compare(b.label, a.label))

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
      conditions: [...parent.conditions, { tab: parent.tab, column, operator: 'equals', value: item.label }],
      mergeable: parent.mergeable,
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
        mergeable: parent.mergeable,
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
      })
    )
  }

  return children
}

function ruleChildren(parent, level, ctx) {
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
        })
      )
    }
  }

  return children
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
      hop: { tab, fromKey, toKey },
    }),
  ]
}

function childrenOf(parent, level, ctx) {
  if (level.kind === 'rules') return ruleChildren(parent, level, ctx)
  if (level.kind === 'hop') return hopChildren(parent, level, ctx)
  return splitChildren(parent, level, ctx)
}

/**
 * Could this level produce children at all? Asked before expanding, so the
 * chevron does not appear on a node that has nothing under it.
 */
function levelIsConfigured(level) {
  if (!level) return false
  if (level.kind === 'rules') return (level.branches || []).some((b) => (b.conditions || []).some((c) => c.column))
  if (level.kind === 'hop') return Boolean(level.tab && level.fromKey && level.toKey)
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
  rowsByTab,
  dateOrder = 'DMY',
  expanded = new Set(),
  collapsed = new Set(),
  autoExpand,
  levelOverrides = {},
}) {
  const flow = { ...DEFAULT_FLOW, ...(widget?.flow || {}) }
  const levels = (flow.levels || [])
    .filter(Boolean)
    .map((l) => ({ ...DEFAULT_FLOW_LEVEL, ...l, ...(levelOverrides[l.id] || {}) }))

  const rootTab = widget?.tab || ''
  const all = rowsByTab?.[rootTab] || []
  const rootConditions = ownConditions(flow.conditions, rootTab)
  const rows = rootConditions.length
    ? all.filter((row) => matchesConditions(row, rootConditions, flow.match || 'all', dateOrder))
    : all

  const ctx = {
    flow,
    levels,
    rowsByTab,
    dateOrder,
    rootValue: measureOf(rows, flow.measure),
    rootCount: rows.length,
    budget: Number(flow.maxNodes) > 0 ? Number(flow.maxNodes) : DEFAULT_FLOW.maxNodes,
    spent: 0,
    truncated: false,
  }

  const root = makeNode({
    path: '',
    level: 0,
    label: flow.label || widget?.title || 'All rows',
    kind: 'root',
    tab: rootTab,
    rows,
    parent: null,
    ctx,
    conditions: rootConditions,
    mergeable: true,
  })

  const depth = autoExpand === undefined ? Number(flow.autoExpand) || 0 : autoExpand

  const isOpen = (node) => {
    if (collapsed.has(node.path)) return false
    return expanded.has(node.path) || node.level < depth
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
    levels,
    depth: levels.length,
    truncated: ctx.truncated,
    total: root.value,
    tabs: uniq([rootTab, ...levels.filter((l) => l.kind === 'hop' && l.tab).map((l) => l.tab)]),
  }
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
export function flowCrossFilter(widget, node) {
  if (!node) return null
  const label = node.trail.slice(1).join(' → ') || node.label

  if (node.hopped) {
    const column = node.keyColumn || '_row'
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
  const flow = { ...DEFAULT_FLOW, ...(widget?.flow || {}) }
  const parts = [labelFor(widget?.tab) || 'root']
  for (const level of flow.levels || []) {
    if (level.kind === 'hop') parts.push(`🔗 ${labelFor(level.tab) || 'another tab'}`)
    else if (level.kind === 'rules') parts.push(`${(level.branches || []).length} branches`)
    else if (level.column) parts.push(level.column)
  }
  return parts.join(' → ')
}
