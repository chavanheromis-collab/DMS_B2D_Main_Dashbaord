import { PALETTE } from '../../lib/config'
import { COUNTDOWN_MODES, COUNTDOWN_UNITS } from '../../lib/countdown'
import { CALLOUT_TONES, MEDIA_FITS, NOTE_STYLES } from '../../components/widgets/CanvasWidgets.jsx'
import { safeImageUrl } from '../../lib/imageUrl'
import { plainText } from '../../lib/richText'
import { Field, Select, TextInput, Toggle } from './ui.jsx'
import EmojiPicker from './EmojiPicker.jsx'

// =====================================================================
// Editors for the three widgets that carry no data
// =====================================================================
// No tab, no calculation, no conditions. What these need instead is the
// thing the data widgets never do: somewhere to type.

function ColorInput({ value, onChange, fallback = PALETTE[0] }) {
  return (
    <input
      type="color"
      value={value || fallback}
      onChange={(e) => onChange(e.target.value)}
      className="h-[30px] w-full rounded-lg border border-slate-200"
    />
  )
}

const ALIGNMENTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centred' },
  { value: 'right', label: 'Right' },
]

// =====================================================================
// Note
// =====================================================================
export function NoteEditor({ widget, set }) {
  const style = widget.noteStyle || 'plain'
  const chosen = NOTE_STYLES.find((s) => s.value === style)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Kind" hint={chosen?.hint}>
          <Select value={style} onChange={(v) => set({ noteStyle: v })} options={NOTE_STYLES} />
        </Field>
        <Field label={style === 'quote' ? 'Attributed to' : 'Heading'} hint="Leave blank for text on its own.">
          <TextInput value={widget.title || ''} onChange={(v) => set({ title: v })} placeholder="What this section is" />
        </Field>
        <Field label="Icon" hint="An emoji. Optional.">
          <EmojiPicker value={widget.icon || ''} onChange={(v) => set({ icon: v })} placeholder="📌" />
        </Field>
        <Field label="Align">
          <Select value={widget.align || 'left'} onChange={(v) => set({ align: v })} options={ALIGNMENTS} />
        </Field>
      </div>

      {style === 'callout' && (
        <Field label="Tone" className="max-w-xs">
          <Select value={widget.tone || 'info'} onChange={(v) => set({ tone: v })} options={CALLOUT_TONES} />
        </Field>
      )}

      {(style === 'banner' || style === 'quote') && (
        <Field label={style === 'banner' ? 'Banner colour' : 'Rule colour'} className="max-w-[7rem]">
          <ColorInput value={widget.color} onChange={(v) => set({ color: v })} />
        </Field>
      )}

      <div>
        <span className="mb-1 block text-[11px] font-medium text-slate-500">The text</span>
        <textarea
          value={widget.text || ''}
          onChange={(e) => set({ text: e.target.value })}
          rows={8}
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs leading-relaxed"
          placeholder={'# A heading\n\nSome **bold** text and a [link](https://example.com).\n\n- a bullet\n- another\n- [ ] something to do'}
        />
        <p className="mt-1 text-[10px] text-slate-400">
          <code className="rounded bg-slate-100 px-1"># heading</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">**bold**</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">*italic*</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">~~struck~~</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">`code`</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">- bullet</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">1. numbered</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">- [ ] to do</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">&gt; quote</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">---</code> ·{' '}
          <code className="rounded bg-slate-100 px-1">[text](url)</code>
        </p>
        {/* Nothing here is ever turned into HTML -- the text is rendered as
            real elements from parsed tokens, so a pasted script tag is a
            pasted script tag and never a running one. Worth saying, because
            an admin pasting from a web page will otherwise wonder why the
            markup came out as words. */}
        <p className="mt-1 text-[10px] text-slate-400">
          Anything else is shown as plain text — HTML is never interpreted, so a note cannot run code in anybody’s
          browser.
        </p>
      </div>
    </div>
  )
}

