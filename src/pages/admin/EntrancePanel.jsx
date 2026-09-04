import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { Plus, Sparkles } from 'lucide-react'
import { db } from '../../firebase'
import {
  DEFAULT_ENTRANCE,
  ITEM_KINDS,
  LOGO_DEFAULT,
  LOGO_MAX,
  LOGO_MIN,
  emptyEntranceItem,
  itemIsLive,
  kindMeta,
  liveEntranceItems,
  logoBox,
} from '../../lib/branding'
import { BRAND_NAME, BRAND_TAGLINE } from '../../components/SplashScreen.jsx'
import { stripUndefined } from '../../lib/firestoreSafe'
import { isDriveUrl, safeImageUrl } from '../../lib/imageUrl'
import {
  DEFAULT_BACKDROP,
  DEFAULT_THEME,
  ENTRANCE_THEMES,
  LOGO_BACKDROPS,
  backdropClass,
  themeOf,
} from '../../lib/entranceThemes'
import { Btn, Field, RowControls, Select, TextInput, Toggle, listOps, stableEqual } from './ui.jsx'
import { entranceDocId } from '../../lib/spaces'
import { useSpace } from '../../context/SpaceContext.jsx'
import EmojiPicker from './EmojiPicker.jsx'

/**
 * The entrance animation's content: the wordmark, and the campaigns,
 * achievements and notices that greet everyone on their way in.
 *
 * All of it lives in one `settings/entrance` document, so this panel is a
 * single load-edit-save form rather than a collection editor.
 */
export default function EntrancePanel() {
  // The entrance belongs to ONE dashboard: two businesses in one account
  // do not share a login screen. The first dashboard keeps the document
  // that is already there -- see lib/spaces.js.
  const { spaceId, spaces } = useSpace()
  const [live, setLive] = useState(null)
  const [draft, setDraft] = useState(DEFAULT_ENTRANCE)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(
    () =>
      onSnapshot(doc(db, 'settings', entranceDocId(spaceId)), (snap) => {
        const data = snap.exists() ? { ...DEFAULT_ENTRANCE, ...snap.data() } : DEFAULT_ENTRANCE
        setLive(data)
        setDraft(data)
      }),
    // Re-read when the dashboard changes, or the panel would go on editing
    // the one that was open when it mounted.
    [spaceId]
  )

  const dirty = live !== null && !stableEqual(draft, live)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const ops = listOps(draft.items || [], (items) => set({ items }))

  async function save() {
    await setDoc(doc(db, 'settings', entranceDocId(spaceId)), stripUndefined(draft), { merge: true })
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
        {/* WHOSE entrance. With several dashboards in one account, editing
            the wrong one's login screen is a mistake nobody would catch
            until somebody else signed in. */}
        {spaces.length > 1 && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
            {spaces.find((sp) => sp.id === spaceId)?.name || 'This dashboard'}
          </span>
        )}
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
{/* Previewed on the chosen theme's OWN ground, with the chosen
                backdrop -- a logo that looks fine on white can vanish on
                dark, and a preview on a colour the entrance does not use
                answers the wrong question. */}
            {/* Scaled to the swatch, not drawn at the real size: this
                preview exists to show the COLOUR behind the logo, and a
                320px logo inside a panel that can be 340px wide would push
                it out. So the size here is RELATIVE -- it grows and shrinks
                as the slider moves, which is what makes the setting legible
                -- and the pixel figure beside the slider is the real one. */}
            <span
              className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg p-1.5"
              style={{ background: themeOf(draft).bg }}
            >
              {safeImageUrl(draft.logoUrl, { width: 96 }) ? (
                <span className={backdropClass({ value: draft.logoBackdrop || DEFAULT_BACKDROP })}>
                  <img
                    src={safeImageUrl(draft.logoUrl, { width: 96 })}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-auto object-contain"
                    style={{
                      maxHeight: `${Math.min(100, (logoBox(draft).height / 200) * 100)}%`,
                      maxWidth: '100%',
                    }}
                  />
                </span>
              ) : (
                <span className={`text-[10px] ${themeOf(draft).dark ? 'text-slate-500' : 'text-slate-400'}`}>
                  no logo
                </span>
              )}
            </span>
          </div>
        </Field>

        {/* --- how it looks ------------------------------------------- */}
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-slate-500">Background</p>
          <div className="flex flex-wrap gap-1.5">
            {ENTRANCE_THEMES.map((t) => {
              const on = (draft.theme || DEFAULT_THEME) === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => set({ theme: t.value })}
                  title={t.hint}
                  aria-pressed={on}
                  className={`overflow-hidden rounded-lg border transition-all ${
                    on ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* The swatch IS the theme: its own ground with its own two
                      fields on it, so the choice is made by looking rather
                      than by reading ten names. */}
                  <span
                    className="relative flex h-11 w-20 items-center justify-center overflow-hidden"
                    style={{ background: t.bg }}
                  >
                    <span
                      className="absolute -left-2 -top-3 h-10 w-10 rounded-full blur-md"
                      style={{ background: t.orbA }}
                    />
                    <span
                      className="absolute -bottom-3 -right-2 h-9 w-9 rounded-full blur-md"
                      style={{ background: t.orbB }}
                    />
                    <span
                      className="relative text-[10px] font-semibold"
                      style={{ color: t.dark ? '#fff' : '#0f172a' }}
                    >
                      {t.label}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-slate-500">Behind the logo</p>
          <div className="flex flex-wrap gap-1.5">
            {LOGO_BACKDROPS.map((b) => {
              const on = (draft.logoBackdrop || DEFAULT_BACKDROP) === b.value
              return (
                <button
                  key={b.value}
                  onClick={() => set({ logoBackdrop: b.value })}
                  title={b.hint}
                  aria-pressed={on}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    on
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {b.label}
                </button>
              )
            })}
          </div>
          {/* The one thing worth saying about transparent logos, said where
              the decision is made. */}
          <p className="mt-1 text-[11px] leading-snug text-slate-400">
            A <strong>transparent PNG or SVG is the right thing to upload</strong> — it sits on
            the background instead of carrying a white rectangle. But transparent means the ink
            is whatever your designer chose: a dark logo disappears on a dark background and a
            white one disappears on a light one. A glow rescues the first, a plate rescues
            either.
          </p>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-medium text-slate-500">How big</p>
            <span className="text-[11px] tabular-nums text-slate-400">{logoBox(draft).height}px tall</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={LOGO_MIN}
              max={LOGO_MAX}
              step={4}
              value={logoBox(draft).height}
              onChange={(e) => set({ logoSize: Number(e.target.value) })}
              className="h-1.5 w-full min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
              aria-label="Logo size"
            />
            <button
              onClick={() => set({ logoSize: LOGO_DEFAULT })}
              disabled={logoBox(draft).height === LOGO_DEFAULT}
              className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              title="Back to the size it has always been"
            >
              Reset
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-400">
            The height. The width follows it, so a wide wordmark and a square mark both keep their own shape — and
            the image is fetched at twice this size, so it stays sharp on a good screen.
          </p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
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
                  <EmojiPicker value={item.icon} onChange={(v) => setItem({ icon: v })} placeholder="🏆" />
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
