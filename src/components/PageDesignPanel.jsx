import { useState } from 'react'
import { Columns3, Layout, Palette, RotateCcw, Type, X } from 'lucide-react'
import {
  COLUMN_CHOICES,
  DEFAULT_DESIGN,
  PACKING_MODES,
  GAP_MAX,
  GAP_MIN,
  SCALE_MAX,
  SCALE_MIN,
  clampDesign,
  isDefaultDesign,
} from '../lib/pageDesign'
import { WIDGET_THEMES } from '../lib/widgetStyle'

/**
 * A page's whole appearance, edited on the page.
 *
 * The admin panel is where a page is BUILT. It is the wrong place to decide
 * how one LOOKS, because looking at it is the only way to tell -- and a form
 * on another screen means changing a number, saving, navigating back,
 * squinting, and going round again.
 *
 * So this floats over the canvas it is changing, and every control takes
 * effect on the spot: the gaps, the column count, the text size, the card
 * surface, the backdrop. Nothing is applied on a Save that has to be
 * imagined first.
 *
 * Nothing is written until Save, though. A design being fiddled with is not
 * a design the other forty people looking at this page should be watching
 * change under them.
 */
const SWATCHES = [
  { label: 'None', value: null },
  { label: 'Paper', value: '#FFFDF7' },
  { label: 'Mist', value: '#F8FAFC' },
  { label: 'Sky', value: '#F0F7FF' },
  { label: 'Sage', value: '#F3F8F4' },
  { label: 'Sand', value: '#FBF7F0' },
  { label: 'Slate', value: '#EEF2F7' },
]

