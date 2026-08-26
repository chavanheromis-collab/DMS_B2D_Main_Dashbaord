import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Database, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { extractSheetId } from '../../lib/config'
import { fetchSpreadsheetTabs, syncSource } from '../../lib/sheetsApi'
import { emptySource } from '../../lib/workspace'
import { useAuth } from '../../context/AuthContext.jsx'
import { Btn, Field, Select, TextInput, stableEqual } from './ui.jsx'
import ComputedColumns from './ComputedColumns.jsx'

/**
 * Connects any number of spreadsheets to the workspace.
 *
 * This replaces v2's "one spreadsheet per page". A source is connected ONCE
 * here and can then be used by as many dashboard pages as you like -- so the
 * sales sheet feeding four different pages is loaded, cached and permissioned
 * as one thing, not four.
 *
 * The tab list saved per source is still the security boundary: the API
 * refuses to read a tab that isn't ticked here, so an unticked tab can't be
 * reached even by crafting a request by hand.
 */
export default function DataSourcesPanel({ sources, pages, onSave, onDelete }) {
  const { getIdToken } = useAuth()
  const [syncingAll, setSyncingAll] = useState(false)
  const [allReport, setAllReport] = useState(null)

  const syncable = sources.filter((s) => s.sheetId && (s.tabs || []).length > 0)

  /**
   * Refreshes every connected sheet.
   *
   * Sequential rather than parallel: each one is several Google API calls,
   * and firing a dozen spreadsheets at once is how you meet a rate limit.
   * One failing source is recorded and the rest continue.
   */
  async function syncAll() {
    setSyncingAll(true)
    setAllReport(null)
    const report = { ok: 0, failed: [] }
    try {
      const idToken = await getIdToken()
      for (const source of syncable) {
        try {
          await syncSource(idToken, source.id)
          report.ok += 1
        } catch (e) {
          report.failed.push(`${source.name}: ${e.message}`)
        }
      }
    } finally {
      setAllReport(report)
      setSyncingAll(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <Btn variant="accent" onClick={() => onSave(emptySource(`Spreadsheet ${sources.length + 1}`))}>
          <Plus size={13} /> Connect a spreadsheet
        </Btn>

        {syncable.length > 1 && (
          <Btn onClick={syncAll} disabled={syncingAll}>
            <RefreshCw size={12} className={syncingAll ? 'animate-spin' : ''} />
            {syncingAll ? 'Syncing…' : `Sync all ${syncable.length}`}
          </Btn>
        )}

        <p className="max-w-lg text-[11px] text-slate-400">
          Each spreadsheet is connected once and can then feed any number of pages. Remember to share the sheet with
          your service account’s email, exactly as you’d share it with a person.
        </p>
      </div>

      {allReport && (
        <p
          className={`rounded-lg px-2 py-1.5 text-[11px] ${
            allReport.failed.length ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          Synced {allReport.ok} of {syncable.length}.
          {allReport.failed.length > 0 && ` Failed — ${allReport.failed.join('; ')}`}
        </p>
      )}

      {sources.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No spreadsheets connected yet. Add the first one above.
        </p>
      )}

      <div className="space-y-3">
        {sources.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            usedBy={pages.filter((p) => (p.sourceIds || []).includes(source.id))}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}

/** "3 minutes ago" — a sync time only needs to be roughly right. */
function agoText(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function SourceCard({ source, usedBy, onSave, onDelete }) {
  const { getIdToken } = useAuth()
  const [draft, setDraft] = useState(source)
  const [available, setAvailable] = useState([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncReport, setSyncReport] = useState(null)
  // A handful of real rows per tab, from the last sync. Component state
  // only: this is for showing an admin what a formula produces, and rows
  // have no business being written into the workspace document.
  const [samples, setSamples] = useState({})
  // A source card is tall: a sheet id, forty tab checkboxes, the calculated
  // columns and a sync report. Three of them and the one you want is off the
  // bottom of the screen. Folded by default, and the closed row says enough
  // to pick the right one without opening any of them.
  //
  // Up here with the other hooks, not beside the early return it controls:
  // a hook below that return would be skipped whenever the card is folded,
  // which is the "rendered fewer hooks than expected" crash.
  const [open, setOpen] = useState(false)

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const sheetId = extractSheetId(draft.sheetId)
  const dirty = !stableEqual({ ...draft, sheetId }, source)

  async function loadTabs() {
    if (!sheetId) {
      setMessage({ type: 'error', text: 'Paste a spreadsheet link or ID first.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const idToken = await getIdToken()
      const result = await fetchSpreadsheetTabs(idToken, sheetId, source.id)
      setAvailable(result.tabs || [])
      setTitle(result.title || '')
      // Name the source after the spreadsheet the first time, so nobody has
      // to invent a name for something Google already named.
      if (result.title && /^Spreadsheet \d+$/.test(draft.name)) set({ name: result.title })
      if (!result.tabs?.length) setMessage({ type: 'error', text: 'That spreadsheet has no readable tabs.' })
    } catch (e) {
      setMessage({
        type: 'error',
        text: `${e.message} — make sure the sheet is shared with your service account's email.`,
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Reads the saved tabs and refreshes their column lists.
   *
   * Deliberately reads what is SAVED, not the draft: syncing tabs you have
   * ticked but not saved would report columns for a configuration that isn't
   * stored anywhere. The button is disabled while there are unsaved changes
   * and says why.
   */
  async function sync() {
    setSyncing(true)
    setSyncReport(null)
    setMessage(null)
    try {
      const idToken = await getIdToken()
      const result = await syncSource(idToken, source.id)
      setSyncReport(result)
      setSamples(
        Object.fromEntries(Object.entries(result.tabs || {}).map(([tab, info]) => [tab, info.sample || []]))
      )
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSyncing(false)
    }
  }

  const shownTabs = available.length ? available : draft.tabs || []
  const selected = draft.tabs || []
  const computedCount = Object.values(source.computed || {}).reduce(
    (sum, list) => sum + (list || []).filter((c) => c?.name && c?.formula).length,
    0
  )
  const lastSynced = agoText(source.lastSyncedAt)
  const knownColumns = Object.keys(source.tabHeaders || {}).length
  const needsSync = selected.length > 0 && knownColumns < selected.length

  function toggleTab(name) {
    set({ tabs: selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name] })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-slate-300 hover:bg-slate-50/60"
      >
        <ChevronRight size={14} className="shrink-0 text-slate-400" />
        <Database size={14} className="shrink-0 text-slate-400" />
        <span className="truncate font-medium text-ink">{source.name || 'Untitled spreadsheet'}</span>

        <span className="truncate text-[11px] text-slate-400">
          {selected.length} tab{selected.length === 1 ? '' : 's'}
          {computedCount > 0 && ` · ${computedCount} calculated`}
          {lastSynced ? ` · synced ${lastSynced}` : ' · never synced'}
        </span>

        {/* The two things that decide whether this card needs opening. */}
        {dirty && (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">unsaved</span>
        )}
        {needsSync && !dirty && (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">needs a sync</span>
        )}

        <span className="ml-auto shrink-0 text-[11px] text-slate-400">
          {usedBy.length === 0 ? 'unused' : `used by ${usedBy.length} page${usedBy.length === 1 ? '' : 's'}`}
        </span>
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <button
        onClick={() => setOpen(false)}
        className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700"
      >
        <ChevronDown size={14} /> {source.name || 'Untitled spreadsheet'}
      </button>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Name shown in pickers" className="w-56">
          <TextInput value={draft.name} onChange={(v) => set({ name: v })} placeholder="Premia Sales" />
        </Field>
        <Field label="Google Sheet link or ID" className="min-w-[260px] flex-1">
          <TextInput
            value={draft.sheetId}
            onChange={(v) => set({ sheetId: v })}
            placeholder="https://docs.google.com/spreadsheets/d/1F0HI0…/edit"
          />
        </Field>
        <Btn onClick={loadTabs} variant="accent" disabled={busy}>
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Load tabs
        </Btn>

        <button
          onClick={() => {
            if (usedBy.length > 0) return
            // eslint-disable-next-line no-alert
            if (window.confirm(`Disconnect "${source.name}"? Its data stays in Google — only this connection is removed.`)) {
              onDelete(source.id)
            }
          }}
          disabled={usedBy.length > 0}
          title={
            usedBy.length > 0
              ? `In use by ${usedBy.map((p) => p.name).join(', ')} — remove it from those pages first`
              : 'Disconnect this spreadsheet'
          }
          className="rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {title && (
        <p className="mb-2 flex items-center gap-1 text-xs text-emerald-600">
          <Check size={12} /> Connected to “{title}” · {available.length} tabs found
        </p>
      )}
      {message && (
        <p className={`mb-2 text-xs ${message.type === 'error' ? 'text-rose-500' : 'text-slate-500'}`}>{message.text}</p>
      )}

      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <Database size={11} /> Tabs this workspace may read
        {selected.length > 0 && <span className="text-slate-400">({selected.length} selected)</span>}
      </p>

      {shownTabs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
          No tabs yet — paste the sheet link above and click “Load tabs”.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 lg:grid-cols-4">
          {shownTabs.map((name) => (
            <label
              key={name}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                selected.includes(name)
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              <input type="checkbox" checked={selected.includes(name)} onChange={() => toggleTab(name)} />
              <span className="truncate" title={name}>
                {name}
              </span>
            </label>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="mt-2 flex gap-3 text-xs">
          <button className="text-indigo-600 underline" onClick={() => set({ tabs: available })}>
            Select all
          </button>
          <button className="text-slate-400 underline" onClick={() => set({ tabs: [] })}>
            Clear
          </button>
        </div>
      )}

      {selected.length > 0 && (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
          <ComputedColumns
            tabs={selected}
            tabHeaders={source.tabHeaders || {}}
            computed={draft.computed || {}}
            sampleRows={samples}
            dateOrder={draft.dateOrder || 'DMY'}
            onChange={(next) => set({ computed: next })}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field
          label="Date format in this spreadsheet"
          className="w-64"
          hint="Only matters for ambiguous dates like 05/06/2024."
        >
          <Select
            value={draft.dateOrder || 'DMY'}
            onChange={(v) => set({ dateOrder: v })}
            options={[
              { value: 'DMY', label: 'Day / Month / Year (25/06/2024)' },
              { value: 'MDY', label: 'Month / Day / Year (06/25/2024)' },
            ]}
          />
        </Field>

        <div className="flex items-center gap-2 pb-1">
          <Btn
            variant="primary"
            disabled={!dirty || !sheetId || selected.length === 0}
            onClick={() => {
              onSave({ ...draft, sheetId })
              setMessage({ type: 'ok', text: 'Saved.' })
            }}
          >
            Save source
          </Btn>

          {/* Pulls the saved tabs and refreshes their column lists, so the
              widget pickers know what's in this sheet without anyone having
              to open a dashboard first. */}
          <Btn
            onClick={sync}
            disabled={syncing || dirty || !source.sheetId || (source.tabs || []).length === 0}
            title={
              dirty
                ? 'Save the source first — sync reads what is stored, not what is on screen'
                : 'Read the selected tabs and refresh their column lists'
            }
            className={needsSync && !dirty ? '!border-amber-300 !bg-amber-50 !text-amber-700' : ''}
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync data'}
          </Btn>

          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>

        <p className="ml-auto pb-2 text-[11px] text-slate-400">
          {usedBy.length === 0 ? 'Not used by any page yet' : `Used by ${usedBy.map((p) => p.name).join(', ')}`}
        </p>
      </div>

      {/* --- Sync state ------------------------------------------------- */}
      {!dirty && needsSync && !syncReport && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
          {knownColumns === 0
            ? 'No columns known yet — hit Sync data so the widget and filter pickers can offer this sheet’s columns.'
            : `Columns known for ${knownColumns} of ${selected.length} tabs — Sync data to fetch the rest.`}
        </p>
      )}

      {syncReport && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <Check size={11} className="text-emerald-600" />
            Synced {Object.keys(syncReport.tabs).length} tab
            {Object.keys(syncReport.tabs).length === 1 ? '' : 's'}
          </p>
          <div className="grid grid-cols-1 gap-0.5 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(syncReport.tabs).map(([tab, info]) => (
              <p key={tab} className="truncate text-[10px]" title={info.error || undefined}>
                <span className="font-medium text-slate-600">{tab}</span>{' '}
                {info.error ? (
                  // A single bad tab is reported on its own line rather than
                  // failing the whole sync -- the other tabs are still fine.
                  <span className="text-rose-600">· {info.error}</span>
                ) : (
                  <span className="text-slate-400">
                    · {info.rows.toLocaleString('en-IN')} rows · {info.columns} cols
                  </span>
                )}
              </p>
            ))}
          </div>
        </div>
      )}

      {lastSynced && !syncReport && (
        <p className="mt-1.5 text-[10px] text-slate-400">Last synced {lastSynced}</p>
      )}
    </div>
  )
}
