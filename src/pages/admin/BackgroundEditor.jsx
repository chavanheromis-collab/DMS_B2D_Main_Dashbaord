import { Image as ImageIcon, RotateCcw } from 'lucide-react'
import {
  BACKGROUND_MODES,
  BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND,
  IMAGE_FITS,
  IMAGE_POSITIONS,
  TEXT_MODES,
  backgroundIsSet,
  backgroundPreviewStyle,
  usesLightText,
} from '../../lib/pageBackground'
import { isDriveUrl, safeImageUrl } from '../../lib/imageUrl'
import { Field, Select, TextInput, Toggle } from './ui.jsx'

/**
 * The page's canvas backdrop.
 *
 * Every control defaults to "app default" and stays there until touched, so
 * a page nobody has restyled stores no background at all and looks exactly
 * as it always did.
 */
export default function BackgroundEditor({ background, onChange }) {
  const bg = { ...DEFAULT_BACKGROUND, ...(background || {}) }
  const set = (patch) => onChange({ ...bg, ...patch })
  const isSet = backgroundIsSet(bg)

  const urlOk = bg.mode !== 'image' || !bg.imageUrl || Boolean(safeImageUrl(bg.imageUrl))

  const slider = (label, key, max, suffix = '%') => (
    <Field label={`${label} — ${bg[key]}${suffix}`}>
      <input
        type="range"
        min={0}
        max={max}
        value={bg[key]}
        onChange={(e) => set({ [key]: Number(e.target.value) })}
        className="w-full accent-indigo-500"
      />
    </Field>
  )

  return (
    <div className="rounded-lg border border-sky-100 bg-sky-50/40 p-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[11px] font-medium text-sky-700">
          <ImageIcon size={11} /> Canvas background
        </p>
        {isSet && (
          <button
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 text-[10px] text-slate-500 underline hover:text-slate-700"
          >
            <RotateCcw size={10} /> Back to app default
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <Field label="Style" hint={BACKGROUND_MODES.find((m) => m.value === bg.mode)?.hint}>
          <Select value={bg.mode || ''} onChange={(v) => set({ mode: v })} options={BACKGROUND_MODES} />
        </Field>

        {bg.mode === 'color' && (
          <Field label="Colour">
            <input
              type="color"
              value={bg.color}
              onChange={(e) => set({ color: e.target.value })}
              className="h-[30px] w-full rounded-lg border border-slate-200"
            />
          </Field>
        )}

        {bg.mode === 'gradient' && (
          <>
            <Field label="From">
              <input
                type="color"
                value={bg.gradientFrom}
                onChange={(e) => set({ gradientFrom: e.target.value })}
                className="h-[30px] w-full rounded-lg border border-slate-200"
              />
            </Field>
            <Field label="To">
              <input
                type="color"
                value={bg.gradientTo}
                onChange={(e) => set({ gradientTo: e.target.value })}
                className="h-[30px] w-full rounded-lg border border-slate-200"
              />
            </Field>
            <Field label={`Angle — ${bg.angle}°`}>
              <input
                type="range"
                min={0}
                max={360}
                value={bg.angle}
                onChange={(e) => set({ angle: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </Field>
          </>
        )}

        {bg.mode === 'image' && (
          <>
            <Field
              label="Image URL"
              className="md:col-span-2"
              hint={
                isDriveUrl(bg.imageUrl)
                  ? '✓ Google Drive link — make sure it’s shared “Anyone with the link”.'
                  : 'A Google Drive share link works, or any https:// image.'
              }
            >
              <TextInput
                value={bg.imageUrl}
                onChange={(v) => set({ imageUrl: v })}
                placeholder="https://drive.google.com/file/d/…/view"
              />
            </Field>
            <Field label="Fit">
              <Select value={bg.imageFit} onChange={(v) => set({ imageFit: v })} options={IMAGE_FITS} />
            </Field>
            <Field label="Position">
              <Select
                value={bg.imagePosition}
                onChange={(v) => set({ imagePosition: v })}
                options={IMAGE_POSITIONS}
              />
            </Field>
          </>
        )}
      </div>

      {bg.mode === 'image' && !urlOk && (
        <p className="mt-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
          That doesn’t look like an image link. Google Drive share links and any <code>https://</code> or{' '}
          <code>data:image/</code> URL are accepted; they can’t contain spaces or quotes. The page falls back to the
          app default until it’s valid.
        </p>
      )}

      {bg.mode && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            {slider('Visibility', 'opacity', 100)}
            {slider('Blur', 'blur', 40, 'px')}
            <Field label="Dim / tint">
              <input
                type="color"
                value={bg.overlayColor}
                onChange={(e) => set({ overlayColor: e.target.value })}
                className="h-[30px] w-full rounded-lg border border-slate-200"
              />
            </Field>
            {slider('Tint strength', 'overlayOpacity', 100)}
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <Field
              label="Page text colour"
              hint={
                bg.mode === 'image'
                  ? 'Automatic can’t read an image — pick one that suits your photo.'
                  : TEXT_MODES.find((m) => m.value === (bg.textMode || 'auto'))?.hint
              }
            >
              <Select
                value={bg.textMode || 'auto'}
                onChange={(v) => set({ textMode: v })}
                options={TEXT_MODES}
              />
            </Field>
            <div className="flex items-end pb-1.5">
              <p className="text-[10px] text-slate-500">
                Headings, tabs and control bars will use{' '}
                <strong className="text-slate-700">{usesLightText(bg) ? 'light' : 'dark'}</strong> text. Widget cards
                keep their own surface and are unaffected.
              </p>
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <Toggle
              checked={bg.fixed !== false}
              onChange={(v) => set({ fixed: v })}
              label="Hold still while the page scrolls"
            />
            <p className="text-[10px] text-slate-400">
              Visibility and blur affect the backdrop only — widgets stay fully sharp and opaque.
            </p>
          </div>

          {bg.mode === 'image' && bg.overlayOpacity < 20 && (
            <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
              💡 A photo behind a dashboard usually needs a tint to stay readable. Try a white tint around 40–60%, or
              drop Visibility instead.
            </p>
          )}
        </>
      )}

      {/* --- Presets + preview ---------------------------------------- */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-slate-400">Presets</span>
        {BACKGROUND_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => set({ ...DEFAULT_BACKGROUND, ...preset })}
            className="h-6 w-10 rounded border border-slate-200 transition-transform hover:scale-105"
            style={backgroundPreviewStyle({ ...DEFAULT_BACKGROUND, ...preset })}
            title={preset.label}
          />
        ))}

        <span className="ml-auto text-[10px] text-slate-400">Preview</span>
        <div
          className="h-10 w-40 rounded-lg border border-slate-200"
          // Uses the same resolver the page does, so the swatch can't drift
          // out of step with what actually gets painted.
          style={backgroundPreviewStyle(bg)}
        />
      </div>
    </div>
  )
}
