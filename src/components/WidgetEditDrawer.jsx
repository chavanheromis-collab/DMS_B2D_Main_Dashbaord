import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { dockFor, scrimBands, spotlight } from '../lib/editMode'
import WidgetsPanel from '../pages/admin/WidgetsPanel.jsx'

/**
 * A widget's whole editor, on the page, beside the widget.
 *
 * The screen is covered except for the widget being edited -- which stays
 * lit, live, and redraws as the form is typed into. That is the entire
 * point: an editor that covered the thing it edits would make you change
 * something, close it, look, and open it again.
 *
 * The form is the SAME one the admin panel shows. Not a copy of it, not a
 * cut-down version: `WidgetsPanel` rendered over a list of one, with its own
 * chrome folded away. Two implementations of a widget form would disagree
 * about one field within a month, and it would be the field nobody checked.
 *
 * Rendered into `<body>` through a portal, because the canvas it sits over
 * is its own stacking context and a `fixed` child of one is positioned
 * against that context rather than against the window.
 */
export default function WidgetEditDrawer({
  widget,
  rect,
  tabs,
  tabHeaders,
  pageControls,
  onChange,
  onDelete,
  onClose,
  saving = false,
}) {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }))

  useLayoutEffect(() => {
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  // Escape closes, the way it does everywhere else in this project.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!widget || typeof document === 'undefined') return null

  const dock = dockFor(rect, viewport)
  const ring = spotlight(rect)
  // A sheet covers the widget by definition, so there is nothing to leave a
  // hole for: dim everything and let the widget sit under the sheet.
  const bands = dock.side === 'sheet' ? scrimBands(null, viewport) : scrimBands(rect, viewport)

  return createPortal(
    <>
      {/* Everything except the widget. Four rectangles rather than one layer
          with a hole in it -- see lib/editMode.js. */}
      {bands.map((b) => (
        <div
          key={b.key}
          onClick={onClose}
          className="fixed z-[60] bg-slate-900/45 backdrop-blur-[1px] transition-opacity"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        />
      ))}

      {ring && dock.side !== 'sheet' && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[61] rounded-2xl ring-2 ring-indigo-400/80"
          style={ring}
        />
      )}

      <div
        className={`fixed z-[70] flex flex-col overflow-hidden border-slate-200 bg-white shadow-2xl ${
          dock.side === 'right'
            ? 'border-l'
            : dock.side === 'left'
              ? 'border-r'
              : 'rounded-t-2xl border-t'
        }`}
        style={dock.style}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <span className="truncate text-sm font-semibold text-ink">{widget.title || 'Widget'}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {widget.type}
          </span>
          {saving ? (
            <span className="text-[11px] text-amber-600">Saving…</span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600">
              <Check size={11} /> Live
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Done
          </button>
          <button onClick={onClose} className="text-slate-300 hover:text-rose-500" title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <WidgetsPanel
            compact
            tabs={tabs}
            tabHeaders={tabHeaders}
            pageControls={pageControls}
            widgets={[widget]}
            setWidgets={(next) => {
              const only = Array.isArray(next) ? next[0] : null
              if (!only) onDelete?.(widget.id)
              else onChange?.(only)
            }}
          />
        </div>
      </div>
    </>,
    document.body
  )
}
