import { useMemo } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { distinctValues } from '../lib/dataUtils'
import {
  anyControlActive,
  controlIsActive,
  numericBounds,
  stepFor,
  stepperTicks,
} from '../lib/widgetControls'
import { controlWidth } from '../lib/pageControls'
// The same slider primitives the page filter bar uses. Scope differs -- a
// page filter spans every widget on a tab, a widget control narrows one
// widget -- but a range slider is a range slider, and two implementations
// would drift apart the first time one of them got a fix.
import { DaysRange, DualRange, SingleRange, SteppedRange, sliderFormat } from './Sliders.jsx'

const chip = 'rounded-lg border px-2.5 py-1 text-[11px] transition-all'
const idle = 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
const live = 'border-indigo-300 bg-indigo-50 text-indigo-700'

/**
 * The controls attached to ONE widget. Rendered by the canvas wrapper above
 * the widget card, so every widget type gets them without knowing they exist.
 */
export default function WidgetControls({ controls, values, onChange, onReset, rows, dateOrder }) {
  if (!controls?.length) return null

  const active = anyControlActive(controls, values)

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/70 bg-white/70 px-2 py-1.5 backdrop-blur">
      {controls.map((control) => {
        // Same pixel convention as the page control bar -- see
        // lib/pageControls.js. `flex: 0 0 auto` keeps the bar's own layout
        // from stretching or squashing a width the admin typed.
        const px = controlWidth(control)
        return (
          <div key={control.id} style={px ? { width: px, flex: '0 0 auto' } : undefined}>
            <OneControl
              control={control}
              value={values?.[control.id]}
              rows={rows}
              dateOrder={dateOrder}
              onChange={(v) => onChange(control.id, v)}
              sized={!!px}
            />
          </div>
        )
      })}

      {/* Same treatment as the page bar's Reset: coloured, so a widget that
          is quietly narrowed says so. */}
      {active && (
        <button
          onClick={onReset}
          title="Clear this widget's controls"
          className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-600 transition-colors hover:bg-rose-100"
        >
          <RotateCcw size={10} /> Reset
        </button>
      )}
    </div>
  )
}

