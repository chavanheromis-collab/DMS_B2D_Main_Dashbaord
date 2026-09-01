import { useEffect, useMemo, useState } from 'react'
import { imageCandidates } from '../lib/imageUrl'

/**
 * An image URL that keeps trying.
 *
 * No single Google Drive endpoint serves every file, so a Drive link yields
 * several candidate URLs (see lib/imageUrl.js) and this walks them on error
 * rather than giving up on the first refusal.
 *
 * It lives here, on its own, because TWO places need it and the second one
 * did without: the entrance used a single URL and hid the logo when it
 * failed, so a Drive logo whose CDN copy had not been generated yet simply
 * never appeared. A second copy of the retry loop would have been a second
 * thing to fix the next time Drive changes an endpoint.
 *
 * Whatever uses this must also set `referrerPolicy="no-referrer"` on the
 * img: Google refuses image requests carrying a referrer from an origin it
 * does not know, which is every dashboard deployment, and a perfectly public
 * file 403s without it.
 */
export function useImageFallback(src, width = 200) {
  const candidates = useMemo(() => imageCandidates(src, { width }), [src, width])
  const [attempt, setAttempt] = useState(0)

  // A new source deserves a fresh run through the candidates: without this,
  // fixing a typo would leave the fallback showing until a page reload.
  useEffect(() => {
    setAttempt(0)
  }, [candidates.join('|')])

  return {
    url: candidates[attempt] || '',
    /** Every endpoint refused. Time for whatever the caller shows instead. */
    exhausted: attempt >= candidates.length,
    onError: () => setAttempt((n) => n + 1),
  }
}
