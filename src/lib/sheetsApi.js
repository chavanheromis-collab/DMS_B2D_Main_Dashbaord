// Talks to our own /api/sheets serverless function, which in turn talks to
// the Google Sheets API using a service account. The browser never calls
// Google directly and never needs a Sheets OAuth token -- it only sends a
// Firebase ID token, which proves who's asking so the server can check
// that person's permissions.

export class SheetsAuthError extends Error {
  constructor(msg) {
    super(msg)
    this.name = 'SheetsAuthError'
  }
}

async function apiFetch(idToken, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  // The API route always responds with JSON when it actually runs. Anything
  // else means the serverless function never executed (e.g. running plain
  // `vite` locally, or a deployment/routing misconfiguration) -- catch that
  // with an actionable message instead of a cryptic JSON parse error.
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    let hint = `The server returned an unexpected response (status ${res.status}).`
    if (text.trim().startsWith('<')) {
      hint =
        "The /api backend isn't running -- the app's own HTML page came back instead of data. " +
        'Locally, run "npm run dev" rather than "npm run dev:frontend-only". ' +
        "If this is deployed, check that the Vercel deployment succeeded."
    } else if (/^\s*(import|export)\s/.test(text)) {
      hint =
        "The /api backend returned raw source instead of running it -- Vercel isn't executing it as a " +
        "serverless function. Check the project's Root Directory setting (it must contain package.json " +
        'and the /api folder) and confirm the latest deployment succeeded.'
    }
    throw new Error(hint)
  }

  const body = await res.json()
  if (res.status === 401) throw new SheetsAuthError('Your sign-in session has expired. Please sign in again.')
  if (res.status === 403) throw new SheetsAuthError(body.error || "You don't have access to this page.")
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

/**
 * Reads a dashboard page's data in one request.
 *
 * `refs` are qualified "<sourceId>::<tabName>" addresses (see lib/refs.js) --
 * a page may pull from several spreadsheets at once, and the server batches
 * per spreadsheet before replying. Pass none to read everything the page is
 * allowed. Returns { tabs: { [ref]: { headers, rows, error? } } }.
 */
export async function fetchPageData(idToken, pageId, refs) {
  const params = new URLSearchParams({ page: pageId })
  if (refs?.length) params.set('refs', refs.join(','))
  return apiFetch(idToken, `/api/sheets?${params.toString()}`)
}

/**
 * Reads an UNMIGRATED v2 page, whose config still lives under
 * `sheetConfigs/{PAGE}` and addresses data by bare tab name.
 */
export async function fetchLegacyPageData(idToken, page, tabs) {
  const params = new URLSearchParams({ page })
  if (tabs?.length) params.set('tabs', tabs.join(','))
  return apiFetch(idToken, `/api/sheets?${params.toString()}`)
}

/**
 * Admin-only: asks Google for the actual tab names inside a spreadsheet so
 * the admin panel can show a picker instead of a free-text box. Runs before
 * a data source has been saved, hence the raw sheetId.
 */
export async function fetchSpreadsheetTabs(idToken, sheetId, sourceId) {
  const params = new URLSearchParams({ action: 'listTabs' })
  if (sheetId) params.set('sheetId', sheetId)
  if (sourceId) params.set('sourceId', sourceId)
  return apiFetch(idToken, `/api/sheets?${params.toString()}`)
}

/**
 * Writes a single cell back to the spreadsheet, addressed by ref + header
 * name. The server re-checks that this user may edit this column on this
 * ref before touching Google.
 */
export async function updateCell(idToken, pageId, ref, rowNumber, headers, columnName, value) {
  return apiFetch(idToken, '/api/sheets', {
    method: 'POST',
    body: JSON.stringify({ page: pageId, ref, row: rowNumber, column: columnName, value, headers }),
  })
}
