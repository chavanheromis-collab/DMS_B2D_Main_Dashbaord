import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { RECENT_LIMIT, emojiName, firstEmoji, knownEmoji, rememberEmoji, searchEmoji } from '../../lib/emoji'
import { useLocalState } from '../../hooks/usePageData'

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
 */
export default function EmojiPicker({ value, onChange, placeholder = '📊', className = 'w-16' }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(0)
  const [recent, setRecent] = useLocalState('emoji.recent', [])
  const ref = useRef(null)

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

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
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

      {open && (
        <div className="absolute left-0 top-full z-[9999] mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="relative mb-1.5">
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
                <>
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">Recent</p>
                  <Grid emoji={mine.map((c) => [c, emojiName(data, c)])} onPick={choose} value={value} />
                  <div className="my-1.5 h-px bg-slate-100" />
                </>
              )}

              <div className="mb-1 flex gap-0.5">
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
              className="mt-1.5 w-full rounded py-1 text-[11px] text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            >
              No icon
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The grid itself.
 *
 * Capped in HEIGHT rather than in count: a category of 385 people should be
 * all 385, and the browser scrolls a list far better than a picker can
 * paginate one.
 */
function Grid({ emoji, onPick, value, empty = 'Nothing here' }) {
  if (emoji.length === 0) return <p className="py-6 text-center text-[11px] text-slate-400">{empty}</p>

  return (
    <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
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
