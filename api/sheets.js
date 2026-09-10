import { requireUser, getAccess, adminDb } from './_lib/firebaseAdmin.js'
import {
  appendRows,
  deleteRows,
  fetchManyTabs,
  fetchSheetRows,
  listTabs,
  updateCell,
  updateCells,
} from './_lib/googleSheets.js'
import { valueIndexFor } from '../src/lib/columnValues.js'
import { staleRows } from '../src/lib/rowFingerprint.js'
import {
  canAdd,
  canDelete,
  creatableColumns,
  mapRow,
  MAX_ROWS_PER_OP,
  resolvePairs,
  routeFor,
} from '../src/lib/rowOps.js'

// ---------------------------------------------------------------------
// The one API route
// ---------------------------------------------------------------------
// v2: a "page" was PREMIA or HERO and owned exactly one spreadsheet.
// v3: a page is an admin-created dashboard that may pull from ANY number of
// spreadsheets, so data is addressed by a qualified REF:
//
//     "<sourceId>::<tabName>"
//
// The security rule is unchanged in spirit and still enforced here, not in
// the browser: a page may only read a ref whose source is on that page's
// own `sourceIds` list AND whose tab is on that source's own `tabs` list.
// A crafted request naming another page's spreadsheet is dropped, exactly as
// PREMIA could never read HERO's tabs before.

const REF_SEP = '::'

function parseRef(ref) {
  const s = String(ref ?? '')
  const at = s.indexOf(REF_SEP)
  if (at === -1) return { sourceId: '', tab: s }
  return { sourceId: s.slice(0, at), tab: s.slice(at + REF_SEP.length) }
}

const makeRef = (sourceId, tab) => `${sourceId}${REF_SEP}${tab}`

// --- Document loaders ---------------------------------------------------

async function getPage(pageId) {
  const snap = await adminDb.doc(`dashboards/${pageId}`).get()
  return snap.exists ? { id: snap.id, ...snap.data() } : null
}

async function getSources(sourceIds) {
  const ids = [...new Set((sourceIds || []).filter(Boolean))]
  if (ids.length === 0) return {}
  const snaps = await adminDb.getAll(...ids.map((id) => adminDb.doc(`dataSources/${id}`)))
  const out = {}
  snaps.forEach((snap) => {
    if (snap.exists) out[snap.id] = { id: snap.id, ...snap.data() }
  })
  return out
}

/**
 * v2 fallback. A workspace that hasn't been migrated yet still has its
 * config under `sheetConfigs/{PAGE}`; treating that document as a single
 * implicit source keeps the old two-page setup working unchanged while an
 * admin migrates at their own pace.
 */
async function getLegacyPage(pageName) {
  const snap = await adminDb.doc(`sheetConfigs/${pageName}`).get()
  if (!snap.exists) return null
  const data = snap.data()
  const tabs = data.tabs || (data.tabName ? [data.tabName] : [])
  return { legacy: true, id: pageName, sheetId: data.sheetId, tabs }
}

/**
 * Every ref this page is permitted to read: the cross-product of the page's
 * declared sources and each source's own permitted tabs.
 *
 * Computing it from stored config (rather than trusting the request) is what
 * makes ref scoping a real boundary instead of a UI convention.
 */
function allowedRefs(page, sources) {
  const allowed = new Set()
  for (const sourceId of page.sourceIds || []) {
    const source = sources[sourceId]
    if (!source) continue
    for (const tab of source.tabs || []) allowed.add(makeRef(sourceId, tab))
  }
  return allowed
}

/**
 * Reads a set of refs, batching per spreadsheet so a page drawing on three
 * sources costs three Google round-trips rather than one per tab. Each
 * source is fetched in parallel and a source that fails (deleted sheet,
 * revoked sharing) reports only its own refs as errored instead of blanking
 * the whole page.
 */
async function fetchRefs(refs, sources) {
  const bySource = new Map()
  for (const ref of refs) {
    const { sourceId, tab } = parseRef(ref)
    if (!bySource.has(sourceId)) bySource.set(sourceId, [])
    bySource.get(sourceId).push(tab)
  }

  const out = {}
  await Promise.all(
    Array.from(bySource.entries()).map(async ([sourceId, tabs]) => {
      const source = sources[sourceId]
      if (!source?.sheetId) {
        for (const tab of tabs) {
          out[makeRef(sourceId, tab)] = { headers: [], rows: [], error: 'That spreadsheet is no longer connected' }
        }
        return
      }
      try {
        const data = await fetchManyTabs(source.sheetId, tabs)
        for (const [tab, result] of Object.entries(data)) out[makeRef(sourceId, tab)] = result
      } catch (e) {
        for (const tab of tabs) out[makeRef(sourceId, tab)] = { headers: [], rows: [], error: e.message }
      }
    })
  )
  return out
}

