import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { Plus, Sparkles } from 'lucide-react'
import { db } from '../../firebase'
import {
  DEFAULT_ENTRANCE,
  ITEM_KINDS,
  emptyEntranceItem,
  itemIsLive,
  kindMeta,
  liveEntranceItems,
} from '../../lib/branding'
import { BRAND_NAME, BRAND_TAGLINE } from '../../components/SplashScreen.jsx'
import { stripUndefined } from '../../lib/firestoreSafe'
import { isDriveUrl, safeImageUrl } from '../../lib/imageUrl'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps, stableEqual } from './ui.jsx'

/**
 * The entrance animation's content: the wordmark, and the campaigns,
 * achievements and notices that greet everyone on their way in.
 *
 * All of it lives in one `settings/entrance` document, so this panel is a
 * single load-edit-save form rather than a collection editor.
 */
export default function EntrancePanel() {
  const [live, setLive] = useState(null)
  const [draft, setDraft] = useState(DEFAULT_ENTRANCE)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(
    () =>
      onSnapshot(doc(db, 'settings', 'entrance'), (snap) => {
        const data = snap.exists() ? { ...DEFAULT_ENTRANCE, ...snap.data() } : DEFAULT_ENTRANCE
        setLive(data)
        setDraft(data)
      }),
    []
  )

  const dirty = live !== null && !stableEqual(draft, live)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const ops = listOps(draft.items || [], (items) => set({ items }))

  async function save() {
    await setDoc(doc(db, 'settings', 'entrance'), stripUndefined(draft), { merge: true })
    setSavedAt(new Date())
  }

  // `liveEntranceItems` is what the splash renders and is already capped, so
  // the count of everything currently eligible has to be taken separately --
  // otherwise the "more than fits" warning below could never fire.
  const showing = liveEntranceItems(draft)
  const eligible = (draft.items || []).filter((item) => itemIsLive(item))

  return (
    <div className="space-y-4">
      <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <Sparkles size={13} /> Entrance animation
        </span>
        {dirty ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            Unsaved changes
          </span>
        ) : (
          savedAt && <span className="text-[11px] text-emerald-600">Saved {savedAt.toLocaleTimeString()}</span>
        )}
        <div className="ml-auto">
          <Btn variant="primary" onClick={save} disabled={!dirty}>
            Publish entrance
          </Btn>
        </div>
      </div>

      {/* --- Brand ------------------------------------------------------ */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <p className="font-semibold text-ink">Branding</p>
          <Toggle
            checked={draft.enabled !== false}
            onChange={(v) => set({ enabled: v })}
            label="Play the entrance on every page load"
          />
        </div>

        <Field
          label="Logo image (optional)"
          hint={
            draft.logoUrl && !safeImageUrl(draft.logoUrl)
              ? '⚠️ Not a usable image link — the default mark will be used.'
              : isDriveUrl(draft.logoUrl)
                ? '✓ Google Drive link — make sure it’s shared “Anyone with the link”.'
                : 'Replaces the default mark on the entrance. Drive share links work.'
          }
        >
          <div className="flex items-center gap-2">
            <TextInput
              value={draft.logoUrl || ''}
              onChange={(v) => set({ logoUrl: v })}
              placeholder="https://drive.google.com/file/d/…/view"
            />
            {/* Previewed on the entrance's own near-black backdrop, because
                a logo that looks fine on white can vanish on dark. */}
            <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg bg-slate-900 p-1.5">
              {safeImageUrl(draft.logoUrl, { width: 96 }) ? (
                <img
                  src={safeImageUrl(draft.logoUrl, { width: 96 })}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[10px] text-slate-500">no logo</span>
              )}
            </span>
          </div>
        </Field>

        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
          <Field label="Brand name" hint={`Blank uses “${BRAND_NAME}” from the build settings.`}>
            <TextInput value={draft.brandName || ''} onChange={(v) => set({ brandName: v })} placeholder={BRAND_NAME} />
          </Field>
          <Field label="Tagline" hint={`Blank uses “${BRAND_TAGLINE}”.`}>
            <TextInput value={draft.tagline || ''} onChange={(v) => set({ tagline: v })} placeholder={BRAND_TAGLINE} />
          </Field>
          <Field
            label="How long it holds (ms)"
            hint="Clamped to 1.2–6s, plus a little per announcement. Anyone can click to skip."
          >
            <TextInput
              type="number"
              value={draft.durationMs ?? 2600}
              onChange={(v) => set({ durationMs: Number(v) || 2600 })}
            />
          </Field>
        </div>

        {draft.enabled === false && (
          <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
            Turned off — people go straight to the dashboard. Announcements below are kept but not shown.
          </p>
        )}
      </div>

      {/* --- Announcements ---------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <Btn variant="accent" onClick={() => ops.add(emptyEntranceItem())}>
          <Plus size={13} /> Add announcement
        </Btn>
        <p className="max-w-xl text-[11px] text-slate-400">
          Campaigns, achievements and notices shown under the wordmark. Give one a date range and it appears and
          disappears on its own — no need to remember to take it down.
        </p>
        <span className="ml-auto text-[11px] text-slate-500">
          {eligible.length} of {(draft.items || []).length} live right now
        </span>
      </div>

      {(draft.items || []).length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No announcements. The entrance will show just the wordmark.
        </p>
      )}

      <div className="space-y-2">
        {(draft.items || []).map((item, index) => {
          const setItem = (patch) => ops.update(item.id, patch)
          const isLive = itemIsLive(item)

          return (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                <Field label="Kind">
                  <Select
                    value={item.kind}
                    onChange={(v) => {
                      // Switching kind refreshes the icon and colour to that
                      // kind's defaults, but only if they were still the old
                      // kind's defaults -- a hand-picked colour survives.
                      const from = kindMeta(item.kind)
                      const to = kindMeta(v)
                      setItem({
                        kind: v,
                        icon: item.icon === from.icon ? to.icon : item.icon,
                        color: item.color === from.color ? to.color : item.color,
                      })
                    }}
                    options={ITEM_KINDS.map((k) => ({ value: k.value, label: `${k.icon} ${k.label}` }))}
                  />
                </Field>
                <Field label="Icon">
                  <TextInput value={item.icon} onChange={(v) => setItem({ icon: v })} placeholder="🏆" />
                </Field>
                <Field label="Headline" className="md:col-span-2">
                  <TextInput
                    value={item.title}
                    onChange={(v) => setItem({ title: v })}
                    placeholder="500 deliveries this quarter"
                  />
                </Field>
                <Field label="Colour">
                  <input
                    type="color"
                    value={item.color}
                    onChange={(e) => setItem({ color: e.target.value })}
                    className="h-[30px] w-full rounded-lg border border-slate-200"
                  />
                </Field>
                <div className="flex items-end justify-end">
                  <RowControls
                    onUp={() => ops.move(index, -1)}
                    onDown={() => ops.move(index, 1)}
                    onDelete={() => ops.remove(item.id)}
                    isFirst={index === 0}
                    isLast={index === (draft.items || []).length - 1}
                  />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                <Field label="Supporting line" className="md:col-span-2">
                  <TextInput
                    value={item.subtitle}
                    onChange={(v) => setItem({ subtitle: v })}
                    placeholder="A company record — thank you, everyone"
                  />
                </Field>
                <Field label="Show from" hint="Optional">
                  <TextInput type="date" value={item.startDate} onChange={(v) => setItem({ startDate: v })} />
                </Field>
                <Field label="Show until" hint="Optional — inclusive">
                  <TextInput type="date" value={item.endDate} onChange={(v) => setItem({ endDate: v })} />
                </Field>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2">
                <Toggle checked={item.active} onChange={(v) => setItem({ active: v })} label="Active" />
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    isLive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isLive
                    ? 'Showing now'
                    : !item.active
                      ? 'Switched off'
                      : !String(item.title || '').trim()
                        ? 'Needs a headline'
                        : 'Outside its date range'}
                </span>

                {/* The card exactly as the entrance will draw it. */}
                <div
                  className="ml-auto flex min-w-[190px] max-w-xs items-start gap-2.5 rounded-xl border px-3 py-2 text-left"
                  style={{ borderColor: `${item.color}55`, background: '#0F172A' }}
                >
                  <span className="text-lg leading-none">{item.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-snug text-white">
                      {item.title || 'Headline goes here'}
                    </p>
                    {item.subtitle && <p className="text-[10px] leading-snug text-slate-300">{item.subtitle}</p>}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {eligible.length > showing.length && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
          {eligible.length} announcements are live but only the first {showing.length} are shown, so the entrance stays
          an entrance. Reorder them, or give the others a date range.
        </p>
      )}
    </div>
  )
}
