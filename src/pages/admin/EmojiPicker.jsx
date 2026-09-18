import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { RECENT_LIMIT, emojiName, firstEmoji, knownEmoji, rememberEmoji, searchEmoji } from '../../lib/emoji'
import { placePopover } from '../../lib/popoverPlace'
import { useLocalState } from '../../hooks/usePageData'

/** What the grid asks for when the screen has the room. */
const MENU_WIDTH = 288

/**
 * An icon field you can pick from as well as type into.
 *
 * Every icon in this app was a text box with an emoji as its placeholder,
 * which meant using one required already knowing which one you wanted,
 * finding it somewhere else and pasting it in. In practice everybody used
 * the placeholder, and a workspace of forty widgets was forty identical 📊.
 *
 * Still a text box, though: pasting one straight in has always worked and
 * still does, and somebody who knows exactly which emoji they want should
 * not have to hunt for it in a grid. The button beside it opens the other
 * 1,898.
 *
 * The whole set is 146KB and lives behind a dynamic import, so a page that
 * never opens a picker never downloads it -- which is every page except an
 * admin's, and every admin session except the one where they set an icon.
 *
 * THE GRID IS PORTALLED, and that is not decoration. These fields sit in
 * the on-page editor panel and in admin cards, both of which scroll, and a
 * menu drawn inside a scroll container is cut off by it -- which is what
 * "the emoji dropdown does not work" turns out to be. In `<body>` and
 * placed against the viewport, it is also free to flip above a field near
 * the bottom of the screen and to narrow itself on a phone, neither of
 * which an `absolute top-full` box can do. See lib/popoverPlace.js.
 */
export default function EmojiPicker({ value, onChange, placeholder = '📊', className = 'w-16' }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(0)
  const [recent, setRecent] = useLocalState('emoji.recent', [])
  const ref = useRef(null)
  const menu = useRef(null)
  const [place, setPlace] = useState(null)

  // Fetched the first time the grid is opened, and kept for the session.
  useEffect(() => {
    if (!open || data) return
    let live = true
    import('../../lib/emojiData').then((mod) => {
      if (live) setData(mod.EMOJI_GROUPS)
    })
    return () => {
      live = false
    }
  }, [open, data])

  // Measured, then placed -- before the browser paints, so it never appears
  // in the wrong spot first. Re-run as the grid's own size changes: loading
  // the set and typing a search both change how tall it wants to be.
  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined
    const put = () => {
      const anchor = ref.current?.getBoundingClientRect()
      if (!anchor) return
      const box = menu.current?.getBoundingClientRect()
      setPlace(
        placePopover(
          anchor,
          { width: MENU_WIDTH, height: box?.height || 360 },
          { width: window.innerWidth, height: window.innerHeight }
        )
      )
    }
    put()
    window.addEventListener('resize', put)
    return () => window.removeEventListener('resize', put)
  }, [open, data, query, group, recent.length])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      // The grid is in `<body>` now, so "outside" is outside BOTH of them.
      const inside = ref.current?.contains(e.target) || menu.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // A fixed menu would drift away from its field as the page behind it
    // scrolls, so it closes -- the same answer the table's filter menu
    // gives. Scrolling the grid itself is not the page moving.
    const onScroll = (e) => {
      if (menu.current && e.target && menu.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const results = useMemo(() => (data && query ? searchEmoji(data, query) : null), [data, query])
  const mine = useMemo(() => (data ? knownEmoji(data, recent) : []), [data, recent])
  const title = useMemo(() => (data ? emojiName(data, value) : ''), [data, value])

  function choose(char) {
    onChange(char)
    setRecent((list) => rememberEmoji(list, char, { limit: RECENT_LIMIT }))
    setOpen(false)
    setQuery('')
  }

  const style = place
    ? { position: 'fixed', top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight }
    : // Measured where it cannot be seen doing it.
      { position: 'fixed', top: -9999, left: -9999, width: MENU_WIDTH, visibility: 'hidden' }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div className="flex items-center gap-0.5">
        <input
          value={value || ''}
          // Pasting a whole line -- which is what happens when somebody
          // copies out of a chat -- takes the picture and leaves the
          // sentence, rather than putting a paragraph where a 16px glyph
          // belongs. An empty paste clears it, which is how you remove one.
          onChange={(e) => onChange(firstEmoji(e.target.value))}
          placeholder={placeholder}
          title={title || 'Type or paste an emoji'}
          className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm focus:border-indigo-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title="Pick an emoji"
          className={`shrink-0 rounded-lg border px-1 py-1.5 text-[10px] transition-colors ${
            open ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-400 hover:bg-slate-50'
          }`}
        >
          ▾
        </button>
      </div>

      {open &&
        createPortal(
          <div
            ref={menu}
            style={style}
            className="z-[9999] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
          >
            <div className="relative mb-1.5 shrink-0">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 1,898 emoji…"
                className="w-full rounded-lg border border-slate-200 py-1 pl-7 pr-6 text-xs focus:border-indigo-400 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {!data ? (
              <p className="py-6 text-center text-[11px] text-slate-400">Loading…</p>
            ) : results ? (
              <Grid emoji={results.map((r) => [r.char, r.name])} onPick={choose} value={value} empty="Nothing matches" />
            ) : (
              <>
                {/* Yours first. A picker of nineteen hundred is only usable
                    because most of the time you want one of six. */}
                {mine.length > 0 && (
                  <div className="shrink-0">
                    <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">Recent</p>
                    <Grid emoji={mine.map((c) => [c, emojiName(data, c)])} onPick={choose} value={value} grow={false} />
                    <div className="my-1.5 h-px bg-slate-100" />
                  </div>
                )}

                <div className="mb-1 flex shrink-0 gap-0.5">
                  {data.map((g, i) => (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => setGroup(i)}
                      title={g.name}
                      className={`flex-1 rounded py-0.5 text-sm transition-colors ${
                        i === group ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'
                      }`}
                    >
                      {g.icon}
                    </button>
                  ))}
                </div>

                <Grid emoji={data[group]?.emoji || []} onPick={choose} value={value} />
              </>
            )}

            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="mt-1.5 shrink-0 rounded py-1 text-[11px] text-slate-500 hover:bg-rose-50 hover:text-rose-600"
              >
                No icon
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

/**
 * The grid itself.
 *
 * It takes the height the menu has left rather than a fixed 208px, because
 * what is left is what a phone in landscape has -- and it scrolls inside
 * that. Capped by HEIGHT and never by count: a category of 385 people
 * should be all 385, and a browser scrolls a list far better than a picker
 * paginates one.
 */
function Grid({ emoji, onPick, value, empty = 'Nothing here', grow = true }) {
  if (emoji.length === 0) return <p className="py-6 text-center text-[11px] text-slate-400">{empty}</p>

  return (
    <div
      className={`grid grid-cols-8 gap-0.5 overflow-y-auto ${grow ? 'min-h-0 flex-1' : 'max-h-24'}`}
    >
      {emoji.map((entry) => {
        const char = entry[0]
        const name = entry[1]
        return (
          <button
            key={char}
            type="button"
            onClick={() => onPick(char)}
            title={name}
            className={`rounded p-1 text-lg leading-none transition-colors hover:bg-indigo-50 ${
              char === value ? 'bg-indigo-100 ring-1 ring-indigo-300' : ''
            }`}
          >
            {char}
          </button>
        )
      })}
    </div>
  )
}
