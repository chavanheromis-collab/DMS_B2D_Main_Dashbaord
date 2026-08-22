import { useState } from 'react'
import { Check, Database, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { extractSheetId } from '../../lib/config'
import { fetchSpreadsheetTabs } from '../../lib/sheetsApi'
import { emptySource } from '../../lib/workspace'
import { useAuth } from '../../context/AuthContext.jsx'
import { Btn, Field, Select, TextInput, stableEqual } from './ui.jsx'

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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <Btn variant="accent" onClick={() => onSave(emptySource(`Spreadsheet ${sources.length + 1}`))}>
          <Plus size={13} /> Connect a spreadsheet
        </Btn>
        <p className="max-w-xl text-[11px] text-slate-400">
          Each spreadsheet is connected once and can then feed any number of pages. Remember to share the sheet with
          your service account’s email, exactly as you’d share it with a person.
        </p>
      </div>

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

function SourceCard({ source, usedBy, onSave, onDelete }) {
  const { getIdToken } = useAuth()
  const [draft, setDraft] = useState(source)
  const [available, setAvailable] = useState([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

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

  const shownTabs = available.length ? available : draft.tabs || []
  const selected = draft.tabs || []

  function toggleTab(name) {
    set({ tabs: selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name] })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
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
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>

        <p className="ml-auto pb-2 text-[11px] text-slate-400">
          {usedBy.length === 0 ? 'Not used by any page yet' : `Used by ${usedBy.map((p) => p.name).join(', ')}`}
        </p>
      </div>
    </div>
  )
}
