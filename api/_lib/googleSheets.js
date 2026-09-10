import { GoogleAuth } from 'google-auth-library'
import { FP, fingerprintValues } from '../../src/lib/rowFingerprint.js'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

// GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY come from a Google
// Cloud service account JSON key (see README). The spreadsheet must be
// shared (Share button) with that service account's email, exactly like
// sharing with a person.
function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_PRIVATE_KEY
  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variable')
  }
  // Vercel env vars store literal "\n" instead of real newlines -- restore them.
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey
  return new GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

let cachedAuth = null
async function getAccessToken() {
  if (!cachedAuth) cachedAuth = getAuthClient()
  const client = await cachedAuth.getClient()
  const { token } = await client.getAccessToken()
  return token
}

async function sheetsFetch(path, options = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    let detail = body
    try {
      detail = JSON.parse(body)?.error?.message || body
    } catch {
      /* keep raw body */
    }
    const err = new Error(`Google Sheets error (${res.status}): ${detail}`)
    err.statusCode = res.status === 404 ? 404 : res.status === 403 ? 403 : 502
    throw err
  }
  return res.json()
}

export function columnIndexToLetter(index) {
  let letter = ''
  let n = index
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}

// --- Tiny in-memory read cache -------------------------------------------
// Serverless functions reuse their process between nearby invocations
// ("warm starts"), so this turns a burst of dashboard loads -- across ALL
// users, since they share the same underlying spreadsheet -- into a single
// Sheets API call. Writes always invalidate it, so edits are never stale.
const CACHE_TTL_MS = 15_000
const cache = new Map()

const cacheKey = (sheetId, tabName) => `${sheetId}::${tabName}`

export function invalidateCache(sheetId, tabName) {
  cache.delete(cacheKey(sheetId, tabName))
}

function parseValues(values) {
  if (!values || values.length === 0) return { headers: [], rows: [] }

  // De-duplicate blank/repeated headers so two columns can never collapse
  // into one key and silently lose data.
  const seen = new Map()
  const headers = values[0].map((h, i) => {
    let name = String(h ?? '').trim() || `Column ${columnIndexToLetter(i)}`
    if (seen.has(name)) {
      const n = seen.get(name) + 1
      seen.set(name, n)
      name = `${name} (${n})`
    } else {
      seen.set(name, 1)
    }
    return name
  })

  const rows = values.slice(1).map((row, i) => {
    // Two keys the sheet did not put there. `_row` is the row's ADDRESS --
    // what a write is aimed at -- and `_fp` is what it looked like when it
    // was read, so a delete can refuse to fire at a row that has moved
    // underneath the browser holding it. See src/lib/rowFingerprint.js;
    // both are listed in src/lib/rowMeta.js so nothing offers them as a
    // column.
    //
    // Hashed from the RAW array rather than from the object below, because
    // the array is in the sheet's own order and the object's key order is a
    // detail of how this loop happens to build it.
    const obj = { _row: i + 2, [FP]: fingerprintValues(row) }
    headers.forEach((h, colIdx) => {
      obj[h] = row[colIdx] ?? ''
    })
    return obj
  })
  return { headers, rows }
}

/**
 * Reads one whole tab and returns { headers, rows }.
 *
 * `fresh` skips the cache, and every destructive operation passes it. The
 * fifteen seconds that make a burst of dashboard loads into one Google call
 * are fifteen seconds in which somebody can insert a row in Google -- and a
 * delete verified against a cached read is a delete verified against
 * exactly the state that would hide the problem it is checking for.
 */
export async function fetchSheetRows(sheetId, tabName, { fresh = false } = {}) {
  const key = cacheKey(sheetId, tabName)
  const hit = fresh ? null : cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data

  const range = encodeURIComponent(`${tabName}!A1:ZZ`)
  const data = await sheetsFetch(`/${sheetId}/values/${range}?majorDimension=ROWS`)
  const result = parseValues(data.values)
  cache.set(key, { data: result, expires: Date.now() + CACHE_TTL_MS })
  return result
}