export default function PageDesignPanel({ design, theme, onChange, onThemeChange, onSave, onClose, saving, dirty }) {
  const d = clampDesign(design)
  const [tab, setTab] = useState('layout')
  const set = (patch) => onChange({ ...d, ...patch })

  return (
    <div className="page-chrome fixed bottom-3 right-3 z-50 w-[19rem] rounded-2xl border border-slate-200 bg-white/97 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5">
        <Palette size={13} className="text-indigo-500" />
        <span className="text-xs font-semibold text-slate-700">Design this page</span>
        {dirty && <span className="rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-700">unsaved</span>}
        <button onClick={onClose} className="ml-auto text-slate-300 hover:text-rose-500" title="Close">
          <X size={13} />
        </button>
      </div>

      <div className="flex gap-1 px-2 pt-2">
        {[
          { key: 'layout', label: 'Layout', icon: Layout },
          { key: 'surface', label: 'Cards', icon: Columns3 },
          { key: 'text', label: 'Text', icon: Type },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ${
              tab === t.key ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <t.icon size={11} /> {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-[54vh] space-y-2.5 overflow-y-auto p-2.5">
        {tab === 'layout' && (
          <>
            {/* First, because it is the one that decides whether the page
                reads in the order it was built in. */}
            <Row label="How widgets pack">
              <div className="flex gap-1">
                {PACKING_MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => set({ packing: m.value })}
                    title={m.hint}
                    className={`flex-1 rounded border px-1.5 py-1 text-[11px] ${
                      d.packing === m.value
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {PACKING_MODES.find((m) => m.value === d.packing)?.hint}
              </p>
            </Row>

            <label className="flex items-start gap-1.5">
              <input
                type="checkbox"
                checked={d.snapWidths}
                onChange={(e) => set({ snapWidths: e.target.checked })}
                className="mt-0.5 h-3 w-3"
              />
              <span>
                <span className="text-[11px] font-medium text-slate-600">Widths fill their columns</span>
                <span className="block text-[10px] text-slate-400">
                  A widget pinned to 260px on a canvas of 316px columns leaves 56px beside it that nothing can
                  ever fill. Three in a row is a strip of nothing. This closes it.
                </span>
              </span>
            </label>

            <Slider
              label="Gap across"
              hint="Between widgets, left to right"
              value={d.gapX}
              min={GAP_MIN}
              max={GAP_MAX}
              onChange={(v) => set({ gapX: v })}
              unit="px"
            />
            <Slider
              label="Gap down"
              hint="Between rows. Not the same decision as across."
              value={d.gapY}
              min={GAP_MIN}
              max={GAP_MAX}
              onChange={(v) => set({ gapY: v })}
              unit="px"
            />

            <Row label="Columns" hint="What the canvas is divided into. Every width is a fraction of this.">
              <div className="flex gap-1">
                {COLUMN_CHOICES.map((c) => (
                  <button
                    key={c}
                    onClick={() => set({ columns: c })}
                    className={`flex-1 rounded border px-1 py-0.5 text-[11px] tabular-nums ${
                      d.columns === c
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </Row>

            <Slider
              label="Canvas width"
              hint="0 means all of the screen."
              value={d.maxWidth}
              min={0}
              max={2400}
              step={40}
              onChange={(v) => set({ maxWidth: v })}
              unit={d.maxWidth === 0 ? '' : 'px'}
              format={(v) => (v === 0 ? 'full' : v)}
            />
          </>
        )}

        {tab === 'surface' && (
          <>
            <Row label="Card look" hint="A starting point. A widget that sets its own still wins.">
              <select
                value={theme || ''}
                onChange={(e) => onThemeChange(e.target.value)}
                className="w-full rounded border border-slate-200 px-1.5 py-1 text-[11px] text-slate-600"
              >
                {WIDGET_THEMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Row>

            <Slider
              label="Corner radius"
              value={d.cardRadius ?? 16}
              min={0}
              max={40}
              onChange={(v) => set({ cardRadius: v })}
              unit="px"
              onClear={d.cardRadius === null ? undefined : () => set({ cardRadius: null })}
            />
            <Slider
              label="Card padding"
              value={d.cardPadding ?? 16}
              min={0}
              max={40}
              onChange={(v) => set({ cardPadding: v })}
              unit="px"
              onClear={d.cardPadding === null ? undefined : () => set({ cardPadding: null })}
            />

            <Row label="Card colour">
              <div className="flex flex-wrap gap-1">
                {SWATCHES.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => set({ cardBg: s.value })}
                    className={`h-6 w-6 rounded border ${
                      (d.cardBg || null) === s.value ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-slate-200'
                    }`}
                    style={{ backgroundColor: s.value || 'transparent' }}
                    title={s.label}
                  >
                    {s.value === null && <span className="text-[9px] text-slate-400">—</span>}
                  </button>
                ))}
                <input
                  type="color"
                  value={d.cardBg || '#ffffff'}
                  onChange={(e) => set({ cardBg: e.target.value })}
                  className="h-6 w-6 cursor-pointer rounded border border-slate-200 bg-white p-0"
                  title="Any colour"
                />
              </div>
            </Row>

            <Row label="Card border">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={d.cardBorder || '#e2e8f0'}
                  onChange={(e) => set({ cardBorder: e.target.value })}
                  className="h-6 w-6 cursor-pointer rounded border border-slate-200 bg-white p-0"
                />
                {d.cardBorder && (
                  <button onClick={() => set({ cardBorder: null })} className="text-[10px] text-slate-400 underline">
                    clear
                  </button>
                )}
              </div>
            </Row>
          </>
        )}

        {tab === 'text' && (
          <Slider
            label="Text size"
            hint="Everything scales together — the same design, bigger."
            value={Math.round(d.fontScale * 100)}
            min={Math.round(SCALE_MIN * 100)}
            max={Math.round(SCALE_MAX * 100)}
            step={5}
            onChange={(v) => set({ fontScale: v / 100 })}
            unit="%"
          />
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-slate-100 px-2 py-1.5">
        <button
          onClick={() => onChange({ ...DEFAULT_DESIGN })}
          disabled={isDefaultDesign(d)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-1 text-[10px] text-slate-500 hover:bg-slate-50 disabled:opacity-30"
          title="Back to the stock design"
        >
          <RotateCcw size={11} /> Reset
        </button>
        <span className="ml-auto" />
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save for everyone'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-600">{label}</p>
      {hint && <p className="mb-1 text-[10px] text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}

function Slider({ label, hint, value, min, max, step = 1, unit = '', onChange, onClear, format }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <p className="text-[11px] font-medium text-slate-600">{label}</p>
        <span className="ml-auto text-[11px] font-semibold tabular-nums text-slate-700">
          {format ? format(value) : value}
          {unit}
        </span>
        {onClear && (
          <button onClick={onClear} className="text-[10px] text-slate-400 underline" title="Back to inherited">
            auto
          </button>
        )}
      </div>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 w-full accent-indigo-600"
        aria-label={label}
      />
    </div>
  )
}
