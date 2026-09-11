import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { Globe, Plus, Sparkles } from 'lucide-react'
import { db } from '../../firebase'
import {
  DEFAULT_ENTRANCE,
  GAP_DEFAULT,
  GAP_MAX,
  GAP_MIN,
  ITEM_KINDS,
  LOGO_DEFAULT,
  LOGO_SLOTS,
  LOGO_MAX,
  LOGO_MIN,
  emptyEntranceItem,
  itemIsLive,
  kindMeta,
  liveEntranceItems,
  logoBox,
} from '../../lib/branding'
import { BRAND_NAME, BRAND_TAGLINE } from '../../components/SplashScreen.jsx'
import AppImage from '../../components/PageIcon.jsx'
import { faviconHref, faviconSource } from '../../lib/favicon'
import { BASE_TITLE } from '../../lib/notify'
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
 * The tab, actual size.
 *
 * The only preview worth having here, and the reason is the whole
 * difficulty of the setting: an icon is chosen by looking at a 400px
 * image and then drawn at sixteen. A logo that is unmistakable in the
 * Drive thumbnail is a grey smudge in the tab strip, and there is no way
 * to know that from the link. So this is not scaled to fit a panel -- it
 * is the size it will really be, next to the name it will really carry.
 *
 * It also says WHICH image is in play. A pasted link that Drive will not
 * serve, or one that is not an image at all, leaves the tab wearing the
 * logo instead -- and "I pasted something and nothing happened" has to be
 * answered on the screen where it was pasted.
 */
function TabPreview({ entrance }) {
  const source = faviconSource(entrance)
  const said = {
    chosen: 'this icon',
    logo: 'a logo above',
    default: 'the built-in icon',
  }[source]

  return (
    <span className="shrink-0">
      <span className="flex w-[150px] items-center gap-1.5 rounded-t-lg border border-b-0 border-slate-200 bg-white px-2 py-1.5 shadow-sm">
        {source === 'default' ? (
          <Globe size={14} className="shrink-0 text-slate-300" />
        ) : (
          <AppImage
            src={faviconHref(entrance)}
            size={16}
            fit="contain"
            ring={false}
            rounded="rounded-sm"
            fallback="🌐"
          />
        )}
        <span className="truncate text-[10px] text-slate-500">{BASE_TITLE}</span>
      </span>
      <span className="mt-1 block text-center text-[9px] text-slate-400">Tab shows {said}</span>
    </span>
  )
}

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

        {/* Both marks, each with the same settings, because they are the
            same component reading different keys. The main one is drawn
            above -- the group's logo over the division's, which is how a
            business with two of them says it. */}
        {LOGO_SLOTS.map((slot) => (
          <LogoControls key={slot.key} slot={slot} draft={draft} set={set} advice={slot.key === 'logo'} />
        ))}

        {/* The tab icon. Its own field rather than the logo reused,
            because the two are drawn at 96 pixels and at 16 and almost no
            logo survives both -- the entrance wants the whole lockup, the
            tab wants the mark cut out of it. */}
        <Field
          label="Browser tab icon (optional)"
          hint={
            draft.faviconUrl && !safeImageUrl(draft.faviconUrl)
              ? '⚠️ Not a usable image link — the tab falls back to the logo.'
              : isDriveUrl(draft.faviconUrl)
                ? '✓ Google Drive link — make sure it’s shared “Anyone with the link”.'
                : 'Blank uses a logo above. Square images work best — the tab draws it at 16px.'
          }
        >
          <div className="flex items-center gap-2">
            <TextInput
              value={draft.faviconUrl || ''}
              onChange={(v) => set({ faviconUrl: v })}
              placeholder="https://drive.google.com/file/d/…/view"
            />
            <TabPreview entrance={draft} />
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

/**
 * One logo, and everything that can be set about it.
 *
 * Written once and rendered per slot. "The main logo has every setting
 * the other one has" is the requirement, and two copies of these controls
 * would satisfy it on the day they were written and not a fortnight
 * later -- the second one always misses whatever gets added to the first.
 * One component reading `slot.size` instead of `logoSize` cannot drift.
 *
 * `advice` puts the two explanatory paragraphs under this card rather
 * than repeating them: they are about logo files in general, not about
 * either slot, and saying them twice makes them furniture nobody reads.
 */