/**
 * Reads MANY tabs in a single Google API round-trip (batchGet), which is
 * what makes a page showing MASTER + Quotations + GOOGLE REVIEW side by
 * side load as fast as a single-tab one.
 *
 * Returns { [tabName]: { headers, rows, error? } }.
 */
export async function fetchManyTabs(sheetId, tabNames) {
  const wanted = [...new Set(tabNames)].filter(Boolean)
  const out = {}
  const missing = []

  for (const tab of wanted) {
    const hit = cache.get(cacheKey(sheetId, tab))
    if (hit && hit.expires > Date.now()) out[tab] = hit.data
    else missing.push(tab)
  }
  if (missing.length === 0) return out

  const params = missing.map((t) => `ranges=${encodeURIComponent(`${t}!A1:ZZ`)}`).join('&')
  try {
    const data = await sheetsFetch(`/${sheetId}/values:batchGet?${params}&majorDimension=ROWS`)
    const ranges = data.valueRanges || []
    missing.forEach((tab, i) => {
      const result = parseValues(ranges[i]?.values)
      cache.set(cacheKey(sheetId, tab), { data: result, expires: Date.now() + CACHE_TTL_MS })
      out[tab] = result
    })
  } catch {
    // One bad tab name (renamed or deleted in Google) fails the whole
    // batch, so fall back to reading them one at a time and report only
    // the tab that's actually broken instead of blanking the whole page.
    await Promise.all(
      missing.map(async (tab) => {
        try {
          out[tab] = await fetchSheetRows(sheetId, tab)
        } catch (err) {
          out[tab] = { headers: [], rows: [], error: err.message }
        }
      })
    )
  }
  return out
}

/**
 * Lists the real tab names inside a spreadsheet, so the admin panel can
 * offer a dropdown of actual tabs instead of asking anyone to retype
 * "GOOGLE REVIEW" exactly right.
 */
export async function listTabs(sheetId) {
  const data = await sheetsFetch(`/${sheetId}?fields=properties.title,sheets.properties.title`)
  return {
    title: data.properties?.title || '',
    tabs: (data.sheets || []).map((s) => s.properties?.title).filter(Boolean),
  }
}

// One drag, one paste, one bulk change. Past this a request is either a
// mistake or somebody probing, and either way it is not a spreadsheet edit.
const MAX_BATCH_CELLS = 500

// Whole rows are a heavier thing than cells and a rarer gesture. Past two
// hundred, an add or a delete is not something somebody selected on screen.
const MAX_BATCH_ROWS = 200

