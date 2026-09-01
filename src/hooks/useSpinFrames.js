import { useEffect, useState } from 'react'
import { auth } from '../firebase'
import { orderFrames } from '../lib/spin360'
import { driveImageUrl } from '../lib/imageUrl'

// One listing per folder for the life of the page. Three viewers of the
// same vehicle, or the same one re-rendering as somebody drags it, must not
// each ask Drive again.
const cache = new Map()

/**
 * The frames of one 360° set, ready to draw.
 *
 * Returns `{ frames, loading, error }`, where a frame is a plain image URL
 * at the size the viewer will actually draw it -- fetched at twice that,
 * because a photograph shown at 520px and fetched at 520px is visibly soft
 * on any modern screen.
 */
export function useSpinFrames(folderId, width = 520) {
  const [state, setState] = useState({ frames: [], loading: false, error: '' })

  useEffect(() => {
    const id = String(folderId || '').trim()
    if (!id) {
      setState({ frames: [], loading: false, error: '' })
      return undefined
    }

    const key = `${id}@${width}`
    if (cache.has(key)) {
      setState({ frames: cache.get(key), loading: false, error: '' })
      return undefined
    }

    let cancelled = false
    setState({ frames: [], loading: true, error: '' })

    ;(async () => {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) throw new Error('Not signed in')
        const res = await fetch(`/api/drive?folder=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || `Drive listing failed (${res.status})`)

        // Ordered by the trailing frame number, not by name -- see
        // lib/spin360.js for why a string sort is a trap here.
        const frames = orderFrames(body.files).map((f) => ({
          id: f.id,
          name: f.name,
          url: driveImageUrl(f.id, width * 2),
        }))
        cache.set(key, frames)
        if (!cancelled) setState({ frames, loading: false, error: '' })
      } catch (e) {
        if (!cancelled) setState({ frames: [], loading: false, error: e?.message || 'Could not load the frames' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [folderId, width])

  return state
}
