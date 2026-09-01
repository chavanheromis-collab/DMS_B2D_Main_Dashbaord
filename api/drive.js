import { requireUser } from './_lib/firebaseAdmin.js'
import { listFolderImages } from './_lib/googleDrive.js'

// ---------------------------------------------------------------------
// The images in one Drive folder
// ---------------------------------------------------------------------
// Used by the 360° viewer, which needs the FILE IDS of a set of frames. A
// folder id and a file name are not a URL and cannot be turned into one --
// only a listing knows a file's id -- so this is the one thing that must
// happen on the server.
//
// Signed in is the whole check. What comes back is a list of names and ids
// for a folder the person asking already has the id of, and every image it
// describes is one an admin deliberately shared with the service account.
// There is no per-page rule to apply here the way there is for a
// spreadsheet ref: a folder is not addressed by a page.
//
// Cached at the edge for a few minutes. A 360° set does not change between
// two people looking at the same vehicle, and a listing per viewer per page
// load is a Drive quota nobody budgeted for.

export default async function handler(req, res) {
  try {
    await requireUser(req)

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const folderId = String(req.query.folder || '').trim()
    if (!folderId) return res.status(400).json({ error: 'No folder id' })

    const files = await listFolderImages(folderId)

    // `s-maxage` is the shared cache; `stale-while-revalidate` means the
    // one unlucky request after it expires still gets an instant answer
    // while the next listing happens behind it.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
    return res.status(200).json({ files })
  } catch (e) {
    const status = e.statusCode || 500
    return res.status(status).json({ error: e.message || 'Internal error' })
  }
}
