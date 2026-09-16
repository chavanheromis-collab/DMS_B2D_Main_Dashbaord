import { useCallback, useRef, useState } from 'react'
import { auth } from '../firebase'
import {
  MAX_IMAGES,
  STALL_MS,
  cleanImage,
  driveNameFor,
  imageProblem,
  roomFor,
  shrinkImage,
  toBase64,
  uploadProblem,
} from '../lib/chatImages'

/**
 * Pictures on their way into a chat.
 *
 * Held here until the message is sent, because that is what lets somebody
 * paste three screenshots, change their mind about one, write a line and
 * send the rest -- rather than each paste being its own message.
 *
 * They are uploaded AS THEY ARE CHOSEN rather than on send, so pressing
 * send is instant and the wait happens while the person is still typing.
 * The cost of that is an abandoned draft leaving files behind, which is
 * why removing one deletes it too.
 *
 * The bytes go to Google Drive, through this app's own server -- the
 * browser holds no Drive access, the service account does. See
 * api/chatImage.js.
 */
export function useChatImages() {
  const [images, setImages] = useState([])
  const [busy, setBusy] = useState(0)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  // Removing a picture while it is still uploading has to win -- otherwise
  // the finished upload puts back what somebody has just taken away.
  const dropped = useRef(new Set())

  const add = useCallback(
    async (files) => {
      const list = Array.from(files || [])
      if (list.length === 0) return
      setError('')

      const room = roomFor(images)
      if (room <= 0) {
        setError(`A message can carry ${MAX_IMAGES} pictures`)
        return
      }

      const wanted = list.slice(0, room)
      const refused = wanted.map(imageProblem).find(Boolean)
      if (refused) setError(refused)

      for (const file of wanted) {
        if (imageProblem(file)) continue
        setBusy((n) => n + 1)
        const mine = `${Date.now()}-${file.name}`
        try {
          const { blob, width, height } = await shrinkImage(file)
          const { id, link } = await send(blob, file.name, setPercent)
          const image = cleanImage({ url: link, width, height, path: id })
          if (!image) continue
          if (dropped.current.has(mine)) {
            remove(image.path)
            continue
          }
          setImages((current) => (current.length >= MAX_IMAGES ? current : [...current, image]))
        } catch (e) {
          // Named rather than shrugged at: the likely causes have different
          // fixes, and only one of them is anybody's fault here.
          setError(uploadProblem(e))
        } finally {
          setBusy((n) => Math.max(0, n - 1))
          setPercent(0)
        }
      }
    },
    [images]
  )

  const remove = useCallback((id) => {
    dropped.current.add(id)
    setImages((current) => current.filter((image) => image.path !== id))
    if (!id) return
    auth.currentUser
      ?.getIdToken()
      .then((token) =>
        fetch(`/api/chatImage?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      // A picture nobody will ever see again, still in a folder: worth
      // trying to tidy, never worth an error in front of somebody.
      .catch(() => {})
  }, [])

  /** After a send: the pictures belong to the message now, not to the box. */
  const clear = useCallback(() => {
    dropped.current = new Set()
    setImages([])
    setError('')
  }, [])

  return { images, add, remove, clear, busy, percent, error, clearError: () => setError('') }
}

/**
 * One upload, watched.
 *
 * XMLHttpRequest rather than fetch for one reason: it reports progress, and
 * progress is the difference between an upload that is slow and one that is
 * dead. Silence is treated as failure -- if nothing moves for STALL_MS the
 * request is abandoned and says so, rather than being waited out.
 */
function send(blob, name, onPercent) {
  return new Promise((resolve, reject) => {
    ;(async () => {
      const user = auth.currentUser
      const token = await user?.getIdToken()
      if (!token) throw Object.assign(new Error('Not signed in'), { status: 401 })

      const request = new XMLHttpRequest()
      let moved = Date.now()

      const watchdog = window.setInterval(() => {
        if (Date.now() - moved > STALL_MS) {
          window.clearInterval(watchdog)
          request.abort()
        }
      }, 2000)

      const done = (fn, value) => {
        window.clearInterval(watchdog)
        onPercent(0)
        fn(value)
      }

      request.upload.onprogress = (e) => {
        moved = Date.now()
        if (e.lengthComputable) onPercent(Math.round((e.loaded / e.total) * 100))
      }
      request.onabort = () => done(reject, Object.assign(new Error('The upload stopped'), { stalled: true }))
      request.onerror = () => done(reject, Object.assign(new Error('The upload failed'), { offline: true }))
      request.onload = () => {
        let body = {}
        try {
          body = JSON.parse(request.responseText || '{}')
        } catch {
          // A response that is not JSON is a proxy or a crash, not an answer.
        }
        if (request.status >= 200 && request.status < 300 && body.link) return done(resolve, body)
        done(reject, Object.assign(new Error(body.error || 'That picture could not be sent'), { status: request.status }))
      }

      request.open('POST', '/api/chatImage')
      request.setRequestHeader('Authorization', `Bearer ${token}`)
      request.setRequestHeader('Content-Type', 'application/json')
      request.send(
        JSON.stringify({
          // Named for the sender, so the folder can be read by a person.
          name: driveNameFor(user.uid, name),
          mimeType: blob.type || 'image/jpeg',
          data: await toBase64(blob),
        })
      )
    })().catch(reject)
  })
}
