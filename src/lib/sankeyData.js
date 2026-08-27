// ---------------------------------------------------------------------
// Sankey -- where the rows went
// ---------------------------------------------------------------------
// A pivot table can tell you that 340 enquiries came from Referral and that
// 210 enquiries were Lost. What it cannot tell you, without the reader
// tracing a finger across a grid, is how much of the Referral column ended
// up in the Lost row -- and that is the only question anybody was asking.
//
// A Sankey answers it by making the quantity a WIDTH. Every row of the
// sheet becomes a thread; threads that share a path fuse into a ribbon; and
// a ribbon four times as thick as its neighbour is four times as many rows.
// Nothing has to be read off an axis, which is why it survives being looked
// at from the back of a room.
//
// Two rules keep it honest, and both are the difference between a Sankey
// and a decorative tangle:
//
//   - The aggregation must be ADDITIVE. A node's height is the sum of the
//     ribbons entering it, so an average would make the picture arithmetic
//     nonsense -- the editor therefore offers only the measures that sum.
//   - Overflow MERGES, it does not vanish. The fortieth-largest source is
//     folded into "Other" at full weight, so the ribbons still add up to
//     the total and the diagram cannot quietly lose rows.
//
// Pure: rows in, geometry out, every coordinate a fraction of the canvas.

import { aggregate, isBlank } from './dataUtils.js'

/**
 * The measures a Sankey may use.
 *
 * Deliberately short. Every one of these is additive -- the value of a
 * whole is the sum of its parts -- which is the property the layout
 * depends on. An average or a median would draw a diagram in which the
 * ribbons entering a node do not add up to it, and there is no way to make
 * that picture mean anything.
 */
export const SANKEY_AGGS = [
  { value: 'count', label: 'Count of rows', needsColumn: false },
  { value: 'sum', label: 'Sum of a column', needsColumn: true },
  { value: 'count_filled', label: 'Count where a column is filled', needsColumn: true },
]

export const DEFAULT_SANKEY = {
  // Two stages minimum, and as many more as the story needs. Stored as a
  // list rather than as `fromColumn` / `toColumn`, because "source →
  // status → outcome" is one question and not two charts.
  stages: [],
  aggregation: 'count',
  column: null,
  format: 'comma',
  maxNodes: 8,
  minShare: 0,
  includeBlank: true,
  blankLabel: '(blank)',
  otherLabel: 'Other',
  palette: 'default',
  nodeWidth: 14,
  nodeGap: 6,
  linkOpacity: 0.42,
  showValues: true,
  height: 360,
}

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

/**
 * The node column's width, as a fraction of the canvas.
 *
 * Lives here rather than in the component because the LAYOUT depends on it:
 * the last column has to be pulled back by exactly its own width, or its
 * nodes are drawn from x=1 rightwards and hang off the edge of the diagram.
 * Two copies of this number -- one placing the nodes, one drawing them --
 * is that bug waiting to happen.
 *
 * 900 is a nominal canvas width. The admin types pixels because that is
 * what a node width reads as; on a wider card the bar is proportionally
 * slimmer, which is the correct behaviour for a diagram that scales.
 */
export function nodeWidthFraction(px) {
  const n = Number(px)
  return Math.max(0.004, Math.min(0.06, (Number.isFinite(n) && n > 0 ? n : 14) / 900))
}

/** A cell as a node name -- blanks named rather than dropped. */
function nodeName(value, config) {
  return isBlank(value) ? config.blankLabel || '(blank)' : String(value).trim()
}

/**
 * The value of one group of rows.
 *
 * Routed through the shared `aggregate` so that a Sankey's numbers and a
 * KPI's numbers over the same rows are the same numbers -- a diagram that
 * disagrees with the card above it is worse than no diagram.
 */
function valueOf(rows, config) {
  return aggregate(rows, config.column, config.aggregation || 'count')
}

/**
 * Rows collected into the ribbons between each pair of adjacent stages.
 *
 * A row missing a value at some stage still counts, under the blank label,
 * because "we don't know where half of these went" is the finding, not the
 * thing to hide. Switching `includeBlank` off drops those rows from the
 * whole diagram rather than only from one stage -- a thread that
 * disappears mid-canvas would leave ribbons that no longer sum.
 */
export function sankeyLinks(rows, config) {
  const stages = (config.stages || []).filter(Boolean)
  const links = new Map()

  for (const row of rows || []) {
    const path = stages.map((col) => row[col])
    if (!config.includeBlank && path.some(isBlank)) continue

    for (let i = 0; i < stages.length - 1; i += 1) {
      const from = `${i}\u0000${nodeName(path[i], config)}`
      const to = `${i + 1}\u0000${nodeName(path[i + 1], config)}`
      const key = `${from}\u0001${to}`
      const bucket = links.get(key)
      if (bucket) bucket.rows.push(row)
      else links.set(key, { from, to, stage: i, rows: [row] })
    }
  }

  return links
}