/**
 * Keeps every source's header list current from the real sheet, so the
 * admin's column pickers show a column renamed in Google without anyone
 * retyping it. Fire-and-forget: a failed sync must never fail the read.
 */
function syncHeaders(data) {
  const bySource = new Map()
  for (const [ref, result] of Object.entries(data)) {
    if (!result?.headers?.length) continue
    const { sourceId, tab } = parseRef(ref)
    if (!sourceId) continue
    if (!bySource.has(sourceId)) bySource.set(sourceId, {})
    bySource.get(sourceId)[tab] = result.headers
  }
  for (const [sourceId, tabHeaders] of bySource.entries()) {
    adminDb.doc(`dataSources/${sourceId}`).set({ tabHeaders }, { merge: true }).catch(() => {})
  }
}

// --- Handler ------------------------------------------------------------

export default async function handler(req, res) {
  try {
    const decoded = await requireUser(req)
    const uid = decoded.uid

    // AWAITED, not merely returned. `return somePromise` inside a `try`
    // finishes the try block synchronously: the promise is handed back and
    // its later rejection lands on whoever called this handler, NOT in the
    // catch below. Every refusal raised deeper in -- a 403 on a row
    // operation, the 409 that says the rows have moved, a bad request from
    // Google -- would then reach the browser as an unhandled crash rather
    // than as the sentence explaining it, and the client would report the
    // API as being down.
    if (req.method === 'GET') return await handleGet(req, res, uid)
    if (req.method === 'POST') return await handlePost(req, res, uid)

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    const status = e.statusCode || 500
    return res.status(status).json({ error: e.message || 'Internal error' })
  }
}

