import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'

import {
  CUSTOM_RANGE,
  DATE_PRESET_GROUPS,
  datePresetLabel,
  dateValueIsSet,
  dateWindow,
  describeRange,
  resolveDatePreset,
  toDateInput,
} from '../lib/datePresets'
import {
  WEEKDAY_INITIALS,
  dayState,
  dragPreview,
  dragRange,
  extendDrag,
  monthGrid,
  monthLabel,
  monthStart,
  nextPick,
  orderRange,
  startDrag,
} from '../lib/calendarGrid'
import { fromDateInput } from '../lib/dataUtils'

// ---------------------------------------------------------------------
// One button, and everything behind it
// ---------------------------------------------------------------------
// The date range used to be a label, a dropdown of periods and two native
// date inputs, all sitting open in the control bar -- around 380px of a bar
// that also has to hold four other filters, for a control that spends
// almost all of its life displaying a value nobody is currently changing.
//
// So it collapses to what it IS: one button saying the period. Everything
// needed to change it lives in a popover that is only there while somebody
// is choosing, which is where it can afford to be good -- the periods down
// one side, a real calendar down the other, and the exact dates underneath
// for anybody who would rather type them.
//
// The calendar is the part the native inputs could not do. Each of those
// opens the browser's own picker, which shows one month and knows nothing
// about the other box, so the span between them -- the thing actually being
// chosen -- was never on screen at once.

/** Which month to open the calendar on: where the range is, or today. */
function openingMonth(range) {
  return monthStart(range.from || range.to || new Date())
}

