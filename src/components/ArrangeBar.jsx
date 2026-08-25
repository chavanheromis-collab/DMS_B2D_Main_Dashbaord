import { useEffect, useRef, useState } from 'react'
import { Maximize2, Paintbrush, X } from 'lucide-react'
import { widthSlack } from '../lib/gridSpan'
import { DEFAULT_WIDGET_STYLE, SHADOW_LEVELS, WIDGET_THEMES } from '../lib/widgetStyle'

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
  widthUnits,
  columns = 12,
  style,
  measured,
  onSize,
  onStyle,
  title = 'this widget',
}) {
  const [open, setOpen] = useState(false)
  const [painting, setPainting] = useState(false)
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

  // The room this widget claimed and does not use.
  //
  // The canvas is twelve columns, so a widget pinned to 260px where a column
  // is 95px claims three of them and leaves 45px beside it that nothing can
  // ever fill -- which is what a hole beside a row of KPIs actually is. It
  // is invisible until you are told, so: shown, with one click to close it.
  const slack = widthSlack(w, measured?.spanWidth)
  const wasteful = slack > 16 && measured?.spanWidth > 0
  const snap = () => onSize({ widthPx: String(measured.spanWidth) })

  if (painting) {
    return (
      <WidgetPaint
        title={title}
        style={style}
        widthUnits={widthUnits}
        columns={columns}
        onStyle={onStyle}
        onSize={onSize}
        onClose={() => setPainting(false)}
      />
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`absolute -left-1 -top-1 z-20 inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow-sm backdrop-blur transition-colors ${
          pinned
            ? 'border-indigo-300 bg-indigo-50/90 text-indigo-700 hover:bg-indigo-100'
            : 'border-slate-200 bg-white/85 text-slate-500 hover:bg-white'
        }`}
        title={`Position, width and height of ${title}`}
      >
        <span className="font-bold">{order || index}</span>
        {w && h ? (
          <span className="opacity-70">
            {Math.round(w)}×{Math.round(h)}
          </span>
        ) : null}
        {wasteful && <span className="font-semibold text-amber-600">+{slack}</span>}
      </button>
    )
  }

  return (
    <div
      ref={ref}
      onBlur={onBlur}
      className="absolute -left-1 -top-1 z-30 flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-1.5 py-1 shadow-md"
    >
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
      {wasteful && (
        <button
          onClick={snap}
          className="rounded p-0.5 text-amber-500 hover:text-amber-700"
          title={`This widget claims ${slack}px more than it uses — a dead strip beside it. Widen it to ${measured.spanWidth}px to close the gap.`}
        >
          <Maximize2 size={12} />
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
function WidgetPaint({ title, style, widthUnits, columns, onStyle, onSize, onClose }) {
  const s = { ...DEFAULT_WIDGET_STYLE, ...(style || {}) }
  const set = (patch) => onStyle({ ...s, ...patch })

  return (
    <div className="absolute -left-1 -top-1 z-40 w-56 rounded-xl border border-indigo-300 bg-white p-2 shadow-xl">
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

      {/* Width in COLUMNS, so a widget can be sized without pixels at all --
          and the count is the page's, not a hard twelve. */}
      <div className="mb-1.5">
        <span className="text-[10px] text-slate-500">Width in columns</span>
        <div className="mt-0.5 flex items-center gap-1.5">
          <input
            type="range"
            min={1}
            max={12}
            value={Number(widthUnits) || Math.round(columns / 2)}
            onChange={(e) => onSize({ widthUnits: Number(e.target.value) })}
            className="flex-1 accent-indigo-600"
            aria-label="Width in columns"
          />
          <span className="w-6 text-right text-[11px] font-semibold tabular-nums text-slate-700">
            {Number(widthUnits) || '—'}
          </span>
        </div>
      </div>

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

