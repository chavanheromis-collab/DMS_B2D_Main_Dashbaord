import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SANKEY, ribbonPath, sankeyData, sankeyLinks } from './sankeyData.js'

const rows = (spec) => spec.flatMap(([from, to, n]) => Array.from({ length: n }, () => ({ A: from, B: to })))

const config = (over = {}) => ({ ...DEFAULT_SANKEY, stages: ['A', 'B'], ...over })

// --- the ribbons ---------------------------------------------------------

test('one stage is not a diagram', () => {
  const data = sankeyData({ stages: ['A'] }, { rows: rows([['x', 'y', 3]]) })
  assert.equal(data.ready, false)
})

test('every row becomes a thread, and threads on the same path fuse', () => {
  const links = sankeyLinks(rows([['Web', 'Won', 3], ['Web', 'Lost', 2], ['Ref', 'Won', 5]]), config())
  assert.equal(links.size, 3)
  assert.equal([...links.values()].reduce((a, l) => a + l.rows.length, 0), 10)
})

test('a blank is named and charted rather than quietly dropped', () => {
  const data = sankeyData(config(), { rows: [{ A: 'Web', B: '' }, { A: 'Web', B: 'Won' }] })
  const labels = data.stages[1].nodes.map((n) => n.label)
  assert.ok(labels.includes('(blank)'))
  assert.equal(data.total, 2, 'the total still counts every row')
})

test('switching blanks off drops the whole row, not just one stage', () => {
  // A thread that disappears mid-canvas leaves ribbons that no longer sum,
  // which is worse than either including or excluding it outright.
  const data = sankeyData(config({ includeBlank: false }), {
    rows: [{ A: 'Web', B: '' }, { A: 'Web', B: 'Won' }],
  })
  assert.equal(data.total, 1)
})

// --- the overflow --------------------------------------------------------

test('overflow merges at full weight, so the ribbons still add up', () => {
  const spec = Array.from({ length: 20 }, (_, i) => [`S${i}`, 'Won', 20 - i])
  const total = spec.reduce((a, s) => a + s[2], 0)
  const data = sankeyData(config({ maxNodes: 5 }), { rows: rows(spec) })

  const sourceTotal = data.stages[0].nodes.reduce((a, n) => a + n.value, 0)
  assert.equal(sourceTotal, total, 'nothing was lost to the cut')
  assert.equal(data.stages[0].nodes.length, 5)
  assert.ok(data.stages[0].nodes.some((n) => n.isOther))
})

test('two small sources folded into Other become ONE ribbon, not a stack of hairlines', () => {
  const data = sankeyData(config({ maxNodes: 2 }), {
    rows: rows([['Big', 'Won', 50], ['Tiny1', 'Won', 1], ['Tiny2', 'Won', 1], ['Tiny3', 'Won', 1]]),
  })
  const intoWon = data.links.filter((l) => l.target.label === 'Won')
  assert.equal(intoWon.length, 2, 'Big, and one merged Other')
  assert.equal(intoWon.find((l) => l.source.isOther).value, 3)
})

test('the cap is spent per stage, not shared across them', () => {
  // A stage with three values should keep all three even when the stage
  // beside it has ninety.
  const spec = Array.from({ length: 12 }, (_, i) => [`S${i}`, i % 2 ? 'Won' : 'Lost', 5])
  const data = sankeyData(config({ maxNodes: 4 }), { rows: rows(spec) })
  assert.equal(data.stages[0].nodes.length, 4)
  assert.equal(data.stages[1].nodes.length, 2, 'the second stage only ever had two values')
})

// --- the layout ----------------------------------------------------------

test('nodes never overlap and never leave the canvas', () => {
  const data = sankeyData(config({ nodeGap: 6 }), {
    rows: rows([['A', 'X', 10], ['B', 'X', 6], ['C', 'Y', 4]]),
  })

  for (const column of data.stages) {
    const sorted = [...column.nodes].sort((a, b) => a.y0 - b.y0)
    for (let i = 0; i < sorted.length; i += 1) {
      assert.ok(sorted[i].y0 >= -0.001 && sorted[i].y1 <= 1.001, 'inside the canvas')
      if (i > 0) assert.ok(sorted[i].y0 >= sorted[i - 1].y1 - 0.001, 'no overlap')
    }
  }
})

test('the busiest column fills the canvas, and a thinner one does not pretend to', () => {
  // Scaling each column to its own total would make a stage holding half
  // the rows look exactly as big as the stage holding all of them.
  const data = sankeyData(config({ includeBlank: false }), {
    rows: [
      { A: 'X', B: 'Won' },
      { A: 'X', B: 'Won' },
      { A: 'X', B: '' },
      { A: 'X', B: '' },
    ],
  })
  const first = data.stages[0].nodes.reduce((a, n) => a + n.height, 0)
  const second = data.stages[1].nodes.reduce((a, n) => a + n.height, 0)
  assert.ok(first >= second - 0.001)
})

test('a node is at least as tall as the ribbons leaving it', () => {
  const data = sankeyData({ ...DEFAULT_SANKEY, stages: ['A', 'B', 'C'] }, {
    rows: [
      { A: 'S', B: 'M', C: 'E' },
      { A: 'S', B: 'M', C: 'E' },
      { A: 'S', B: 'N', C: 'E' },
    ],
  })
  for (const link of data.links) {
    assert.ok(link.thickness <= link.source.height + 0.001, 'the ribbon fits its source')
    assert.ok(link.thickness <= link.target.height + 0.001, 'and its target')
  }
})

test('ribbons stack inside their node without spilling out of it', () => {
  const data = sankeyData(config(), { rows: rows([['A', 'X', 5], ['A', 'Y', 5], ['A', 'Z', 5]]) })
  const source = data.stages[0].nodes[0]
  const leaving = data.links.filter((l) => l.source.key === source.key)

  assert.equal(leaving.length, 3)
  const lowest = Math.min(...leaving.map((l) => l.sourceY))
  const highest = Math.max(...leaving.map((l) => l.sourceY + l.thickness))
  assert.ok(lowest >= source.y0 - 0.001)
  assert.ok(highest <= source.y1 + 0.001)
})

test('Other sinks to the bottom whatever its size', () => {
  const spec = [['Big', 'X', 3], ...Array.from({ length: 10 }, (_, i) => [`T${i}`, 'X', 20])]
  const data = sankeyData(config({ maxNodes: 3 }), { rows: rows(spec) })
  const nodes = data.stages[0].nodes
  assert.equal(nodes[nodes.length - 1].isOther, true, 'so the eye can skip it')
})

// --- the path ------------------------------------------------------------

test('a ribbon path is a closed shape with both ends flat', () => {
  const data = sankeyData(config(), { rows: rows([['A', 'X', 5]]) })
  const path = ribbonPath(data.links[0], { nodeWidth: 0.02 })
  assert.ok(path.startsWith('M'))
  assert.ok(path.endsWith('Z'), 'closed, or the fill leaks')
  assert.equal((path.match(/C/g) || []).length, 2, 'one curve down each side')
})

test('a link with a missing end draws nothing rather than NaN', () => {
  assert.equal(ribbonPath({ source: null, target: null }), '')
})
