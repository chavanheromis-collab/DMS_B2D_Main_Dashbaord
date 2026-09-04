import { useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { RotateCcw, X } from 'lucide-react'
import {
  CHART_VISUAL_PRESETS,
  DEFAULT_CHART_VISUALS,
  FILL_LABEL_MODES,
  GRID_LINES,
  GRID_STYLES,
  LIMITS,
  barGapProps,
  barRadius,
  chartVisualClass,
  chartVisualVars,
  clearChartVisuals,
  fillLabelColor,
  gridProps,
  hasChartVisuals,
} from '../lib/chartVisuals'
import { WEIGHTS } from '../lib/typography'

/**
 * How a chart is DRAWN, as something an admin can actually operate.
 *
 * Twenty numbers in a column is a form nobody finishes. Three things make
 * this one usable instead, and they are the whole design:
 *
 *  1. PRESETS FIRST. Eight named looks, each a complete opinion. Most
 *     people click one and are done; the controls underneath exist for the
 *     one thing they then want different, which is a far smaller decision
 *     than twenty.
 *  2. A LIVE PREVIEW, drawn by the real chart library through the real
 *     `chartVisualClass` and `chartVisualVars`. Not a mock-up: if the
 *     preview is wrong the page is wrong, because they are the same code.
 *     Reading six numbers back as a picture in your head is exactly the
 *     job a preview should be doing for you.
 *  3. FOUR SHORT TABS rather than one long form, so the thing you came for
 *     is one click rather than one hunt. The same reasoning as the widget
 *     editor's own section tabs.
 *
 * Every control starts at "inherit" and says so. Clearing one hands it back
 * to the page, and clearing the page hands it back to the app -- which is
 * not the same as setting it to whatever that happens to be today.
 */
export default function ChartVisualFields({ value, onChange, title = 'Chart drawing' }) {
  const v = { ...DEFAULT_CHART_VISUALS, ...(value || {}) }
  const [tab, setTab] = useState('marks')
  const set = (patch) => onChange({ ...v, ...patch })

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-1.5">
        <p className="text-[11px] font-medium text-slate-600">{title}</p>
        {hasChartVisuals(v) && (
          <button
            onClick={() => onChange(clearChartVisuals(v))}
            className="ml-auto text-[10px] text-slate-400 underline hover:text-rose-500"
            title="Every drawing setting back to what the chart does by default"
          >
            all inherited
          </button>
        )}
      </div>

      {/* --- presets, because most people are finished here --------- */}
      <div className="flex flex-wrap gap-1">
        {CHART_VISUAL_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => set({ preset: p.value })}
            title={p.hint}
            className={`rounded-lg border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              (v.preset || '') === p.value
                ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Preview visuals={v} />

      {/* --- four short tabs rather than one long form -------------- */}
      <div className="flex flex-wrap gap-1">
        {[
          { key: 'marks', label: 'Marks' },
          { key: 'grid', label: 'Grid & axes' },
          { key: 'labels', label: 'Labels on marks' },
          { key: 'tooltip', label: 'Tooltip' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-2 py-0.5 text-[10px] font-medium transition-colors ${
              tab === t.key ? 'bg-ink text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5 rounded-lg border border-slate-100 bg-white/70 p-2">
        {tab === 'marks' && (
          <>
            <Slider
              label="Fill"
              suffix="%"
              value={v.fillOpacity}
              range={LIMITS.fillOpacity}
              onChange={(n) => set({ fillOpacity: n })}
              hint="How solid a bar, area or slice is."
            />
            <Slider
              label="Line"
              suffix="px"
              value={v.strokeWidth}
              range={LIMITS.strokeWidth}
              onChange={(n) => set({ strokeWidth: n })}
              hint="Thickness of lines and area edges."
            />
            <Slider
              label="Corners"
              suffix="px"
              value={v.barRadius}
              range={LIMITS.barRadius}
              onChange={(n) => set({ barRadius: n })}
              hint="Rounding on the end a bar grows towards."
            />
            <Slider
              label="Bar gap"
              suffix="%"
              value={v.barGap}
              range={LIMITS.barGap}
              onChange={(n) => set({ barGap: n })}
              hint="Air between one category and the next."
            />
            <Slider
              label="Points"
              suffix="px"
              value={v.pointSize}
              range={LIMITS.pointSize}
              onChange={(n) => set({ pointSize: n })}
              hint="Dots on a line or an area."
            />
            <Slider
              label="Depth"
              suffix="%"
              value={v.markDepth}
              range={LIMITS.markDepth}
              onChange={(n) => set({ markDepth: n })}
              hint="Stands bars and slices off the card on a shadow. The 3D look, without the distortion."
            />
            <div className="grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-1.5">
              <Swatch
                label="Slice edge"
                value={v.separatorColor}
                fallback="#FFFFFF"
                onChange={(c) => set({ separatorColor: c })}
              />
              <Slider
                label="Edge"
                suffix="px"
                compact
                value={v.separatorWidth}
                range={LIMITS.separatorWidth}
                onChange={(n) => set({ separatorWidth: n })}
              />
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              The hairline between two pie slices or two treemap cells. White by default, which reads as cracks on a
              dark card.
            </p>
          </>
        )}

        {tab === 'grid' && (
          <>
            <Picker
              label="Rules"
              value={v.gridLines}
              options={GRID_LINES}
              onChange={(x) => set({ gridLines: x })}
            />
            <Picker
              label="Style"
              value={v.gridStyle}
              options={GRID_STYLES}
              onChange={(x) => set({ gridStyle: x })}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Swatch label="Rule colour" value={v.gridColor} fallback="#EEF2F7" onChange={(c) => set({ gridColor: c })} />
              <Swatch label="Axis colour" value={v.axisColor} fallback="#E2E8F0" onChange={(c) => set({ axisColor: c })} />
            </div>
            <Tri
              label="Axis lines"
              value={v.axisLines}
              onChange={(x) => set({ axisLines: x })}
              hint="The line the marks stand on."
            />
            <Tri
              label="Tick marks"
              value={v.tickMarks}
              onChange={(x) => set({ tickMarks: x })}
              hint="The little dashes beside each label."
            />
          </>
        )}

        {tab === 'labels' && (
          <>
            {/* The setting this whole feature was missing. A value written
                on a bar was hard-coded white in five places and slate in a
                sixth, so a pale palette or a dark card had no way to make
                its own chart readable. */}
            <Picker
              label="Colour"
              value={v.fillLabelMode}
              options={FILL_LABEL_MODES}
              onChange={(x) => set({ fillLabelMode: x })}
            />
            {v.fillLabelMode === 'fixed' ? (
              <Swatch
                label="Label colour"
                value={v.fillLabelColor}
                fallback="#FFFFFF"
                onChange={(c) => set({ fillLabelColor: c })}
              />
            ) : (
              <p className="rounded bg-slate-50 px-2 py-1 text-[10px] leading-relaxed text-slate-500">
                Each label takes dark or light ink depending on the mark it sits on, judged by perceived lightness —
                so a pale bar gets dark text and a deep one gets white, without you checking every colour in the
                palette.
              </p>
            )}
            <Slider
              label="Size"
              suffix="px"
              value={v.fillLabelSize}
              range={LIMITS.fillLabelSize}
              onChange={(n) => set({ fillLabelSize: n })}
            />
            <Picker
              label="Weight"
              value={v.fillLabelWeight ? String(v.fillLabelWeight) : ''}
              options={[
                { value: '', label: 'Chart default' },
                ...WEIGHTS.filter((w) => w.css).map((w) => ({ value: String(w.css), label: w.label })),
              ]}
              onChange={(x) => set({ fillLabelWeight: x ? Number(x) : null })}
            />
            <p className="text-[10px] leading-relaxed text-slate-400">
              This is the writing <em>on</em> the marks. The axis text and the legend are set just above, because they
              are read differently and almost never want the same colour.
            </p>
          </>
        )}

        {tab === 'tooltip' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <Swatch label="Background" value={v.tooltipBg} fallback="#FFFFFF" onChange={(c) => set({ tooltipBg: c })} />
              <Swatch label="Text" value={v.tooltipText} fallback="#0F172A" onChange={(c) => set({ tooltipText: c })} />
              <Swatch label="Border" value={v.tooltipBorder} fallback="#E2E8F0" onChange={(c) => set({ tooltipBorder: c })} />
              <Swatch
                label="Hover band"
                value={v.cursorColor}
                fallback="#F8FAFC"
                onChange={(c) => set({ cursorColor: c })}
              />
            </div>
            <Slider
              label="Corners"
              suffix="px"
              value={v.tooltipRadius}
              range={LIMITS.tooltipRadius}
              onChange={(n) => set({ tooltipRadius: n })}
            />
            <Slider
              label="Text size"
              suffix="px"
              value={v.tooltipSize}
              range={LIMITS.tooltipSize}
              onChange={(n) => set({ tooltipSize: n })}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------
const SAMPLE = [
  { name: 'A', value: 34, line: 18 },
  { name: 'B', value: 58, line: 31 },
  { name: 'C', value: 26, line: 44 },
  { name: 'D', value: 71, line: 39 },
  { name: 'E', value: 45, line: 52 },
]

const SAMPLE_FILL = '#4F46E5'

/**
 * A real chart, drawn through the real functions.
 *
 * Deliberately not a hand-drawn mock-up. It is wrapped in exactly the class
 * and the properties the page will put on the widget, and its bars get
 * their radius and gap from exactly the helpers the page calls -- so if
 * this looks right the chart looks right, and if it is wrong the bug is in
 * the thing being previewed rather than in the preview.
 *
 * The tooltip is a static sample rather than something you have to hover
 * for: a setting you can only see by holding the mouse still in the right
 * place is a setting nobody discovers.
 */
function Preview({ visuals }) {
  const grid = gridProps(visuals)
  const ink = fillLabelColor(visuals, SAMPLE_FILL)

  return (
    <div
      className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${chartVisualClass(visuals)}`}
      style={chartVisualVars(visuals)}
    >
      <div className="relative h-[132px] w-full px-1 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={SAMPLE} margin={{ top: 6, right: 8, bottom: 0, left: -22 }} {...(barGapProps(visuals) || {})}>
            {!grid?.hidden && (
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} {...(grid || {})} />
            )}
            <XAxis dataKey="name" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={30} />
            <Bar
              dataKey="value"
              fill={SAMPLE_FILL}
              isAnimationActive={false}
              radius={barRadius(visuals) ?? [6, 6, 0, 0]}
              label={{
                position: 'insideTop',
                className: 'label-on-fill',
                // Same call the chart makes, so automatic contrast is
                // visible here rather than only on the page.
                fill: ink || '#fff',
                fontSize: 9,
                formatter: (n) => n,
              }}
            />
            <Line
              type="monotone"
              dataKey="line"
              stroke="#F59E0B"
              strokeWidth={2}
              isAnimationActive={false}
              dot={{ r: 3, fill: '#F59E0B', strokeWidth: 0 }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* A standing sample of the tooltip, wearing the class Recharts
            gives the real one, so the tooltip settings are visible without
            anybody having to hover the right pixel. */}
        <div
          className="recharts-default-tooltip pointer-events-none absolute right-2 top-2 border px-2 py-1 shadow-sm"
          style={{
            background: '#fff',
            borderColor: '#e2e8f0',
            borderRadius: 10,
            fontSize: 11,
            lineHeight: 1.35,
          }}
        >
          <p className="recharts-tooltip-label m-0 font-medium">D</p>
          <p className="recharts-tooltip-item m-0">Value : 71</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------

/**
 * A number with a visible value and a way back to inherited.
 *
 * A slider rather than a number box because every one of these is a
 * judgement made by looking -- "is that bar round enough" is not a question
 * anybody answers by typing 7. The reading beside it is what stops it being
 * a mystery dial, and `auto` is what makes the setting reversible: a slider
 * with no null position can only ever be set, never unset.
 */
function Slider({ label, value, range, onChange, suffix = '', hint, compact = false }) {
  const [min, max] = range
  const current = value === null || value === undefined || value === '' ? null : Number(value)
  const shown = current === null ? Math.round((min + max) / 2) : current

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="w-14 shrink-0 text-[10px] text-slate-500">{label}</span>
        <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-600">
          {current === null ? 'inherit' : `${current}${suffix}`}
        </span>
        {current !== null && (
          <button
            onClick={() => onChange(null)}
            className="text-[10px] text-slate-400 underline hover:text-rose-500"
            title="Back to what the chart does by default"
          >
            auto
          </button>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={shown}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full accent-indigo-600 ${current === null ? 'opacity-40' : ''}`}
        aria-label={label}
      />
      {hint && !compact && <p className="-mt-0.5 text-[10px] text-slate-400">{hint}</p>}
    </div>
  )
}

function Picker({ label, value, options, onChange }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] text-slate-500">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} title={o.hint}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Swatch({ label, value, fallback, onChange }) {
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
        <button onClick={() => onChange(null)} className="text-[9px] text-slate-300 hover:text-rose-500" title="Inherit">
          <X size={10} />
        </button>
      )}
    </label>
  )
}

/**
 * On, off, or "no opinion".
 *
 * Three states rather than a checkbox, because a checkbox has only two and
 * neither of them is "leave it as it was". Without the third, switching
 * axis lines on and then changing your mind pins them OFF for ever rather
 * than handing them back to the chart.
 */
function Tri({ label, value, onChange, hint }) {
  const options = [
    { value: '', label: 'Default' },
    { value: 'on', label: 'Show' },
    { value: 'off', label: 'Hide' },
  ]
  const current = value === true ? 'on' : value === false ? 'off' : ''

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] text-slate-500" title={hint}>
        {label}
      </span>
      <div className="flex overflow-hidden rounded border border-slate-200">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value === '' ? null : o.value === 'on')}
            className={`px-1.5 py-0.5 text-[10px] transition-colors ${
              current === o.value ? 'bg-ink text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {current !== '' && (
        <button
          onClick={() => onChange(null)}
          className="text-slate-300 hover:text-rose-500"
          title="Back to the chart's own behaviour"
        >
          <RotateCcw size={10} />
        </button>
      )}
    </div>
  )
}