/**
 * A node key back into its stage and its label.
 *
 * A node is addressed by BOTH, because the same value can legitimately
 * appear in two columns -- "Pending" as a status and "Pending" as an
 * outcome are two different blocks, and merging them would draw a ribbon
 * from a node to itself.
 *
 * The separators are control characters rather than a space or a dash for
 * the obvious reason: a spreadsheet cell can contain either of those, and a
 * key that a VALUE can forge is a key that silently merges two nodes.
 * U+0000 divides a stage from its label; U+0001 divides the two ends of a
 * link, so joining "0/X" to "11/Y" cannot produce the same string as
 * joining "0/X11" to "1/Y" -- which bare concatenation would, quietly
 * losing one of the two ribbons.
 */
const splitKey = (key) => {
  const at = key.indexOf('\u0000')
  return { stage: Number(key.slice(0, at)), label: key.slice(at + 1) }
}

/**
 * The top N nodes in each stage, with the rest folded into one.
 *
 * Applied per stage rather than globally: a stage with three values should
 * keep all three even when the stage beside it has ninety, and one shared
 * budget would spend itself on whichever stage happened to be listed first.
 */
function foldOverflow(links, config) {
  const maxNodes = clampInt(config.maxNodes, 2, 40, 8)
  const otherLabel = config.otherLabel || 'Other'

  // How big each node is, before anything is merged.
  const weight = new Map()
  const bump = (key, value) => weight.set(key, (weight.get(key) || 0) + value)
  for (const link of links.values()) {
    const value = valueOf(link.rows, config)
    link.value = value
    bump(link.from, value)
    bump(link.to, value)
  }

  // The keepers, per stage.
  const byStage = new Map()
  for (const [key, value] of weight) {
    const { stage, label } = splitKey(key)
    if (!byStage.has(stage)) byStage.set(stage, [])
    byStage.get(stage).push({ key, label, value })
  }

  const keep = new Set()
  for (const [, nodes] of byStage) {
    nodes.sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)))
    const total = nodes.reduce((a, n) => a + n.value, 0)
    const floor = (Math.max(0, Number(config.minShare) || 0) / 100) * total
    const eligible = nodes.filter((n) => n.value >= floor)

    // The same rule the series charts use (see pickSeries in seriesData.js):
    // the cap counts the merged block ITSELF, so "8 nodes" means eight
    // blocks on screen and not nine. And one node over the cap is left
    // alone -- an "Other" holding a single value hides its name for
    // nothing. Two dialects of "max series" in one app would be worse than
    // either rule on its own.
    const keepCount = eligible.length <= maxNodes + 1 ? eligible.length : maxNodes - 1
    eligible.slice(0, keepCount).forEach((n) => keep.add(n.key))
  }

  const rename = (key) => {
    if (keep.has(key)) return key
    const { stage } = splitKey(key)
    return `${stage}\u0000${otherLabel}`
  }

  // Re-key every link onto its surviving endpoints and re-merge the ones
  // that now share a path. Two different small sources both folded into
  // "Other" have to become ONE ribbon, or the diagram grows a stack of
  // hairlines that all say the same thing.
  const merged = new Map()
  for (const link of links.values()) {
    const from = rename(link.from)
    const to = rename(link.to)
    const key = `${from}\u0001${to}`
    const bucket = merged.get(key)
    if (bucket) {
      bucket.value += link.value
      bucket.rows.push(...link.rows)
    } else {
      merged.set(key, { from, to, stage: link.stage, value: link.value, rows: [...link.rows] })
    }
  }

  return { links: merged, folded: weight.size - keep.size, otherLabel }
}

/**
 * Nodes stacked in each column, and ribbons threaded between them.
 *
 * Everything is a fraction of the canvas height, so the component can be
 * any size without this module knowing what size that is. Node heights are
 * scaled so that the tallest COLUMN exactly fills the canvas -- scaling
 * each column to its own total instead would make a stage holding half the
 * rows look exactly as big as the stage holding all of them.
 */
