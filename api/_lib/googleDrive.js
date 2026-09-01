import { GoogleAuth } from 'google-auth-library'

// ---------------------------------------------------------------------
// Listing a Drive folder
// ---------------------------------------------------------------------
// A 360° set is twelve photographs in a folder. The browser cannot ask
// Drive for them: a folder id plus a file NAME is not a URL, and there is
// no way to construct one -- every Drive file is addressed by its own id,
// which only a listing can tell you.
//
// So the server lists the folder with the same service account that reads
// the spreadsheets, and hands back ids the browser can turn into image URLs
// (see lib/imageUrl.js).
//
// ITS OWN AUTH CLIENT, deliberately. Adding `drive.readonly` to the Sheets
// client would widen the scope of every token that already works; a
// separate one means a Drive misconfiguration can never stop a spreadsheet
// loading.
//
// The folder must be shared with the service account's email, exactly like
// sharing with a person -- the same rule the spreadsheets already follow.

const BASE = 'https://www.googleapis.com/drive/v3'

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
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
}

let cachedAuth = null
async function getAccessToken() {
  if (!cachedAuth) cachedAuth = getAuthClient()
  const client = await cachedAuth.getClient()
  const { token } = await client.getAccessToken()
  return token
}

/**
 * Every image in one folder: `[{ id, name, mimeType }]`.
 *
 * Ordered by name here as a courtesy; the browser re-sorts by the trailing
 * frame number, which is the order that actually matters (see
 * lib/spin360.js). Paged, because a folder is not promised to fit in one
 * response and a 360° set that silently loses its last four frames is a
 * bike that jumps as it turns.
 */
export async function listFolderImages(folderId) {
  const id = String(folderId || '').trim()
  if (!id) throw new Error('No folder id')

  const files = []
  let pageToken = ''

  do {
    const params = new URLSearchParams({
      q: `'${id.replace(/'/g, "\\'")}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      orderBy: 'name',
      pageSize: '200',
      // A folder in a Shared Drive is invisible to a plain query otherwise,
      // and "the folder is shared but comes back empty" is a support call
      // nobody can diagnose.
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const token = await getAccessToken()
    const res = await fetch(`${BASE}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const body = await res.text()
      let detail = body
      try {
        detail = JSON.parse(body)?.error?.message || body
      } catch {
        // Not JSON. The raw body is the best detail there is.
      }
      if (res.status === 404) {
        throw new Error(
          `Drive folder not found, or not shared with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}. ` +
            'Open the folder in Drive, press Share, and add that address as a Viewer.'
        )
      }
      throw new Error(`Drive: ${detail}`)
    }

    const data = await res.json()
    files.push(...(data.files || []))
    pageToken = data.nextPageToken || ''
    // A folder with thousands of images is not a 360° set; stop rather than
    // page through it for a minute.
  } while (pageToken && files.length < 600)

  return files
}
