import { useEffect, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { widthSlack } from '../lib/gridSpan'

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
  measured,
  onSize,
  title = 'this widget',
}) {
  const [open, setOpen] = useState(false)
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