function OneControl({ control, value, rows, onChange, sized }) {
  const isLive = controlIsActive(control, value)
  const fmt = sliderFormat(control.format)
  // A pinned width has to beat the kind's own minimum, or the number the
  // admin typed would be quietly overridden.
  const sizeClass = (min) => (sized ? 'w-full min-w-0' : min)

  // Bounds are derived from the rows this widget actually holds, so a slider
  // never offers a range with nothing in it.
  const bounds = useMemo(
    () =>
      ['range', 'threshold'].includes(control.kind)
        ? numericBounds(rows, control.column, control)
        : { min: 0, max: 100 },
    [control, rows]
  )

  switch (control.kind) {
    case 'button': {
      const on = value === true
      const color = control.color || '#4F46E5'
      return (
        <button
          onClick={() => onChange(!on)}
          className={`${chip} font-semibold ${on ? 'border-transparent text-white' : idle}`}
          style={on ? { backgroundColor: color } : { borderColor: `${color}66` }}
        >
          {control.icon ? `${control.icon} ` : ''}
          {control.label}
        </button>
      )
    }

    case 'multi': {
      const options = distinctValues(rows, control.column).slice(0, control.maxChips || 8)
      const selected = value || []
      return (
        <span className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium text-slate-500">{control.label}:</span>
          {options.map((opt) => {
            const on = selected.includes(opt)
            return (
              <button
                key={opt}
                onClick={() => onChange(on ? selected.filter((v) => v !== opt) : [...selected, opt])}
                className={`max-w-[120px] truncate rounded-full border px-2 py-0.5 text-[10px] ${
                  on ? 'border-indigo-400 bg-indigo-500 text-white' : idle
                }`}
                title={opt}
              >
                {opt}
              </button>
            )
          })}
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="text-slate-300 hover:text-rose-500">
              <X size={11} />
            </button>
          )}
        </span>
      )
    }

    case 'search':
      return (
        <input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={control.label}
          className={`${sizeClass('w-36')} ${chip} ${isLive ? live : 'border-slate-200'}`}
        />
      )

    case 'range': {
      const { min, max } = bounds
      const step = stepFor(min, max, control)
      const from = value?.from === undefined || value?.from === '' ? min : Number(value.from)
      const to = value?.to === undefined || value?.to === '' ? max : Number(value.to)

      return (
        <span className={`flex ${sizeClass('min-w-[210px]')} items-center gap-2 ${chip} ${isLive ? live : 'border-slate-200'}`}>
          <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">{control.label}</span>
          <DualRange
            min={min}
            max={max}
            step={step}
            from={from}
            to={to}
            label={control.label}
            format={fmt}
            onChange={(a, b) =>
              // Back at the full span means "no opinion", so the value is
              // cleared -- otherwise the control would read as permanently
              // active and Reset would never appear.
              onChange(a <= min && b >= max ? {} : { from: String(a), to: String(b) })
            }
          />
          {isLive && (
            <button onClick={() => onChange({})} className="text-slate-300 hover:text-rose-500">
              <X size={11} />
            </button>
          )}
        </span>
      )
    }

    case 'threshold': {
      const { min, max } = bounds
      const step = stepFor(min, max, control)
      const atMost = control.direction === 'lte'
      const current = value === undefined || value === '' ? (atMost ? max : min) : Number(value)

      return (
        <span className={`flex ${sizeClass('min-w-[190px]')} items-center gap-2 ${chip} ${isLive ? live : 'border-slate-200'}`}>
          <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">
            {control.label} {atMost ? '≤' : '≥'}
          </span>
          <SingleRange
            min={min}
            max={max}
            step={step}
            value={current}
            label={control.label}
            format={fmt}
            // At the extreme end it filters nothing, so treat it as cleared.
            onChange={(n) => onChange(atMost ? (n >= max ? '' : n) : n <= min ? '' : n)}
          />
        </span>
      )
    }

    case 'stepper': {
      const ticks = stepperTicks(control)
      const min = ticks[0]
      const max = ticks[ticks.length - 1]
      const from = value?.from === undefined || value?.from === '' ? min : Number(value.from)
      const to = value?.to === undefined || value?.to === '' ? max : Number(value.to)

      return (
        <span className={`flex ${sizeClass('min-w-[210px]')} items-center gap-2 ${chip} ${isLive ? live : 'border-slate-200'}`}>
          <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">{control.label}</span>
          <SteppedRange
            ticks={ticks}
            from={from}
            to={to}
            label={control.label}
            format={fmt}
            onChange={(a, b) => onChange(a <= min && b >= max ? {} : { from: String(a), to: String(b) })}
          />
          {isLive && (
            <button onClick={() => onChange({})} className="text-slate-300 hover:text-rose-500">
              <X size={11} />
            </button>
          )}
        </span>
      )
    }

    case 'dateslider': {
      const maxDays = Number(control.maxDays) || 365
      const current = value === undefined || value === '' ? maxDays : Number(value)
      return (
        <span className={`flex ${sizeClass('min-w-[200px]')} items-center gap-2 ${chip} ${isLive ? live : 'border-slate-200'}`}>
          <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">{control.label}</span>
          <DaysRange
            maxDays={maxDays}
            value={current}
            label={control.label}
            onChange={(n) => onChange(n >= maxDays ? '' : n)}
          />
        </span>
      )
    }

    case 'topn': {
      const maxN = Number(control.maxN) || 50
      const current = value === undefined || value === '' ? maxN : Number(value)
      return (
        <span className={`flex ${sizeClass('min-w-[180px]')} items-center gap-2 ${chip} ${isLive ? live : 'border-slate-200'}`}>
          <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">{control.label}</span>
          <input
            type="range"
            min={1}
            max={maxN}
            value={current}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange(n >= maxN ? '' : n)
            }}
            className="h-1 min-w-[70px] flex-1 accent-indigo-500"
            aria-label={control.label}
          />
          <span className="whitespace-nowrap text-[10px] tabular-nums text-slate-600">
            {current >= maxN ? 'all' : `top ${current}`}
          </span>
        </span>
      )
    }

    case 'date': {
      const v = value || {}
      return (
        <span className={`flex items-center gap-1 ${chip} ${isLive ? live : 'border-slate-200'}`}>
          <span className="whitespace-nowrap text-[10px] font-medium text-slate-500">📅 {control.label}</span>
          <input
            type="date"
            value={v.from || ''}
            onChange={(e) => onChange({ ...v, from: e.target.value })}
            className="rounded border border-slate-200 px-1 py-0.5 text-[10px]"
          />
          <span className="text-[10px] text-slate-300">to</span>
          <input
            type="date"
            value={v.to || ''}
            onChange={(e) => onChange({ ...v, to: e.target.value })}
            className="rounded border border-slate-200 px-1 py-0.5 text-[10px]"
          />
          {isLive && (
            <button onClick={() => onChange({})} className="text-slate-300 hover:text-rose-500">
              <X size={11} />
            </button>
          )}
        </span>
      )
    }

    case 'select':
    default: {
      const options = distinctValues(rows, control.column)
      return (
        <select
          value={value ?? '__ALL__'}
          onChange={(e) => onChange(e.target.value)}
          className={`${sizeClass('max-w-[180px]')} ${chip} ${isLive ? live : 'border-slate-200'}`}
        >
          <option value="__ALL__">{control.label}: All</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    }
  }
}
