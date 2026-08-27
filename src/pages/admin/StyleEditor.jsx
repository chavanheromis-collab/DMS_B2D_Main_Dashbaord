import { Palette, RotateCcw } from 'lucide-react'
import {
  DEFAULT_WIDGET_STYLE,
  SHADOW_LEVELS,
  WIDGET_THEMES,
  resolveStyle,
  styleClass,
  styleVars,
} from '../../lib/widgetStyle'
import { Field, Select, TextInput } from './ui.jsx'
import TypographyFields, { MarkTextFields } from '../../components/TypographyFields.jsx'
import ChartVisualFields from '../../components/ChartVisualFields.jsx'
import { hasChartText } from '../../lib/typography'

/**
 * Per-widget appearance.
 *
 * Every control starts at "system default" and stays there until touched.
 * That's the important property: a widget nobody has restyled stores no
 * style at all and renders exactly as the stock theme does, so this feature
 * can't quietly drift the look of an existing dashboard. Clearing a field
 * returns it to the theme rather than to some hard-coded value.
 */
export default function StyleEditor({ widget, set }) {
  const style = { ...DEFAULT_WIDGET_STYLE, ...(widget.style || {}) }
  const resolved = resolveStyle(style)

  const setStyle = (patch) => set({ style: { ...style, ...patch } })

  // A colour input can't express "unset", so each swatch is paired with a
  // clear button and shows the theme's own value until it's overridden.
  const colorField = (label, key, fallback) => (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={style[key] || resolved?.[key] || fallback}
          onChange={(e) => setStyle({ [key]: e.target.value })}
          className="h-[30px] w-full rounded-lg border border-slate-200"
        />
        {style[key] && (
          <button
            onClick={() => setStyle({ [key]: null })}
            className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
            title="Back to theme default"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </Field>
  )

  const numberField = (label, key, placeholder, hint) => (
    <Field label={label} hint={hint}>
      <TextInput
        type="number"
        value={style[key] ?? ''}
        onChange={(v) => setStyle({ [key]: v === '' ? null : Number(v) })}
        placeholder={placeholder}
      />
    </Field>
  )

  return (
    <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/40 p-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[11px] font-medium text-violet-700">
          <Palette size={11} /> Appearance
        </p>
        {resolved && (
          <button
            onClick={() => set({ style: { ...DEFAULT_WIDGET_STYLE } })}
            className="inline-flex items-center gap-1 text-[10px] text-slate-500 underline hover:text-slate-700"
          >
            <RotateCcw size={10} /> Reset to system theme
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Theme" hint="A starting point you can then override.">
          <Select
            value={style.theme || ''}
            onChange={(v) => setStyle({ theme: v })}
            options={WIDGET_THEMES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </Field>
        {colorField('Background', 'bg', '#FFFFFF')}
        {colorField('Border colour', 'borderColor', '#E2E8F0')}
        <Field label="Shadow">
          <Select
            value={style.shadow || ''}
            onChange={(v) => setStyle({ shadow: v || null })}
            options={[{ value: '', label: 'Theme default' }, ...SHADOW_LEVELS]}
          />
        </Field>

        {numberField('Border thickness', 'borderWidth', 'px', '0 removes the border')}
        {numberField('Corner radius', 'radius', 'px')}
        {numberField('Inner padding', 'padding', 'px')}
        {colorField('Accent', 'accent', '#4F46E5')}
      </div>

      {/* Text is not one field. It is the colour of the headings, the
          colour of the captions, the typeface, the weight, the letter
          spacing, the alignment and the size -- and the widget's own
          controls take all of it too. */}
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-violet-100 bg-white/60 p-2">
          <TypographyFields value={style} onChange={(patch) => setStyle(patch)} />
        </div>

        {/* A chart is two kinds of writing in one picture, read differently:
            an axis is glanced at while reading a value off the chart, a
            legend is read once and deliberately. One control for both would
            mean enlarging a legend enlarged forty axis ticks with it. */}
        {hasChartText(widget.type) && (
          <div className="space-y-2 rounded-lg border border-violet-100 bg-white/60 p-2">
            <MarkTextFields
              label="Chart text"
              hint="Axis ticks, axis titles, and a pie's labels."
              value={style.chartText}
              onChange={(v) => setStyle({ chartText: v })}
            />
            <MarkTextFields
              label="Legend"
              hint="The key, on its own — read once and deliberately, so almost never the same size as an axis."
              value={style.legendText}
              onChange={(v) => setStyle({ legendText: v })}
            />
          </div>
        )}
      </div>

      {/* The text is one decision and the DRAWING is another: the grid, the
          axes, the tooltip, how solid a bar is, and the writing that sits
          on the marks rather than beside them. */}
      {hasChartText(widget.type) && (
        <div className="mt-2 rounded-lg border border-violet-100 bg-white/60 p-2">
          <ChartVisualFields value={style.chartVisuals} onChange={(v) => setStyle({ chartVisuals: v })} />
        </div>
      )}

      {/* A live sample, because reading six numbers back as a card in your
          head is exactly the thing a preview should do for you. It is drawn
          from the same two functions the page uses, so the preview cannot
          drift from the thing it is previewing. */}
      <div className="mt-2 flex items-center gap-3">
        <span className="text-[10px] text-slate-400">Preview</span>
        <div className={`flex-1 ${styleClass(style)}`} style={styleVars(style)}>
          <div className="card !py-2">
            <p className="text-xs font-semibold text-slate-800">{widget.title || 'Widget title'}</p>
            <p className="text-[10px] text-slate-400">This is how the card will look</p>
          </div>
        </div>
      </div>
    </div>
  )
}
