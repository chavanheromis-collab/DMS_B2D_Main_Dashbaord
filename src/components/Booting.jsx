/**
 * The screen between arriving and seeing anything.
 *
 * It was the word "Loading…" in grey, centred on white. Which is not wrong,
 * exactly -- it is just indistinguishable from a page that has given up, and
 * a dashboard's first load is long enough (auth, then the workspace, then
 * every tab of every sheet) for somebody to start wondering.
 *
 * Three things fix that, and none of them is a bigger spinner:
 *
 *   MOTION says the app is working rather than stuck. A static word cannot.
 *   A REASON says which part is slow -- signing in, finding a page, fetching
 *     the admin panel -- so a long wait is explained rather than mysterious.
 *   A SHAPE that looks like the page being waited for turns the wait into
 *     the beginning of the thing instead of an interruption before it.
 *
 * Deliberately no timeout message. "This is taking longer than usual" is a
 * sentence that arrives exactly when somebody is already annoyed and tells
 * them nothing they cannot see.
 */
export default function Booting({ label = 'Loading', skeleton = false }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-50/40">
      {skeleton ? <CardSkeleton /> : <Pulse />}

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" />
        <span className="ml-1 text-xs font-medium text-slate-500">{label}…</span>
      </div>
    </div>
  )
}

/** The app's own mark, breathing. */
function Pulse() {
  return (
    <div className="relative h-12 w-12">
      <span className="absolute inset-0 animate-ping rounded-2xl bg-indigo-400/30" />
      <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-sky-400 shadow-lg" />
    </div>
  )
}

/**
 * The shape of a card, for where one is about to appear.
 *
 * Not a spinner in a box: a spinner says "wait", a skeleton says "a card is
 * coming and this is where it goes", and the second one is the difference
 * between a page that is loading and a page that is broken.
 */
export function CardSkeleton({ className = '' }) {
  return (
    <div className={`card ${className}`} aria-hidden>
      <div className="skeleton mb-3 h-3 w-32 rounded" />
      <div className="skeleton mb-2 h-8 w-24 rounded" />
      <div className="flex h-24 items-end gap-2">
        {[60, 85, 45, 95, 70].map((h, i) => (
          <div key={i} className="skeleton flex-1 rounded-t" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

/**
 * A row of them, for a canvas whose widgets have not arrived.
 *
 * Three, because a page of one is unusual and a page of ten would be a
 * screenful of grey pretending to be a dashboard.
 */
export function CanvasSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}
