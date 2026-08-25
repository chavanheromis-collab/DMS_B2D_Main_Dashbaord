import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { blankOut, findTdzUses } from './tdz.js'

// --- the scanner ----------------------------------------------------------

test('comments and strings are blanked, and every index still points where it did', () => {
  const src = "const a = 'const b = 1' // const c = 2\nconst d = 3"
  const out = blankOut(src)
  assert.equal(out.length, src.length, 'positions must not move')
  assert.equal(out.includes('const b'), false, 'code inside a string is not code')
  assert.equal(out.includes('const c'), false, 'nor is code inside a comment')
  assert.equal(out.includes('const d'), true)
  assert.equal(out.split('\n').length, 2, 'and the lines still line up')
})

test('a use before the const that declares it is found', () => {
  // The bug, three times over in one week.
  const problems = findTdzUses('function f() {\n  use(width)\n  const width = 2\n}')
  assert.equal(problems.length, 1)
  assert.equal(problems[0].name, 'width')
  assert.equal(problems[0].line, 2)
  assert.equal(problems[0].declaredLine, 3)
})

test('the object-literal shape that actually happened', () => {
  const src = `
    function render(items) {
      return items.map((item) => {
        const left = 1
        store[item.id] = { left, width }
        const width = drawnWidth(item)
        return width
      })
    }`
  const problems = findTdzUses(src)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].name, 'width')
})

test('the hook-dependency shape that actually happened', () => {
  const src = `
    function C() {
      const scope = useMemo(() => 1, [access])
      const access = map[id]
      return scope + access
    }`
  assert.equal(findTdzUses(src)[0].name, 'access')
})

test('a use after the declaration is fine', () => {
  assert.deepEqual(findTdzUses('function f() {\n  const w = 2\n  use(w)\n}'), [])
})

// --- what it must NOT flag ------------------------------------------------

test('a handler mentioning something declared below it is fine', () => {
  // It runs after the render that defines it. Flagging these would be
  // nothing but false alarms, which is how a guard gets switched off.
  const src = `
    function C() {
      const onClick = () => later()
      const later = () => 1
      return onClick
    }`
  assert.deepEqual(findTdzUses(src), [])
})

test('a name declared in another function is not this function’s problem', () => {
  const src = `
    function a() { use(x) }
    function b() { const x = 1; return x }`
  assert.deepEqual(findTdzUses(src), [])
})

test('a property key is not a use', () => {
  const src = 'function f() {\n  const box = { width: 1 }\n  const width = box.width\n  return width\n}'
  assert.deepEqual(findTdzUses(src), [])
})

test('a member access is not a use of the variable', () => {
  const src = 'function f(p) {\n  const a = p.width\n  const width = a\n  return width\n}'
  assert.deepEqual(findTdzUses(src), [])
})

test('an if block is a block, not a function, so it is still checked', () => {
  const src = 'function f(c) {\n  if (c) {\n    use(w)\n  }\n  const w = 1\n  return w\n}'
  assert.equal(findTdzUses(src).length, 1, 'an if body runs immediately')
})

test('a shadowing const in an inner scope is not the outer one', () => {
  const src = `
    function f() {
      const w = 1
      function g() {
        const w = 2
        return w
      }
      return w + g()
    }`
  assert.deepEqual(findTdzUses(src), [])
})

test('the word const inside a longer name is not a declaration', () => {
  assert.deepEqual(findTdzUses('function f() {\n  const constant = 1\n  return constant\n}'), [])
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

test('nothing in this project uses a const before it exists', () => {
  const problems = []
  for (const file of walk(SRC)) {
    for (const found of findTdzUses(fs.readFileSync(file, 'utf8'))) {
      problems.push(`${path.relative(SRC, file)}:${found.line} uses '${found.name}', declared on line ${found.declaredLine}`)
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`)
})
