import { requireUser, getAccess, adminDb } from './_lib/firebaseAdmin.js'
import { fetchManyTabs, listTabs, updateCell } from './_lib/googleSheets.js'

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

    if (req.method === 'GET') return handleGet(req, res, uid)
    if (req.method === 'POST') return handlePost(req, res, uid)

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
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
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

  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
  return res.status(200).json({ tabs: data })
}

async function handlePost(req, res, uid) {
  const body = req.body || {}
  const pageId = body.page || body.sheet
  const { ref, tab, row, column, value, headers } = body

  if (!pageId || !row || !column || !Array.isArray(headers)) {
    return res.status(400).json({ error: 'Missing page, row, column or headers in request body' })
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
    return res.status(200).json(await updateCell(legacy.sheetId, tab, row, headers, column, value))
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

  return res.status(200).json(await updateCell(source.sheetId, tabName, row, headers, column, value))
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
