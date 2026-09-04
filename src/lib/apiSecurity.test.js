import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// =====================================================================
// The rules that are not written in JavaScript
// =====================================================================
// Three of this app's boundaries are enforced somewhere `node --test`
// cannot call into: a serverless handler that needs Google credentials, a
// Sheets helper that needs a live spreadsheet, and a `.rules` file that
// runs inside Firestore. All three are one edit away from being quietly
// undone, and none of them fails visibly when they are -- a leaked cache
// header and a rewritten reply both look exactly like working software.
//
// So they are read as text. A source guard is a weak test of behaviour and
// a strong test of INTENT: it cannot prove the column is resolved
// correctly, but it can prove that nobody has put the browser back in
// charge of deciding which column gets written.

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const sheetsApi = read('api/sheets.js')
const sheetsLib = read('api/_lib/googleSheets.js')
const rules = read('firestore.rules')
const client = read('src/lib/sheetsApi.js')

// --- writing a cell ------------------------------------------------------

test('the column written is found in the sheet, not chosen by the request', () => {
  // The escalation this closes: the permission check is on a column NAME
  // ("you may edit Remarks"). If the POSITION of that name came from the
  // request body, anyone allowed to edit any one column could send a header
  // list placing "Remarks" where "Discount" sits, and write it.
  const at = sheetsLib.indexOf('export async function updateCell(')
  assert.ok(at >= 0, 'updateCell is gone')
  const signature = sheetsLib.slice(at, sheetsLib.indexOf(')', at))
  assert.ok(!signature.includes('headers'), 'updateCell still takes the caller’s headers')

  const body = sheetsLib.slice(at, sheetsLib.indexOf('\n}', at))
  assert.ok(body.includes('await fetchSheetRows(sheetId, tabName)'), 'the real header row is never read')
  assert.ok(body.includes('sheet.headers.indexOf(columnName)'), 'the column is not located in the sheet')
})

test('the header row itself cannot be edited, nor a row past the data', () => {
  // Row 1 renames a column for everybody. A row number past the end is not
  // an edit at all -- it is an append somewhere arbitrary.
  const at = sheetsLib.indexOf('export async function updateCell(')
  const body = sheetsLib.slice(at, sheetsLib.indexOf('\n}', at))
  assert.match(body, /Number\.isInteger\(row\)/, 'a fractional or missing row is accepted')
  assert.match(body, /row < 2/, 'the header row is writable')
  assert.match(body, /row > sheet\.rows\.length \+ 1/, 'any row number at all is accepted')
})

test('the browser no longer sends a column position for anyone to trust', () => {
  const at = client.indexOf('export async function updateCell(')
  const call = client.slice(at, client.indexOf('\n}', at))
  assert.ok(!call.includes('headers'), 'the client still sends its own header order')
  // And the handler does not read one back in by another name.
  const post = sheetsApi.slice(sheetsApi.indexOf('async function handlePost'))
  assert.ok(!/const \{[^}]*headers[^}]*\} = body/.test(post), 'the handler destructures headers again')
})

// --- who may read the answer --------------------------------------------

test('spreadsheet data is never cached in a shared cache', () => {
  // Every caller hits the same URL for the same page and the access check
  // is per user, so `s-maxage` on this response is one person's rows served
  // to somebody with no grant at all.
  const headers = sheetsApi.match(/Cache-Control', '[^']+'/g) || []
  assert.ok(headers.length >= 2, 'the cache headers have moved')
  for (const header of headers) {
    if (!sheetsApi.slice(0, sheetsApi.indexOf(header)).includes('function handleGet')) continue
    assert.ok(header.includes('private'), `${header} is a shared cache`)
    assert.ok(!header.includes('s-maxage'), `${header} is shared with the edge`)
  }
})

test('the folder listing may still be shared, because it is not per user', () => {
  // The contrast that shows the rule above is about ACCESS and not about
  // caching: /api/drive checks only that you are signed in, and every
  // signed-in caller gets the same answer.
  const drive = read('api/drive.js')
  assert.match(drive, /s-maxage/, 'the Drive listing lost its edge cache for no reason')
  assert.match(drive, /await requireUser\(req\)/, 'and it is still behind sign-in')
})

// --- what a recipient may do to a message -------------------------------

test('a reply may be added but never rewritten, and only as yourself', () => {
  // Checking that the list did not SHRINK is not enough: a two-reply list
  // replaced by two different replies passes a size check while rewriting
  // what somebody else said.
  const at = rules.indexOf('match /messages/{messageId}')
  const block = rules.slice(at, rules.indexOf('match /dataSources', at))
  assert.ok(block.includes('repliesGone().size() == 0'), 'replies can still be removed or rewritten')
  assert.ok(block.includes('repliesAdded().size() <= 1'), 'a single update may add several replies')
  assert.ok(
    block.includes("repliesAdded()[0].from == request.auth.uid"),
    'a reply can still be signed with somebody else’s name'
  )
  // The weaker check this replaced must be gone, or it reads as if both
  // apply and only one of them does anything.
  assert.ok(!block.includes('replies.size() >= resource.data.replies.size()'), 'the size-only check is still here')
})

test('the field a reply is signed with is the field the rule checks', () => {
  // `from`, not `by`. The remark rules next door use `by`, and one letter
  // between two collections is exactly the kind of thing that passes review
  // and then permits everything.
  const messages = read('src/lib/messages.js')
  const at = messages.indexOf('export function replyDoc(')
  const shape = messages.slice(at, messages.indexOf('\n}', at))
  assert.match(shape, /from: sender\?\.uid/, 'a reply is no longer signed with `from`')
})

// --- and the boundaries that were already right --------------------------

test('every request is answered for the person who made it', () => {
  // Not a new rule -- a regression guard on the oldest one in the file.
  assert.ok(sheetsApi.includes('await requireUser(req)'), 'the handler no longer identifies the caller')
  // Counted, not merely present: there are two of them, one on the read
  // and one on the write, and losing either leaves the other looking like
  // proof that the check is still there.
  assert.equal(
    (sheetsApi.match(/if \(!access\.canView\)/g) || []).length,
    2,
    'one of the two page-access checks is gone'
  )
  for (const admin of ['listTabs', 'syncSource']) {
    const at = sheetsApi.indexOf(`action === '${admin}'`)
    assert.ok(at > 0, `${admin} is gone`)
    const body = sheetsApi.slice(at, at + 700)
    assert.ok(body.includes('if (!isAdmin)'), `${admin} is no longer admin-only`)
  }
})

test('a page can only ever read refs its own sources declare', () => {
  // The check that stops one dashboard reading another's spreadsheet by
  // naming its ref in the query string.
  assert.ok(sheetsApi.includes('function allowedRefs(page, sources)'), 'the allow-list is gone')
  assert.ok(sheetsApi.includes('requested.filter((r) => allowed.has(r))'), 'requested refs are no longer filtered')
  assert.ok(sheetsApi.includes('if (!allowedRefs(page, sources).has(targetRef))'), 'a write is no longer scoped')
})