const badRequest = (message) => {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

// ---------------------------------------------------------------------
// Whole rows
// ---------------------------------------------------------------------
// Everything above writes VALUES into cells that already exist. Adding and
// removing rows changes the shape of the sheet, which the Sheets API treats
// as a different kind of request -- `values.append` for one and a
// `deleteDimension` batch for the other -- and which needs the tab's
// numeric id rather than its name.

/**
 * The numeric ids of a spreadsheet's tabs, by title.
 *
 * Only `deleteDimension` needs these; everything else in this file
 * addresses a tab by name through an A1 range. Not cached: it is one small
 * request, it only happens on a delete, and a stale gid would aim a
 * deletion at whichever tab now holds that id.
 */
export async function tabGids(sheetId) {
  const data = await sheetsFetch(`/${sheetId}?fields=sheets.properties(sheetId,title)`)
  const out = {}
  for (const sheet of data.sheets || []) {
    const props = sheet.properties || {}
    if (props.title) out[props.title] = props.sheetId
  }
  return out
}

/**
 * Turns objects keyed by column name into the arrays the sheet wants.
 *
 * The order comes from the TAB'S OWN header row, read here, never from the
 * caller -- the same rule `updateCell` follows and for the same two
 * reasons. A caller that chose the order could put a permitted value under
 * a forbidden heading, and a browser holding this morning's column order
 * would write every value one column left of where it belongs the moment
 * somebody inserts a column in Google.
 *
 * A column the row says nothing about is written as an empty string rather
 * than skipped: a short array leaves the cells beyond it untouched, which
 * on an append is harmless and on any future in-place write would silently
 * keep whatever was there before.
 */
function toRowArrays(headers, rows) {
  return rows.map((row) => headers.map((h) => {
    const value = row?.[h]
    return value === undefined || value === null ? '' : String(value)
  }))
}

/**
 * Appends rows to the bottom of a tab.
 *
 * `INSERT_ROWS` rather than `OVERWRITE`: overwrite starts at the first
 * empty row of the range, which on a sheet with a stray value parked below
 * the data is not the bottom of the table -- it is on top of that value.
 *
 * Returns the row numbers Google actually gave them, read back out of the
 * updated range, so the caller can say WHERE the rows went instead of
 * "done". Nothing else can know: the browser cannot see the bottom of a
 * sheet it has filtered, and two people appending at once each get rows
 * they did not choose the position of.
 */
export async function appendRows(sheetId, tabName, rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) throw badRequest('Nothing to add')
  if (list.length > MAX_BATCH_ROWS) throw badRequest(`That is more than ${MAX_BATCH_ROWS} rows in one go`)

  const sheet = await fetchSheetRows(sheetId, tabName, { fresh: true })
  if (sheet.headers.length === 0) throw badRequest('That tab has no header row to add under')

  const range = encodeURIComponent(`${tabName}!A1`)
  const result = await sheetsFetch(
    `/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: toRowArrays(sheet.headers, list) }) }
  )
  invalidateCache(sheetId, tabName)

  return { added: list.length, rows: appendedRowNumbers(result, list.length) }
}

/** Which rows an append landed on, from the range Google says it wrote. */
function appendedRowNumbers(result, count) {
  const range = result?.updates?.updatedRange || ''
  const first = Number(range.match(/![A-Z]+(\d+)/)?.[1])
  if (!Number.isInteger(first)) return []
  return Array.from({ length: count }, (_, i) => first + i)
}

/**
 * Deletes rows, by sheet row number.
 *
 * Two things make this safe to point at a live sheet, and both are the
 * whole of the function:
 *
 *   IT WORKS DOWNWARDS. Deleting row 5 moves row 9 to row 8, so a request
 *   that deleted 5 and then 9 would take out what used to be row 10.
 *   Sorted descending, every index is still valid when its turn comes.
 *
 *   IT GOES IN ONE BATCH. Contiguous runs are merged into single ranges and
 *   the whole set is one `batchUpdate`, which Google applies atomically --
 *   so a delete of forty rows cannot half-happen and leave a selection
 *   nobody can reconstruct.
 *
 * The caller is expected to have verified fingerprints first; this does not
 * re-check, because the check needs the tab as a whole and the caller has
 * already read it.
 */
export async function deleteRows(sheetId, tabName, rowNumbers) {
  const wanted = [...new Set((rowNumbers || []).map(Number))]
  if (wanted.length === 0) throw badRequest('Nothing to delete')
  if (wanted.length > MAX_BATCH_ROWS) throw badRequest(`That is more than ${MAX_BATCH_ROWS} rows in one go`)
  for (const row of wanted) {
    // Row 1 is the header. Deleting it renames every column at once and is
    // the one row a deletion can never legitimately mean.
    if (!Number.isInteger(row) || row < 2) throw badRequest('That row cannot be deleted')
  }

  const gid = (await tabGids(sheetId))[tabName]
  if (gid === undefined) throw badRequest(`Tab "${tabName}" is no longer in this spreadsheet`)

  const requests = mergeRuns(wanted).map(([start, end]) => ({
    deleteDimension: {
      // Zero-based and end-exclusive, against 1-based inclusive row
      // numbers: row 5 alone is [4, 5).
      range: { sheetId: gid, dimension: 'ROWS', startIndex: start - 1, endIndex: end },
    },
  }))

  await sheetsFetch(`/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) })
  invalidateCache(sheetId, tabName)
  return { deleted: wanted.length }
}

/**
 * Row numbers as descending contiguous runs: [7,3,5,4] -> [[7,7],[3,5]].
 *
 * Descending so each deletion leaves the ones still to come at the indices
 * they were found at, and merged so twenty adjacent rows are one range
 * rather than twenty requests.
 */
export function mergeRuns(rowNumbers) {
  const sorted = [...new Set(rowNumbers)].sort((a, b) => b - a)
  const runs = []
  for (const row of sorted) {
    const last = runs[runs.length - 1]
    if (last && last[0] === row + 1) last[0] = row
    else runs.push([row, row])
  }
  return runs
}