async function handleGet(req, res, uid) {
  const action = String(req.query.action || '')
  const pageId = String(req.query.page || req.query.sheet || '')

  // --- Admin-only: discover a spreadsheet's real tab names ---------------
  // Runs BEFORE a source is saved (that's the point of it), so it takes a
  // raw sheetId and is gated purely on the caller being an admin.
  if (action === 'listTabs') {
    const { isAdmin } = await getAccess(uid, pageId || 'ANY')
    if (!isAdmin) return res.status(403).json({ error: 'Admins only' })

    let sheetId = String(req.query.sheetId || '')
    if (!sheetId && req.query.sourceId) {
      const snap = await adminDb.doc(`dataSources/${String(req.query.sourceId)}`).get()
      sheetId = snap.exists ? snap.data().sheetId || '' : ''
    }
    if (!sheetId) return res.status(400).json({ error: 'No spreadsheet ID given' })
    return res.status(200).json(await listTabs(sheetId))
  }

  // --- Admin-only: pull one source's tabs and refresh its header lists ---
  //
  // Headers are normally written as a side effect of a dashboard loading,
  // which meant a freshly connected spreadsheet had no known columns until
  // someone opened a page that used it -- and you cannot build that page
  // without the columns. This breaks the circle: sync the source directly,
  // from the panel where you just added it.
  if (action === 'syncSource') {
    const { isAdmin } = await getAccess(uid, 'ANY')
    if (!isAdmin) return res.status(403).json({ error: 'Admins only' })

    const sourceId = String(req.query.sourceId || '')
    if (!sourceId) return res.status(400).json({ error: 'Missing "sourceId"' })

    const snap = await adminDb.doc(`dataSources/${sourceId}`).get()
    if (!snap.exists) return res.status(404).json({ error: 'That spreadsheet is not connected' })

    const source = snap.data()
    const tabs = (source.tabs || []).filter(Boolean)
    if (!source.sheetId) return res.status(400).json({ error: 'No spreadsheet ID saved for this source' })
    if (tabs.length === 0) return res.status(400).json({ error: 'No tabs are selected for this source' })

    const data = await fetchManyTabs(source.sheetId, tabs)

    const tabHeaders = {}
    // What is actually IN each column, so a condition can be PICKED rather
    // than typed from memory and spelled wrong. Collected here because the
    // rows are already in hand -- this costs no extra call to Google -- and
    // it lasts until the next sync, which is the right lifetime: it
    // describes the data as it was last read, and so does everything else.
    const tabValues = {}
    const summary = {}
    for (const [tab, result] of Object.entries(data)) {
      if (result?.headers?.length) tabHeaders[tab] = result.headers
      if (result?.rows?.length) {
        const index = valueIndexFor(result.rows, result.headers || [])
        if (Object.keys(index).length > 0) tabValues[tab] = index
      }
      summary[tab] = {
        rows: result?.rows?.length ?? 0,
        columns: result?.headers?.length ?? 0,
        error: result?.error || null,
        // A handful of real rows, so the calculated-column editor can show
        // what a formula actually produces instead of asking an admin to
        // save it, open a dashboard and look. The data is already in hand
        // here -- this costs no extra call to Google -- and it never
        // touches Firestore, so nothing is cached anywhere it shouldn't be.
        sample: (result?.rows || []).slice(0, 8),
      }
    }

    const syncedAt = new Date().toISOString()
    // Awaited, unlike the fire-and-forget sync on a normal read: the panel
    // reports success, so it must not claim a write that never landed.
    await adminDb
      .doc(`dataSources/${sourceId}`)
      .set({ tabHeaders, tabValues, lastSyncedAt: syncedAt }, { merge: true })

    return res.status(200).json({ tabs: summary, syncedAt })
  }

  if (!pageId) return res.status(400).json({ error: 'Missing "page" query param' })

  const access = await getAccess(uid, pageId)
  if (!access.canView) return res.status(403).json({ error: 'No access to this page' })

  const page = await getPage(pageId)

  // --- v2 fallback: an unmigrated PREMIA / HERO page ---------------------
  if (!page) {
    const legacy = await getLegacyPage(pageId)
    if (!legacy?.sheetId) return res.status(200).json({ tabs: {}, notConfigured: true })

    const requested = splitList(req.query.tabs)
    const tabsToRead = requested.length ? requested.filter((t) => legacy.tabs.includes(t)) : legacy.tabs
    if (tabsToRead.length === 0) return res.status(200).json({ tabs: {} })

    const data = await fetchManyTabs(legacy.sheetId, tabsToRead)
    const tabHeaders = {}
    for (const [tab, result] of Object.entries(data)) {
      if (result?.headers?.length) tabHeaders[tab] = result.headers
    }
    if (Object.keys(tabHeaders).length) {
      adminDb.doc(`sheetConfigs/${pageId}`).set({ tabHeaders }, { merge: true }).catch(() => {})
    }
    res.setHeader('Cache-Control', 'private, max-age=10')
    return res.status(200).json({ tabs: data, legacy: true })
  }

  const sources = await getSources(page.sourceIds)
  const allowed = allowedRefs(page, sources)
  if (allowed.size === 0) return res.status(200).json({ tabs: {}, notConfigured: true })

  // `?refs=a::MASTER,b::Quotations` reads a subset; omitting it reads every
  // ref the page is allowed. Either way the result is intersected with
  // `allowed`, so an unknown ref is dropped rather than fetched.
  const requested = splitList(req.query.refs)
  const refsToRead = requested.length ? requested.filter((r) => allowed.has(r)) : Array.from(allowed)

  if (refsToRead.length === 0) {
    return res.status(200).json({ tabs: {}, error: 'None of the requested tabs belong to this page' })
  }

  const data = await fetchRefs(refsToRead, sources)
  syncHeaders(data)

  // PRIVATE, not `s-maxage`. This response is spreadsheet data chosen by
  // who is asking -- the access check above is per user -- and every caller
  // hits the same URL for the same page. A shared cache keyed on that URL
  // would hand one person's rows to somebody with no grant at all. The
  // browser may still keep its own copy for a few seconds, and the warm
  // lambda's own 15-second cache already collapses a burst of loads across
  // users into one Google call, which is where the saving actually came
  // from.
  res.setHeader('Cache-Control', 'private, max-age=10')
  return res.status(200).json({ tabs: data })
}

