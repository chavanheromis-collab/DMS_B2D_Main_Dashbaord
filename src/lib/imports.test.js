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
  //
  // BOTH sides of a colon. In `{ icon: Icon }` the binding introduced is
  // `Icon` -- the right -- and taking only the left reported every renamed
  // prop as an undeclared component. A scanner that cries wolf is a scanner
  // people learn to ignore, which is worse than not having one.
  for (const [, block] of text.matchAll(/\{([^{}]*)\}\s*(?:=|\)|,)/g)) {
    for (const part of block.split(',')) {
      const [left, right] = part.split(':')
      for (const half of [left, right]) {
        const name = String(half || '').split('=')[0].trim().replace(/^\.\.\./, '')
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
      }
    }
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

// And the third face of it: a hook that reads something declared further
// down the same component. `const scope = useMemo(..., [access])` written
// above `const access = ...` compiles, builds, and throws "Cannot access
// 'access' before initialization" the moment the page mounts -- because a
// dependency array is evaluated during render, not later like the callback
// bodies around it.
//
// Only dependency arrays are checked, and only against consts declared in
// the same function. A handler that mentions something declared below it is
// perfectly fine -- it runs after the render that defines it -- so looking
// at ordinary code here would be all false alarms.
const HOOK_DEPS = /\b(?:useMemo|useCallback|useEffect|useLayoutEffect)\s*\([\s\S]*?,\s*\[([^\]]*)\]\s*\)/g

/** Each top-level function in a file, as [name, body, offset]. */
function topLevelFunctions(text) {
  const out = []
  const starts = [...text.matchAll(/^(?:export (?:default )?)?function ([A-Za-z_$][\w$]*)/gm)]
  starts.forEach((m, i) => {
    const from = m.index
    const to = i + 1 < starts.length ? starts[i + 1].index : text.length
    out.push([m[1], text.slice(from, to), from])
  })
  return out
}

test('no hook depends on something declared below it', () => {
  const problems = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')

    for (const [fn, body] of topLevelFunctions(text)) {
      // Where each const in this function is introduced.
      const declaredAt = new Map()
      for (const m of body.matchAll(/^\s{2}const\s+([A-Za-z_$][\w$]*)\s*=/gm)) {
        if (!declaredAt.has(m[1])) declaredAt.set(m[1], m.index)
      }

      HOOK_DEPS.lastIndex = 0
      for (const m of body.matchAll(HOOK_DEPS)) {
        for (const raw of m[1].split(',')) {
          const dep = raw.trim().split(/[.?[]/)[0]
          const at = declaredAt.get(dep)
          if (at !== undefined && at > m.index) {
            problems.push(`${path.relative(SRC, file)}: ${fn}() has a hook depending on '${dep}', declared below it`)
          }
        }
      }
    }
  }

  assert.deepEqual(Array.from(new Set(problems)), [], `\n${problems.join('\n')}\n`)
})

// ---------------------------------------------------------------------
// Hook results that were never destructured
// ---------------------------------------------------------------------
// The third way a free identifier has got into this codebase, after a
// missing import and an unrendered component: a hook returns `{ send,
// reply, ... }`, a file destructures some of them, and then uses one it
// left out.
//
//     const { markRead, reply } = useMessageActions()
//     ...
//     send({ ... })          // ReferenceError, at render, in production
//
// Vite compiles it without a murmur -- it is a perfectly good reference to
// a global that does not exist -- so nothing says a word until the page is
// open. That is exactly what happened to `send` when the compose form moved
// into the chat panel and took its own `useMessageActions()` call with it.

