import { Fragment, useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'
import {
  ArrowUpDown,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Filter,
  Inbox,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import { db } from '../../firebase'
import { accessId } from '../../lib/workspace'
import { DEFAULT_SCOPE, SCOPE_TOKENS, describeScope } from '../../lib/userScope'
import { collectTabRefs } from '../../lib/refs'
import { canReceiveMessages, canSendMessages } from '../../lib/messages'
import { avatarSpec } from '../../lib/avatar'
import { useAuth } from '../../context/AuthContext.jsx'
import ConditionBuilder from './ConditionBuilder.jsx'
import { stripUndefined } from '../../lib/firestoreSafe'
import { Btn, Select, TextInput, Toggle, stableEqual, useWorkspaceCtx } from './ui.jsx'

/**
 * Who can see what, across every page in the workspace.
 *
 * Access is granted per PAGE, then narrowed three ways:
 *   - hiddenWidgets: specific widgets on that page this user shouldn't see
 *   - editable:      { [ref]: [columns] } -- inline-edit rights
 *   - downloadable:  { [ref]: [columns] } -- row download rights
 *
 * All three are keyed by REF ("<sourceId>::MASTER") rather than a bare tab
 * name, because a page can now span several spreadsheets and two of them
 * very often both have a MASTER.
 *
 * Widget visibility is a DENY list, so a widget an admin adds next week is
 * visible to everyone who can see the page rather than invisible until each
 * user is re-granted one by one.
 */
/**
 * A switch the size of an icon.
 *
 * A column of forty rows cannot afford a labelled checkbox each. The state
 * is carried by colour AND by a slash through the icon when it is off, so
 * it does not rely on colour alone -- and the words live in the tooltip and
 * the aria-label, where a screen reader and a hesitating admin both find
 * them.
 */
function IconToggle({ on, onChange, label, title, icon: Icon }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={`${title} — ${on ? 'on' : 'off'}`}
      onClick={() => onChange(!on)}
      className={`relative flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
        on
          ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
          : 'border-slate-200 bg-white text-slate-300 hover:bg-slate-50'
      }`}
    >
      <Icon size={12} />
      {!on && <span aria-hidden className="absolute h-4 w-px rotate-45 bg-slate-300" />}
    </button>
  )
}

/** A user with no status yet has not been looked at, which is pending. */
const statusOf = (u) => u?.status || 'pending'

/** Tooltips list one page per line. */
const SCOPE_SEPARATOR = String.fromCharCode(10)

const STATUS_TABS = [
  { value: 'all', label: 'All', on: 'border-slate-300 bg-slate-100 text-slate-700' },
  { value: 'pending', label: 'Pending', on: 'border-amber-300 bg-amber-50 text-amber-700' },
  { value: 'active', label: 'Active', on: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { value: 'removed', label: 'Removed', on: 'border-rose-300 bg-rose-50 text-rose-700' },
]

export default function UsersPanel({ pages, tabHeaders, labelFor = (t) => t }) {
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  // Who a bulk action applies to. Twelve people joining in the same week is
  // the normal shape of this job, and doing them one at a time is how the
  // twelfth gets a different answer from the first.
  const [picked, setPicked] = useState([])
  const [accessMap, setAccessMap] = useState({})
  const [accessError, setAccessError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  // Which page's detail is open, inside the open user. Twelve pages drawn
  // as twelve full cards is a wall nobody reads; one line each, and the one
  // being worked on opened.
  const [openPage, setOpenPage] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')

  useEffect(
    () => onSnapshot(collection(db, 'users'), (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    []
  )

  // ONE listener over the whole `access` collection.
  //
  // This used to subscribe per (user, page), which is a listener for every
  // cell of the grid: forty people and fifteen pages is six hundred live
  // subscriptions, six hundred separate `setAccessMap` calls on open, and
  // the whole lot torn down and rebuilt every time anybody's user document
  // changed -- because `users` is a new array on each snapshot.
  //
  // The dashboard still reads these one document at a time, and must: a
  // non-admin has no right to list them (see firestore.rules). An admin
  // does, explicitly, and this panel is admin-only.
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'access'),
        (snap) => {
          const next = {}
          snap.docs.forEach((d) => {
            next[d.id] = d.data()
          })
          // Replaced wholesale rather than merged, so a grant deleted
          // somewhere else stops showing here instead of lingering as a row
          // nothing will ever clear.
          setAccessMap(next)
          setAccessError(null)
        },
        // Said out loud. Failing quietly here draws every person on the
        // page as having no access to anything -- which is a screen an
        // admin would act on, and act on wrongly.
        (e) => setAccessError(e?.message || 'Could not read who has access')
      ),
    []
  )

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...users]
      .filter((u) => status === 'all' || statusOf(u) === status)
      .filter((u) => !q || `${u.email || ''} ${u.name || ''} ${u.jobRole || ''}`.toLowerCase().includes(q))
      // Pending first: they are the ones waiting on somebody.
      .sort((a, b) => {
        const rank = (u) => (statusOf(u) === 'pending' ? 0 : 1)
        return rank(a) - rank(b) || (a.email || '').localeCompare(b.email || '')
      })
  }, [users, query, status])

  const saveUser = (id, patch) => setDoc(doc(db, 'users', id), stripUndefined(patch), { merge: true })

  // --- acting on several at once ----------------------------------------
  /**
   * Never yourself.
   *
   * A sweep that sets everybody to "User", or to "Removed", is one click
   * away from an admin taking their own rights off -- and the panel that
   * would put them back is the one they just locked. Individual rows still
   * allow it, where the choice is unmistakably about one person.
   */
  const targets = useMemo(() => picked.filter((id) => id !== me?.uid), [picked, me?.uid])
  const droppedSelf = picked.length !== targets.length

  const bulkUser = (patch) => targets.forEach((id) => saveUser(id, patch))
  const bulkPages = (canView) => targets.forEach((id) => setAllPages(id, canView))
  const bulkCopy = (sourceUid) => targets.forEach((id) => id !== sourceUid && copyFrom(id, sourceUid))

  const allPicked = sorted.length > 0 && sorted.every((u) => picked.includes(u.id))
  const togglePick = (id) =>
    setPicked((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]))
  const saveAccess = (uid, pageId, next) =>
    setDoc(doc(db, 'access', accessId(uid, pageId)), stripUndefined(next), { merge: true })

  /** Grant or revoke every page at once -- the common case for a new hire. */
  function setAllPages(uid, canView) {
    pages.forEach((page) => saveAccess(uid, page.id, { canView }))
  }

  /**
   * Copies another user's whole permission set. Onboarding someone into an
   * existing role is otherwise a dozen identical checkbox passes.
   */
  function copyFrom(targetUid, sourceUid) {
    pages.forEach((page) => {
      const from = accessMap[accessId(sourceUid, page.id)]
      saveAccess(targetUid, page.id, {
        canView: !!from?.canView,
        hiddenWidgets: from?.hiddenWidgets || [],
        editable: from?.editable || {},
        downloadable: from?.downloadable || {},
        widgetOrder: from?.widgetOrder || {},
      })
    })
  }

  /**
   * Copies only the widget ORDER, leaving every permission alone.
   *
   * Ordering is the one thing an ordinary reader cannot set for themselves
   * any more -- the arrange tool on the canvas belongs to admins -- so the
   * way somebody gets a layout that suits their job is for an admin to give
   * them one, usually the one that already suits somebody doing the same
   * job. Copying the whole permission set to achieve that would hand over
   * page access nobody asked to change.
   */
  function copyLayoutFrom(targetUid, sourceUid) {
    pages.forEach((page) => {
      const from = accessMap[accessId(sourceUid, page.id)]
      const to = accessMap[accessId(targetUid, page.id)]
      if (!from?.widgetOrder || Object.keys(from.widgetOrder).length === 0) return
      saveAccess(targetUid, page.id, { ...(to || { canView: false }), widgetOrder: from.widgetOrder })
    })
  }

  /**
   * The same row restriction on every page this user can open.
   *
   * "Ravi only ever sees the west" is a statement about Ravi, not about one
   * page, and setting it eleven times is how the twelfth page gets missed.
   * Only pages they can already view are touched -- this narrows access, it
   * never grants it -- and only where the condition's tab actually appears
   * on that page, since a rule naming a tab the page never reads would sit
   * there doing nothing.
   */
  function applyScopeEverywhere(uid, scope) {
    const named = new Set((scope?.conditions || []).map((c) => c?.tab).filter(Boolean))
    pages.forEach((page) => {
      const current = accessMap[accessId(uid, page.id)]
      if (!current?.canView) return
      const refs = collectTabRefs(page.widgets || [])
      const conditions = (scope?.conditions || []).filter((c) => refs.has(c.tab))
      if (named.size > 0 && conditions.length === 0) return
      saveAccess(uid, page.id, { ...current, scope: { match: scope?.match || 'all', conditions } })
    })
  }

  return (
    <div className="space-y-3">
      {accessError && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700">
          Who has access to what could not be read, so every row below will look as though it has none:{' '}
          {accessError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find by name, email or role…"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs placeholder:text-slate-300"
          />
        </div>

        {/* Pending is the one that needs acting on, so it is countable at a
            glance rather than something you find by scrolling. */}
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => {
            const n = tab.value === 'all' ? users.length : users.filter((u) => statusOf(u) === tab.value).length
            const on = status === tab.value
            return (
              <button
                key={tab.value}
                onClick={() => setStatus(tab.value)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  on ? tab.on : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                    on ? 'bg-white/70' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {n}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Only when something is selected, so it costs no room the rest of
          the time -- and sticky, because the people it acts on are the ones
          you scrolled past to pick them. */}
      {picked.length > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/95 px-3 py-2 shadow-sm backdrop-blur">
          <span className="text-xs font-semibold text-indigo-800">
            {picked.length} selected
          </span>

          <span className="h-4 w-px bg-indigo-200" />

          <Select
            value=""
            onChange={(v) => v && bulkUser({ status: v })}
            options={[
              { value: '', label: 'Set status…' },
              { value: 'active', label: 'Active' },
              { value: 'pending', label: 'Pending' },
              { value: 'removed', label: 'Removed' },
            ]}
            className="w-32"
          />
          <Select
            value=""
            onChange={(v) => v && bulkUser({ role: v })}
            options={[
              { value: '', label: 'Set access…' },
              { value: 'user', label: 'User' },
              { value: 'admin', label: 'Admin' },
            ]}
            className="w-32"
          />
          <Select
            value=""
            onChange={(v) => {
              if (v === 'send-on') bulkUser({ canSendMessages: true })
              if (v === 'send-off') bulkUser({ canSendMessages: false })
              if (v === 'recv-on') bulkUser({ canReceiveMessages: true })
              if (v === 'recv-off') bulkUser({ canReceiveMessages: false })
            }}
            options={[
              { value: '', label: 'Messaging…' },
              { value: 'send-on', label: 'Can send' },
              { value: 'send-off', label: 'Cannot send' },
              { value: 'recv-on', label: 'Can receive' },
              { value: 'recv-off', label: 'Cannot receive' },
            ]}
            className="w-36"
          />

          <span className="h-4 w-px bg-indigo-200" />

          <Btn onClick={() => bulkPages(true)}>
            <Eye size={12} /> Grant all pages
          </Btn>
          <Btn onClick={() => bulkPages(false)}>
            <EyeOff size={12} /> Revoke all
          </Btn>
          <div className="flex items-center gap-1.5">
            <Copy size={12} className="text-indigo-400" />
            <Select
              value=""
              onChange={(v) => v && bulkCopy(v)}
              options={[
                { value: '', label: 'Copy permissions from…' },
                ...users
                  .filter((other) => other.role !== 'admin')
                  .map((other) => ({ value: other.id, label: other.email || other.id })),
              ]}
              className="w-52"
            />
          </div>

          <button
            onClick={() => setPicked([])}
            className="ml-auto flex items-center gap-1 text-[11px] text-indigo-700 underline"
          >
            <X size={11} /> Clear
          </button>

          {/* Said where the action is, not discovered afterwards. */}
          {droppedSelf && (
            <p className="w-full text-[10px] leading-snug text-indigo-700/80">
              Your own account is in the selection and will be left alone — a sweep that
              sets everybody to “User” is one click from locking yourself out of this
              panel. Change your own row directly if you mean to.
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="w-8 py-1.5">
                <input
                  type="checkbox"
                  checked={allPicked}
                  onChange={() => setPicked(allPicked ? [] : sorted.map((u) => u.id))}
                  aria-label="Select every user shown"
                  className="cursor-pointer"
                />
              </th>
              <th className="py-1.5 font-medium">Person</th>
              <th className="py-1.5 font-medium">Status</th>
              <th className="py-1.5 font-medium">Access</th>
              <th className="py-1.5 text-center font-medium" title="Send / receive messages">
                Msgs
              </th>
              <th className="py-1.5 font-medium">Pages</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => {
              const granted = pages.filter((p) => accessMap[accessId(u.id, p.id)]?.canView)
              const open = expanded === u.id
              const chosen = picked.includes(u.id)
              const face = avatarSpec(u.name || u.email, u.id)

              return (
                <Fragment key={u.id}>
                  <tr
                    className={`border-b border-slate-50 transition-colors ${
                      chosen ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'
                    }`}
                  >
                    <td className="py-1.5 align-middle">
                      <input
                        type="checkbox"
                        checked={chosen}
                        onChange={() => togglePick(u.id)}
                        aria-label={`Select ${u.name || u.email}`}
                        className="cursor-pointer"
                      />
                    </td>

                    {/* Name, email and what they do in one cell. Three
                        columns for one person was three columns of mostly
                        white space, and the job title is the thing an admin
                        recognises somebody by. */}
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                          style={{ backgroundColor: face.bg, color: face.fg }}
                        >
                          {face.initials}
                        </span>
                        <div className="min-w-0">
                          <input
                            defaultValue={u.name || ''}
                            onBlur={(e) => {
                              const next = e.target.value.trim()
                              if (next !== (u.name || '')) saveUser(u.id, { name: next })
                            }}
                            placeholder="— no name yet —"
                            className="w-44 rounded border border-transparent px-1 py-0.5 text-[13px] font-medium text-ink hover:border-slate-200 focus:border-slate-300 focus:bg-white"
                            aria-label={`Name of ${u.email}`}
                          />
                          <div className="flex items-baseline gap-1.5 px-1">
                            <span className="truncate text-[10px] text-slate-400">{u.email}</span>
                            <input
                              defaultValue={u.jobRole || ''}
                              onBlur={(e) => {
                                const next = e.target.value.trim()
                                if (next !== (u.jobRole || '')) saveUser(u.id, { jobRole: next })
                              }}
                              placeholder="+ role"
                              className="w-24 rounded border border-transparent px-1 text-[10px] text-slate-500 hover:border-slate-200 focus:border-slate-300 focus:bg-white"
                              aria-label={`Work role of ${u.name || u.email}`}
                            />
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-1.5 pr-2">
                      <Select
                        value={u.status || 'pending'}
                        onChange={(v) => saveUser(u.id, { status: v })}
                        options={[
                          { value: 'pending', label: 'Pending' },
                          { value: 'active', label: 'Active' },
                          { value: 'removed', label: 'Removed' },
                        ]}
                        className="w-24"
                      />
                    </td>

                    <td className="py-1.5 pr-2">
                      <Select
                        value={u.role || 'user'}
                        onChange={(v) => saveUser(u.id, { role: v })}
                        options={[
                          { value: 'user', label: 'User' },
                          { value: 'admin', label: 'Admin' },
                        ]}
                        className="w-20"
                      />
                    </td>

                    {/* Two switches, as switches rather than two labelled
                        rows. Which one is which is in the tooltip and the
                        aria-label; the pair reads as one thing at a glance,
                        which is what a column of forty of them needs. */}
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center justify-center gap-1">
                        <IconToggle
                          on={canSendMessages(u)}
                          onChange={(v) => saveUser(u.id, { canSendMessages: v })}
                          label={`${u.name || u.email} can send messages`}
                          title="Can send messages"
                          icon={Send}
                        />
                        <IconToggle
                          on={canReceiveMessages(u)}
                          onChange={(v) => saveUser(u.id, { canReceiveMessages: v })}
                          label={`${u.name || u.email} can receive messages`}
                          title="Can receive messages"
                          icon={Inbox}
                        />
                      </div>
                    </td>

                    <td className="py-1.5 pr-2 text-xs text-slate-500">
                      {u.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 text-indigo-600">
                          <ShieldCheck size={12} /> all
                        </span>
                      ) : granted.length === 0 ? (
                        <span className="text-slate-300">none</span>
                      ) : (
                        <span className="tabular-nums">
                          {granted.length}/{pages.length}
                        </span>
                      )}
                      {(() => {
                        // A row restriction is the kind of thing somebody
                        // forgets they set, so it is visible without opening
                        // anything.
                        const scoped = pages.filter((p) =>
                          (accessMap[accessId(u.id, p.id)]?.scope?.conditions || []).some((c) => c?.column)
                        )
                        if (u.role === 'admin' || scoped.length === 0) return null
                        return (
                          <span
                            className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                            title={scoped
                              .map((p) => `${p.name}: ${describeScope(accessMap[accessId(u.id, p.id)]?.scope, labelFor)}`)
                              .join(SCOPE_SEPARATOR)}
                          >
                            <Filter size={9} /> {scoped.length}
                          </span>
                        )
                      })()}
                    </td>

                    <td className="py-1.5 text-right">
                      <Btn onClick={() => setExpanded(open ? null : u.id)}>
                        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
                        {open ? 'Hide' : 'Pages'}
                      </Btn>
                    </td>
                  </tr>

                  {open && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={7} className="p-3">
                        {u.role === 'admin' ? (
                          <p className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-4 text-center text-xs text-indigo-700">
                            Admins can see and edit every page. Change their role to “User” to grant pages individually.
                          </p>
                        ) : (
                          <>
                            <div className="mb-2 flex flex-wrap items-center gap-1.5">
                              <Btn onClick={() => setAllPages(u.id, true)}>
                                <Eye size={12} /> Grant all
                              </Btn>
                              <Btn onClick={() => setAllPages(u.id, false)}>
                                <EyeOff size={12} /> Revoke all
                              </Btn>
                              <div className="flex items-center gap-1">
                                <Copy size={12} className="text-slate-400" />
                                <Select
                                  value=""
                                  onChange={(v) => v && copyFrom(u.id, v)}
                                  options={[
                                    { value: '', label: 'Copy permissions from…' },
                                    ...users
                                      .filter((other) => other.id !== u.id && other.role !== 'admin')
                                      .map((other) => ({ value: other.id, label: other.email || other.id })),
                                  ]}
                                  className="w-48"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <ArrowUpDown size={12} className="text-slate-400" />
                                <Select
                                  value=""
                                  onChange={(v) => v && copyLayoutFrom(u.id, v)}
                                  options={[
                                    { value: '', label: 'Copy layout from…' },
                                    ...users
                                      .filter((other) => other.id !== u.id)
                                      .map((other) => ({ value: other.id, label: other.email || other.id })),
                                  ]}
                                  className="w-44"
                                />
                              </div>
                            </div>

                            {pages.length === 0 ? (
                              <p className="py-4 text-center text-xs text-slate-400">
                                No pages exist yet — create one under “Pages”.
                              </p>
                            ) : (
                              <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                                {pages.map((page) => (
                                  <AccessCard
                                    key={page.id}
                                    open={openPage === `${u.id}:${page.id}`}
                                    onToggleOpen={() =>
                                      setOpenPage((cur) =>
                                        cur === `${u.id}:${page.id}` ? null : `${u.id}:${page.id}`
                                      )
                                    }
                                    page={page}
                                    value={accessMap[accessId(u.id, page.id)]}
                                    onSave={(next) => saveAccess(u.id, page.id, next)}
                                    onApplyScopeToAll={(scope) => applyScopeEverywhere(u.id, scope)}
                                    // Whose order could be copied onto this
                                    // one. Admins included: theirs is usually
                                    // the arrangement worth spreading.
                                    tabs={Array.from(collectTabRefs(page.widgets || []))}
                                    tabHeaders={tabHeaders}
                                    labelFor={labelFor}
                                    others={users
                                      .filter((other) => other.id !== u.id)
                                      .map((other) => ({
                                        id: other.id,
                                        label: `${other.name || other.email || other.id}${
                                          other.role === 'admin' ? ' (admin)' : ''
                                        }`,
                                        order: accessMap[accessId(other.id, page.id)]?.widgetOrder || {},
                                      }))
                                      .filter((other) => Object.keys(other.order).length > 0)}
                                  />
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-300">
                  {users.length === 0 ? 'No users have signed in yet' : 'No user matches that search'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The rows one person may see on one page.
 *
 * Deliberately one line to start with -- a column, and a value -- because
 * "Ravi sees the west" is the whole request nine times in ten, and a full
 * condition builder is a lot of screen for it. More conditions, other
 * operators and ANY/ALL are one click away for the tenth.
 */
function ScopeEditor({ tabs, tabHeaders, scope, onChange, labelFor, onApplyAll }) {
  const conditions = scope?.conditions || []
  const first = conditions[0] || {}
  const [advanced, setAdvanced] = useState(
    conditions.length > 1 || (!!first.operator && first.operator !== 'equals')
  )

  const setFirst = (patch) => {
    const next = [{ tab: tabs[0] || '', operator: 'equals', value: '', ...first, ...patch }]
    onChange({ match: scope?.match || 'all', conditions: next })
  }
  const setAll = (next) => onChange({ match: scope?.match || 'all', conditions: next })

  const columns = tabHeaders?.[first.tab || tabs[0]] || []

  return (
    <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50/40 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[11px] font-medium text-amber-800">
          <Filter size={11} /> Only these rows <span className="font-normal text-amber-700/70">(optional)</span>
        </p>
        <div className="flex items-center gap-2">
          {onApplyAll && conditions.some((c) => c?.column) && (
            <button onClick={onApplyAll} className="text-[10px] text-amber-700 underline" title="Save this rule on every page this user can open">
              apply to every page
            </button>
          )}
          <button onClick={() => setAdvanced((a) => !a)} className="text-[10px] text-amber-700 underline">
            {advanced ? 'simple' : 'more conditions'}
          </button>
        </div>
      </div>

      {advanced ? (
        <ConditionBuilder
          compact
          conditions={conditions}
          match={scope?.match || 'all'}
          tabs={tabs}
          tabHeaders={tabHeaders}
          onChange={setAll}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.length > 1 && (
            <Select
              value={first.tab || tabs[0] || ''}
              onChange={(v) => setFirst({ tab: v, column: '' })}
              options={tabs.map((t) => ({ value: t, label: labelFor(t) }))}
              className="w-40"
            />
          )}
          <Select
            value={first.column || ''}
            onChange={(v) => setFirst({ tab: first.tab || tabs[0] || '', column: v })}
            options={columns}
            placeholder="— column —"
            className="w-44"
          />
          <span className="text-[10px] text-amber-800">is</span>
          <TextInput
            value={first.value ?? ''}
            onChange={(v) => setFirst({ value: v })}
            placeholder="the value"
            className="w-40"
          />
          {conditions.length > 0 && (
            <button onClick={() => setAll([])} className="text-amber-500 hover:text-rose-500" title="Remove this restriction">
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-amber-700/80">Or match them:</span>
        {SCOPE_TOKENS.map((t) => (
          <button
            key={t.token}
            onClick={() => setFirst({ value: t.token })}
            className="rounded-full border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] text-amber-800 hover:bg-amber-100"
            title={`Matches ${t.label}, so one rule serves everybody`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-amber-700/80">
        Runs before anything on the page. They cannot clear it, a saved view cannot restore past it, and Reset does
        not touch it. A rule whose value cannot be worked out shows them <strong>nothing</strong> rather than
        everything.
      </p>
    </div>
  )
}

function AccessCard({ page, value, onSave, onApplyScopeToAll, others = [], tabs = [], open = true, onToggleOpen }) {
  const { tabHeaders, labelFor } = useWorkspaceCtx()
  const [canView, setCanView] = useState(false)
  const [hidden, setHidden] = useState([])
  const [editable, setEditable] = useState({})
  const [downloadable, setDownloadable] = useState({})
  const [widgetOrder, setWidgetOrder] = useState({})
  const [scope, setScope] = useState(DEFAULT_SCOPE)
  const [openRef, setOpenRef] = useState('')
  const [mode, setMode] = useState('editable')
  const [ordering, setOrdering] = useState(false)

  useEffect(() => {
    setCanView(!!value?.canView)
    setHidden(value?.hiddenWidgets || [])
    setEditable(value?.editable || {})
    setDownloadable(value?.downloadable || {})
    setWidgetOrder(value?.widgetOrder || {})
    setScope(value?.scope || DEFAULT_SCOPE)
  }, [value])

  const widgets = page.widgets || []

  // Only refs backing a table that the admin actually marked editable /
  // downloadable can grant those rights -- offering every ref would imply
  // permissions that the widget would never honour anyway.
  const editableRefs = useMemo(
    () => Array.from(new Set(widgets.filter((w) => w.type === 'table' && w.editable).map((w) => w.tab))),
    [widgets]
  )
  const downloadRefs = useMemo(
    () => Array.from(new Set(widgets.filter((w) => w.type === 'table' && w.downloadButtons).map((w) => w.tab))),
    [widgets]
  )

  const activeRefs = mode === 'editable' ? editableRefs : downloadRefs
  const activeMap = mode === 'editable' ? editable : downloadable
  const setActiveMap = mode === 'editable' ? setEditable : setDownloadable

  function toggleColumn(ref, col) {
    setActiveMap((m) => {
      const current = m[ref] || []
      return { ...m, [ref]: current.includes(col) ? current.filter((c) => c !== col) : [...current, col] }
    })
  }

  const dirty =
    canView !== !!value?.canView ||
    !stableEqual(hidden, value?.hiddenWidgets || []) ||
    !stableEqual(editable, value?.editable || {}) ||
    !stableEqual(downloadable, value?.downloadable || {}) ||
    !stableEqual(widgetOrder, value?.widgetOrder || {}) ||
    !stableEqual(scope, value?.scope || DEFAULT_SCOPE)

  // What this page grants, in one line. An admin scanning twelve pages
  // wants to know which ones are open and which of those are narrowed --
  // opening each card to find out is the thing that made this a wall.
  const shownWidgets = widgets.length - hidden.length
  const editCount = Object.values(editable).reduce((n, cols) => n + (cols?.length || 0), 0)
  const downloadCount = Object.values(downloadable).reduce((n, cols) => n + (cols?.length || 0), 0)
  const limited = (scope?.conditions || []).some((c) => c?.column)

  return (
    <div className={open ? 'bg-slate-50/40' : ''}>
      {/* The summary line. The view switch lives here, so granting a page
          takes one click and no expanding at all. */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Toggle
          checked={canView}
          onChange={setCanView}
          label=""
          ariaLabel={`Can view ${page.name}`}
        />

        <button
          type="button"
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="shrink-0">{page.icon || '📊'}</span>
          <span className={`truncate text-[13px] font-medium ${canView ? 'text-ink' : 'text-slate-400'}`}>
            {page.name}
          </span>

          {canView && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
              {hidden.length > 0 && (
                <span title={`${hidden.length} widgets hidden from this user`}>
                  {shownWidgets}/{widgets.length} widgets
                </span>
              )}
              {editCount > 0 && (
                <span
                  className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700"
                  title={`${editCount} editable columns`}
                >
                  edit {editCount}
                </span>
              )}
              {downloadCount > 0 && (
                <span
                  className="rounded-full bg-sky-50 px-1.5 py-0.5 text-sky-700"
                  title={`${downloadCount} downloadable columns`}
                >
                  files {downloadCount}
                </span>
              )}
              {limited && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700"
                  title={describeScope(scope, labelFor)}
                >
                  <Filter size={9} /> rows
                </span>
              )}
            </span>
          )}

          {/* Unsaved work must be visible on the line, or collapsing the
              card hides the fact that there is something to save. */}
          {dirty && (
            <span className="ml-1 shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
              unsaved
            </span>
          )}

          <ChevronDown
            size={13}
            className={`shrink-0 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
      <div className="border-t border-slate-100 px-3 pb-3 pt-2">

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-slate-500">Widgets visible ({widgets.length - hidden.length}/{widgets.length})</p>
        <button className="text-[10px] text-indigo-600 underline" onClick={() => setHidden([])} disabled={!canView}>
          All
        </button>
        <button
          className="text-[10px] text-slate-400 underline"
          onClick={() => setHidden(widgets.map((w) => w.id))}
          disabled={!canView}
        >
          None
        </button>
        {widgets.length > 1 && (
          <button
            className={`ml-auto inline-flex items-center gap-1 text-[10px] underline ${
              ordering ? 'text-indigo-600' : 'text-slate-400'
            }`}
            onClick={() => setOrdering((o) => !o)}
            disabled={!canView}
          >
            <ArrowUpDown size={10} /> {ordering ? 'done ordering' : 'set order for this user'}
          </button>
        )}
      </div>

      {ordering && (
        <div className="mb-1 space-y-1 rounded bg-indigo-50/70 px-2 py-1.5">
          <p className="text-[10px] text-indigo-800">
            Lower numbers first. Blank uses the page default.
          </p>
          {others.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[10px] text-indigo-800">Same order as</span>
              <Select
                value=""
                onChange={(v) => {
                  const from = others.find((o) => o.id === v)
                  if (from) setWidgetOrder({ ...from.order })
                }}
                options={[
                  { value: '', label: '— pick a user —' },
                  ...others.map((o) => ({ value: o.id, label: o.label })),
                ]}
                className="w-56"
              />
            </div>
          )}
        </div>
      )}

      <div className="mb-3 grid max-h-36 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-100 p-2">
        {widgets.map((w) => (
          <label key={w.id} className={`flex items-center gap-1.5 text-[11px] ${canView ? '' : 'opacity-40'}`}>
            <input
              type="checkbox"
              checked={!hidden.includes(w.id)}
              disabled={!canView}
              onChange={() =>
                setHidden((h) => (h.includes(w.id) ? h.filter((x) => x !== w.id) : [...h, w.id]))
              }
            />
            {ordering && (
              <input
                type="number"
                value={widgetOrder[w.id] ?? ''}
                disabled={!canView}
                placeholder="—"
                onChange={(e) =>
                  setWidgetOrder((m) => {
                    const next = { ...m }
                    // Clearing the box must REMOVE the override, not store a
                    // zero, or blanking it would pin the widget to the front.
                    if (e.target.value === '') delete next[w.id]
                    else next[w.id] = Number(e.target.value)
                    return next
                  })
                }
                className="w-11 shrink-0 rounded border border-slate-200 px-1 py-0.5 text-center text-[10px] tabular-nums"
                aria-label={`Position of ${w.title}`}
              />
            )}
            <span className="min-w-0 flex-1 truncate">
              {w.title} <span className="text-slate-400">· {labelFor(w.tab)}</span>
            </span>
          </label>
        ))}
        {widgets.length === 0 && (
          <p className="py-2 text-center text-[11px] text-slate-300">No widgets on this page yet</p>
        )}
      </div>

      {(editableRefs.length > 0 || downloadRefs.length > 0) && (
        <>
          <div className="mb-1.5 flex rounded-lg border border-slate-200 p-0.5 text-[11px]">
            {editableRefs.length > 0 && (
              <button
                onClick={() => {
                  setMode('editable')
                  setOpenRef('')
                }}
                className={`flex-1 rounded px-2 py-1 ${mode === 'editable' ? 'bg-slate-100 font-medium text-ink' : 'text-slate-500'}`}
              >
                Columns they may edit
              </button>
            )}
            {downloadRefs.length > 0 && (
              <button
                onClick={() => {
                  setMode('downloadable')
                  setOpenRef('')
                }}
                className={`flex-1 rounded px-2 py-1 ${mode === 'downloadable' ? 'bg-slate-100 font-medium text-ink' : 'text-slate-500'}`}
              >
                Downloads they may use
              </button>
            )}
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {activeRefs.map((ref) => (
              <button
                key={ref}
                onClick={() => setOpenRef(openRef === ref ? '' : ref)}
                className={`rounded-full border px-2 py-1 text-[11px] ${
                  openRef === ref ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'
                }`}
              >
                {labelFor(ref)}
                {activeMap[ref]?.length ? ` (${activeMap[ref].length})` : ''}
              </button>
            ))}
            {activeRefs.length === 0 && (
              <p className="py-1 text-[11px] text-slate-400">
                No table on this page has that turned on yet.
              </p>
            )}
          </div>

          {openRef && (
            <div className="mb-2 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-100 p-2 md:grid-cols-2">
              {(tabHeaders[openRef] || []).map((col) => (
                <label key={col} className={`flex items-center gap-1.5 text-[11px] ${canView ? '' : 'opacity-40'}`}>
                  <input
                    type="checkbox"
                    disabled={!canView}
                    checked={(activeMap[openRef] || []).includes(col)}
                    onChange={() => toggleColumn(openRef, col)}
                  />
                  <span className="truncate" title={col}>
                    {col}
                  </span>
                </label>
              ))}
              {(tabHeaders[openRef] || []).length === 0 && (
                <p className="col-span-2 py-2 text-center text-[11px] text-slate-300">
                  No columns known for this tab yet
                </p>
              )}
            </div>
          )}
        </>
      )}

      {canView && (
        <ScopeEditor
          tabs={tabs}
          tabHeaders={tabHeaders}
          scope={scope}
          onChange={setScope}
          labelFor={labelFor}
          onApplyAll={onApplyScopeToAll ? () => onApplyScopeToAll(scope) : undefined}
        />
      )}

      <div className="mt-2 flex items-center gap-2">
        <Btn
          variant="primary"
          disabled={!dirty}
          onClick={() => onSave({ canView, hiddenWidgets: hidden, editable, downloadable, widgetOrder, scope })}
        >
          Save access
        </Btn>
        {dirty && <span className="text-[11px] text-amber-600">Unsaved</span>}
      </div>
      </div>
      )}
    </div>
  )
}