/**
 * Writes a single cell, addressed by header NAME.
 *
 * The column is located in the sheet's OWN header row, read here, and the
 * browser's idea of the headers is never consulted. That is the whole point
 * of this function, for two separate reasons:
 *
 *   PERMISSION. The caller has been checked against a column NAME -- "you
 *   may edit Remarks". If the position of that name came from the request,
 *   anyone allowed to edit one column could send a header list that puts
 *   "Remarks" where "Discount" actually sits, and write it. The name that
 *   was authorised has to be the name that is written.
 *
 *   STALENESS. A tab open in a browser since this morning has this
 *   morning's column order. If somebody has since inserted a column in
 *   Google, every index that browser holds is off by one -- and an edit
 *   made by index would land in the wrong column, silently, with the right
 *   value.
 *
 * The read is nearly always free: the same 15-second cache the dashboard
 * fills is what answers it.
 */
export async function updateCell(sheetId, tabName, rowNumber, columnName, value) {
  const row = Number(rowNumber)
  // Row 1 is the header. Writing there renames a column for everybody, and
  // is the one row an edit can never legitimately mean.
  if (!Number.isInteger(row) || row < 2) throw badRequest('That row cannot be edited')

  const sheet = await fetchSheetRows(sheetId, tabName)
  const colIdx = sheet.headers.indexOf(columnName)
  if (colIdx === -1) {
    throw badRequest(`Column "${columnName}" not found in this tab's header row`)
  }
  // Past the last row with data is not an edit, it is an append somewhere
  // arbitrary -- a typo in a row number should not write into row 90,000.
  if (row > sheet.rows.length + 1) throw badRequest('That row is no longer in this tab')

  const colLetter = columnIndexToLetter(colIdx)
  const range = encodeURIComponent(`${tabName}!${colLetter}${rowNumber}`)
  const result = await sheetsFetch(`/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[value]] }),
  })
  invalidateCache(sheetId, tabName)
  return result
}

/**
 * Writes MANY cells in ONE column, in a single call.
 *
 * The shape is deliberately narrow -- one column name, many row numbers --
 * and it is narrow for the permission check's sake. The caller upstream has
 * been cleared to edit exactly one named column; letting each entry name
 * its own column would mean one grant standing in for a write anywhere on
 * the sheet. A drag fills one column by definition, so nothing is lost.
 *
 * Everything `updateCell` refuses, this refuses too, per entry and before
 * anything is sent: the header row, a row past the end of the data, a
 * column that is not in the sheet's own header row. A batch is all-or-
 * nothing on validation for a plain reason -- a partly applied drag leaves
 * a span with no way to see where it stopped.
 */
export async function updateCells(sheetId, tabName, columnName, entries) {
  const list = Array.isArray(entries) ? entries : []
  if (list.length === 0) throw badRequest('Nothing to write')
  if (list.length > MAX_BATCH_CELLS) throw badRequest(`That is more than ${MAX_BATCH_CELLS} cells in one go`)

  const sheet = await fetchSheetRows(sheetId, tabName)
  const colIdx = sheet.headers.indexOf(columnName)
  if (colIdx === -1) {
    throw badRequest(`Column "${columnName}" not found in this tab's header row`)
  }
  const colLetter = columnIndexToLetter(colIdx)
  const lastRow = sheet.rows.length + 1

  const seen = new Set()
  const data = []
  for (const entry of list) {
    const row = Number(entry?.row)
    if (!Number.isInteger(row) || row < 2) throw badRequest('That row cannot be edited')
    if (row > lastRow) throw badRequest('One of those rows is no longer in this tab')
    // The same cell twice in one batch is two answers to one question, and
    // which one wins is whatever order Google happens to apply them in.
    if (seen.has(row)) throw badRequest('The same row was sent twice')
    seen.add(row)
    data.push({ range: `${tabName}!${colLetter}${row}`, values: [[entry?.value ?? '']] })
  }

  const result = await sheetsFetch(`/${sheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  })
  invalidateCache(sheetId, tabName)
  return result
}