export default function DateRange({ control, value, onChange, fill = '', sized = false, dataSpan }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(null)
  // The press that may become a drag across the days -- see lib/calendarGrid.js.
  const [drag, setDrag] = useState(null)
  const draggedRef = useRef(false)
  const ref = useRef(null)

  const v = value || {}
  const preset = v.preset || CUSTOM_RANGE
  const fyStart = control.fyStart
  const active = dateValueIsSet(v)

  // What the value means today. Recomputed on every render on purpose: this
  // is display only, and the filter resolves the period again for itself
  // when it runs, so a tab left open overnight is never showing one day and
  // filtering by another.
  const range = useMemo(() => dateWindow(v, { fyStart }), [v.preset, v.from, v.to, fyStart])

  const [month, setMonth] = useState(() => openingMonth(range))

  // Opening is the only moment it is safe to move the calendar: doing it
  // whenever the range changes would drag the month out from under somebody
  // paging back through last year to pick a start date.
  useEffect(() => {
    if (open) {
      setMonth(openingMonth(range))
      setHover(null)
      // Every gesture starts from nothing. The guard below matters most: a
      // drag that closes the panel commits on mouseup and the `click` it
      // was suppressing never arrives, because the day is already gone. Left
      // standing, that flag would eat the FIRST click of the next time
      // somebody opened the picker.
      setDrag(null)
      draggedRef.current = false
    }
  }, [open])

  /**
   * The button coming up anywhere ends the drag.
   *
   * On the document rather than on the day, because a drag very often ends
   * with the pointer off the grid -- past the last column, or outside the
   * popover entirely. Without this the press would still be "down" as far
   * as this component knew, and the next thing the pointer touched would
   * extend a range nobody was drawing any more.
   */
  useEffect(() => {
    if (!drag) return undefined
    function onUp() {
      const picked = dragRange(drag)
      setDrag(null)
      // Null means the pointer never left the day it started on, so that
      // was a click: leave it to the two-click flow, which the `click`
      // event about to fire will run.
      if (!picked) return
      draggedRef.current = true
      commit(picked)
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [drag])

  useEffect(() => {
    if (!open) return undefined
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /** Writes a range and closes if it is a finished answer. */
  function commit({ from, to }) {
    onChange({ preset: CUSTOM_RANGE, from: toDateInput(from), to: toDateInput(to) })
    setHover(null)
    // A closed range is a finished answer; an open one is still being made.
    if (to) setOpen(false)
  }

  /** A day clicked on the calendar. */
  function pickDay(day) {
    // A drag that has just landed already committed its range on mouseup,
    // and the browser fires `click` after that on the day it ended on. One
    // gesture must not also be read as the first click of the next range.
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    commit(nextPick(preset ? { from: null, to: null } : range, day))
  }

  /** One end typed rather than clicked. Kept in order, so from ≤ to. */
  function typeEnd(which, text) {
    const typed = fromDateInput(text)
    const other = which === 'from' ? range.to : range.from
    const ordered = which === 'from' ? orderRange(typed, other) : orderRange(other, typed)
    onChange({
      preset: CUSTOM_RANGE,
      from: toDateInput(ordered.from),
      to: toDateInput(ordered.to),
    })
  }

  const summary = preset ? datePresetLabel(preset) : describeRange(range)

  return (
    <div className={`relative ${fill}`} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={preset && range.from ? `${datePresetLabel(preset)} — ${describeRange(range)}` : undefined}
        className={`flex items-center gap-1.5 rounded-lg border py-1.5 pl-2.5 text-sm ${
          active ? 'border-indigo-300 bg-indigo-50 pr-7 text-indigo-700' : 'border-slate-200 bg-white pr-2.5 text-slate-600'
        } ${fill}`}
      >
        <CalendarDays size={13} className="shrink-0 opacity-70" />
        <span className={`truncate ${sized ? 'min-w-0 flex-1 text-left' : 'max-w-[220px]'}`}>
          {control.label}
          {summary && `: ${summary}`}
        </span>
        {!active && <ChevronDown size={13} className="shrink-0" />}
      </button>

      {/* Clearing is the commonest thing done to a filter that is on, so it
          stays reachable without opening the panel. A SIBLING of the trigger
          rather than something inside it: a button cannot contain a button,
          and an onClick on a plain span would not be reachable by keyboard.
          It sits in the padding the trigger reserves while it is showing. */}
      {active && (
        <button
          onClick={() => {
            onChange({})
            setOpen(false)
          }}
          aria-label={`Clear ${control.label}`}
          title={`Clear ${control.label}`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-indigo-400 hover:bg-white hover:text-rose-500"
        >
          <X size={12} />
        </button>
      )}

      {open && (
        <div className="absolute z-[9999] mt-1 flex w-[430px] max-w-[92vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {/* --- The periods, by name ---------------------------------- */}
          <div className="max-h-[330px] w-[168px] shrink-0 overflow-y-auto border-r border-slate-100 p-1.5">
            <PeriodButton
              label="Custom range"
              on={!preset}
              onClick={() => onChange({ ...v, preset: CUSTOM_RANGE })}
            />
            {DATE_PRESET_GROUPS.map((group) => (
              <div key={group.label} className="mt-1.5">
                <p className="px-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300">
                  {group.label}
                </p>
                {group.presets.map((p) => (
                  <PeriodButton
                    key={p.value}
                    label={p.label}
                    on={preset === p.value}
                    // The period is stored by NAME and resolved when the
                    // filter runs, so this stays "this month" next month.
                    onClick={() => {
                      onChange({ ...v, preset: p.value })
                      setMonth(openingMonth(resolveDatePreset(p.value, { fyStart }) || {}))
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* --- The calendar ------------------------------------------ */}
          <div className="min-w-0 flex-1 p-2">
            <div className="mb-1 flex items-center justify-between">
              <NavButton label="Previous month" onClick={() => setMonth((m) => monthStart(m, -1))}>
                <ChevronLeft size={14} />
              </NavButton>
              <span className="text-xs font-semibold text-slate-700">{monthLabel(month)}</span>
              <NavButton label="Next month" onClick={() => setMonth((m) => monthStart(m, 1))}>
                <ChevronRight size={14} />
              </NavButton>
            </div>

            {/* `select-none` as well as the preventDefault below: without
                it, pulling across the days drags a text selection over the
                whole panel and the range is drawn under a blue smear. */}
            <div className="grid select-none grid-cols-7 gap-y-0.5">
              {WEEKDAY_INITIALS.map((d, i) => (
                <span key={i} className="pb-0.5 text-center text-[9px] font-semibold text-slate-300">
                  {d}
                </span>
              ))}
              {monthGrid(month)
                .flat()
                .map((day) => {
                  // While the button is down the grid shows the drag, which
                  // is the same open-range shape a half-made two-click range
                  // has -- one preview, one code path.
                  const shown = dragPreview(drag) || { ...range, hover }
                  const state = dayState(day, { ...shown, month })
                  return (
                    <button
                      key={day.getTime()}
                      onMouseDown={(e) => {
                        // Stops the browser starting a text selection, which
                        // is what a press-and-pull means everywhere else.
                        e.preventDefault()
                        setDrag(startDrag(day))
                      }}
                      onMouseEnter={() => {
                        setHover(day)
                        setDrag((d) => extendDrag(d, day))
                      }}
                      onClick={() => pickDay(day)}
                      className={dayClass(state)}
                      aria-label={day.toDateString()}
                    >
                      {day.getDate()}
                    </button>
                  )
                })}
            </div>

            {/* The exact dates, for anyone who would rather type than page
                back through eleven months to reach last April. */}
            <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2">
              <input
                type="date"
                value={toDateInput(range.from)}
                onChange={(e) => typeEnd('from', e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                aria-label="From"
              />
              <span className="text-[10px] text-slate-300">to</span>
              <input
                type="date"
                value={toDateInput(range.to)}
                onChange={(e) => typeEnd('to', e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                aria-label="To"
              />
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-2">
              {/* What the choice actually covers, said in full. A period is
                  a promise the reader would otherwise have to take on
                  trust, and the day it is wrong is the day nobody notices. */}
              <span className="truncate text-[10px] text-slate-400">
                {describeRange(range) || 'No dates chosen'}
              </span>
              {active && (
                <button
                  onClick={() => {
                    onChange({})
                    setOpen(false)
                  }}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Where the data actually is, so a range is not picked over a
                month the sheet has nothing in. Narrowed with everything
                else, so on a page filtered to one branch this is that
                branch's dates -- which is what the Narrowing setting on a
                date control means. Absent when that setting is off. */}
            {dataSpan?.label && (
              <p className="mt-0.5 truncate text-[10px] text-slate-300" title={dataSpan.title}>
                Rows here run {dataSpan.label}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PeriodButton({ label, on, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] transition-colors ${
        on ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
      }`}
      title={label}
    >
      {label}
    </button>
  )
}

function NavButton({ children, label, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
    >
      {children}
    </button>
  )
}

/**
 * How one day is drawn.
 *
 * The ends are solid and the days between them are a tint, so a range reads
 * as one shape rather than as thirty separate selected days. Squared-off
 * inner corners are what joins them into that shape -- a row of rounded
 * pills has visible gaps and reads as a scatter.
 */
function dayClass({ inRange, isStart, isEnd, outside, isToday, provisional }) {
  const base = 'h-7 text-[11px] transition-colors'

  if (isStart || isEnd) {
    const corners = isStart && isEnd ? 'rounded' : isStart ? 'rounded-l' : 'rounded-r'
    return `${base} ${corners} bg-indigo-600 font-semibold text-white`
  }
  if (inRange) {
    return `${base} ${provisional ? 'bg-indigo-50' : 'bg-indigo-100'} text-indigo-800`
  }
  return `${base} rounded ${outside ? 'text-slate-300' : 'text-slate-600'} ${
    isToday ? 'font-bold text-indigo-600 ring-1 ring-inset ring-indigo-200' : ''
  } hover:bg-slate-100`
}
