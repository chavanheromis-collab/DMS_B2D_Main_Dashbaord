// ---------------------------------------------------------------------
// Using a `const` before the line that declares it
// ---------------------------------------------------------------------
// Three times in one week, in three different shapes:
//
//   const scope = useMemo(..., [access])   // `access` is declared below
//   layoutRef.current[id] = { width }      // `const width` is two lines down
//
// Every one built clean, passed every test, and threw "Cannot access 'x'
// before initialization" the moment the component rendered -- because a
// `const` is hoisted but not initialised, and touching it in between is a
// runtime error the compiler is under no obligation to notice.
//
// The existing guard only checked hook DEPENDENCY ARRAYS, which caught one
// of the three. This finds the family: any straight-line use of a name
// before the `const` that declares it, in the same scope or a plain block
// inside it.
//
// It deliberately does NOT flag a use inside a nested FUNCTION. A handler
// that mentions something declared below it is completely fine -- it runs
// after the render that defines it -- and flagging those would be nothing
// but false alarms, which is how a guard gets switched off.
//
// Text, not a parser: this project has no parser dependency, and adding one
// to run a lint is a bigger decision than the lint is worth. The scanner is
// therefore conservative everywhere it is unsure -- it would rather miss one
// than invent one, because a guard that cries wolf gets deleted and a guard
// that misses one is still ahead of no guard at all.

/**
 * The source with every comment and string blanked to spaces.
 *
 * Same length, so every index still points where it did. Blanking rather
 * than removing is what lets the scanner reason about positions in one
 * pass.
 */
export function blankOut(source) {
  const out = source.split('')
  let i = 0
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' '
  }

  while (i < source.length) {
    const two = source.slice(i, i + 2)

    if (two === '//') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      blank(i, stop)
      i = stop
      continue
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }

    const c = source[i]
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1
      while (k < source.length) {
        if (source[k] === '\\') {
          k += 2
          continue
        }
        if (source[k] === c) break
        k += 1
      }
      // The quotes themselves stay, so a blanked string is still visibly a
      // string and not a gap an identifier could be read across.
      blank(i + 1, k)
      i = k + 1
      continue
    }

    i += 1
  }
  return out.join('')
}

const BLOCK_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'finally'])

/**
 * Is the `{` that follows this text the body of a FUNCTION?
 *
 * `=>` is unambiguous. A `)` is a function only when the parenthesis it
 * closes was not an `if`/`for`/`while` -- and getting that wrong the safe
 * way (calling a plain block a function) only ever loses a finding.
 */
function opensFunctionBody(before) {
  const text = before.trimEnd()
  if (text.endsWith('=>')) return true
  if (!text.endsWith(')')) return false

  let depth = 0
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] === ')') depth += 1
    else if (text[i] === '(') {
      depth -= 1
      if (depth === 0) {
        const word = (text.slice(0, i).trimEnd().match(/[\w$]+$/) || [''])[0]
        return !BLOCK_KEYWORDS.has(word)
      }
    }
  }
  return false
}

/**
 * The names a function's parameter list binds.
 *
 * Without these, every `function tokenize(text)` in the project reads as a
 * use of some module-level `const text` further down the file -- which is
 * five false alarms in this codebase alone, and five is more than enough to
 * make a guard worthless.
 *
 * Destructured parameters are raked for plain names and defaults ignored,
 * which over-collects rather than under-collects: a name wrongly treated as
 * a parameter loses a finding, one wrongly missed invents one.
 */
function paramNames(before) {
  const text = before.trimEnd()

  let list = ''
  if (text.endsWith('=>')) {
    const head = text.slice(0, -2).trimEnd()
    if (head.endsWith(')')) list = between(head)
    else list = (head.match(/[\w$]+$/) || [''])[0]
  } else if (text.endsWith(')')) {
    list = between(text)
  }

  return (list.match(/[A-Za-z_$][\w$]*/g) || []).filter((n) => n !== 'function')
}

/** The contents of the bracket pair this text ends with. */
function between(text) {
  let depth = 0
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] === ')') depth += 1
    else if (text[i] === '(') {
      depth -= 1
      if (depth === 0) return text.slice(i + 1, -1)
    }
  }
  return ''
}

const nextNonSpace = (text, from) => {
  for (let i = from; i < text.length; i += 1) if (!/\s/.test(text[i])) return text[i]
  return ''
}

/**
 * Where a concise arrow's expression ends: the first `,` or closing bracket
 * that is not inside one of its own.
 */
function endOfExpression(text, from) {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i
      depth -= 1
    } else if ((c === ',' || c === ';' || c === '\n') && depth === 0) return i
  }
  return text.length
}

