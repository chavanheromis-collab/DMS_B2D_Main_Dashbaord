import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Maximize2, Paintbrush, Pencil, Trash2, X } from 'lucide-react'
import { DEFAULT_WIDGET_STYLE, SHADOW_LEVELS, WIDGET_THEMES } from '../lib/widgetStyle'

/**
 * A panel that floats ABOVE every widget on the page, wherever it is opened.
 *
 * Rendered through a portal at a fixed position, anchored to the button that
 * opened it. Inside the card it was a child of, it was painted under every
 * widget that came after it in the DOM -- each card has its own entrance
 * animation, and a CSS transform creates a stacking context that no z-index
 * can climb out of. Escaping to <body> is the only fix that works from any
 * position on the page.
 */
function Floating({ anchor, children, onDismiss, width = 224 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!anchor) return
    const margin = 8
    const height = ref.current?.offsetHeight || 320
    // Below the handle by preference, flipped above when there is no room,
    // and always inside the window.
    const below = anchor.bottom + 6
    const top = below + height + margin > window.innerHeight ? Math.max(margin, anchor.top - height - 6) : below
    setPos({
      top,
      left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)),
    })
  }, [anchor, width])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onDismiss()
    }
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onDismiss()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onDismiss])

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[80] rounded-xl border border-indigo-300 bg-white p-2 shadow-2xl"
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body
  )
}

/**
 * The per-widget handle shown in arrange mode: its position, and its pinned
 * width and height in pixels.
 *
 * Two problems with the first version, both of which this exists to fix.
 *
 * It wrote on every KEYSTROKE. Typing "412" saved 4, then 41, then 412 --
 * three round trips through Firestore, three full re-layouts, and a widget
 * that really was four pixels wide for a moment on the way. That is what
 * made resizing flash blank. A number is now held locally while it is being
 * typed and committed once: on blur, on Enter, or after a pause. Escape puts
 * back what was saved.
 *
 * And it sat open on top of every widget, covering the title of anything
 * short. It is a small pill until you touch it -- which doubles as the thing
 * you actually want while arranging: every widget's position and real size,
 * readable at a glance without opening anything.
 */
const COMMIT_DELAY = 600

function NumberBox({ value, placeholder, onCommit, label, title }) {
  const [draft, setDraft] = useState(value ?? '')
  const timer = useRef(null)

  // Adopt whatever was actually saved -- our own commit coming back rounded
  // or clamped, or another admin editing the same page.
  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = (raw) => {
    clearTimeout(timer.current)
    onCommit(raw)
  }

  return (
    <label className="flex items-center gap-1" title={title}>
      {label && <span className="text-[10px] font-semibold text-slate-400">{label}</span>}
      <input
        type="number"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => onCommit(raw), COMMIT_DELAY)
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
          if (e.key === 'Escape') {
            clearTimeout(timer.current)
            setDraft(value ?? '')
            e.currentTarget.blur()
          }
        }}
        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-center text-xs tabular-nums"
        aria-label={title}
      />
    </label>
  )
}

