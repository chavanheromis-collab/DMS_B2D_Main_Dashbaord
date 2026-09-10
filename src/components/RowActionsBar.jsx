import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckSquare, Copy, Loader2, Lock, Scissors, Trash2, X } from 'lucide-react'

import { confirmLabel, limitNote, resolvePairs, rowCount, routeNote, tooMany } from '../lib/rowOps'

// ---------------------------------------------------------------------
// What to do with the rows you have ticked
// ---------------------------------------------------------------------
// A band directly above the grid, there only while something is selected,
// and built to read as a member of the same family as the page's control
// bar -- same button shape, same sizing, same accent. What can be done to
// what is on the table belongs in the same visual place as what narrows
// it.
//
// It sits ABOVE rather than below for two reasons. On a tall table the
// buttons were a scroll away from the rows they act on, and a bar hanging
// over the bottom edge covered the last row -- the one somebody is most
// likely to have just ticked, hidden behind the thing about to delete it.
//
// Three more decisions in it, and all three are about the same thing -- a
// row operation is not a cell edit and must not feel like one:
//
//   IT SAYS THE COUNT ON EVERY BUTTON, not just on the bar. The failure
//   this whole feature has to survive is acting on a selection that is not
//   the one you think you have -- rows ticked before a search narrowed the
//   table, a select-all that took in more than the screen showed. "Delete"
//   is a button you press without reading. "Delete 43 rows" is not.
//
//   THE DESTRUCTIVE ONE ASKS AGAIN. Not a browser confirm(), which is a
//   dialog nobody reads and which cannot show what is about to go. A panel
//   that lists the first few rows by their own values, so the question is
//   "are these the records?" rather than "are you sure?".
//
//   A COPY SAYS WHAT WILL NOT CARRY. Columns map across tabs by NAME, so
//   sending a quotation to Bookings drops whatever Bookings has no column
//   for. Said before it happens, with the names, because discovered
//   afterwards it is discovered by whoever is reconciling the month.

