import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PanelBottom, PanelLeft, PanelRight, X } from 'lucide-react'
import { EDIT_SIDES, fractionAt, splitFor } from '../lib/editLayout'

const ICONS = { left: PanelLeft, right: PanelRight, bottom: PanelBottom }

/**
 * The editor on one side, the thing being edited on the other.
 *
 * Two panes that tile the screen exactly -- no gap, no overlap, no strip of
 * the old page showing between them. The form is in the same place every
 * time it is opened, which is the whole reason this is a split and not a
 * panel that follows the widget around.
 *
 * The preview is not a mock-up. It is the same component the page renders,
 * given the same unsaved draft, so what is on the right IS what will be on
 * the page -- there is no second implementation to disagree.
 *
 * Which side is the admin's, remembered per browser, and the divider drags.
 * On a screen too narrow for two columns the split stacks itself; a 320px
 * form beside an 80px preview is not a preview.
 *
 * Rendered through a portal into <body>, because the canvas underneath is
 * its own stacking context and a `fixed` child of one is positioned against
 * that context rather than against the window.
 */
export default function EditSplit({
  title,
  subtitle,
  side,
  onSide,
  fraction,
  onFraction,
  onClose,
  saving = false,
  toolbar,
  preview,
  children,
}) {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }))
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef(null)

  useLayoutEffect(() => {
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const split = splitFor(side, viewport, fraction)

  // The divider reads the POINTER's position rather than a delta, so a drag
  // that outruns the pointer cannot drift away from the hand moving it.
  const onDrag = useCallback(
    (e) => {
      if (!dragging) return
      onFraction?.(fractionAt(split.side, { x: e.clientX, y: e.clientY }, viewport))
    },
    [dragging, onFraction, split.side, viewport]
  )

  useEffect(() => {
    if (!dragging) return undefined
    const stop = () => setDragging(false)
    window.addEventListener('pointermove', onDrag)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', onDrag)
      window.removeEventListener('pointerup', stop)
    }
  }, [dragging, onDrag])

  if (typeof document === 'undefined') return null

  const vertical = split.side !== 'bottom'

  return createPortal(
    <div ref={frameRef} className="fixed inset-0 z-[70]">
      {/* --- what is being edited ------------------------------------- */}
      <div
        className="absolute overflow-auto bg-slate-100/70"
        style={{ left: split.preview.left, top: split.preview.top, width: split.preview.width, height: split.preview.height }}
      >
        <div className="pointer-events-none sticky top-0 z-10 flex items-center gap-1.5 px-3 py-1.5">
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">
            Live
          </span>
        </div>
        <div className="p-3 pt-0">{preview}</div>
      </div>

      {/* --- the divider ----------------------------------------------- */}
      <div
        onPointerDown={() => setDragging(true)}
        className={`absolute z-20 bg-slate-200 transition-colors hover:bg-indigo-300 ${
          vertical ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
        } ${dragging ? 'bg-indigo-400' : ''}`}
        style={
          vertical
            ? { left: split.panel.left - 3, top: 0, height: viewport.height }
            : { left: 0, top: split.panel.top - 3, width: viewport.width }
        }
        title="Drag to resize"
      />

      {/* --- the editor -------------------------------------------------- */}
      {/* `edit-shell` is the CONTAINER everything inside measures itself
          against -- the header as well as the form, which is why it is on
          the panel rather than on the scrolling body: a query only answers
          for descendants, and the header is a sibling of the body. */}
      <div
        className="edit-shell absolute flex flex-col border-slate-200 bg-white shadow-2xl"
        style={{ left: split.panel.left, top: split.panel.top, width: split.panel.width, height: split.panel.height }}
      >
        {/* The header has six things in it and the panel can be 340px
            wide. It wraps rather than squeezing, and the parts that are
            nice-to-know rather than need-to-know stand down first. */}
        <div className="edit-head flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-3 py-2">
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate text-sm font-semibold text-ink">{title}</p>
            {subtitle && <p className="edit-head-sub truncate text-[10px] text-slate-400">{subtitle}</p>}
          </div>

          <span
            className={`edit-head-state ml-auto text-[11px] ${saving ? 'text-amber-600' : 'text-emerald-600'}`}
          >
            {saving ? 'Saving…' : 'Saved'}
          </span>

          {/* Which side the form lives on. Three buttons rather than a
              dropdown: it is a spatial choice, and a spatial choice reads
              faster as a picture of itself. */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
            {EDIT_SIDES.map((s) => {
              const Icon = ICONS[s.value]
              const on = (split.asked || split.side) === s.value
              return (
                <button
                  key={s.value}
                  onClick={() => onSide?.(s.value)}
                  title={`Editor on the ${s.label.toLowerCase()}`}
                  className={`rounded p-1 ${on ? 'bg-ink text-white' : 'text-slate-400 hover:bg-slate-100'}`}
                >
                  <Icon size={13} />
                </button>
              )
            })}
          </div>

          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Done
          </button>
          <button onClick={onClose} className="text-slate-300 hover:text-rose-500" title="Close (Esc)">
            <X size={15} />
          </button>
        </div>

        {toolbar && <div className="border-b border-slate-100 px-3 py-1.5">{toolbar}</div>}

        {/* The forms answer "how much room have I got" with the panel's
            width rather than the window's -- see index.css. A `md:`
            breakpoint asks the window, and the window is wide even when
            this is not. */}
        <div className="edit-panel min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </div>,
    document.body
  )
}
