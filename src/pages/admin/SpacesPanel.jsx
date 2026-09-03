import { useState } from 'react'
import { deleteDoc, doc, setDoc } from 'firebase/firestore'
import { Check, Link2, Plus, Trash2 } from 'lucide-react'
import { db } from '../../firebase'
import { stripUndefined } from '../../lib/firestoreSafe'
import { useSpace } from '../../context/SpaceContext.jsx'
import { DEFAULT_SPACE, emptySpace, shareLink, spaceContents } from '../../lib/spaces'

/**
 * The account's dashboards.
 *
 * A dashboard is not a folder of pages -- it is a whole one: its own pages,
 * its own sheet connections, its own entrance, its own look. See
 * lib/spaces.js.
 *
 * The first dashboard is not a stored document until somebody renames it,
 * which is what lets every account that predates this feature carry on
 * working without anything being migrated. Naming it writes the document
 * for the first time; everything already in it stays exactly where it is.
 */
export default function SpacesPanel({ pages, sources }) {
  const { spaces, spaceId, chooseSpace } = useSpace()
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')

  const copy = async (space) => {
    const link = shareLink(window.location.origin, space.id)
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // A browser that refuses the clipboard (no permission, or not a
      // secure origin) still has to hand the link over somehow.
      window.prompt('Copy this link', link)
      return
    }
    setCopied(space.id)
    setTimeout(() => setCopied(''), 1600)
  }

  const save = async (space) => {
    setBusy(space.id)
    try {
      await setDoc(doc(db, 'spaces', space.id), stripUndefined(space), { merge: true })
    } finally {
      setBusy('')
    }
  }

  const add = async () => {
    const space = emptySpace('New dashboard', spaces.length)
    await save(space)
    chooseSpace(space.id)
  }

  const remove = async (space) => {
    const held = spaceContents(space.id, pages, sources)
    // The count out loud, because "Delete dashboard?" and "Delete 14 pages
    // and 3 sheet connections?" are different questions and only the second
    // one is true.
    const what = [
      held.pages ? `${held.pages} page${held.pages === 1 ? '' : 's'}` : '',
      held.sources ? `${held.sources} sheet connection${held.sources === 1 ? '' : 's'}` : '',
    ]
      .filter(Boolean)
      .join(' and ')
    const warning = what
      ? `Delete “${space.name}”? Its ${what} stay in the database but nothing will show them.`
      : `Delete “${space.name}”? It is empty.`
    if (!window.confirm(warning)) return
    await deleteDoc(doc(db, 'spaces', space.id))
    if (spaceId === space.id) chooseSpace(DEFAULT_SPACE)
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Dashboards</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Each one is a dashboard of its own — its own pages, its own spreadsheets, its own entrance. People
          see a dashboard when they have been given a page inside it, so there is nothing extra to grant.
        </p>
      </div>

      <ul className="space-y-1.5">
        {spaces.map((space) => {
          const held = spaceContents(space.id, pages, sources)
          const open = space.id === spaceId
          return (
            <li
              key={space.id}
              className={`flex items-center gap-2 rounded-lg border p-2 ${
                open ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 bg-white'
              }`}
            >
              <input
                value={space.icon || ''}
                onChange={(e) => save({ ...space, icon: e.target.value.slice(0, 2) })}
                placeholder="🏠"
                className="w-10 rounded border border-slate-200 px-1 py-1 text-center text-sm"
                title="An emoji, so it can be picked out of the list at a glance"
              />
              <input
                value={space.name || ''}
                onChange={(e) => save({ ...space, name: e.target.value })}
                placeholder="Dashboard name"
                className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-sm"
              />
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                {held.pages} page{held.pages === 1 ? '' : 's'} · {held.sources} sheet
                {held.sources === 1 ? '' : 's'}
              </span>
              {busy === space.id && <span className="text-[10px] text-indigo-500">saving…</span>}

              {/* The dashboard's own link. A page link would land in the
                  right dashboard too -- see `spaceForPage` -- but it dies
                  when that page is renamed away or deleted. This one names
                  the dashboard and lands on whatever its first page is. */}
              <button
                onClick={() => copy(space)}
                className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  copied === space.id
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
                title={`Copy the link to ${space.name || 'this dashboard'} — it opens this dashboard and only its pages`}
              >
                <Link2 size={11} /> {copied === space.id ? 'Copied' : 'Link'}
              </button>

              {open ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white">
                  <Check size={11} /> Open
                </span>
              ) : (
                <button
                  onClick={() => chooseSpace(space.id)}
                  className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50"
                >
                  Open
                </button>
              )}

              {/* The first one cannot be deleted: it is where everything
                  that predates dashboards lives, and there is no second
                  place for it to go. */}
              {space.id !== DEFAULT_SPACE && (
                <button
                  onClick={() => remove(space)}
                  className="shrink-0 rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                  title="Delete this dashboard"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <button
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
      >
        <Plus size={13} /> Add dashboard
      </button>

      <p className="text-[11px] text-slate-400">
        <strong>Link</strong> copies a share link for that dashboard — anyone who opens it lands there and sees
        only its pages, even if they have access to several. It is not a way in on its own: they still see only
        the pages they have been granted.
      </p>

      <p className="text-[11px] text-slate-400">
        A new dashboard starts empty. Connect its spreadsheets under Data Sources, add its pages, and give it
        its own entrance — all of them apply to whichever dashboard is open here.
      </p>
    </div>
  )
}