/** Every `useX` the project defines, and the names it returns. */
const hookResults = new Map()
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const [, name, body] of text.matchAll(
    /export function (use[A-Z][\w$]*)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g
  )) {
    // The LAST plain `return { a, b, c }` in the body: a hook that returns
    // early with a different shape is still described by its main one.
    const returns = [...body.matchAll(/return \{\s*([A-Za-z0-9_$,\s]+?)\s*\}/g)]
    if (returns.length === 0) continue
    const names = returns[returns.length - 1][1]
      .split(',')
      .map((n) => n.trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
    // Keyed with the file that DEFINES it, so that file is skipped below:
    // a hook naturally uses the state it returns, and flagging it would be
    // the scanner reporting every hook in the project.
    if (names.length) hookResults.set(name, { names: new Set(names), home: file })
  }
}

test('the project has hooks whose shape can be checked', () => {
  // If the regex above ever stops matching, every check below passes by
  // finding nothing -- which is the quietest way for a scanner to die.
  assert.ok(hookResults.size >= 3, `only found ${hookResults.size} hooks`)
  assert.ok(hookResults.get('useMessageActions')?.names.has('send'))
})

/**
 * Names one file takes from a hook without destructuring them.
 *
 * A function rather than a loop body so it can be aimed at a snippet whose
 * answer is known -- see the positive control below.
 */
function unboundHookNames(text, hooks, self = null) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
  const known = bindings(clean)
  const out = []
  let checked = 0

  for (const [hook, { names, home }] of hooks) {
    if (home && home === self) continue
    if (!clean.includes(`${hook}(`)) continue
    checked += 1
    for (const name of names) {
      // Bare, and read as a value ANYWHERE -- called, passed, or handed to
      // JSX as `notes={notes}`. Not `something.send`, not a longer
      // identifier that happens to start with it, and not `send:` where it
      // is a key rather than a reference.
      const used = new RegExp(`(^|[^.\\w$])${name}(?![\\w$:])`, 'm')
      if (!used.test(clean)) continue
      if (known.has(name)) continue
      out.push({ name, hook })
    }
  }
  return { problems: out, checked }
}

test('the check itself reports a bug it is shown, and stays quiet otherwise', () => {
  // The positive control. Every other assertion here is about real files
  // being clean, and "clean" is exactly what a check that has stopped
  // working also reports. This one fails unless the thing actually detects.
  const hooks = new Map([['useThing', { names: new Set(['send', 'reply']), home: null }]])

  const bad = 'const { reply } = useThing()\nfunction go() { send({ body: 1 }) }'
  assert.deepEqual(
    unboundHookNames(bad, hooks).problems.map((p) => p.name),
    ['send'],
    'a name used but not destructured must be reported'
  )

  const good = 'const { send, reply } = useThing()\nfunction go() { send({ body: 1 }) }'
  assert.deepEqual(unboundHookNames(good, hooks).problems, [], 'and a correct file must not be')

  const jsx = 'const { reply } = useThing()\nconst el = <Row send={send} />'
  assert.deepEqual(
    unboundHookNames(jsx, hooks).problems.map((p) => p.name),
    ['send'],
    'a value handed to JSX is a use like any other'
  )

  const unused = 'const { reply } = useThing()\nconst x = other.send(1)'
  assert.deepEqual(unboundHookNames(unused, hooks).problems, [], 'a property is not a bare name')
})

test('every name a file takes from a hook is a name it destructured', () => {
  // NOTE the limit: `bindings` is file-scoped, not scope-aware, so a name
  // bound anywhere in the file -- a prop of some other component in it, say
  // -- counts as bound. It catches the destructure that was forgotten, not
  // every possible shadowing.
  const problems = []
  let checked = 0

  for (const file of files) {
    const found = unboundHookNames(fs.readFileSync(file, 'utf8'), hookResults, file)
    checked += found.checked
    for (const { name, hook } of found.problems) {
      problems.push(
        `${path.relative(SRC, file)} uses \`${name}\` from ${hook}() without destructuring it`
      )
    }
  }

  // Widen the skip above by one character and this inspects nothing at all,
  // then reports success. A scanner that has quietly died is worse than no
  // scanner, because it is trusted.
  assert.ok(checked >= 3, `only inspected ${checked} hook call sites`)
  assert.deepEqual(problems, [])
})
