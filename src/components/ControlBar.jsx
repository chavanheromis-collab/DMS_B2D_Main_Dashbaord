import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'

import { filterIsActive } from '../lib/filterEngine'
import { numericBounds, stepFor, stepperTicks } from '../lib/widgetControls'
import {
  activeCount,
  controlActive,
  controlOptions,
  visibleChips,
  controlWidth,
  isButton,
  partitionByProminence,
  viewIsActive,
} from '../lib/pageControls'
import { DaysRange, DualRange, SingleRange, SteppedRange, sliderFormat } from './Sliders.jsx'

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

      {open && (
        <div className="absolute z-[9999] mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
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
                <span className="truncate">{opt}</span>
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

/**
 * One control of any kind.
 *
 * `sized` is true when the admin pinned an exact pixel width on the wrapper.
 * Every root element then fills that wrapper and drops its own minimum width
 * -- a `min-w-[220px]` baked into a slider would otherwise silently override
 * an admin who asked for 150px, and the number they typed would be a lie.
 */
function Control({ control, value, rows, optionRows, onChange, isOn, onToggleButton, sized, dateOrder }) {
  const active = isButton(control) ? isOn : filterIsActive(control, value)
  const fmt = sliderFormat(control.format)

  const fill = sized ? 'w-full' : ''
  /** Applies the admin's width, or the kind's own sensible minimum. */
  const sizeClass = (min) => (sized ? 'w-full min-w-0' : min)

  const shell = `flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
    active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'
  }`

  const bounds = useMemo(
    () => (['slider', 'threshold'].includes(control.kind) ? numericBounds(rows, control.column, control) : null),
    [control, rows]
  )

  // --- Action ------------------------------------------------------------
  if (isButton(control)) {
    const color = control.color || '#4F46E5'
    return (
      <button
        onClick={onToggleButton}
        title={control.hint || undefined}
        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-all ${fill} ${
          isOn ? 'border-transparent text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`}
        style={isOn ? { backgroundColor: color } : { borderColor: `${color}66` }}
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
        options={controlOptions(control, optionRows ?? rows, dateOrder, value)}
        onChange={onChange}
        fill={fill}
      />
    )
  }

  if (control.kind === 'chips') {
    const selected = value || []
    const { shown, hidden } = visibleChips(controlOptions(control, optionRows ?? rows, dateOrder, value), control.maxChips)
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

  if (control.kind === 'date' || control.kind === 'number') {
    const isDate = control.kind === 'date'
    const v = value || {}
    return (
      <div className={`${shell} ${fill}`}>
        <span className="whitespace-nowrap text-[11px] font-medium text-slate-400">
          {isDate ? '📅' : '#'} {control.label}
        </span>
        <input
          type={isDate ? 'date' : 'number'}
          value={v.from || ''}
          onChange={(e) => onChange({ ...v, from: e.target.value })}
          className="w-[112px] rounded border border-slate-200 px-1.5 py-0.5 text-xs"
          placeholder={isDate ? '' : 'min'}
        />
        <span className="text-[11px] text-slate-300">to</span>
        <input
          type={isDate ? 'date' : 'number'}
          value={v.to || ''}
          onChange={(e) => onChange({ ...v, to: e.target.value })}
          className="w-[112px] rounded border border-slate-200 px-1.5 py-0.5 text-xs"
          placeholder={isDate ? '' : 'max'}
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
      {controlOptions(control, optionRows ?? rows, dateOrder, value).map((opt) => (
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
      <div key={control.id} className="relative" style={px ? { width: px, flex: '0 0 auto' } : undefined}>
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
