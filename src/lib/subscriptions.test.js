import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// =====================================================================
// Live subscriptions
// =====================================================================
// A Firestore listener has two ways of going wrong that look nothing like
// an error: it can fail and tell nobody, leaving a screen that says
// "loading" for ever; and it can be correct but multiplied, so opening a
// panel costs six hundred subscriptions instead of one.
//
// Neither shows up in a unit test of anything, because both are properties
// of how the listener is SET UP. So they are read from the source.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/** The arguments of the `onSnapshot(` call starting at `at`. */
function callAt(source, at) {
  let depth = 0
  for (let i = source.indexOf('(', at); i < source.length; i += 1) {
    const c = source[i]
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  return ''
}

/**
 * The call with its comments and string bodies emptied.
 *
 * Both are full of commas, and a comma inside either is not an argument --
 * which is exactly the mistake this helper made first time round, reporting
 * a three-argument call as a seven-argument one because the comment
 * explaining it had four commas in it.
 */
const bare = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .replace(/`[^`]*`/g, '``')

/** How many top-level arguments a call has. */
function arity(rawCall) {
  const call = bare(rawCall)
  let depth = 0
  let commas = 0
  const body = call.slice(call.indexOf('('))
  for (let i = 1; i < body.length - 1; i += 1) {
    const c = body[i]
    if ('([{'.includes(c)) depth += 1
    else if (')]}'.includes(c)) depth -= 1
    else if (c === ',' && depth === 0) commas += 1
  }
  return commas + 1
}

// --- the one that can hang the whole app --------------------------------

test('a profile that cannot be read resolves, rather than saying “checking” for ever', () => {
  // `userDoc === undefined` means "still checking", and ProtectedRoute
  // renders "Checking access…" while it is. A listener that fails without
  // an error handler never sets it, so EVERY route in the app sits on that
  // line permanently, with nothing to say why and no way out but a reload.
  const auth = read('context/AuthContext.jsx')
  const at = auth.indexOf('onSnapshot(')
  assert.ok(at >= 0, 'the profile listener is gone')
  const call = callAt(auth, at)
  assert.equal(arity(call), 3, 'the profile listener has no error handler')
  assert.match(call, /setUserDoc\(\(current\) => \(current === undefined \? null : current\)\)/)

  // And the state it resolves TO matters: a profile already in hand is
  // kept, because a moment of trouble is not grounds for throwing somebody
  // out of a dashboard they are already reading.
  assert.ok(!/\(\) => setUserDoc\(null\)/.test(auth), 'an error signs the reader out')

  const guard = read('components/ProtectedRoute.jsx')
  assert.ok(guard.includes('if (userDoc === undefined)'), 'the wait this protects has moved')
})

// --- the one that multiplies --------------------------------------------

test('the admin panel reads who has access with one listener, not one per cell', () => {
  // This was a listener per (user, page): forty people and fifteen pages is
  // six hundred live subscriptions and six hundred state updates on open --
  // torn down and rebuilt every time anybody's user document changed,
  // because the users array is new on every snapshot.
  const panel = read('pages/admin/UsersPanel.jsx')
  assert.ok(panel.includes("onSnapshot(\n        collection(db, 'access')"), 'the collection listener is gone')
  assert.ok(!/onSnapshot\(doc\(db, 'access'/.test(panel), 'it subscribes per document again')
  assert.ok(!/pages\.forEach\(\(page\) => \{[\s\S]{0,200}onSnapshot/.test(panel), 'a listener per page is back')
})

test('...and says so when it cannot, because an empty grid is a screen an admin would act on', () => {
  const panel = read('pages/admin/UsersPanel.jsx')
  const at = panel.indexOf("onSnapshot(\n        collection(db, 'access')")
  assert.equal(arity(callAt(panel, at)), 3, 'the access listener has no error handler')
  // The ERROR branch, specifically. `setAccessError(null)` in the success
  // handler is not evidence of anything -- and deleting the error callback
  // leaves a trailing comma, so the argument count alone still reads as
  // three.
  assert.match(panel, /\(e\) => setAccessError\(/, 'the failure is never recorded')
  assert.ok(panel.includes('{accessError && ('), 'the failure is never shown')
})

test('the dashboard still reads a grant one document at a time', () => {
  // Not a style choice: a non-admin has no right to LIST that collection
  // (see firestore.rules), and a list query is rejected wholesale rather
  // than narrowed to what the reader may see. Only the admin panel, which
  // is admin-only, may ask the broad question.
  const workspace = read('hooks/useWorkspace.js')
  assert.ok(/onSnapshot\(\s*doc\(db, 'access'/.test(workspace), 'the dashboard now lists the collection')

  const rules = fs.readFileSync(path.resolve(SRC, '..', 'firestore.rules'), 'utf8')
  const block = rules.slice(rules.indexOf('match /access/'), rules.indexOf('match /settings/'))
  assert.ok(block.includes('allow list: if isAdmin()'), 'listing grants is no longer admin-only')
})

// --- and every other one is at least accounted for -----------------------

test('every live subscription either handles failure or cannot leave a screen waiting', () => {
  // Not a blanket demand for error handlers -- a list that comes back empty
  // is a legible state. The demand is that anything a screen WAITS on has
  // an answer for failure. These are the files that hold such a state.
  for (const file of [
    'context/AuthContext.jsx',
    'context/SpaceContext.jsx',
    'hooks/usePageData.js',
    'hooks/useWorkspace.js',
    'hooks/useUserPrefs.js',
    'hooks/useMessages.js',
    'hooks/useRowNotes.js',
  ]) {
    const source = read(file)
    let at = source.indexOf('onSnapshot(')
    while (at >= 0) {
      const call = callAt(source, at)
      assert.equal(arity(call), 3, `${file}: a listener with no error handler`)
      at = source.indexOf('onSnapshot(', at + call.length)
    }
  }
})
