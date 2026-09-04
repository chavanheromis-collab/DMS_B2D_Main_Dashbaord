import { GoogleAuth } from 'google-auth-library'

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
    const obj = { _row: i + 2 } // 1-based sheet row number (header is row 1)
    headers.forEach((h, colIdx) => {
      obj[h] = row[colIdx] ?? ''
    })
    return obj
  })
  return { headers, rows }
}

/** Reads one whole tab and returns { headers, rows }. */
export async function fetchSheetRows(sheetId, tabName) {
  const key = cacheKey(sheetId, tabName)
  const hit = cache.get(key)
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

const badRequest = (message) => {
  const err = new Error(message)
  err.statusCode = 400
  return err
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