async function handlePost(req, res, uid) {
  const body = req.body || {}
  const pageId = body.page || body.sheet

  // Whole-row work is a different request with a different permission, so
  // it forks before any of the cell handling below. `op` is absent on every
  // request the browser sent before row operations existed, which is what
  // keeps this a pure addition rather than a change to the write path.
  if (body.op) return handleRowOp(req, res, uid, pageId, body)

  const { ref, tab, row, column, value } = body

  // A fill drag sends many rows of ONE column. One column, because the
  // permission below clears a column by name -- see updateCells for why
  // letting each entry name its own would make that grant meaningless.
  const cells = Array.isArray(body.cells) ? body.cells : null

  // `headers` is still accepted in the body and deliberately ignored: the
  // column is located in the sheet's own header row (see updateCell), so a
  // request cannot choose which column its permission applies to. Older
  // browsers still send it; there is nothing to break.
  if (!pageId || !column || (!row && !cells)) {
    return res.status(400).json({ error: 'Missing page, row or column in request body' })
  }
  if (cells && cells.length === 0) {
    return res.status(400).json({ error: 'Nothing to write' })
  }

  const access = await getAccess(uid, pageId)
  if (!access.canView) return res.status(403).json({ error: 'No access to this page' })

  const page = await getPage(pageId)

  // --- v2 fallback -------------------------------------------------------
  if (!page) {
    const legacy = await getLegacyPage(pageId)
    if (!legacy?.sheetId || !tab || !legacy.tabs.includes(tab)) {
      return res.status(400).json({ error: 'That tab is not configured for this page' })
    }
    const allowedLegacy = access.isAdmin || (access.editable?.[tab] || []).includes(column)
    if (!allowedLegacy) {
      return res.status(403).json({ error: `You are not allowed to edit "${column}" on the ${tab} tab` })
    }
    return res
      .status(200)
      .json(
        cells
          ? await updateCells(legacy.sheetId, tab, column, cells)
          : await updateCell(legacy.sheetId, tab, row, column, value)
      )
  }

  const targetRef = ref || (tab && page.sourceIds?.length ? makeRef(page.sourceIds[0], tab) : '')
  if (!targetRef) return res.status(400).json({ error: 'Missing "ref" in request body' })

  const sources = await getSources(page.sourceIds)
  if (!allowedRefs(page, sources).has(targetRef)) {
    return res.status(400).json({ error: 'That tab is not configured for this page' })
  }

  // Edit rights are granted per REF, since one page now spans tabs from
  // different spreadsheets that may share a tab name. Admins edit anything;
  // every write is re-checked here, so the browser can never grant itself
  // permission by hiding the pencil or editing the request.
  const allowed = access.isAdmin || (access.editable?.[targetRef] || []).includes(column)
  if (!allowed) {
    const { tab: tabName } = parseRef(targetRef)
    return res.status(403).json({ error: `You are not allowed to edit "${column}" on the ${tabName} tab` })
  }

  const { sourceId, tab: tabName } = parseRef(targetRef)
  const source = sources[sourceId]
  if (!source?.sheetId) return res.status(400).json({ error: 'That spreadsheet is no longer connected' })

  return res
    .status(200)
    .json(
      cells
        ? await updateCells(source.sheetId, tabName, column, cells)
        : await updateCell(source.sheetId, tabName, row, column, value)
    )
}

// ---------------------------------------------------------------------
// Whole-row operations
// ---------------------------------------------------------------------
// Deleting rows, and sending them to another tab. Both decompose into
// exactly two permissions -- ADD on the tab a row lands on, DELETE on the
// tab it leaves -- which is the point of modelling them that way (see
// src/lib/rowOps.js): a move cannot be granted by accident to somebody who
// was only meant to copy.
//
// Rows are never CREATED here. A record is entered where records are
// entered; a dashboard's business is what happens to it afterwards.
//
// Everything here re-derives its answer from stored config, exactly as the
// read path does. The browser's idea of what it may do decides which
// buttons it draws and nothing else.

/** The refs a page may touch at all, and this user's rights on one of them. */
async function rowOpContext(uid, pageId, refs) {
  const access = await getAccess(uid, pageId)
  if (!access.canView) {
    const err = new Error('No access to this page')
    err.statusCode = 403
    throw err
  }

  const page = await getPage(pageId)
  if (!page) {
    // Deliberately not offered on unmigrated v2 pages. Those address data
    // by bare tab name with no source behind it, and a delete is not the
    // operation to run through a compatibility path that cannot say which
    // spreadsheet it is pointing at.
    const err = new Error('Row operations need a migrated page')
    err.statusCode = 400
    throw err
  }

  const sources = await getSources(page.sourceIds)
  const allowed = allowedRefs(page, sources)
  for (const ref of refs) {
    if (!allowed.has(ref)) {
      const err = new Error('That tab is not configured for this page')
      err.statusCode = 400
      throw err
    }
  }

  return { access, page, sources }
}

