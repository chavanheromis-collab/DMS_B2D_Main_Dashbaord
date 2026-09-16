import { useCallback, useRef, useState } from 'react'
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { storage } from '../firebase'
import { useAuth } from '../context/AuthContext.jsx'
import {
  MAX_IMAGES,
  STALL_MS,
  cleanImage,
  imageProblem,
  roomFor,
  shrinkImage,
  storagePathFor,
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
 * why removing one deletes it and why the folder is the sender's own.
 */
export function useChatImages() {
  const { user } = useAuth()
  const uid = user?.uid
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
      if (!uid || list.length === 0) return
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
        const path = storagePathFor(uid, file.name)
        setBusy((n) => n + 1)
        try {
          const { blob, width, height } = await shrinkImage(file)
          const where = ref(storage, path)
          await send(where, blob, setPercent)
          const url = await getDownloadURL(where)
          const image = cleanImage({ url, width, height, path })
          if (!image) continue
          if (dropped.current.has(path)) {
            deleteObject(where).catch(() => {})
            continue
          }
          setImages((current) => (current.length >= MAX_IMAGES ? current : [...current, image]))
        } catch (e) {
          // Named rather than shrugged at: the likely causes have different
          // fixes, and only one of them is anybody's fault here.
          setError(uploadProblem(e?.code))
        } finally {
          setBusy((n) => Math.max(0, n - 1))
          setPercent(0)
        }
      }
    },
    [uid, images]
  )

  const remove = useCallback((path) => {
    dropped.current.add(path)
    setImages((current) => current.filter((image) => image.path !== path))
    if (path) deleteObject(ref(storage, path)).catch(() => {})
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
 * `uploadBytesResumable` rather than `uploadBytes` for one reason: it
 * reports progress, and progress is the difference between an upload that
 * is slow and one that is dead. A bucket that will not take the file does
 * not refuse it -- the request stalls, the SDK retries, and from the
 * outside a 400KB photo "uploads" for twenty minutes.
 *
 * So silence is treated as failure. If nothing moves for STALL_MS the task
 * is cancelled, which surfaces as `storage/canceled` and is turned into a
 * sentence naming what to check.
 */
function send(where, blob, onPercent) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(where, blob, { contentType: blob.type || 'image/jpeg' })
    let moved = Date.now()

    const watchdog = window.setInterval(() => {
      if (Date.now() - moved > STALL_MS) {
        window.clearInterval(watchdog)
        task.cancel()
      }
    }, 2000)

    const done = (fn, value) => {
      window.clearInterval(watchdog)
      onPercent(0)
      fn(value)
    }

    task.on(
      'state_changed',
      (snap) => {
        moved = Date.now()
        onPercent(snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0)
      },
      (e) => done(reject, e),
      () => done(resolve)
    )
  })
}