export default function RowActionsBar({
  rows,
  actions = [],
  canMove = false,
  // [{ ref, label }] -- a destination is usually a tab with no widget on
  // the page, so there is no label space to look it up in. The ref travels
  // with it and is what goes to the server.
  targets = [],
  headersFor,
  // The columns ON SCREEN, for the preview -- what the reader is looking at
  // is how they recognise a record.
  columns = [],
  // ...and every column the TAB has, for the mapping. The two are different
  // whenever an admin has hidden a column, and the mapping has to use this
  // one: the server copies what the ROW holds, not what the table shows, so
  // measuring against the visible columns understates what carries -- and
  // on a table narrowed to a few columns it can claim nothing carries at
  // all and disable a copy that would have worked perfectly.
  sourceHeaders = [],
  // The tab the ticked rows are ON. Not a choice -- they were ticked in one
  // table -- but named on screen, because "Quotations → Bookings" is the
  // sentence somebody is checking before they press Move.
  sourceLabel = '',
  busy = false,
  onClear,
  onDelete,
  onCopy,
}) {
  // 'delete' | 'copy' | 'move' | null. Copy and move are separate actions
  // rather than one action with a checkbox on it: they are different
  // sentences, one of them takes rows away, and a checkbox is the control
  // people press without reading.
  const [asking, setAsking] = useState(null)
  const [error, setError] = useState(null)
  const n = rows.length

  // A dialog left open over a selection that has since been pruned would be
  // asking about rows that are no longer there.
  useEffect(() => {
    if (n === 0) {
      setAsking(null)
      setError(null)
    }
  }, [n])

  if (n === 0) return null

  const over = tooMany(n)

  async function run(work) {
    setError(null)
    try {
      await work()
      setAsking(null)
      onClear()
    } catch (e) {
      // Kept ON the dialog rather than sent to the page's error strip: the
      // commonest refusal here is "these rows have moved, refresh and look
      // again", and it is only actionable next to the rows it is about.
      setError(e.message)
    }
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
          <CheckSquare size={13} />
          {rowCount(n)} selected
        </span>

        {over && (
          <span className="flex items-center gap-1 text-[10px] text-amber-700">
            <AlertTriangle size={11} /> {limitNote(n)}
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {actions.includes('canCopyRows') && (
            <BarButton
              icon={<Copy size={13} />}
              label="Copy to…"
              disabled={busy || over}
              onClick={() => setAsking('copy')}
            />
          )}
          {actions.includes('canCopyRows') && canMove && (
            <BarButton
              icon={<Scissors size={13} />}
              label="Move to…"
              tone="danger"
              disabled={busy || over}
              onClick={() => setAsking('move')}
            />
          )}
          {actions.includes('canDeleteRows') && (
            <BarButton
              icon={<Trash2 size={13} />}
              label={confirmLabel('delete', n)}
              tone="danger"
              disabled={busy || over}
              onClick={() => setAsking('delete')}
            />
          )}
          <button
            onClick={onClear}
            className="rounded-lg p-1.5 text-indigo-400 hover:bg-white hover:text-indigo-700"
            aria-label="Clear the selection"
            title="Clear the selection"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {asking === 'delete' && (
        <ConfirmDelete
          rows={rows}
          columns={columns}
          busy={busy}
          error={error}
          onCancel={() => setAsking(null)}
          onConfirm={() => run(onDelete)}
        />
      )}

      {(asking === 'copy' || asking === 'move') && (
        <TransferDialog
          move={asking === 'move'}
          rows={rows}
          columns={columns}
          sourceLabel={sourceLabel}
          sourceHeaders={sourceHeaders.length ? sourceHeaders : columns}
          targets={targets}
          headersFor={headersFor}
          busy={busy}
          error={error}
          onCancel={() => setAsking(null)}
          onConfirm={(target) => run(() => onCopy(target, { move: asking === 'move' }))}
        />
      )}
    </>
  )
}

/**
 * One action, shaped like a control on the page's own bar.
 *
 * Same radius, padding and text size as the buttons above the canvas, so
 * the two bands read as one system rather than as a widget having grown a
 * toolbar of its own.
 */
function BarButton({ icon, label, onClick, disabled, tone = 'plain' }) {
  const tones = {
    plain: 'border-indigo-200 bg-white text-slate-600 hover:bg-indigo-100 hover:text-indigo-700',
    danger: 'border-rose-200 bg-white text-rose-600 hover:bg-rose-50',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {icon}
      {label}
    </button>
  )
}

/** The shell both dialogs sit in. */
function Dialog({ title, children, footer, onCancel, error }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/30 p-4" onMouseDown={onCancel}>
      <div
        className="max-h-[85vh] w-[440px] max-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-2xl"
        // The backdrop closes on a press; the panel must not, or a drag
        // that starts on a value and ends on the backdrop shuts it.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-[13px] font-semibold text-slate-700">{title}</h3>
        {children}
        {error && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
            <AlertTriangle size={12} className="mt-px shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  )
}

/**
 * A few of the rows, by the values that identify them.
 *
 * The first three columns rather than all of them: this is a "are these the
 * records?" question and a table of thirty columns is not a question, it is
 * the thing you were trying to avoid reading.
 */
function RowPreview({ rows, columns, limit = 5 }) {
  const shown = columns.slice(0, 3)
  const rest = rows.length - limit
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-1.5">
      {rows.slice(0, limit).map((row) => (
        <div key={row._row} className="truncate text-[11px] text-slate-600">
          <span className="mr-1.5 text-[10px] text-slate-300">#{row._row}</span>
          {shown.map((c) => String(row[c] ?? '')).filter(Boolean).join(' · ') || <em className="text-slate-300">blank row</em>}
        </div>
      ))}
      {rest > 0 && <p className="pt-0.5 text-[10px] text-slate-400">and {rest} more</p>}
    </div>
  )
}

function ConfirmDelete({ rows, columns, busy, error, onCancel, onConfirm }) {
  return (
    <Dialog
      title={`Delete ${rowCount(rows.length)}?`}
      error={error}
      onCancel={onCancel}
      footer={
        <>
          <button onClick={onCancel} className="rounded-lg px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {confirmLabel('delete', rows.length)}
          </button>
        </>
      }
    >
      <p className="mb-2 text-[11px] text-slate-500">
        This removes them from the spreadsheet itself. There is no undo — and nothing on the page afterwards to say
        what was here.
      </p>
      <RowPreview rows={rows} columns={columns} />
    </Dialog>
  )
}

/**
 * Sending rows somewhere else, and saying exactly what will land where.
 *
 * The route reads left to right -- the tab the rows are on, an arrow, the
 * tab they are going to -- and under it the column pairs, which is the
 * thing that actually decides whether this was a good idea. Three
 * decisions in here:
 *
 *   THE SOURCE IS SHOWN, NOT CHOSEN. The rows were ticked in one table, so
 *   there is exactly one answer and a picker offering it would be a
 *   question with no second option. It is on screen because a route with
 *   only one end named is one nobody can check.
 *
 *   THE MAPPING OPENS ON THE ADMIN'S ROUTE and can be changed. Whoever set
 *   the page up knows that Quotation No becomes Booking Ref; whoever is
 *   filing today knows this batch is going in as cancellations. Both are
 *   real, so the route is a starting point rather than a rule.
 *
 *   A PAIR AIMED NOWHERE IS DROPPED, NOT REFUSED. A column deleted in
 *   Google since the route was written, or one this reader may not write
 *   on the target, would otherwise make the whole transfer fail over a
 *   field nobody was thinking about. It is skipped and counted, and the
 *   count is on screen before anything is sent.
 */
function TransferDialog({
  move,
  rows,
  columns,
  sourceLabel,
  sourceHeaders,
  targets,
  headersFor,
  busy,
  error,
  onCancel,
  onConfirm,
}) {
  const [target, setTarget] = useState(targets[0]?.ref || '')

  const chosen = targets.find((t) => t.ref === target)
  const targetLabel = chosen?.label || ''
  const targetHeaders = headersFor(target)
  const known = targetHeaders.length > 0

  // The admin's route, resolved against the columns that actually exist.
  // Shown and not editable: where a value lands is a decision about the
  // sheet rather than about today's batch, and once anyone sending rows can
  // re-point a column, "what is in the Booking Ref column" stops having one
  // answer. The server reads the same route out of the stored widget, so
  // this panel describes what will happen rather than instructing it.
  const resolved = useMemo(
    () => resolvePairs(chosen?.pairs || [], sourceHeaders, targetHeaders),
    [chosen, sourceHeaders, targetHeaders]
  )

  const nothingCarries = known && resolved.pairs.length === 0
  const action = move ? 'move' : 'copy'

  return (
    <Dialog
      title={`${move ? 'Move' : 'Copy'} ${rowCount(rows.length)}`}
      error={error}
      onCancel={onCancel}
      footer={
        <>
          <button onClick={onCancel} className="rounded-lg px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(target)}
            disabled={busy || !target || nothingCarries}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50 ${
              move ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {confirmLabel(action, rows.length, targetLabel || '…')}
          </button>
        </>
      }
    >
      {/* The route, left to right. The source is shown and not chosen: the
          rows were ticked in one table, so there is exactly one answer --
          but a route with only one end named is one nobody can check. */}
      <div className="mb-2 flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">From</span>
          <div
            className="truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500"
            title={sourceLabel}
          >
            {sourceLabel || 'this tab'}
          </div>
        </label>
        <ArrowRight size={13} className="mb-2 shrink-0 text-slate-300" />
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">To</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          >
            {targets.map((t) => (
              <option key={t.ref} value={t.ref}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {move && (
        <p className="mb-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] leading-snug text-rose-700">
          They are deleted from {sourceLabel || 'this tab'} once they have landed. There is no undo.
        </p>
      )}

      {/* --- what lands where ------------------------------------------- */}
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
        <Lock size={10} className="text-slate-300" />
        Columns
        <span className="font-normal text-slate-400">— set by an admin</span>
      </div>

      <div className="mb-1 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-1.5">
        {/* Destination on the LEFT, the same way round as the editor that
            set it up -- "Booking Ref is filled from Quotation No". Showing
            it one way to the admin and the other to the reader is how a
            mapping gets read backwards by whoever is checking it. */}
        {resolved.pairs.length > 0 && (
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300">
            <span className="min-w-0 flex-1 truncate" title={targetLabel}>
              {targetLabel || 'destination'}
            </span>
            <span className="w-2.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={sourceLabel}>
              {sourceLabel || 'this tab'}
            </span>
          </div>
        )}
        {resolved.pairs.map(({ from, to }) => (
          <div key={`${from}->${to}`} className="flex items-center gap-1.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-slate-600" title={to}>
              {to}
            </span>
            <span className="w-2.5 shrink-0 text-center text-[10px] text-slate-300">←</span>
            <span className="min-w-0 flex-1 truncate text-slate-600" title={from}>
              {from}
            </span>
          </div>
        ))}

        {resolved.pairs.length === 0 && (
          <p className="py-1 text-center text-[10px] text-slate-400">
            {known ? 'Nothing is mapped for this destination.' : 'The mapping will be applied when the rows are sent.'}
          </p>
        )}
      </div>

      <p className={`mb-2 text-[10px] ${nothingCarries ? 'text-rose-600' : 'text-slate-500'}`}>
        {routeNote(resolved, { known })}
        {nothingCarries && ' Ask an admin to map the columns for this destination.'}
      </p>

      <RowPreview rows={rows} columns={columns} />
    </Dialog>
  )
}