export function sankeyData(widget, { rows = [] } = {}) {
  const config = { ...DEFAULT_SANKEY, ...(widget || {}) }
  const stages = (config.stages || []).filter(Boolean)

  if (stages.length < 2) {
    return { ready: false, stages: [], links: [], reason: 'Pick at least two columns', nodeWidth: nodeWidthFraction() }
  }

  const nodeFraction = nodeWidthFraction(config.nodeWidth)

  const { links, folded, otherLabel } = foldOverflow(sankeyLinks(rows, config), config)
  if (links.size === 0) return { ready: true, stages: [], links: [], total: 0, folded: 0, nodeWidth: nodeFraction }

  // Node totals, taken as the LARGER of what flows in and what flows out.
  // They differ at the ends of the diagram (nothing flows into stage one)
  // and wherever a stage lost rows to a blank, and a node drawn shorter
  // than the ribbons leaving it is a node the ribbons overflow.
  const inflow = new Map()
  const outflow = new Map()
  for (const link of links.values()) {
    outflow.set(link.from, (outflow.get(link.from) || 0) + link.value)
    inflow.set(link.to, (inflow.get(link.to) || 0) + link.value)
  }

  const nodesByStage = new Map()
  const allKeys = new Set([...inflow.keys(), ...outflow.keys()])
  for (const key of allKeys) {
    const { stage, label } = splitKey(key)
    const value = Math.max(inflow.get(key) || 0, outflow.get(key) || 0)
    if (!nodesByStage.has(stage)) nodesByStage.set(stage, [])
    nodesByStage.get(stage).push({ key, stage, label, value, isOther: label === otherLabel })
  }

  const gap = Math.max(0, Number(config.nodeGap) || 0) / 100
  const columns = []
  let tallest = 0

  for (let i = 0; i < stages.length; i += 1) {
    const nodes = nodesByStage.get(i) || []
    // "Other" always sinks to the bottom regardless of its size, so the eye
    // can skip it; everything else is biggest-first.
    nodes.sort((a, b) => Number(a.isOther) - Number(b.isOther) || b.value - a.value || String(a.label).localeCompare(String(b.label)))
    const total = nodes.reduce((a, n) => a + n.value, 0)
    tallest = Math.max(tallest, total)
    columns.push({ index: i, column: stages[i], nodes, total })
  }

  if (tallest <= 0) return { ready: true, stages: [], links: [], total: 0, folded, nodeWidth: nodeFraction }

  // Gaps eat into the canvas, so the value scale has to be computed against
  // what is left after the busiest column has paid for its own gaps.
  const maxGaps = Math.max(...columns.map((c) => Math.max(0, c.nodes.length - 1)))
  const usable = Math.max(0.25, 1 - gap * maxGaps)
  const scale = usable / tallest

  const nodeIndex = new Map()
  for (const column of columns) {
    let y = (1 - (column.total * scale + gap * Math.max(0, column.nodes.length - 1))) / 2
    column.nodes.forEach((node, order) => {
      node.order = order
      node.height = node.value * scale
      node.y0 = y
      node.y1 = y + node.height
      // Running offsets, consumed as the ribbons are threaded below.
      node.outCursor = node.y0
      node.inCursor = node.y0
      // Pulled back by the node's own width, so the LAST column's blocks
      // end flush with the right edge instead of starting at it and
      // hanging off the diagram.
      node.x = stages.length === 1 ? 0 : (column.index / (stages.length - 1)) * (1 - nodeFraction)
      nodeIndex.set(node.key, node)
      y += node.height + gap
    })
  }

  // Ribbons are threaded in the order their endpoints are stacked, which is
  // what stops them crossing more than they have to. Sorting by the SOURCE
  // order at the target end (and vice versa) is the whole trick: it keeps
  // parallel flows parallel instead of braiding them.
  const linkList = [...links.values()].map((link) => ({
    ...link,
    source: nodeIndex.get(link.from),
    target: nodeIndex.get(link.to),
  }))

  linkList.sort(
    (a, b) =>
      a.stage - b.stage ||
      (a.source?.order ?? 0) - (b.source?.order ?? 0) ||
      (a.target?.order ?? 0) - (b.target?.order ?? 0)
  )

  for (const link of linkList) {
    if (!link.source || !link.target) continue
    const thickness = link.value * scale
    link.sourceY = link.source.outCursor
    link.source.outCursor += thickness
    link.thickness = thickness
  }

  // A second pass for the target ends, ordered by the target's stacking so
  // the arrivals are sorted the same way the departures were.
  const byTarget = [...linkList].sort(
    (a, b) => (a.target?.order ?? 0) - (b.target?.order ?? 0) || (a.source?.order ?? 0) - (b.source?.order ?? 0)
  )
  for (const link of byTarget) {
    if (!link.target) continue
    link.targetY = link.target.inCursor
    link.target.inCursor += link.thickness
  }

  return {
    ready: true,
    stages: columns,
    links: linkList,
    total: columns[0]?.total || 0,
    folded,
    otherLabel,
    columnNames: stages,
    // Handed back so the component draws the blocks at exactly the width
    // the layout reserved for them.
    nodeWidth: nodeFraction,
  }
}

/**
 * The ribbon as an SVG path, in a 0→1 × 0→1 box.
 *
 * Cubic curves with their control points at the horizontal midpoint: the
 * classic Sankey shape, which leaves both ends flat against their node so
 * the ribbon reads as joining the block rather than as pointing at it.
 */
export function ribbonPath(link, { nodeWidth = 0.02 } = {}) {
  if (!link.source || !link.target) return ''
  const x0 = Math.min(1, link.source.x + nodeWidth)
  const x1 = Math.max(0, link.target.x)
  const mid = (x0 + x1) / 2

  const sy0 = link.sourceY
  const sy1 = link.sourceY + link.thickness
  const ty0 = link.targetY
  const ty1 = link.targetY + link.thickness

  return [
    `M${x0},${sy0}`,
    `C${mid},${sy0} ${mid},${ty0} ${x1},${ty0}`,
    `L${x1},${ty1}`,
    `C${mid},${ty1} ${mid},${sy1} ${x0},${sy1}`,
    'Z',
  ].join(' ')
}
