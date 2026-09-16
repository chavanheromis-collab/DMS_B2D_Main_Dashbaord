import { requireUser } from './_lib/firebaseAdmin.js'
import { deleteChatImage, uploadChatImage } from './_lib/chatDrive.js'

// ---------------------------------------------------------------------
// A picture sent in a chat
// ---------------------------------------------------------------------
// The browser cannot put a file in Drive itself: doing so would need every
// reader signed in to Google with write access to the folder, which is the
// arrangement this app spent its life avoiding -- the service account holds
// the access, and the server uses it. So the picture is posted here and
// this puts it in "CUS Chat Images".
//
// SIGNED IN IS THE CHECK, as it is for the folder listing next door. Anyone
// with an account may send a message, so anyone with an account may send a
// picture with it; there is no per-page rule to apply, because a chat is
// not addressed by a page.
//
// SMALL, AND A PICTURE. The browser shrinks before it posts (see
// src/lib/chatImages.js), so anything arriving near this ceiling did not
// come from the app. Both limits are here as well as there, because a
// limit enforced only in the thing sending it is not a limit.

// Three megabytes, not eight. Base64 inflates the body by a third, and a
// serverless platform refuses a request body over roughly 4.5MB before this
// handler ever runs -- so a higher ceiling here would be a limit that never
// fires, with the platform's own unexplained error arriving in its place. A
// shrunk picture is a few hundred kilobytes, so nothing sent by the app
// comes near this.
const MAX_BYTES = 3 * 1024 * 1024
const IMAGE = /^image\/(png|jpe?g|gif|webp|avif|heic|heif|bmp)$/i

export default async function handler(req, res) {
  try {
    await requireUser(req)

    if (req.method === 'POST') {
      const { name, mimeType, data } = req.body || {}

      if (!IMAGE.test(String(mimeType || ''))) {
        return res.status(400).json({ error: 'Only pictures can be sent in a chat' })
      }

      const bytes = Buffer.from(String(data || ''), 'base64')
      if (bytes.length === 0) return res.status(400).json({ error: 'That picture was empty' })
      if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'That picture is too big to send' })

      const file = await uploadChatImage({ bytes, mimeType, name: String(name || 'chat image').slice(0, 120) })
      // Nothing is cached: every picture is new, and the answer is a link
      // to a file that did not exist a moment ago.
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(file)
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || req.body?.id || '').trim()
      if (!id) return res.status(400).json({ error: 'No picture id' })
      await deleteChatImage(id)
      return res.status(200).json({ removed: true })
    }

    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    const status = e.statusCode || 500
    return res.status(status).json({ error: e.message || 'Internal error' })
  }
}