export default function ArrangeBar({
  index,
  order,
  onOrder,
  widthPx,
  heightPx,
  row,
  onRow,
  style,
  measured,
  onSize,
  onStyle,
  onRename,
  onDuplicate,
  onDelete,
  title = 'this widget',
}) {
  const [open, setOpen] = useState(false)
  const [painting, setPainting] = useState(false)
  const [anchor, setAnchor] = useState(null)

  const anchorTo = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setAnchor({ top: r.top, left: r.left, bottom: r.bottom, right: r.right })
  }
  const ref = useRef(null)

  // Closing on blur rather than on click-outside: the pill is a group of
  // inputs, so "nothing inside me has focus any more" is exactly the right
  // moment, and it survives clicking straight from one box to the next.
  const onBlur = (e) => {
    if (!ref.current?.contains(e.relatedTarget)) setOpen(false)
  }

  const w = widthPx || measured?.width
  const h = heightPx || measured?.height
  const pinned = Boolean(widthPx || heightPx)

  // How much of this widget's ROW is going spare.
  //
  // Not waste any more -- a widget takes exactly the width it asks for, so
  // there is no dead strip beside anything. This is the number somebody
  // actually needs: "there are 340 pixels left on this row", which is what
  // decides whether to widen this widget or bring the next one up onto it.
  const spare = Math.round(measured?.spare ?? 0)
  const roomy = spare > 24
  const fillRow = () => onSize({ widthPx: String(Math.round((w || 0) + spare)) })

  if (painting) {
    return (
      <Floating anchor={anchor} onDismiss={() => setPainting(false)}>
        <WidgetPaint title={title} style={style} onStyle={onStyle} onClose={() => setPainting(false)} />
      </Floating>
    )
  }

  if (!open) {
    return (
      <button
        onClick={(e) => {
          anchorTo(e)
          setOpen(true)
        }}
        className={`absolute -left-1 -top-1 z-20 inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow-sm backdrop-blur transition-colors ${
          pinned
            ? 'border-indigo-300 bg-indigo-50/90 text-indigo-700 hover:bg-indigo-100'
            : 'border-slate-200 bg-white/85 text-slate-500 hover:bg-white'
        }`}
        title={`Position, width and height of ${title}`}
      >
        <span className="font-bold">{order || index}</span>
        <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
          R{measured?.row ?? row ?? 1}
        </span>
        {w && h ? (
          <span className="opacity-70">
            {Math.round(w)}×{Math.round(h)}
          </span>
        ) : null}
        {roomy && <span className="font-semibold text-slate-400">{spare} free</span>}
      </button>
    )
  }

  return (
    <Floating anchor={anchor} onDismiss={() => setOpen(false)} width={276}>
    <div ref={ref} onBlur={onBlur} className="flex flex-wrap items-center gap-1">
      <input
        type="number"
        value={order ?? ''}
        onChange={(e) => onOrder(e.target.value)}
        placeholder={String(index)}
        autoFocus
        className="w-11 rounded border border-slate-200 px-1 py-0.5 text-center text-xs tabular-nums"
        aria-label={`Position of ${title}`}
      />
      <NumberBox
        label="R"
        value={row ?? ''}
        // Which row this widget belongs in. Blank is the first one, and a
        // widget that will not fit in the row it asked for goes to the next
        // -- so a number here is a preference, never a promise the layout
        // has to break something else to keep.
        placeholder={measured?.row ?? 1}
        onCommit={(raw) => onRow(raw)}
        title={`Which row ${title} sits in`}
      />
      <NumberBox
        label="W"
        value={widthPx ?? ''}
        // The measured size, greyed: it says what the widget IS without
        // pretending the page pinned it, so an empty box still means "auto".
        placeholder={measured?.width ?? 'auto'}
        onCommit={(raw) => onSize({ widthPx: raw })}
        title={`Width of ${title} in pixels`}
      />
      <NumberBox
        label="H"
        value={heightPx ?? ''}
        placeholder={measured?.height ?? 'auto'}
        onCommit={(raw) => onSize({ heightPx: raw })}
        title={`Height of ${title} in pixels`}
      />
      {roomy && (
        <button
          onClick={fillRow}
          className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
          title={`${spare}px are going spare on this row — widen this widget to ${Math.round((w || 0) + spare)}px to use all of it`}
        >
          <Maximize2 size={12} />
        </button>
      )}
      {onRename && (
        <button
          onClick={() => {
            // A prompt, deliberately: renaming is one field, and a panel for
            // one field is a panel somebody has to close.
            const next = window.prompt('Widget title', title)
            if (next !== null && next.trim() !== title) onRename(next.trim())
          }}
          className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
          title="Rename this widget"
        >
          <Pencil size={12} />
        </button>
      )}
      {onDuplicate && (
        <button
          onClick={onDuplicate}
          className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
          title="Duplicate it, right after this one"
        >
          <Copy size={12} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => {
            // Confirmed, because it is the one action here that loses work
            // somebody did in the admin panel.
            if (window.confirm(`Remove “${title}” from this page?`)) onDelete()
          }}
          className="rounded p-0.5 text-slate-400 hover:text-rose-600"
          title="Remove this widget from the page"
        >
          <Trash2 size={12} />
        </button>
      )}
      {onStyle && (
        <button
          onClick={() => {
            setOpen(false)
            setPainting(true)
          }}
          className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
          title="How this widget looks"
        >
          <Paintbrush size={12} />
        </button>
      )}
      {pinned && (
        <button
          onClick={() => onSize({ widthPx: '', heightPx: '' })}
          className="rounded p-0.5 text-slate-300 hover:text-rose-500"
          title="Back to automatic size"
        >
          <X size={12} />
        </button>
      )}
    </div>
    </Floating>
  )
}