/** The spreadsheet and tab behind a ref, or a 400 saying it has gone. */
function sheetFor(sources, ref) {
  const { sourceId, tab } = parseRef(ref)
  const source = sources[sourceId]
  if (!source?.sheetId) {
    const err = new Error('That spreadsheet is no longer connected')
    err.statusCode = 400
    throw err
  }
  return { sheetId: source.sheetId, tab }
}

const forbid = (message) => {
  const err = new Error(message)
  err.statusCode = 403
  return err
}

/**
 * Reads a tab fresh and refuses unless every row is still what was read.
 *
 * The whole set or none of it. Skipping the rows that moved and deleting
 * the rest is the outcome hardest to notice afterwards -- some of what was
 * ticked is gone, some is not, and nothing says which was which.
 */
async function verifyRows(sheetId, tab, wanted) {
  const sheet = await fetchSheetRows(sheetId, tab, { fresh: true })
  const stale = staleRows(wanted, sheet.rows)
  if (stale.length > 0) {
    const err = new Error(
      `${stale.length === 1 ? 'A row has' : `${stale.length} rows have`} changed in the sheet since this page ` +
        'was loaded. Refresh and try again.'
    )
    err.statusCode = 409
    throw err
  }
  return sheet
}

/**
 * The table a transfer was launched from, and the route it defines.
 *
 * Read from the STORED page, never from the request. The browser says
 * which widget it is looking at; everything about what that widget may do
 * -- whether it copies, whether it moves, where to, and which column
 * becomes which -- is read back out of the document an admin saved.
 *
 * That is the same rule the read path follows for refs, and it is what
 * makes the mapping an admin's decision rather than a suggestion: a
 * crafted request cannot name its own pairs any more than it can name its
 * own destination.
 */
function transferRoute(page, body, ref, target, move) {
  const widgetId = String(body.widget || '')
  const widget = (page.widgets || []).find((w) => w?.id === widgetId)

  if (!widget || widget.type !== 'table' || widget.tab !== ref) {
    const err = new Error('That table is not on this page')
    err.statusCode = 400
    throw err
  }
  if (!widget[move ? 'canMoveRows' : 'canCopyRows']) {
    throw forbid(`This table does not ${move ? 'move' : 'copy'} rows`)
  }

  const route = routeFor(widget, target)
  if (!(widget.copyTargets || []).some((entry) => (typeof entry === 'string' ? entry : entry?.ref) === target)) {
    const err = new Error('That tab is not a destination for this table')
    err.statusCode = 400
    throw err
  }
  return route
}

/** [{ row, fp }] out of a request body, validated. */
function rowRefsFrom(body) {
  const list = Array.isArray(body.rows) ? body.rows : []
  const out = []
  for (const entry of list) {
    const row = Number(entry?.row)
    if (!Number.isInteger(row) || row < 2) {
      const err = new Error('That row cannot be used')
      err.statusCode = 400
      throw err
    }
    out.push({ row, fp: String(entry?.fp || '') })
  }
  return out
}

function requireSome(rows) {
  if (rows.length === 0) {
    const err = new Error('No rows were given')
    err.statusCode = 400
    throw err
  }
  if (rows.length > MAX_ROWS_PER_OP) {
    const err = new Error(`That is more than ${MAX_ROWS_PER_OP} rows in one go`)
    err.statusCode = 400
    throw err
  }
}

async function handleRowOp(req, res, uid, pageId, body) {
  const op = String(body.op)
  const ref = String(body.ref || '')
  const target = String(body.target || '')

  if (!pageId || !ref) return res.status(400).json({ error: 'Missing page or ref' })

  const refs = op === 'copy' || op === 'move' ? [ref, target] : [ref]
  if ((op === 'copy' || op === 'move') && !target) {
    return res.status(400).json({ error: 'Missing the tab to send rows to' })
  }

  const { access, sources, page } = await rowOpContext(uid, pageId, refs.filter(Boolean))

  if (op === 'delete') return deleteOp(res, access, sources, ref, body)
  if (op === 'copy' || op === 'move') {
    return copyOp(res, access, sources, page, ref, target, body, op === 'move')
  }

  return res.status(400).json({ error: `Unknown row operation "${op}"` })
}

