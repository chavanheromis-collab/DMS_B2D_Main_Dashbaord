// ---------------------------------------------------------------------
// "Call this person" -- said in one place, heard in another
// ---------------------------------------------------------------------
// The button is in the chat panel. The call lives on App, above every
// route, so that walking from a dashboard to the admin panel does not hang
// up on somebody. Those two are siblings with a very large tree between
// them, and the only thing they share is one verb.
//
// A context would mean wrapping the whole app to pass a single function
// down; lifting the call state up would put a WebRTC connection inside the
// component that re-renders on every keystroke of a message. So: one
// module, one verb, and both sides stay where they belong.

const listeners = new Set()

/** Ask for a call with somebody. Returns how many places heard it. */
export function requestCall(uid) {
  const id = String(uid || '').trim()
  if (!id) return 0
  for (const listener of [...listeners]) {
    try {
      listener(id)
    } catch {
      // One broken listener must not stop the others, or the call button
      // would work only until something else went wrong.
    }
  }
  return listeners.size
}

/** Listen for those asks. Returns the unsubscribe. */
export function onCallRequest(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For tests, and for asserting nothing was left behind. */
export const callListenerCount = () => listeners.size