/** The index of the `(` opening the parameter list of the body at `brace`. */
function paramListStart(text, brace) {
  let end = brace - 1
  while (end >= 0 && /\s/.test(text[end])) end -= 1
  if (text[end] === '>' && text[end - 1] === '=') {
    end -= 2
    while (end >= 0 && /\s/.test(text[end])) end -= 1
  }
  if (text[end] !== ')') return -1

  let depth = 0
  for (let i = end; i >= 0; i -= 1) {
    if (text[i] === ')') depth += 1
    else if (text[i] === '(') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

const NAME = /[A-Za-z_$][\w$]*/y
const isNameChar = (c) => !!c && /[\w$]/.test(c)

/**
 * Every `const NAME` used before the line that declares it.
 *
 * Returns `[{ name, line, declaredLine }]`, empty when the file is fine.
 */
export function findTdzUses(source) {
  const text = blankOut(source)

  const root = { consts: new Map(), fn: false, parent: null }
  let scope = root
  const uses = []

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]

    if (c === '{') {
      const before = text.slice(Math.max(0, i - 300), i)
      const fn = opensFunctionBody(before)
      scope = { consts: new Map(), fn, parent: scope }

      if (fn) {
        // A parameter is declared at the top of its own body, so a use of
        // it inside can never be too early.
        for (const name of paramNames(before)) scope.consts.set(name, -1)

        // And the parameter list itself was just read as a run of uses in
        // the scope OUTSIDE this function -- which is how every
        // `function tokenize(text)` in the project came to look like a use
        // of some module-level `const text` two hundred lines further down.
        const from = paramListStart(text, i)
        if (from !== -1) while (uses.length && uses[uses.length - 1].index > from) uses.pop()
      }
      continue
    }
    if (c === '}') {
      scope = scope.parent || root
      continue
    }

    // `const onClick = () => later()` has no brace to open a scope with,
    // and everything in it runs later just the same. Skipped to the end of
    // the arrow's own expression -- NOT to the end of the line, which would
    // also swallow the `[access]` in `useMemo(() => 1, [access])`, and that
    // dependency array is one of the three bugs this exists to catch.
    if (c === '=' && text[i + 1] === '>' && nextNonSpace(text, i + 2) !== '{') {
      i = endOfExpression(text, i + 2) - 1
      continue
    }

    if (!/[A-Za-z_$]/.test(c) || isNameChar(text[i - 1])) continue

    NAME.lastIndex = i
    const match = NAME.exec(text)
    if (!match) continue
    const word = match[0]
    const end = i + word.length
    i = end - 1

    // A declaration: `const NAME =`. Single names only -- a destructuring
    // pattern is more shapes than a text scanner should be guessing at.
    const before = text.slice(Math.max(0, match.index - 12), match.index)
    if (/(^|[^\w$])const\s+$/.test(before) && /^\s*=[^=]/.test(text.slice(end))) {
      if (!scope.consts.has(word)) scope.consts.set(word, match.index)
      continue
    }

    // A JSX ATTRIBUTE name is not a use of anything: `height={54}` on a
    // chart axis is not a read of the `const height` three lines further
    // down. It cannot be told from an assignment by looking, so both are
    // skipped -- assigning to a const before it exists is a different error
    // with its own message, and missing it costs less than a false alarm on
    // every JSX attribute in the project.
    const after = text.slice(end).trimStart()
    if (after.startsWith('=') && !after.startsWith('==') && !after.startsWith('=>')) continue

    // A property KEY is not a use: `{ top: p.top }` mentions `top` twice and
    // only the second one reads anything.
    if (/^\s*:/.test(text.slice(end))) continue
    // Nor is a member access: `.width` is a property, not the variable.
    if (/\.\s*$/.test(text.slice(Math.max(0, match.index - 4), match.index))) continue

    uses.push({ word, index: match.index, scope })
  }

  const lineAt = (index) => text.slice(0, index).split('\n').length
  const problems = []

  for (const use of uses) {
    let deferred = false
    for (let s = use.scope; s; s = s.parent) {
      const declaredAt = s.consts.get(use.word)
      if (declaredAt !== undefined) {
        if (!deferred && use.index < declaredAt) {
          problems.push({ name: use.word, line: lineAt(use.index), declaredLine: lineAt(declaredAt) })
        }
        break
      }
      // Leaving this scope for its parent. If this one is a function body,
      // everything found further out runs later than this code does, and
      // "later" is never too early.
      if (s.fn) deferred = true
    }
  }

  return problems
}