/**
 * The columns a row landing on this ref may carry.
 *
 * The same grant that governs editing that column afterwards. A copy that
 * could land a column its author could not then correct would be a way
 * round the column grants rather than a feature.
 */
function writableColumns(access, ref, headers) {
  return creatableColumns(headers, access.editable?.[ref] || [], access.isAdmin)
}

async function deleteOp(res, access, sources, ref, body) {
  if (!canDelete(access, ref, access.isAdmin)) throw forbid('You are not allowed to delete rows from this tab')

  const { sheetId, tab } = sheetFor(sources, ref)
  const wanted = rowRefsFrom(body)
  requireSome(wanted)

  await verifyRows(sheetId, tab, wanted)
  return res.status(200).json(await deleteRows(sheetId, tab, wanted.map((w) => w.row)))
}

/**
 * Sends rows to another tab, and on a move takes them off this one.
 *
 * Both halves are checked BEFORE either runs. A move whose delete is
 * refused after its append has landed leaves the rows duplicated across two
 * tabs, which is worse than either half failing on its own -- and is not
 * something the person who pressed the button can see, because the tab they
 * are looking at still shows what it showed.
 *
 * The values are read from the SOURCE SHEET rather than from the request:
 * a copy is a statement about rows that exist, so letting the browser
 * supply the contents would make it a create wearing a name that stops
 * anybody reviewing it -- and would let a reader land values on the target
 * that they could never have typed there.
 *
 * The MAPPING is read from the stored widget, not from the request. Where
 * a value lands is an admin's decision about the sheet, and one a reader
 * must not be able to re-point on the way past -- otherwise "what is in
 * the Booking Ref column" stops having one answer and the person
 * reconciling the month cannot tell a typo from a re-mapping.
 *
 * Both ends are then resolved against the real header rows, so a pair
 * naming a column somebody has since deleted in Google is dropped rather
 * than writing into nowhere. An empty mapping falls back to matching by
 * name, which is what this did before routes existed.
 *
 * The column grants are checked on top of all of it: a route may not land
 * a value in a column this person could not type into on the target.
 */
async function copyOp(res, access, sources, page, ref, target, body, move) {
  if (!canAdd(access, target, access.isAdmin)) throw forbid('You are not allowed to add rows to that tab')
  if (move && !canDelete(access, ref, access.isAdmin)) {
    throw forbid('You are not allowed to remove rows from this tab, so they can only be copied')
  }
  if (ref === target) {
    const err = new Error('Those are the same tab — use Duplicate')
    err.statusCode = 400
    throw err
  }

  const from = sheetFor(sources, ref)
  const to = sheetFor(sources, target)
  const wanted = rowRefsFrom(body)
  requireSome(wanted)

  const sheet = await verifyRows(from.sheetId, from.tab, wanted)
  const byNumber = new Map(sheet.rows.map((r) => [r._row, r]))

  // Resolved against the grants on the TARGET, which is where the values
  // are about to live and so whose column grants govern them. The pairs are
  // narrowed to allowed destinations FIRST, so a pair aimed at a column
  // this person may not write is dropped rather than the whole request
  // refused -- the same choice `scrubRow` made, and for the same reason:
  // the record is still worth having and what is missing is visible in the
  // column it is missing from.
  const targetSheet = await fetchSheetRows(to.sheetId, to.tab, { fresh: true })
  const allowed = new Set(writableColumns(access, target, targetSheet.headers))
  const route = transferRoute(page, body, ref, target, move)
  const { pairs } = resolvePairs(route.pairs, sheet.headers, targetSheet.headers)
  const permitted = pairs.filter((p) => allowed.has(p.to))
  if (permitted.length === 0) {
    throw forbid('None of those columns can be written on that tab')
  }

  const rows = wanted.map(({ row }) => mapRow(byNumber.get(row), permitted))

  const added = await appendRows(to.sheetId, to.tab, rows)
  if (!move) return res.status(200).json({ ...added, moved: false })

  // Re-verified rather than trusted: the append is a round trip, and the
  // rows about to be deleted have to be the rows that were just read.
  await verifyRows(from.sheetId, from.tab, wanted)
  const removed = await deleteRows(from.sheetId, from.tab, wanted.map((w) => w.row))
  return res.status(200).json({ ...added, ...removed, moved: true })
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
