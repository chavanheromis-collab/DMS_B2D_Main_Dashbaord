import { useEffect, useState } from 'react'
import { X, Pencil, Check, Copy } from 'lucide-react'
import { badgeColor } from '../lib/dataUtils'

/**
 * Slides in from the right when a row is clicked. Only rendered when the
 * admin has enabled "Open a detail panel on row click" for that table --
 * and it shows only the columns the admin chose for it.
 *
 * Columns the user is allowed to edit get a pencil; everything else is
 * read-only, matching the same per-tab grant the table itself uses.
 */
export default function RowDetailPanel({ open, row, columns, title, editableColumns = [], onEditCell, onClose, saving }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    setEditing(null)
  }, [row])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !row) return null

  async function commit(col) {
    setEditing(null)
    if (draft !== (row[col] ?? '')) await onEditCell?.(row, col, draft)
  }

  function copy(col) {
    navigator.clipboard?.writeText(String(row[col] ?? ''))
    setCopied(col)
    setTimeout(() => setCopied(null), 1200)
  }

  const filled = columns.filter((c) => String(row[c] ?? '').trim() !== '').length

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]" onClick={onClose} />

      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-sky-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">Row details</p>
            <h3 className="truncate font-semibold text-slate-800">{title}</h3>
            <p className="text-[11px] text-slate-400">
              sheet row {row._row} · {filled} of {columns.length} fields filled
              {saving && ' · saving…'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <dl className="space-y-1">
            {columns.map((col) => {
              const value = row[col] ?? ''
              const canEdit = editableColumns.includes(col)
              const isEditing = editing === col
              const empty = String(value).trim() === ''
              const short = !empty && String(value).length <= 24

              return (
                <div
                  key={col}
                  className="group grid grid-cols-5 items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <dt className="col-span-2 pt-0.5 text-[11px] font-medium text-slate-500">{col}</dt>
                  <dd className="col-span-3 flex items-start gap-1">
                    {isEditing ? (
                      <>
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commit(col)
                            if (e.key === 'Escape') setEditing(null)
                          }}
                          className="w-full rounded border border-indigo-300 px-1.5 py-0.5 text-xs"
                        />
                        <button onClick={() => commit(col)} className="text-emerald-600" title="Save">
                          <Check size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 break-words text-xs text-slate-700">
                          {empty ? (
                            <span className="text-slate-300">—</span>
                          ) : short ? (
                            <span
                              className="inline-block rounded px-1.5 py-0.5 font-medium"
                              style={{ backgroundColor: badgeColor(value).bg, color: badgeColor(value).fg }}
                            >
                              {value}
                            </span>
                          ) : (
                            value
                          )}
                        </span>
                        {!empty && (
                          <button
                            onClick={() => copy(col)}
                            className="opacity-0 transition-opacity group-hover:opacity-100"
                            title="Copy"
                          >
                            {copied === col ? (
                              <Check size={12} className="text-emerald-600" />
                            ) : (
                              <Copy size={12} className="text-slate-300 hover:text-slate-600" />
                            )}
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => {
                              setEditing(col)
                              setDraft(String(value))
                            }}
                            className="text-slate-300 hover:text-indigo-600"
                            title="Edit this field"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>

        <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
          Press <kbd className="rounded border border-slate-200 px-1">Esc</kbd> to close
          {editableColumns.length === 0 && ' · you have read-only access to this tab'}
        </div>
      </aside>
    </>
  )
}
