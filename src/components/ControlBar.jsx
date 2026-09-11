import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Paintbrush, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'

import { filterIsActive } from '../lib/filterEngine'
import {
  actionIsReady,
  buttonAction,
  isActionButton,
  isPlainSwitch,
  linkHref,
  opensNewTab,
} from '../lib/buttonActions'
import { boundsHolding, dateSpan, numericBounds, numericSpan, stepFor, stepperTicks } from '../lib/widgetControls'
import DateRange from './DateRange.jsx'
import {
  activeCount,
  controlActive,
  controlOptions,
  visibleChips,
  controlWidth,
  isButton,
  menuWidthFor,
  narrowingOf,
  partitionByProminence,
  viewIsActive,
} from '../lib/pageControls'
import { DaysRange, DualRange, SingleRange, SteppedRange, sliderFormat } from './Sliders.jsx'
import WidgetPaint from './WidgetPaint.jsx'
import { styleClass, styleVars } from '../lib/widgetStyle'

/** Multi-choice dropdown with its own search, for columns with many values. */
function MultiSelect({ control, value, options, onChange, fill = '' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  const selected = value || []

  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const shown = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q]
  )

  return (
    <div className={`relative ${fill}`} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${fill} ${
          selected.length ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'
        }`}
      >
        <span className={`truncate ${fill ? 'min-w-0 flex-1 text-left' : 'max-w-[160px]'}`}>
          {control.label}
          {selected.length > 0 && `: ${selected.length} selected`}
        </span>
        <ChevronDown size={13} />
      </button>

      {/* The list is as wide as the admin asked for, and never narrower
          than the button it drops from -- see menuWidthFor in
          lib/pageControls.js. It used to be a hard-coded 256, which cut the
          end off every value long enough to matter. */}
      {open && (
        <div
          className="absolute z-[9999] mt-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
          style={{ width: menuWidthFor(control) }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search options…"
            className="mb-1.5 w-full rounded border border-slate-200 px-2 py-1 text-xs"
          />
          <div className="max-h-56 overflow-y-auto">
            {shown.map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() =>
                    onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt])
                  }
                />
                {/* Wrapped rather than truncated: a wider menu was asked
                    for so the whole value could be read, and cutting it off
                    at the new edge would have missed the point. */}
                <span className="break-words">{opt}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="py-2 text-center text-xs text-slate-300">No options</p>}
          </div>
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="mt-1 w-full rounded py-1 text-xs text-slate-600 hover:bg-rose-50 hover:text-rose-600"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** A date said the short way, for a hint that has to fit next to two boxes. */
const shortDate = (d) => d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * The ends of what the page currently holds in a range control's column.
 *
 * `from` and `to` are ready to sit in the two placeholders, `label` is the
 * one line a date range needs (a native date input draws no placeholder of
 * its own), and `title` is the hover for all three.
 *
 * Everything comes back empty in the two cases where a number would be a
 * lie rather than a hint:
 *
 *   THE ADMIN TURNED NARROWING OFF. A control on "the whole tab" is
 *   deliberately not describing the current view, so it must not label
 *   itself with one. The wording is "Currently" rather than "this page
 *   holds" for the same reason in the other direction: on the middle
 *   setting these ends have not been told about a clicked chart segment,
 *   and claiming they describe the whole page would overstate them.
 *
 *   THE COLUMN HOLDS NOTHING OF THAT KIND. An invented span reads as data.
 *   `numericSpan` and `dateSpan` answer with nulls rather than the 0-100 a
 *   slider's bounds fall back to, which is exactly why they are separate.
 *
 * It is a hint and it stays one. Neither box carries a `min` or a `max`, so
 * a reader can always type a range wider than what is on the page -- which
 * they will want the moment they are about to clear the filter that
 * narrowed it.
 */
function rangeEnds(control, rows, dateOrder, fmt) {
  const none = { from: '', to: '', label: '', title: undefined }
  if (narrowingOf(control) === 'none' || !control.column) return none

  const said = (from, to) => ({ from, to, label: `${from} – ${to}`, title: `Currently ${from} to ${to}` })

  if (control.kind === 'number') {
    const { min, max } = numericSpan(rows, control.column)
    return min === null ? none : said(fmt(min), fmt(max))
  }

  const { min, max } = dateSpan(rows, control.column, dateOrder)
  return min === null ? none : said(shortDate(min), shortDate(max))
}

/**
 * One control of any kind.
 *
 * `sized` is true when the admin pinned an exact pixel width on the wrapper.
 * Every root element then fills that wrapper and drops its own minimum width
 * -- a `min-w-[220px]` baked into a slider would otherwise silently override
 * an admin who asked for 150px, and the number they typed would be a lie.
 */
function Control({ control, value, rows, optionRows, onChange, isOn, onToggleButton, onAction, sized, dateOrder }) {
  const active = isButton(control) ? isOn : filterIsActive(control, value)
  const fmt = sliderFormat(control.format)

  const fill = sized ? 'w-full' : ''
  /** Applies the admin's width, or the kind's own sensible minimum. */
  const sizeClass = (min) => (sized ? 'w-full min-w-0' : min)

  const shell = `flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
    active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'
  }`

  /**
   * The rows this control describes ITSELF from: the page as everything
   * else has narrowed it, or the whole tab when the admin turned narrowing
   * off (Dashboard hands back the unnarrowed rows for those, so there is
   * nothing to decide here).
   *
   * One name for it because every kind below is asking the same question in
   * a different shape -- a dropdown's list, a slider's track and a range
   * box's hint are all "what is actually there". A slider reading the raw
   * tab was the last one that was not: pick a branch whose biggest order is
   * two lakh and the track still ran to fifty, so four fifths of every drag
   * filtered the page to nothing.
   */
  const listRows = optionRows ?? rows

  // Both of the next two read every row, so both are memoised on the rows
  // and not on the value -- a drag changes `value` sixty times a second,
  // and re-scanning four thousand rows on each of those is the difference
  // between a slider and a slideshow. `control` covers `control.format`,
  // which is the only other thing either of them reads.
  const dataBounds = useMemo(
    () =>
      ['slider', 'threshold'].includes(control.kind)
        ? numericBounds(listRows, control.column, control)
        : null,
    [control, listRows]
  )

  const span = useMemo(
    () => (['number', 'date'].includes(control.kind) ? rangeEnds(control, listRows, dateOrder, fmt) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fmt is control.format
    [control, listRows, dateOrder]
  )

  // Cheap by comparison -- two numbers off the value, no rows -- so it sits
  // outside the memo and stays correct while the handle is moving.
  // `boundsHolding` is what keeps a narrowed track reachable: without it a
  // slider set wide, then narrowed by a filter picked afterwards, loses its
  // own handle off the end. See lib/widgetControls.js.
  const bounds = dataBounds && boundsHolding(dataBounds, value)

  // --- A button that does something other than filter ---------------------
  // Rendered as an <a> when it opens a link, and as a button otherwise.
  // Not a button with a click handler that navigates: a real anchor is
  // what makes middle-click, ctrl-click and "copy link address" work, and
  // those are the three things somebody does with a link on a dashboard
  // they are about to share.
  if (isActionButton(control)) {
    const own = control.color || ''
    const shell = `control-face flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-all ${fill} ${
      own ? 'bg-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`
    const style = own ? { borderColor: `${own}66`, color: own } : undefined
    const label = (
      <>
        {control.icon ? `${control.icon} ` : ''}
        {control.label}
      </>
    )

    // A switch that narrows nothing. It presses and lights exactly like a
    // condition button -- because to the person using it that is what it
    // is -- and no row is affected either way. What reads it is a widget's
    // Visibility rule; see lib/buttonActions.js.
    //
    // It goes through `onToggleButton`, the same path a condition button
    // takes, so its on/off lives in the one list everything already asks:
    // saved views, Reset, and the visibility rules themselves.
    if (isPlainSwitch(control)) {
      const own = control.color || ''
      const onColour = own || 'var(--card-accent, #4F46E5)'
      return (
        <button
          onClick={onToggleButton}
          title={control.hint || undefined}
          aria-pressed={isOn}
          className={`control-face rounded-lg border px-3 py-1.5 text-sm font-semibold transition-all ${fill} ${
            isOn ? 'border-transparent text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
          style={isOn ? { backgroundColor: onColour } : own ? { borderColor: `${own}66` } : undefined}
        >
          {control.icon ? `${control.icon} ` : ''}
          {control.label}
        </button>
      )
    }

    // A button nobody finished setting up is shown as unavailable rather
    // than as a thing that silently does nothing when pressed.
    if (!actionIsReady(control)) {
      return (
        <button
          disabled
          className={`${shell} cursor-not-allowed opacity-40`}
          title="This button has not been finished — an admin needs to choose what it opens"
        >
          {label}
        </button>
      )
    }

    if (buttonAction(control) === 'link') {
      const newTab = opensNewTab(control)
      return (
        <a
          href={linkHref(control.url)}
          target={newTab ? '_blank' : undefined}
          // Both, and not just one: `noopener` is what stops the opened
          // page reaching back through `window.opener`, and `noreferrer`
          // is what stops this dashboard's URL being handed to it.
          rel={newTab ? 'noopener noreferrer' : undefined}
          title={control.hint || linkHref(control.url)}
          className={shell}
          style={style}
        >
          {label}
        </a>
      )
    }

    return (
      <button onClick={() => onAction?.(control)} title={control.hint || undefined} className={shell} style={style}>
        {label}
      </button>
    )
  }

  // --- Action ------------------------------------------------------------
  if (isButton(control)) {
    // The button's OWN colour wins, and the look's accent fills in when it
    // has none -- so the accent picker means something on a button instead
    // of being a control that does nothing, and the purpose-built setting
    // is still the one that decides. Two ways to set one colour would be a
    // fork; a precedence is not.
    const own = control.color || ''
    const onColour = own || 'var(--card-accent, #4F46E5)'
    return (
      <button
        onClick={onToggleButton}
        title={control.hint || undefined}
        className={`control-face rounded-lg border px-3 py-1.5 text-sm font-semibold transition-all ${fill} ${
          isOn ? 'border-transparent text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`}
        style={isOn ? { backgroundColor: onColour } : own ? { borderColor: `${own}66` } : undefined}
      >
        {control.icon ? `${control.icon} ` : ''}
        {control.label}
      </button>
    )
  }

  // --- Sliders -----------------------------------------------------------
  if (control.kind === 'dateslider') {
    const maxDays = Number(control.maxDays) || 365
    const current = value === '' || value === undefined ? maxDays : Number(value)
    return (
      <div className={`${shell} ${sizeClass('min-w-[200px]')}`}>
        <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">{control.label}</span>
        <DaysRange maxDays={maxDays} value={current} label={control.label} onChange={(n) => onChange(n >= maxDays ? '' : n)} />
      </div>
    )
  }

  if (control.kind === 'threshold') {
    const { min, max } = bounds
    const atMost = control.direction === 'lte'
    const current = value === '' || value === undefined ? (atMost ? max : min) : Number(value)
    return (
      <div className={`${shell} ${sizeClass('min-w-[200px]')}`}>
        <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">
          {control.label} {atMost ? '≤' : '≥'}
        </span>
        <SingleRange
          min={min}
          max={max}
          step={stepFor(min, max, control)}
          value={current}
          label={control.label}
          format={fmt}
          onChange={(n) => onChange(atMost ? (n >= max ? '' : n) : n <= min ? '' : n)}
        />
      </div>
    )
  }

  if (control.kind === 'stepper') {
    const ticks = stepperTicks(control)
    const lo = ticks[0]
    const hi = ticks[ticks.length - 1]
    const v = value || {}
    return (
      <div className={`${shell} ${sizeClass('min-w-[220px]')}`}>
        <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">{control.label}</span>
        <SteppedRange
          ticks={ticks}
          from={v.from === '' || v.from === undefined ? lo : Number(v.from)}
          to={v.to === '' || v.to === undefined ? hi : Number(v.to)}
          label={control.label}
          format={fmt}
          onChange={(a, b) => onChange(a <= lo && b >= hi ? {} : { from: String(a), to: String(b) })}
        />
        {active && (
          <button onClick={() => onChange({})} className="shrink-0 text-slate-300 hover:text-rose-500">
            <X size={11} />
          </button>
        )}
      </div>
    )
  }

  if (control.kind === 'slider') {
    const { min, max } = bounds
    const v = value || {}
    return (
      <div className={`${shell} ${sizeClass('min-w-[220px]')}`}>
        <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">{control.label}</span>
        <DualRange
          min={min}
          max={max}
          step={stepFor(min, max, control)}
          from={v.from === '' || v.from === undefined ? min : Number(v.from)}
          to={v.to === '' || v.to === undefined ? max : Number(v.to)}
          label={control.label}
          format={fmt}
          onChange={(a, b) => onChange(a <= min && b >= max ? {} : { from: String(a), to: String(b) })}
        />
        {active && (
          <button onClick={() => onChange({})} className="shrink-0 text-slate-300 hover:text-rose-500">
            <X size={11} />
          </button>
        )}
      </div>
    )
  }

  // --- Value pickers -----------------------------------------------------
  if (control.kind === 'multi') {
    return (
      <MultiSelect
        control={control}
        value={value}
        options={controlOptions(control, listRows, dateOrder, value)}
        onChange={onChange}
        fill={fill}
      />
    )
  }

  if (control.kind === 'chips') {
    const selected = value || []
    const { shown, hidden } = visibleChips(controlOptions(control, listRows, dateOrder, value), control.maxChips)
    return (
      // Every value, and the row scrolls rather than pushing the rest of the
      // bar off the page. A control with ninety values is a real thing; a
      // control that silently shows twelve of them is not.
      <div className="flex max-h-[76px] flex-wrap items-center gap-1 overflow-y-auto">
        <span className="text-[11px] font-medium text-slate-500">{control.label}:</span>
        {shown.map((opt) => {
          const on = selected.includes(opt)
          return (
            <button
              key={opt}
              onClick={() => onChange(on ? selected.filter((v) => v !== opt) : [...selected, opt])}
              className={`max-w-[140px] truncate rounded-full border px-2 py-1 text-[11px] transition-all ${
                on ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title={opt}
            >
              {opt}
            </button>
          )
        })}
        {hidden > 0 && (
          <span className="text-[10px] text-slate-400" title="Raise “Max chips” in the admin panel to show them">
            +{hidden} more
          </span>
        )}
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="text-slate-300 hover:text-rose-500">
            <X size={12} />
          </button>
        )}
      </div>
    )
  }

  if (control.kind === 'text') {
    return (
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={control.label}
        className={`rounded-lg border px-2.5 py-1.5 text-sm ${sizeClass('w-40')} ${
          active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'
        }`}
      />
    )
  }

  // --- Date range --------------------------------------------------------
  // Its own component: one button in the bar, and a calendar plus the named
  // periods in a popover behind it. See components/DateRange.jsx for why the
  // two native date inputs could not stay in the bar.
  if (control.kind === 'date') {
    return (
      <DateRange
        control={control}
        value={value}
        onChange={onChange}
        fill={fill}
        sized={sized}
        dataSpan={span}
      />
    )
  }

  // --- Number range ------------------------------------------------------
  if (control.kind === 'number') {
    const v = value || {}
    // `span` (computed above, with the rest of what reads every row) says
    // what the page currently holds. A min/max pair is TYPED, not dragged,
    // so unlike a slider there is nothing on screen saying what a sensible
    // answer would even look like -- and a range picked out of the air is
    // the one that comes back empty. See `rangeEnds`: it is a hint and it
    // stays one.
    return (
      <div className={`${shell} ${fill}`}>
        <span className="whitespace-nowrap text-[11px] font-medium text-slate-400"># {control.label}</span>
        <input
          type="number"
          value={v.from || ''}
          onChange={(e) => onChange({ ...v, from: e.target.value })}
          className="w-[112px] rounded border border-slate-200 px-1.5 py-0.5 text-xs"
          placeholder={span.from || 'min'}
          title={span.title}
        />
        <span className="text-[11px] text-slate-300">to</span>
        <input
          type="number"
          value={v.to || ''}
          onChange={(e) => onChange({ ...v, to: e.target.value })}
          className="w-[112px] rounded border border-slate-200 px-1.5 py-0.5 text-xs"
          placeholder={span.to || 'max'}
          title={span.title}
        />
        {active && (
          <button onClick={() => onChange({})} className="text-slate-300 hover:text-rose-500">
            <X size={12} />
          </button>
        )}
      </div>
    )
  }

  // --- Single select (default) -------------------------------------------
  return (
    <select
      value={value ?? '__ALL__'}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border px-2 py-1.5 text-sm ${sizeClass('max-w-[200px]')} ${
        active ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white'
      }`}
    >
      <option value="__ALL__">{control.label}: All</option>
      {controlOptions(control, listRows, dateOrder, value).map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}

/**
 * The page's control bar: every filter, dropdown, slider and button the
 * admin defined, in the order they defined them.
 *
 * One bar rather than a filter row and a separate button row, because a
 * "Status" dropdown and a "Pending invoices" button do the same job for the
 * person using the dashboard. Where a control sits is now the admin's
 * decision rather than a consequence of which array it happened to live in.
 */
export default function ControlBar({
  controls,
  values,
  onChange,
  activeButtonIds,
  onToggleButton,
  // What a one-shot button does. Everything it can do belongs to the page
  // -- navigating, refreshing, printing -- so the page performs it and the
  // bar only says which one was pressed.
  onAction,
  onClearButtons,
  onReset,
  search,
  onSearch,
  showSearch = true,
  views = [],
  onApplyView,
  tabsData,
  optionRows,
  totalLabel,
  dateOrder = 'DMY',
  editable = false,
  onControlEdit,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const { visible, advanced } = useMemo(() => partitionByProminence(controls), [controls])
  const live = activeCount(controls, values, activeButtonIds)
  const anyActive = live > 0 || (search || '').trim() !== ''

  // Something narrowing the page from behind the "More" fold would otherwise
  // be invisible -- the count on the button is how you find it.
  const hiddenActive = advanced.filter((c) => controlActive(c, values, activeButtonIds)).length

  const rowsFor = (control) => tabsData?.[control.tab]?.rows || []

  /**
   * A control the admin sized gets a fixed-width wrapper and is told to fill
   * it. `flex: 0 0 auto` stops the bar's own flex layout from stretching or
   * squashing it -- the whole point of typing 260px is getting 260px.
   */
  const renderControl = (control) => {
    const px = controlWidth(control)
    return (
      <div
        key={control.id}
        className={`relative control-skin ${styleClass(control.style)}`}
        style={{ ...(px ? { width: px, flex: '0 0 auto' } : null), ...(styleVars(control.style) || {}) }}
      >
        {/* A control is sized and placed on the page exactly the way a
            widget is: in its own place, in pixels, by an admin who is
            looking at it. */}
        {editable && onControlEdit && (
          <ControlPill control={control} measured={px} onEdit={(patch) => onControlEdit(control.id, patch)} />
        )}
        <Control
          control={control}
          value={values?.[control.id]}
          rows={rowsFor(control)}
          optionRows={optionRows?.[control.id]}
          onChange={(v) => onChange(control.id, v)}
          isOn={(activeButtonIds || []).includes(control.id)}
          onToggleButton={() => onToggleButton(control)}
          onAction={onAction}
          sized={!!px}
          dateOrder={dateOrder}
        />
      </div>
    )
  }

  return (
    <div className="card relative z-50 space-y-2 py-3">
      {/* --- Saved views ---------------------------------------------- */}
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
          <Bookmark size={12} className="text-slate-300" />
          {views.map((view) => {
            const on = viewIsActive(view, values, activeButtonIds, controls)
            const color = view.color || '#4F46E5'
            return (
              <button
                key={view.id}
                onClick={() => onApplyView(view)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-all ${
                  on ? 'border-transparent text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                style={on ? { backgroundColor: color } : { borderColor: `${color}55` }}
              >
                {view.icon ? `${view.icon} ` : ''}
                {view.label}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {showSearch && (
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search everything…"
              className="w-52 rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
        )}

        {visible.map(renderControl)}

        {advanced.length > 0 && (
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
              hiddenActive > 0
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal size={12} />
            More
            {hiddenActive > 0 && (
              <span className="rounded-full bg-indigo-500 px-1.5 text-[10px] font-semibold text-white">
                {hiddenActive}
              </span>
            )}
            <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
        )}

        {/* Reset is deliberately the loudest thing in the bar once anything
            is active. It only appears when there IS something to clear, and
            at that moment it is the most useful control present -- a muted
            grey link was too easy to miss while wondering why the numbers
            looked wrong. The count says exactly how much is being cleared. */}
        {anyActive && (
          <button
            onClick={() => {
              onReset()
              onClearButtons()
            }}
            title={live > 0 ? `Clear ${live} active control${live === 1 ? '' : 's'}` : 'Clear the search'}
            className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-rose-600 hover:shadow active:scale-95"
          >
            <RotateCcw size={12} />
            Reset
            {live > 0 && (
              <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold tabular-nums">{live}</span>
            )}
          </button>
        )}

        {totalLabel && <span className="ml-auto text-sm text-slate-400">{totalLabel}</span>}
      </div>

      {showAdvanced && advanced.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
          {advanced.map(renderControl)}
        </div>
      )}
    </div>
  )
}

/**
 * The handle on a page control, in arrange mode.
 *
 * The same idea as a widget's pill and deliberately the same shape: a
 * number for how wide it is, a number for where it sits, and one switch for
 * whether it is on the bar or behind "More". A control is part of the page's
 * design, and there is no reason it should be the one thing an admin has to
 * leave the page to adjust.
 */
function ControlPill({ control, measured, onEdit }) {
  const [open, setOpen] = useState(false)
  const [painting, setPainting] = useState(false)

  // The same panel a widget's brush opens -- see components/WidgetPaint.jsx.
  // A filter that cannot be restyled beside a widget that can is not a
  // decision anybody made, and one panel serving both is what stops the two
  // drifting into different sets of options.
  if (painting) {
    return (
      <div className="absolute -left-1 -top-2 z-40 w-64 rounded-lg border border-indigo-300 bg-white p-2 shadow-xl">
        <WidgetPaint
          title={control.label || 'this control'}
          style={control.style}
          onStyle={(next) => onEdit({ style: next })}
          onClose={() => setPainting(false)}
        />
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute -left-1 -top-2 z-30 rounded border border-slate-200 bg-white/90 px-1 text-[9px] font-semibold tabular-nums text-slate-400 shadow-sm hover:text-indigo-600"
        title={`Size and place ${control.label || 'this control'}`}
      >
        {control.order ?? '·'} {measured ? `${measured}px` : 'auto'}
      </button>
    )
  }

  return (
    <div
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
      className="absolute -left-1 -top-2 z-40 flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-1.5 py-1 shadow-lg"
    >
      <span className="text-[9px] font-semibold text-slate-400">#</span>
      <input
        type="number"
        defaultValue={control.order ?? ''}
        onBlur={(e) => onEdit({ order: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-10 rounded border border-slate-200 px-1 py-0.5 text-center text-[11px] tabular-nums"
        aria-label="Order"
        autoFocus
      />
      <span className="text-[9px] font-semibold text-slate-400">W</span>
      <input
        type="number"
        defaultValue={control.widthPx ?? ''}
        placeholder={measured || 'auto'}
        onBlur={(e) => onEdit({ widthPx: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-center text-[11px] tabular-nums"
        aria-label="Width in pixels"
      />
      <button
        onClick={() => setPainting(true)}
        className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
        title={`How ${control.label || 'this control'} looks`}
      >
        <Paintbrush size={11} />
      </button>
      <button
        onClick={() => onEdit({ advanced: !control.advanced })}
        className={`rounded border px-1 py-0.5 text-[9px] ${
          control.advanced
            ? 'border-slate-200 text-slate-400'
            : 'border-indigo-300 bg-indigo-50 text-indigo-600'
        }`}
        title={
          control.advanced
            ? 'Behind “More” — click to put it on the bar'
            : 'On the bar — click to move it behind “More”'
        }
      >
        {control.advanced ? 'more' : 'bar'}
      </button>
    </div>
  )
}
