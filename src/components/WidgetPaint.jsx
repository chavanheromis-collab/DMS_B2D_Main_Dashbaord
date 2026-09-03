import { Paintbrush, X } from 'lucide-react'
import TypographyFields, { MarkTextFields } from './TypographyFields.jsx'
import ChartVisualFields from './ChartVisualFields.jsx'
import { DEFAULT_WIDGET_STYLE, SHADOW_LEVELS, WIDGET_THEMES } from '../lib/widgetStyle'

/**
 * How one thing on the page looks.
 *
 * Lifted out of the arrange bar when the CONTROLS needed it too: a filter
 * that cannot be restyled beside a widget that can is not a decision
 * anybody made, and one panel serving both is what stops the two drifting
 * into different sets of options.
 */
export default function WidgetPaint({ title, style, onStyle, onClose, chartText = false }) {
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
