import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Paintbrush, Pencil, Pin, PinOff, SlidersHorizontal, Trash2, X } from 'lucide-react'
import TypographyFields, { MarkTextFields } from './TypographyFields.jsx'
import ChartVisualFields from './ChartVisualFields.jsx'
import { hasChartText } from '../lib/typography'
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

/**
 * A labelled cluster of boxes.
 *
 * Six numbered boxes in a row is six things to work out. Two groups of two
 * or three, each with a word over them, is two.
 */
function Group({ label, children }) {
  return (
    <span className="flex items-center gap-1 rounded-lg border border-slate-200/80 bg-white/70 px-1.5 py-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-300">{label}</span>
      {children}
    </span>
  )
}

export default function ArrangeBar({
  index,
  order,
  onOrder,
  // The four numbers a widget IS. The same ones a drag sets -- typing
  // them and dragging to them are the same act. See lib/freeLayout.js.
  rect,
  onRect,
  // Whether this widget holds its place while the page scrolls under it --
  // a layout behaviour, not a look, so it belongs beside the numbers.
  pinned = false,
  onPinned,
  widgetType,
  style,
  measured,
  onStyle,
  onEdit,
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

  // What is actually on the screen, which on a narrower one is not what
  // was typed. Showing the typed number here was the whole of the "it says
  // the same size on every layout" complaint: it did, because it was
  // reading the design back rather than the drawing.
  const w = rect?.w ?? measured?.width
  const h = rect?.h ?? measured?.height

  // How much the design was scaled to reach this screen. Only ever down --
  // a page designed at the design width is drawn at it, or smaller.
  const scale = Number(measured?.scale) > 0 ? Number(measured.scale) : 1
  const shrunk = scale < 0.995 || measured?.stacked

  if (painting) {
    return (
      <Floating anchor={anchor} onDismiss={() => setPainting(false)}>
        <WidgetPaint
          title={title}
          style={style}
          onStyle={onStyle}
          onClose={() => setPainting(false)}
          chartText={hasChartText(widgetType)}
        />
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
        className="no-print absolute -left-1 -top-1 z-20 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white/85 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-500 shadow-sm backdrop-blur transition-colors hover:bg-white"
        title={`Where ${title} is, and how big`}
      >
        <span className="font-bold">{order || index}</span>
        {/* Where it is. An address somebody can read off the page and
            type straight back into the boxes. */}
        <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
          {Math.round(rect?.x ?? 0)}, {Math.round(rect?.y ?? 0)}
        </span>
        {pinned && <Pin size={9} className="shrink-0 text-indigo-500" />}
        {w && h ? (
          <span className="opacity-70">
            {Math.round(w)}×{Math.round(h)}
          </span>
        ) : null}
        {/* Say so when the screen is not the one this was arranged for,
            rather than letting the numbers look wrong. */}
        {measured?.stacked ? (
          <span className="rounded bg-amber-50 px-1 text-[9px] font-semibold text-amber-700">stacked</span>
        ) : (
          shrunk && (
            <span className="rounded bg-amber-50 px-1 text-[9px] font-semibold text-amber-700">
              {Math.round(scale * 100)}%
            </span>
          )
        )}
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
      {/* WHERE IT IS and HOW BIG. Four numbers, no modes, nothing
          derived from what happens to be beside it -- the same four a
          drag sets, for anybody who would rather type them. */}
      <Group label="At">
        <NumberBox
          label="x"
          value={rect?.x ?? ''}
          placeholder={0}
          onCommit={(raw) => onRect?.({ x: Math.max(0, Math.round(Number(raw) || 0)) })}
          title={`How far from the left of the page ${title} sits`}
        />
        <NumberBox
          label="y"
          value={rect?.y ?? ''}
          placeholder={0}
          onCommit={(raw) => onRect?.({ y: Math.max(0, Math.round(Number(raw) || 0)) })}
          title={`How far down the page ${title} sits`}
        />
      </Group>

      <Group label="Size">
        <NumberBox
          label="wide"
          value={rect?.w ?? ''}
          placeholder={400}
          onCommit={(raw) => onRect?.({ w: Math.round(Number(raw) || 0) })}
          title={
            shrunk
              ? `How wide ${title} is — this screen is narrower, so it is drawing at ${Math.round(
                  (rect?.w ?? 0) * scale
                )}px`
              : `How wide ${title} is`
          }
        />
        <NumberBox
          label="tall"
          value={rect?.h ?? ''}
          placeholder={240}
          onCommit={(raw) => onRect?.({ h: Math.round(Number(raw) || 0) })}
          title={`How tall ${title} is`}
        />
      </Group>

      {/* Stays put while the page scrolls. A KPI row or a filter card is
          read WHILE looking at the table underneath it, and scrolling to
          the bottom of four thousand rows and losing the numbers that say
          what you are looking at is the whole problem. */}
      {onPinned && (
        <button
          onClick={() => onPinned(!pinned)}
          className={`rounded p-0.5 transition-colors ${
            pinned ? 'text-indigo-600' : 'text-slate-400 hover:text-indigo-600'
          }`}
          title={
            pinned
              ? `${title} stays in place while the page scrolls — click to let it scroll away`
              : `Keep ${title} in place while the page scrolls`
          }
        >
          {pinned ? <Pin size={12} /> : <PinOff size={12} />}
        </button>
      )}

      {onEdit && (
        <button
          onClick={(e) => {
            // The widget's own rectangle, so the editor can dock beside it
            // rather than over it -- see lib/editMode.js.
            const box = e.currentTarget.closest('[data-widget]')?.getBoundingClientRect()
            onEdit(box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null)
          }}
          className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
          title={`Edit ${title} — everything about it, here on the page`}
        >
          <SlidersHorizontal size={12} />
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
function WidgetPaint({ title, style, onStyle, onClose, chartText = false }) {
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
      </div>

      {/* Text is not one colour picker. It is the colour of the headings,
          the colour of the captions, the typeface, the weight, the letter
          spacing, the alignment and the size -- and this widget's own
          controls take all of it too, because a control bar in a different
          typeface from the widget under it is an oversight, not a design. */}
      <div className="mb-1.5 border-t border-slate-100 pt-1.5">
        <TypographyFields value={s} onChange={set} />
      </div>

      {/* A chart is two kinds of writing in one picture, and they are read
          differently: an axis is glanced at while reading a value off the
          chart, a legend is read once and deliberately -- and a legend is
          very often the thing that is too small on a screen across the
          room. One control for both would mean enlarging the legend
          enlarged forty axis ticks with it. */}
      {chartText && (
        <div className="mb-1.5 space-y-2 border-t border-slate-100 pt-1.5">
          <MarkTextFields
            label="Chart text"
            hint="Axis ticks, axis titles and the labels on the marks."
            value={s.chartText}
            onChange={(v) => set({ chartText: v })}
          />
          <MarkTextFields
            label="Legend"
            hint="The key, on its own. Labels drawn inside a bar keep their own colour."
            value={s.legendText}
            onChange={(v) => set({ legendText: v })}
          />
          {/* The text is one decision and the DRAWING is another: the grid,
              the axes, the TOOLTIP, how solid a bar is. These lived only in
              the admin panel, so from the widget's own brush -- which is
              where anybody looks first -- the tooltip could not be changed
              at all. Same component the panel uses, so the two cannot
              drift apart. */}
          <ChartVisualFields value={s.chartVisuals} onChange={(v) => set({ chartVisuals: v })} />
        </div>
      )}

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