/**
 * How one widget looks, edited on the widget.
 *
 * The same fields the admin panel's style editor has, in the place where
 * the answer is visible. A page theme is the default underneath all of it
 * -- see withPageTheme -- so everything here is an override, and "auto"
 * really does mean "whatever the page says", not a value we re-stated.
 */
function WidgetPaint({ title, style, onStyle, onClose }) {
  const s = { ...DEFAULT_WIDGET_STYLE, ...(style || {}) }
  const set = (patch) => onStyle({ ...s, ...patch })

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <Paintbrush size={11} className="text-indigo-500" />
        <span className="truncate text-[11px] font-semibold text-slate-700" title={title}>
          {title}
        </span>
        <button onClick={onClose} className="ml-auto text-slate-300 hover:text-rose-500" title="Done">
          <X size={12} />
        </button>
      </div>

      <label className="mb-1.5 block">
        <span className="text-[10px] text-slate-500">Look</span>
        <select
          value={s.theme || ''}
          onChange={(e) => set({ theme: e.target.value })}
          className="w-full rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-600"
        >
          {WIDGET_THEMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <Colour label="Surface" value={s.bg} fallback="#ffffff" onChange={(v) => set({ bg: v })} />
        <Colour label="Accent" value={s.accent} fallback="#4f46e5" onChange={(v) => set({ accent: v })} />
        <Colour label="Border" value={s.borderColor} fallback="#e2e8f0" onChange={(v) => set({ borderColor: v })} />
        <Colour label="Text" value={s.text} fallback="#0f172a" onChange={(v) => set({ text: v })} />
      </div>

      <Number_ label="Radius" value={s.radius} max={40} onChange={(v) => set({ radius: v })} />
      <Number_ label="Padding" value={s.padding} max={40} onChange={(v) => set({ padding: v })} />
      <Number_ label="Border width" value={s.borderWidth} max={6} onChange={(v) => set({ borderWidth: v })} />

      <label className="mt-1.5 block">
        <span className="text-[10px] text-slate-500">Shadow</span>
        <select
          value={s.shadow ?? ''}
          onChange={(e) => set({ shadow: e.target.value || null })}
          className="w-full rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-600"
        >
          <option value="">Auto</option>
          {SHADOW_LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={() => onStyle({ ...DEFAULT_WIDGET_STYLE })}
        className="mt-2 w-full rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
      >
        Back to the page’s look
      </button>
    </div>
  )
}

function Colour({ label, value, fallback, onChange }) {
  return (
    <label className="flex items-center gap-1">
      <input
        type="color"
        value={value || fallback}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-5 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0"
      />
      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{label}</span>
      {value && (
        <button onClick={() => onChange(null)} className="text-[9px] text-slate-300 hover:text-rose-500" title="Auto">
          <X size={10} />
        </button>
      )}
    </label>
  )
}

function Number_({ label, value, max, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-20 shrink-0 text-[10px] text-slate-500">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        value={value ?? 0}
        onChange={(e) => onChange(globalThis.Number(e.target.value))}
        className="flex-1 accent-indigo-600"
        aria-label={label}
      />
      <span className="w-6 text-right text-[10px] tabular-nums text-slate-600">{value ?? 'auto'}</span>
      {value !== null && value !== undefined && (
        <button onClick={() => onChange(null)} className="text-[9px] text-slate-300 hover:text-rose-500" title="Auto">
          <X size={10} />
        </button>
      )}
    </div>
  )
}

