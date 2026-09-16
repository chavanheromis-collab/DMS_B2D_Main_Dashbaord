import { GoogleAuth } from 'google-auth-library'

// ---------------------------------------------------------------------
// Chat pictures, in Google Drive
// ---------------------------------------------------------------------
// The pictures people send each other live in one Drive folder -- "CUS Chat
// Images" -- beside everything else this dealership keeps in Drive, rather
// than in a storage bucket nobody ever opens.
//
// ITS OWN AUTH CLIENT, and its own scope. The listing client next door is
// `drive.readonly` on purpose, with a comment saying why: widening it would
// widen every token that already works. Uploading needs to write, so it
// gets a second client, and a Drive problem here still cannot stop a
// spreadsheet loading.
//
// THE FOLDER IS FOUND, THEN CREATED. Looked up by name so that an admin can
// make it themselves, share it, and have the app use exactly that one --
// and created on first use when they have not. The id is remembered for as
// long as the process lives, because a serverless function reused between
// two uploads should not ask Drive the same question twice.
//
// WHERE IT LIVES IS CONFIGURABLE, and worth understanding:
//
//   GOOGLE_DRIVE_CHAT_PARENT is the folder to make it in. Set it to a
//   folder in a SHARED DRIVE and the files belong to that drive, which is
//   the arrangement that keeps working: a service account has almost no
//   storage of its own, and files it owns in an ordinary folder eventually
//   fail with a quota error that reads like a bug.
//
//   Unset, the folder is created in the service account's own Drive. Fine
//   for a trial, and the first thing to change when uploads start failing.

const BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

/** The folder, by name. Exactly as asked for, and matched on exactly this. */
export const CHAT_FOLDER = 'CUS Chat Images'

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
    // Write, because this uploads. Narrower than it looks: a service
    // account sees only what has been shared with it.
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
}

let cachedAuth = null
async function getAccessToken() {
  if (!cachedAuth) cachedAuth = getAuthClient()
  const client = await cachedAuth.getClient()
  const { token } = await client.getAccessToken()
  return token
}

async function driveFetch(url, options = {}) {
  const token = await getAccessToken()
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  })

  if (!res.ok) {
    const body = await res.text()
    let detail = body
    try {
      detail = JSON.parse(body)?.error?.message || body
    } catch {
      // Not JSON. The raw body is the best detail there is.
    }
    const err = new Error(`Drive: ${detail}`)
    // A quota failure is the one worth naming: it means the folder is in
    // the service account's own Drive rather than a Shared Drive, and no
    // amount of retrying will help.
    err.statusCode = /quota/i.test(detail) ? 507 : res.status === 403 ? 403 : res.status === 404 ? 404 : 502
    throw err
  }

  return res.status === 204 ? null : res.json()
}

const quote = (s) => String(s).replace(/'/g, "\\'")

let cachedFolder = ''

/** The id of "CUS Chat Images", found or made. */
export async function chatFolderId() {
  if (cachedFolder) return cachedFolder

  const parent = String(process.env.GOOGLE_DRIVE_CHAT_PARENT || '').trim()
  const clauses = [
    `name = '${quote(CHAT_FOLDER)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ]
  if (parent) clauses.push(`'${quote(parent)}' in parents`)

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id, name)',
    pageSize: '1',
    // A folder in a Shared Drive is invisible to a plain query otherwise.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })

  const found = await driveFetch(`${BASE}/files?${params}`)
  if (found?.files?.length) {
    cachedFolder = found.files[0].id
    return cachedFolder
  }

  const made = await driveFetch(`${BASE}/files?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: CHAT_FOLDER,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parent ? { parents: [parent] } : {}),
    }),
  })

  cachedFolder = made.id
  return cachedFolder
}

/**
 * One picture into that folder. Returns `{ id, link }`.
 *
 * The file is then made readable by anyone holding its link, because that
 * is what an <img> in a browser needs: the tag carries no sign-in, and a
 * private Drive file answers it with a 403. It is the same bargain as the
 * storage bucket this replaced -- a long unguessable link -- and it is
 * written down in the README rather than left to be discovered.
 */
export async function uploadChatImage({ bytes, mimeType, name }) {
  const parent = await chatFolderId()
  const boundary = `cus${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

  const meta = JSON.stringify({ name: name || 'chat image', parents: [parent] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])

  const file = await driveFetch(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })

  await driveFetch(`${BASE}/files/${file.id}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })

  // The canonical Drive link. The browser turns it into whichever endpoint
  // actually serves the picture -- see src/lib/imageUrl.js.
  return { id: file.id, link: `https://drive.google.com/file/d/${file.id}/view` }
}

/**
 * Remove one, and ONLY one of ours.
 *
 * The parent is checked first. Without that, an endpoint that takes a file
 * id from the browser and removes it is an endpoint for removing anything
 * this service account can reach -- which is every spreadsheet the
 * dashboard runs on.
 *
 * TRASHED, NOT DESTROYED, and not by preference. In a Shared Drive only a
 * MANAGER may delete a file outright; a Content manager -- all this app
 * asks to be -- gets a bare 404 from files.delete on a file it created
 * itself and can plainly see. Trashing is the operation the role actually
 * has, and it is the better default regardless: "I changed my mind about
 * that picture" should be undoable from the Drive trash rather than final.
 */
export async function deleteChatImage(fileId) {
  const id = String(fileId || '').trim()
  if (!id) return false

  const parent = await chatFolderId()
  const file = await driveFetch(`${BASE}/files/${id}?fields=parents&supportsAllDrives=true`)
  if (!file?.parents?.includes(parent)) {
    const err = new Error('That file is not a chat picture')
    err.statusCode = 403
    throw err
  }

  await driveFetch(`${BASE}/files/${id}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
  return true
}