// =====================================================================
// Image / media
// =====================================================================
export function MediaEditor({ widget, set }) {
  const url = safeImageUrl(widget.imageUrl)
  const typed = String(widget.imageUrl || '').trim()

  return (
    <div className="space-y-2">
      <Field
        label="Image link"
        hint="Any https image URL, or a Google Drive share link — Drive links are rewritten so they actually load."
      >
        <TextInput
          value={widget.imageUrl || ''}
          onChange={(v) => set({ imageUrl: v })}
          placeholder="https://… or a Drive share link"
        />
      </Field>

      {typed && !url && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
          That link isn’t one this can load. It needs to be an <code>https</code> image URL or a Google Drive share
          link.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Heading" hint="Leave blank for the picture on its own.">
          <TextInput value={widget.title || ''} onChange={(v) => set({ title: v })} placeholder="Showroom layout" />
        </Field>
        <Field label="Caption">
          <TextInput value={widget.caption || ''} onChange={(v) => set({ caption: v })} placeholder="Updated March" />
        </Field>
        <Field label="How it fits">
          <Select value={widget.fit || 'contain'} onChange={(v) => set({ fit: v })} options={MEDIA_FITS} />
        </Field>
        <Field label="Height (px)" hint="Blank keeps the image’s own proportions.">
          <TextInput
            type="number"
            value={widget.imageHeight ?? ''}
            onChange={(v) => set({ imageHeight: v === '' ? '' : Number(v) })}
            placeholder="auto"
          />
        </Field>
      </div>

      <Field
        label="Description for screen readers"
        hint="What the picture shows. Leave blank only if it is purely decorative."
      >
        <TextInput value={widget.alt || ''} onChange={(v) => set({ alt: v })} placeholder="Floor plan of the main showroom" />
      </Field>

      <div className="flex flex-wrap gap-3">
        <Toggle
          checked={widget.bare}
          onChange={(v) => set({ bare: v })}
          label="No card around it (for a logo or a divider)"
        />
        <Toggle
          checked={widget.rounded !== false}
          onChange={(v) => set({ rounded: v })}
          label="Rounded corners"
        />
      </div>

      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
        Pictures only — not an embed. An embedded page would run another site’s code inside every reader’s session,
        which is not a trade worth making to show a floor plan.
      </p>
    </div>
  )
}

// =====================================================================
// Countdown / clock
// =====================================================================
export function CountdownEditor({ widget, set }) {
  const mode = widget.mode || 'until'
  const isClock = mode === 'clock'

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="This shows">
          <Select value={mode} onChange={(v) => set({ mode: v })} options={COUNTDOWN_MODES} />
        </Field>

        {!isClock && (
          <Field
            label={mode === 'since' ? 'Counting up from' : 'Counting down to'}
            hint="A date alone means the end of that day."
          >
            <TextInput
              type={String(widget.target || '').includes('T') ? 'datetime-local' : 'date'}
              value={widget.target || ''}
              onChange={(v) => set({ target: v })}
            />
          </Field>
        )}

        <Field label="Label" hint="Shown above the number.">
          <TextInput
            value={widget.label || ''}
            onChange={(v) => set({ label: v })}
            placeholder={mode === 'since' ? 'Days without an incident' : 'Left in the quarter'}
          />
        </Field>

        <Field label="Size">
          <Select
            value={widget.size || 'large'}
            onChange={(v) => set({ size: v })}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'large', label: 'Large' },
              { value: 'huge', label: 'Huge — for a wall screen' },
            ]}
          />
        </Field>
      </div>

      {!isClock && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Units" hint="“Whatever fits” drops the seconds on anything more than a day out.">
              <Select value={widget.units || 'auto'} onChange={(v) => set({ units: v })} options={COUNTDOWN_UNITS} />
            </Field>
            <Field label="Colour">
              <ColorInput value={widget.color} onChange={(v) => set({ color: v })} />
            </Field>
            {mode === 'until' && (
              <Field label="When it is over, say">
                <TextInput
                  value={widget.doneLabel ?? 'Time’s up'}
                  onChange={(v) => set({ doneLabel: v })}
                  placeholder="Time’s up"
                />
              </Field>
            )}
          </div>

          {mode === 'until' && (
            <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-2">
              <p className="mb-1 text-[11px] font-medium text-amber-700">
                Change colour as it gets close — the one place a colour change is information
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="“Soon” under (days)">
                  <TextInput type="number" value={widget.warnDays ?? 7} onChange={(v) => set({ warnDays: Number(v) })} />
                </Field>
                <Field label="Soon colour">
                  <ColorInput value={widget.warnColor} onChange={(v) => set({ warnColor: v })} fallback="#D97706" />
                </Field>
                <Field label="“Now” under (days)">
                  <TextInput type="number" value={widget.dangerDays ?? 2} onChange={(v) => set({ dangerDays: Number(v) })} />
                </Field>
                <Field label="Now colour">
                  <ColorInput value={widget.dangerColor} onChange={(v) => set({ dangerColor: v })} fallback="#DC2626" />
                </Field>
              </div>
            </div>
          )}
        </>
      )}

      {isClock && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Clock">
            <Select
              value={widget.clockFormat || '24'}
              onChange={(v) => set({ clockFormat: v })}
              options={[
                { value: '24', label: '24 hour (17:04)' },
                { value: '12', label: '12 hour (5:04 PM)' },
              ]}
            />
          </Field>
          <Field label="Colour">
            <ColorInput value={widget.color} onChange={(v) => set({ color: v })} />
          </Field>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Toggle checked={widget.showDate !== false} onChange={(v) => set({ showDate: v })} label="Show the date" />
        {isClock && (
          <>
            <Toggle
              checked={widget.showWeekday !== false}
              onChange={(v) => set({ showWeekday: v })}
              label="Show the weekday"
            />
            <Toggle
              checked={widget.showSeconds !== false}
              onChange={(v) => set({ showSeconds: v })}
              label="Show seconds"
            />
          </>
        )}
      </div>

      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
        {isClock
          ? 'Redraws every second.'
          : 'Redraws only as often as a digit can change — once a minute at a day out, once a day at a month out.'}{' '}
        Times are this browser’s, not the server’s.
      </p>

      {plainText(widget.label || '') === '' && !isClock && !widget.target && (
        <p className="text-[10px] text-amber-600">Pick a date, or this shows nothing.</p>
      )}
    </div>
  )
}
