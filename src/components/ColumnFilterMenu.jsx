import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { columnOptions, setAllOptions, toggleOption } from '../lib/columnFilters'

const MARGIN = 8

/**
 * The dropdown behind a column header's funnel — the Excel / Sheets filter.
 *
 * Portalled to `<body>` and positioned fixed, for the same reason the
 * pipeline's stage popup is: the table scrolls inside a card with
 * `overflow: auto`, so a menu rendered in the header would be clipped by the
 * first row it tried to cover.
 */
export default function ColumnFilterMenu({ column, anchorRect, rows, filters, onChange, onSort, sort, onClose }) {
  const ref = useRef(null)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState(null)

  const filter = filters?.[column] || {}
  const options = useMemo(() => columnOptions(rows, column, filters), [rows, column, filters])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // Placed after measuring, so a menu near the right edge or the bottom of
  // the window flips instead of hanging off it.
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return
    const box = ref.current.getBoundingClientRect()
    const left = Math.max(MARGIN, Math.min(anchorRect.left, window.innerWidth - box.width - MARGIN))
    const below = anchorRect.bottom + 6
    const top = below + box.height > window.innerHeight - MARGIN
      ? Math.max(MARGIN, anchorRect.top - box.height - 6)
      : below
    setPos({ left, top })
  }, [anchorRect, shown.length])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    // A fixed menu would drift away from its header on scroll, so close it.
    function onScroll(e) {
      if (ref.current && e.target && ref.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const allShown = shown.length > 0 && shown.every((o) => o.selected)
  const noneShown = shown.length > 0 && shown.every((o) => !o.selected)

  const style = pos
    ? { position: 'fixed', top: pos.top, left: pos.left, visibility: 'visible' }
    : { position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[1200]" onMouseDown={onClose} />
      <div
        ref={ref}
        style={style}
        className="pop-in z-[1201] w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="border-b border-slate-100 px-2.5 py-2">
          <p className="truncate text-[11px] font-semibold text-slate-700" title={column}>
            {column}
          </p>
        </div>

        {/* --- Sort ---------------------------------------------------- */}
        <div className="flex gap-1 border-b border-slate-100 px-2 py-1.5">
          <button
            onClick={() => onSort(column, 'asc')}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] ${
              sort?.dir === 'asc' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ArrowUp size={11} /> A → Z
          </button>
          <button
            onClick={() => onSort(column, 'desc')}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] ${
              sort?.dir === 'desc' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ArrowDown size={11} /> Z → A
          </button>
        </div>

        {/* --- Search / numeric test ----------------------------------- */}
        <div className="space-y-1.5 border-b border-slate-100 px-2 py-2">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search values…"
              className="w-full rounded border border-slate-200 py-1 pl-6 pr-2 text-xs"
            />
          </div>
          <input
            value={filter.text || ''}
            onChange={(e) => onChange(column, { ...filter, text: e.target.value })}
            placeholder="Contains…  or  >100"
            className={`w-full rounded border px-2 py-1 text-xs ${
              filter.text ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'
            }`}
          />
        </div>

        {/* --- Values --------------------------------------------------- */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 text-[11px]">
          <label className="flex cursor-pointer items-center gap-1.5 text-slate-600">
            <input
              type="checkbox"
              checked={allShown}
              ref={(el) => {
                // Some shown, some not: an indeterminate box is the honest
                // state, and it stops a click reading as "turn everything on"
                // when it will actually toggle.
                if (el) el.indeterminate = !allShown && !noneShown
              }}
              onChange={() => onChange(column, setAllOptions(filter, shown, !allShown, options))}
            />
            {query ? 'Select shown' : 'Select all'}
          </label>
          <span className="ml-auto text-slate-400">{shown.length}</span>
        </div>

        <div className="max-h-56 overflow-y-auto px-1 py-1">
          {shown.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={option.selected}
                onChange={() => onChange(column, toggleOption(filter, option.key, shown, options))}
              />
              <span className={`min-w-0 flex-1 truncate ${option.key.charCodeAt(0) === 0 ? 'italic text-slate-400' : ''}`}>
                {option.label}
              </span>
              <span className="shrink-0 tabular-nums text-[10px] text-slate-400">{option.count}</span>
            </label>
          ))}
          {shown.length === 0 && <p className="py-3 text-center text-[11px] text-slate-300">No matching values</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1.5">
          <button
            onClick={() => {
              onChange(column, { exclude: [], text: '' })
              setQuery('')
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50"
          >
            <X size={11} /> Clear filter
          </button>
          <button
            onClick={onClose}
            className="ml-auto rounded bg-ink px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
