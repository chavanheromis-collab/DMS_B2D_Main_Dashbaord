import { X } from 'lucide-react'
import {
  CARD_FONTS,
  DEFAULT_MARK_TEXT,
  MARK_SIZE_MAX,
  MARK_SIZE_MIN,
  TEXT_ALIGNS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TRACKING_LEVELS,
  WEIGHTS,
  clearTypography,
  hasMarkText,
  hasTypography,
} from '../lib/typography'

/**
 * Who decides what the text looks like: colour, typeface, weight, spacing,
 * alignment and size.
 *
 * One component in three places -- the paint panel on the widget, the style
 * editor in the admin panel, and the page design panel -- because three
 * implementations of the same seven fields would disagree about one of them
 * within a month, and the one they disagreed about would be the one nobody
 * noticed until an admin set it in the wrong place.
 *
 * Every field starts at "inherit" and says so. Clearing one hands it back to
 * whatever is above it -- the page for a widget, the app for a page -- which
 * is not the same as setting it to what that currently happens to be.
 */
export default function TypographyFields({ value, onChange, showSize = true, title = 'Text' }) {
  const t = value || {}
  const set = (patch) => onChange(patch)
  const scale = Number(t.textScale) > 0 ? Number(t.textScale) : 1

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5">
        <p className="text-[11px] font-medium text-slate-600">{title}</p>
        {hasTypography(t) && (
          <button
            onClick={() => onChange(clearTypography(t))}
            className="ml-auto text-[10px] text-slate-400 underline hover:text-rose-500"
            title="Every text setting back to inherited"
          >
            all inherited
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {/* Headings, values, table cells -- the strong greys. */}
        <Swatch label="Text" value={t.text} fallback="#0f172a" onChange={(v) => set({ text: v })} />
        {/* Captions, axis labels, "3 of 120" -- the quiet ones. Its own
            field, so choosing a heading colour does not flatten the
            hierarchy the two greys exist to create. */}
        <Swatch label="Muted" value={t.textMuted} fallback="#64748b" onChange={(v) => set({ textMuted: v })} />
      </div>

      <Picker label="Font" value={t.font} options={CARD_FONTS} onChange={(v) => set({ font: v || null })} />
      <Picker label="Weight" value={t.weight} options={WEIGHTS} onChange={(v) => set({ weight: v || null })} />
      <Picker
        label="Spacing"
        value={t.tracking}
        options={TRACKING_LEVELS}
        onChange={(v) => set({ tracking: v || null })}
      />
      <Picker label="Align" value={t.align} options={TEXT_ALIGNS} onChange={(v) => set({ align: v || null })} />

      {showSize && (
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-slate-500">Size</span>
            <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-600">
              {t.textScale ? `${Math.round(scale * 100)}%` : 'inherit'}
            </span>
            {t.textScale && (
              <button
                onClick={() => set({ textScale: null })}
                className="text-[10px] text-slate-400 underline"
                title="Back to the page's size"
              >
                auto
              </button>
            )}
          </div>
          <input
            type="range"
            min={Math.round(TEXT_SCALE_MIN * 100)}
            max={Math.round(TEXT_SCALE_MAX * 100)}
            step={5}
            value={Math.round(scale * 100)}
            onChange={(e) => set({ textScale: Number(e.target.value) / 100 })}
            className="w-full accent-indigo-600"
            aria-label="Text size"
          />
        </div>
      )}
    </div>
  )
}

function Picker({ label, value, options, onChange }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] text-slate-500">{label}</span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
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
 * One of a chart's two kinds of text.
 *
 * Fewer fields than a card's, because the rest do not mean anything here:
 * there is no muted grey in an axis, and aligning an axis tick is the
 * axis's job. A size in pixels rather than a percentage, because what is
 * being sized is a fontSize the chart set element by element -- 11 for a
 * tick, 9 for a radius axis -- and a multiplier over several different
 * bases is a number nobody can predict the result of.
 */
export function MarkTextFields({ label, hint, value, onChange }) {
  const t = value || {}
  const set = (patch) => onChange({ ...DEFAULT_MARK_TEXT, ...t, ...patch })

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5">
        <p className="text-[11px] font-medium text-slate-600">{label}</p>
        {hasMarkText(t) && (
          <button
            onClick={() => onChange({ ...DEFAULT_MARK_TEXT })}
            className="ml-auto text-[10px] text-slate-400 underline hover:text-rose-500"
            title="Back to whatever the chart draws by default"
          >
            inherited
          </button>
        )}
      </div>
      {hint && <p className="text-[10px] leading-relaxed text-slate-400">{hint}</p>}

      <div className="flex items-center gap-1.5">
        <Swatch label="Colour" value={t.text} fallback="#475569" onChange={(v) => set({ text: v })} />
        <label className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500">Size</span>
          <input
            type="number"
            min={MARK_SIZE_MIN}
            max={MARK_SIZE_MAX}
            value={t.size ?? ''}
            placeholder="auto"
            onChange={(e) => set({ size: e.target.value === '' ? null : Number(e.target.value) })}
            className="w-14 rounded border border-slate-200 px-1 py-0.5 text-center text-[11px] tabular-nums"
            aria-label={`${label} size in pixels`}
          />
          <span className="text-[10px] text-slate-400">px</span>
        </label>
      </div>

      <Picker label="Font" value={t.font} options={CARD_FONTS} onChange={(v) => set({ font: v || null })} />
      <Picker label="Weight" value={t.weight} options={WEIGHTS} onChange={(v) => set({ weight: v || null })} />
    </div>
  )
}
