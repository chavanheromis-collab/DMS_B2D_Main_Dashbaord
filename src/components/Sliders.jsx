import { formatNumber } from '../lib/dataUtils'

// ---------------------------------------------------------------------
// Shared slider primitives
// ---------------------------------------------------------------------
// Used by BOTH the page filter bar and the per-widget control bar. The two
// differ in scope -- one narrows every widget reading a tab, the other
// narrows a single widget -- but a range slider is a range slider, and two
// implementations would drift apart the first time one of them got a fix.
//
// All of them are built on native <input type="range">. That is a deliberate
// constraint: it brings keyboard support, touch handling, and screen-reader
// semantics that a div-and-pointer-events version would have to rebuild, and
// would rebuild worse.

/**
 * Two handles on one track.
 *
 * The two inputs are stacked exactly on top of each other and made
 * transparent except for their thumbs (see `.range-thumb` in index.css);
 * the visible track and the filled span between the handles are drawn by the
 * divs behind them.
 */
export function DualRange({ min, max, step, from, to, onChange, label, format = (n) => n }) {
  const pct = (n) => (max === min ? 0 : ((n - min) / (max - min)) * 100)

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="relative h-4 min-w-[90px] flex-1">
        <span className="absolute top-1/2 block h-1 w-full -translate-y-1/2 rounded-full bg-slate-200" />
        <span
          className="absolute top-1/2 block h-1 -translate-y-1/2 rounded-full bg-indigo-500"
          style={{ left: `${pct(from)}%`, right: `${100 - pct(to)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 'any'}
          value={from}
          onChange={(e) => onChange(Math.min(Number(e.target.value), to), to)}
          className="range-thumb absolute inset-0 w-full"
          aria-label={`${label || 'Range'} minimum`}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 'any'}
          value={to}
          onChange={(e) => onChange(from, Math.max(Number(e.target.value), from))}
          className="range-thumb absolute inset-0 w-full"
          aria-label={`${label || 'Range'} maximum`}
        />
      </span>
      <span className="whitespace-nowrap text-[10px] tabular-nums text-slate-600">
        {format(from)} – {format(to)}
      </span>
    </span>
  )
}

/** One handle: "at least this" or "at most this". */
export function SingleRange({ min, max, step, value, onChange, label, format = (n) => n }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 'any'}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-[80px] flex-1 accent-indigo-500"
        aria-label={label}
      />
      <span className="whitespace-nowrap text-[10px] tabular-nums text-slate-600">{format(value)}</span>
    </span>
  )
}

/**
 * A range that snaps to the admin's own bands, with the bands labelled
 * underneath.
 *
 * Snapping is the whole point of this kind: business thresholds are round
 * numbers people already talk in ("under 1 lakh", "1–5 lakh"), and an
 * arbitrary 137,412 is never what anyone meant to select.
 */
export function SteppedRange({ ticks, from, to, onChange, label, format = (n) => n }) {
  const min = ticks[0]
  const max = ticks[ticks.length - 1]
  const snap = (n) => ticks.reduce((best, t) => (Math.abs(t - n) < Math.abs(best - n) ? t : best), ticks[0])

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <DualRange
        min={min}
        max={max}
        step={null}
        from={from}
        to={to}
        label={label}
        format={format}
        onChange={(a, b) => onChange(snap(a), snap(b))}
      />
      <span className="flex justify-between px-0.5 text-[8px] tabular-nums text-slate-300">
        {ticks.map((t) => (
          <span key={t}>{format(t)}</span>
        ))}
      </span>
    </span>
  )
}

/**
 * "Everything in the last N days", dragged.
 *
 * At the far end it reads "all" rather than "365d" because that is what it
 * means -- and because a control sitting at its maximum should look inactive,
 * not like a filter someone forgot to clear.
 */
export function DaysRange({ maxDays, value, onChange, label, suffix = 'd' }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <input
        type="range"
        min={1}
        max={maxDays}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-[80px] flex-1 accent-indigo-500"
        aria-label={label}
      />
      <span className="whitespace-nowrap text-[10px] tabular-nums text-slate-600">
        {value >= maxDays ? 'all' : `${value}${suffix}`}
      </span>
    </span>
  )
}

/** The number formatter these all share. */
export const sliderFormat = (format) => (n) => formatNumber(n, format || 'comma')