function LogoControls({ slot, draft, set, advice = false }) {
  const url = draft[slot.url] || ''
  const box = logoBox(draft, slot)
  const backdrop = draft[slot.backdrop] || DEFAULT_BACKDROP
  const shown = safeImageUrl(url, { width: 96 })

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2.5">
      <p className="mb-1.5 text-[11px] font-semibold text-slate-600">{slot.label}</p>

      <Field
        label="Image link"
        hint={
          url && !shown
            ? '⚠️ Not a usable image link — nothing will be drawn.'
            : isDriveUrl(url)
              ? '✓ Google Drive link — make sure it’s shared “Anyone with the link”.'
              : slot.note
        }
      >
        <div className="flex items-center gap-2">
          <TextInput
            value={url}
            onChange={(v) => set({ [slot.url]: v })}
            placeholder="https://drive.google.com/file/d/…/view"
          />
          {/* Previewed on the chosen theme's OWN ground, with the chosen
              backdrop -- a logo that looks fine on white can vanish on
              dark, and a preview on a colour the entrance does not use
              answers the wrong question.

              Scaled to the swatch, not drawn at the real size: this exists
              to show the COLOUR behind the logo, and a 320px logo inside a
              340px panel would push it out. So the size here is RELATIVE
              -- it grows and shrinks as the slider moves, which is what
              makes the setting legible -- and the pixel figure beside the
              slider is the real one. */}
          <span
            className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg p-1.5"
            style={{ background: themeOf(draft).bg }}
          >
            {shown ? (
              <span className={backdropClass({ value: backdrop })}>
                <img
                  src={shown}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-auto object-contain"
                  style={{ maxHeight: `${Math.min(100, (box.height / 200) * 100)}%`, maxWidth: '100%' }}
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

      <div className="mt-2.5">
        <p className="mb-1 text-[11px] font-medium text-slate-500">Behind it</p>
        <div className="flex flex-wrap gap-1.5">
          {LOGO_BACKDROPS.map((b) => {
            const on = backdrop === b.value
            return (
              <button
                key={b.value}
                onClick={() => set({ [slot.backdrop]: b.value })}
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
      </div>

      <div className="mt-2.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium text-slate-500">How big</p>
          <span className="text-[11px] tabular-nums text-slate-400">{box.height}px tall</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={LOGO_MIN}
            max={LOGO_MAX}
            step={4}
            value={box.height}
            onChange={(e) => set({ [slot.size]: Number(e.target.value) })}
            className="h-1.5 w-full min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
            aria-label={`${slot.label} size`}
          />
          <button
            onClick={() => set({ [slot.size]: LOGO_DEFAULT })}
            disabled={box.height === LOGO_DEFAULT}
            className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40"
            title="Back to the size it has always been"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-2.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium text-slate-500">Space under it</p>
          <span className="text-[11px] tabular-nums text-slate-400">{box.gap}px</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={GAP_MIN}
            max={GAP_MAX}
            step={2}
            value={box.gap}
            onChange={(e) => set({ [slot.gap]: Number(e.target.value) })}
            className="h-1.5 w-full min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
            aria-label={`Space under the ${slot.label.toLowerCase()}`}
          />
          <button
            onClick={() => set({ [slot.gap]: GAP_DEFAULT })}
            disabled={box.gap === GAP_DEFAULT}
            className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40"
            title="Back to the standard gap"
          >
            Reset
          </button>
        </div>
      </div>

      {/* The two things worth saying about logo files, said once under the
          pair rather than twice. */}
      {advice && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] leading-snug text-slate-400">
            A <strong>transparent PNG or SVG is the right thing to upload</strong> — it sits on
            the background instead of carrying a white rectangle. But transparent means the ink
            is whatever your designer chose: a dark logo disappears on a dark background and a
            white one disappears on a light one. A glow rescues the first, a plate rescues
            either. The height is what you set; the width follows it, so a wide wordmark and a
            square mark both keep their own shape, and the image is fetched at twice that size
            so it stays sharp.
          </p>
          <p className="text-[11px] leading-snug text-slate-400">
            <strong>The space under goes negative on purpose.</strong> Most logo files are mostly
            nothing — the ink sits in the middle of the canvas with transparent space above and
            below it. The browser cannot tell that apart from the logo, so whatever is underneath
            gets pushed down by emptiness. Drag it left to pull that back up.
          </p>
        </div>
      )}
    </div>
  )
}
