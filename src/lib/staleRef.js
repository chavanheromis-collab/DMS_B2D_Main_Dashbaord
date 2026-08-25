// ---------------------------------------------------------------------
// A state updater that reads a ref
// ---------------------------------------------------------------------
// This threw "Cannot read properties of null (reading 'ox')" on an ordinary
// pan:
//
//     setView((v) => ({ ...v, x: drag.current.ox + dx }))
//
// A state updater does not run when it is QUEUED. It runs when React gets
// round to it -- which can be after the pointer has come up and the handler
// that clears `drag.current` has already run. By then the ref is null and
// the updater is reading a property of nothing.
//
// It is invisible in review, because the line looks like every other line
// that reads a ref, and it only fails on the timing. So: a scanner. Anything
// inside a `setX(... => ...)` callback that reads `something.current` is
// flagged, and the fix is always the same one line -- read the ref before
// the call and let the updater close over a plain value.
//
// Text, not a parser, and conservative like the others: it would rather miss
// one than invent one.

import { blankOut } from './tdz.js'

/** `useRef` handles that are only ever read, never a moving target. */
const SETTLED = new Set(['measure', 'ref', 'hostRef', 'viewportRef', 'searchRef', 'plateRef', 'rootRef', 'itemRefs'])

const SETTER = /\bset[A-Z][\w$]*\s*\(/g

/**
 * Every `.current` read from inside a state updater.
 *
 * Returns `[{ name, line }]`, empty when the file is fine.
 */
export function findStaleRefReads(source) {
  const text = blankOut(source)
  const problems = []

  SETTER.lastIndex = 0
  for (const match of text.matchAll(SETTER)) {
    // The argument list of this setter call.
    let depth = 0
    let end = text.length
    for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
      const c = text[i]
      if (c === '(') depth += 1
      else if (c === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    const args = text.slice(match.index + match[0].length, end)
    // Only a CALLBACK can be deferred. `setX(someRef.current.y)` is
    // evaluated on the spot and is perfectly safe.
    if (!args.includes('=>')) continue

    const body = args.slice(args.indexOf('=>') + 2)
    for (const hit of body.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*current\s*[.?[]/g)) {
      if (SETTLED.has(hit[1])) continue
      const at = match.index + match[0].length + args.indexOf('=>') + 2 + hit.index
      problems.push({ name: hit[1], line: text.slice(0, at).split('\n').length })
    }
  }

  return problems
}
