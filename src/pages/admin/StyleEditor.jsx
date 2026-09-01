import { Clipboard, ClipboardCheck, Copy, Palette, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import {
  DEFAULT_WIDGET_STYLE,
  SHADOW_LEVELS,
  TRANSPARENT,
  WIDGET_THEMES,
  resolveStyle,
  styleClass,
  styleVars,
} from '../../lib/widgetStyle'
import { Btn, Field, Select, TextInput, Toggle } from './ui.jsx'
import { copiedLook, copyLook, hasCopiedLook } from '../../lib/lookClipboard'
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
  // Only to re-render after a copy -- the look itself lives outside React,
  // because it has to survive closing one widget's editor and opening
  // another's, which is the whole point of copying it.
  const [copiedAt, setCopiedAt] = useState(0)

  const setStyle = (patch) => set({ style: { ...style, ...patch } })

  // A colour input can't express "unset", so each swatch is paired with a
  // clear button and shows the theme's own value until it's overridden.
  const colorField = (label, key, fallback) => {
    const clear = style[key] === TRANSPARENT
    return (
      <Field label={label}>
        <div className="flex items-center gap-1">
          {/* A colour input cannot say "none", and absence already means
              something else here -- every field defaults to null for
              "inherit the theme". So transparency is its own button. */}
          {clear ? (
            <button
              onClick={() => setStyle({ [key]: fallback })}
              title="Transparent — click to pick a colour"
              className="h-[30px] w-full rounded-lg border border-slate-200 text-[10px] font-medium text-slate-400"
              style={{
                backgroundImage:
                  'linear-gradient(45deg,#e2e8f0 25%,transparent 25%,transparent 75%,#e2e8f0 75%),' +
                  'linear-gradient(45deg,#e2e8f0 25%,transparent 25%,transparent 75%,#e2e8f0 75%)',
                backgroundSize: '10px 10px',
                backgroundPosition: '0 0, 5px 5px',
              }}
            >
              none
            </button>
          ) : (
            <input
              type="color"
              value={style[key] || resolved?.[key] || fallback}
              onChange={(e) => setStyle({ [key]: e.target.value })}
              className="h-[30px] w-full rounded-lg border border-slate-200"
            />
          )}
          <button
            onClick={() => setStyle({ [key]: clear ? null : TRANSPARENT })}
            className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
              clear ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:bg-slate-100'
            }`}
            title="No colour at all"
          >
            none
          </button>
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
  }

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
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Copy and paste, because the alternative is setting the same six
              fields on eleven widgets by hand and getting one of them
              slightly wrong. The clipboard is not persisted: it is for the
              next few minutes of work, not for next week. */}
          <Btn
            onClick={() => {
              copyLook(style)
              setCopiedAt(Date.now())
            }}
            title="Copy this look"
          >
            {copiedAt ? <ClipboardCheck size={11} /> : <Copy size={11} />} Copy
          </Btn>
          {hasCopiedLook() && (
            <Btn
              onClick={() => set({ style: { ...DEFAULT_WIDGET_STYLE, ...copiedLook() } })}
              title="Paste the copied look over this one"
            >
              <Clipboard size={11} /> Paste
            </Btn>
          )}
          {resolved && (
            <button
              onClick={() => set({ style: { ...DEFAULT_WIDGET_STYLE } })}
              className="inline-flex items-center gap-1 text-[10px] text-slate-500 underline hover:text-slate-700"
            >
              <RotateCcw size={10} /> Reset to system theme
            </button>
          )}
        </div>
      </div>

      {/* A dark card needs light text, and until now nothing anywhere in
          the editor could say so: `invert` was read by the renderer and had
          no switch. Offered only once a background has been chosen, because
          on the stock near-white surface it makes the card unreadable. */}
      {style.bg && (
        <div className="mb-1.5">
          <Toggle
            checked={style.invert}
            onChange={(v) => setStyle({ invert: v })}
            label="Light text (for a dark card)"
          />
        </div>
      )}

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
