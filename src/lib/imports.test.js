import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// The one thing the build will not tell you
// ---------------------------------------------------------------------
// Vite compiles a free identifier without complaint and throws only when
// that branch renders. So a missing import ships green, passes every unit
// test, and crashes the widget the moment somebody opens the page it is on.
//
// It has happened three times in this codebase -- an ExportButton used
// without importing it, a `series` that existed in two of three sibling
// components, a `groupKey` threaded into a widget whose import line was
// never updated. Each was found by a person looking at a broken screen.
//
// This finds them instead. Deliberately narrow: only names this project's
// own lib modules export, and only where they are CALLED. A string literal
// is never followed by an open bracket, which keeps the noise down without
// having to parse JavaScript.

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

const files = walk(SRC)

/** Every function `src/lib` exports, and which file it lives in. */
const exported = new Map()
for (const file of files) {
  if (path.dirname(file) !== path.join(SRC, 'lib')) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const [, name] of text.matchAll(/export (?:async )?function ([A-Za-z_$][\w$]*)/g)) {
    if (!exported.has(name)) exported.set(name, file)
  }
}

/** Every name a file could legitimately be calling. */
function bindings(text) {
  const names = new Set()
  // One pass over the whole clause, because `import A, { b as c } from` is
  // three bindings in one line and matching the halves separately misses
  // both of them.
  for (const [, clause] of text.matchAll(/import\s+([^;]*?)\s+from\s*['"]/g)) {
    for (const part of clause.replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  for (const [, name] of text.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(name)
  // Destructured bindings: props, options objects, hook results.
  for (const [, block] of text.matchAll(/\{([^{}]*)\}\s*(?:=|\)|,)/g)) {
    for (const part of block.split(',')) names.add(part.trim().split(':')[0].split('=')[0].trim())
  }
  return names
}

test('every lib function a file calls is a function it can see', () => {
  assert.ok(exported.size > 50, 'the export scan itself has to be finding things')

  const problems = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const known = bindings(text)

    for (const [name, home] of exported) {
      if (home === file || known.has(name)) continue
      if (new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(text)) {
        problems.push(`${path.relative(SRC, file)} calls ${name}() from ${path.relative(SRC, home)}`)
      }
    }
  }

  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`)
})

// The same bug wearing a different hat: <ScopeEditor /> written before the
// component was added, or a component moved to another file and the import
// left behind. React renders the page fine right up to that element and then
// throws "X is not defined" -- again only for whoever opens that screen.
test('every component a file renders is a component it can see', () => {
  const problems = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    if (!/\.jsx$/.test(file)) continue
    const known = bindings(text)

    for (const [, used] of text.matchAll(/<([A-Z][\w$]*)[\s/>.]/g)) {
      if (known.has(used)) continue
      problems.push(`${path.relative(SRC, file)} renders <${used}>, which it never imports or declares`)
    }
  }

  assert.deepEqual(Array.from(new Set(problems)), [], `\n${problems.join('\n')}\n`)
})
