import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { findStaleRefReads } from './staleRef.js'

test('a ref read from inside a state updater is found', () => {
  // The bug: the updater runs when React gets round to it, which can be
  // after the handler that cleared the ref.
  const src = `
    function movePan(e) {
      setView((v) => ({ ...v, x: drag.current.ox + e.clientX }))
    }`
  const found = findStaleRefReads(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].name, 'drag')
})

test('the fix reads it first, and that passes', () => {
  const src = `
    function movePan(e) {
      const d = drag.current
      if (!d) return
      const x = d.ox + e.clientX
      setView((v) => ({ ...v, x }))
    }`
  assert.deepEqual(findStaleRefReads(src), [])
})

test('a ref read OUTSIDE the callback is fine, because it happens now', () => {
  assert.deepEqual(findStaleRefReads('setView(drag.current.box)'), [])
  assert.deepEqual(findStaleRefReads('setOpen(ref.current !== null)'), [])
})

test('a plain value in an updater is fine', () => {
  assert.deepEqual(findStaleRefReads('setView((v) => ({ ...v, x: x + 1 }))'), [])
})

test('several updaters in one file are all checked', () => {
  const src = `
    setA((v) => v + one.current.x)
    setB((v) => v + 1)
    setC((v) => v + two.current.y)`
  assert.deepEqual(findStaleRefReads(src).map((p) => p.name), ['one', 'two'])
})

test('the line number points at the read', () => {
  const src = 'const a = 1\nconst b = 2\nsetView((v) => drag.current.x)'
  assert.equal(findStaleRefReads(src)[0].line, 3)
})

test('a ref that never moves is not a problem', () => {
  // `measure.current` is a callback held in a ref so it is always current;
  // there is no window in which it becomes null under a queued updater.
  assert.deepEqual(findStaleRefReads('setHeights((prev) => measure.current(prev))'), [])
})

test('something that only looks like a setter is left alone', () => {
  assert.deepEqual(findStaleRefReads('settle((v) => drag.current.x)'), [])
  assert.deepEqual(findStaleRefReads('reset((v) => drag.current.x)'), [])
})

// --- and the codebase itself ---------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.jsx?$/.test(entry.name) && !entry.name.endsWith('.test.js')) out.push(full)
  }
  return out
}

test('nothing in this project reads a ref from inside a state updater', () => {
  const problems = []
  for (const file of walk(SRC)) {
    for (const found of findStaleRefReads(fs.readFileSync(file, 'utf8'))) {
      problems.push(`${path.relative(SRC, file)}:${found.line} reads ${found.name}.current inside a state updater`)
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`)
})
