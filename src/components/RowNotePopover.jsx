import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, MessageSquarePlus, Pencil, Send, StickyNote, Trash2, X } from 'lucide-react'
import {
  MAX_REMARK,
  authorTooltip,
  editProblem,
  editedTooltip,
  exactWhen,
  isEdited,
  isMine,
  remarkProblem,
  remarksOf,
} from '../lib/rowNotes'
import { initialsOf, tintFor } from '../lib/avatar'
import { whenText } from '../lib/messages'

const MARGIN = 8
const WIDTH = 320

/**
 * Rewording one remark, in place.
 *
 * In place rather than in the box at the bottom, because an edit is a
 * correction to something with a position in the conversation -- moving it
 * to the end would lose what it was answering.
 *
 * Escape cancels and STOPS THERE: without stopping the event, the panel's
 * own Escape listener would close the whole note and lose the edit as well.
 */
function EditBox({ remark, onCancel, onSave }) {
  const ref = useRef(null)
  const [text, setText] = useState(remark.text || '')
  const [saving, setSaving] = useState(false)
  const problem = editProblem(remark, text)

  useEffect(() => {
    const box = ref.current
    if (!box) return
    box.focus()
    // Cursor at the END, not selecting everything: an edit is usually a
    // few words added, and select-all means one keystroke destroys the lot.
    box.setSelectionRange(box.value.length, box.value.length)
  }, [])

  async function save() {
    if (problem || saving) return
    setSaving(true)
    try {
      await onSave(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg rounded-tl-none border border-indigo-200 bg-white p-1.5">
      <textarea
        ref={ref}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_REMARK))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          }
        }}
        className="w-full resize-none rounded-md border border-slate-200 px-1.5 py-1 text-[12px] focus:border-indigo-400 focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] text-slate-400">{problem || 'Enter to save'}</span>
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={Boolean(problem) || saving}
          className="flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          <Check size={11} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/**
 * The note behind a row's button.
 *
 * Portalled to `<body>` and positioned fixed, for the same reason the column
 * filter menu is: the table scrolls inside a card with `overflow: auto`, so
 * a panel rendered in the row would be clipped by the row below it.
 *
 * It is a THREAD, not a field. Several people write on the same note, and
 * each remark keeps the name of whoever wrote it and the moment they did.
 *
 * You may reword or take back YOUR OWN, and only your own. An edit keeps the
 * author, the name against it and the moment it was first written -- so it
 * changes what was said, never who said it or when -- and leaves an "edited"
 * mark behind it. A remark colleagues have already acted on quietly becoming
 * a different sentence is the hazard; one that says it was changed, and
 * when, is a correction. Both halves are enforced in firestore.rules, not
 * just here: a rule enforced only in the UI is a rule enforced nowhere.
 */
export default function RowNotePopover({
  anchorRect,
  title,
  note,
  uid,
  onAdd,
  onEdit,
  onRemove,
  onClose,
}) {
  const ref = useRef(null)
  const boxRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [text, setText] = useState('')
  const [failed, setFailed] = useState('')
  const [sending, setSending] = useState(false)
  // Which remark is being reworded, keyed by the moment it was written --
  // an index would follow the wrong remark the instant somebody else's
  // arrives and the thread re-sorts underneath it.
  const [editingAt, setEditingAt] = useState(null)

  const remarks = useMemo(() => remarksOf(note), [note])
  const problem = remarkProblem(text)

  // Placed after measuring, so a note opened on the last row or against the
  // right edge of the window flips rather than hanging off it.
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return
    const box = ref.current.getBoundingClientRect()
    const left = Math.max(MARGIN, Math.min(anchorRect.left, window.innerWidth - box.width - MARGIN))
    const below = anchorRect.bottom + 6
    const top =
      below + box.height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, anchorRect.top - box.height - 6)
        : below
    setPos({ left, top })
  }, [anchorRect, remarks.length])

  // Straight into the box: the button was pressed to write something.
  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  // The newest is at the bottom, so that is where the thread opens.
  useEffect(() => {
    const list = ref.current?.querySelector('[data-thread]')
    if (list) list.scrollTop = list.scrollHeight
  }, [remarks.length])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    // A fixed panel would drift away from its row on scroll.
    function onScroll(e) {
      if (ref.current && e.target && ref.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  async function submit() {
    if (problem || sending) return
    setSending(true)
    setFailed('')
    try {
      await onAdd(text)
      setText('')
      boxRef.current?.focus()
    } catch (e) {
      // A rejected write is almost always a rule, and silence here means
      // somebody believes they wrote something they did not.
      setFailed(e?.message || 'That could not be saved')
    } finally {
      setSending(false)
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Remarks on ${title}`}
      className="no-print fixed z-50 flex max-h-[26rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5"
      style={{
        width: WIDTH,
        maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        // Measured before it is placed; showing it at -9999 first would be a
        // flash of a note in the corner of the screen.
        visibility: pos ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2 border-b border-slate-100 bg-amber-50/60 px-3 py-2">
        <StickyNote size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-slate-700" title={title}>
            {title}
          </p>
          <p className="text-[10px] text-slate-400">
            {remarks.length === 0
              ? 'No remarks yet'
              : `${remarks.length} remark${remarks.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close remarks"
          className="-mr-1 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={14} />
        </button>
      </div>

      {/* --- the thread, oldest first --------------------------------- */}
      <div data-thread className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
        {remarks.length === 0 && (
          <div className="py-6 text-center">
            <MessageSquarePlus size={20} className="mx-auto mb-1.5 text-slate-200" />
            <p className="text-[11px] text-slate-400">
              Be the first to write something about this row.
            </p>
          </div>
        )}

        {remarks.map((r, i) => {
          const tint = tintFor(r.by || r.byName)
          const mine = isMine(r, uid)
          const editing = mine && editingAt === r.at
          return (
            <div key={`${r.at}-${r.by}-${i}`} className="flex gap-2">
              {/* `title`, not a styled bubble: the thread scrolls, and a
                  container that scrolls clips BOTH axes -- so a tooltip
                  drawn inside it would be cut off on exactly the remarks
                  people reach for first, the one at the top and the one at
                  the bottom. A native tooltip is drawn by the browser over
                  everything and cannot be clipped by anything.

                  Left out of the accessibility tree on purpose: the name is
                  already the text beside it, and a screen reader announcing
                  it twice is worse than not announcing the picture. */}
              <span
                aria-hidden
                title={authorTooltip(r)}
                className="mt-0.5 flex h-6 w-6 shrink-0 cursor-help items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-transparent transition hover:ring-slate-300"
                style={{ backgroundColor: tint.bg, color: tint.fg }}
              >
                {initialsOf(r.byName)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] text-slate-400">
                  <strong className="text-[11px] font-semibold text-slate-600">
                    {mine ? 'You' : r.byName || 'Someone'}
                  </strong>
                  {/* Relative for skimming, exact on hover -- a remark is a
                      record, and "2d ago" is not a date anybody can quote. */}
                  <span title={exactWhen(r.at)}>{whenText(r.at)}</span>
                  {/* Said, and dated, because an edit nobody can see is
                      how a remark somebody acted on becomes a different
                      sentence. */}
                  {isEdited(r) && (
                    <span className="italic text-slate-300" title={editedTooltip(r)}>
                      · edited
                    </span>
                  )}
                  {mine && !editing && (
                    <span className="ml-auto flex items-center gap-0.5">
                      <button
                        onClick={() => {
                          setEditingAt(r.at)
                          setFailed('')
                        }}
                        title="Edit this remark"
                        aria-label="Edit this remark"
                        className="rounded p-0.5 text-slate-300 hover:bg-indigo-50 hover:text-indigo-500"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => onRemove(r)}
                        title="Delete this remark"
                        aria-label="Delete this remark"
                        className="rounded p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  )}
                </p>

                {editing ? (
                  <EditBox
                    remark={r}
                    onCancel={() => setEditingAt(null)}
                    onSave={async (next) => {
                      await onEdit(r, next)
                      setEditingAt(null)
                    }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words rounded-lg rounded-tl-none bg-slate-50 px-2 py-1.5 text-[12px] leading-snug text-slate-700">
                    {r.text}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* --- writing one ---------------------------------------------- */}
      <div className="border-t border-slate-100 bg-slate-50/70 p-2">
        <textarea
          ref={boxRef}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_REMARK))}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line -- the shape every
            // messaging app has taught people to expect.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Add a remark…"
          className="w-full resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] focus:border-indigo-400 focus:outline-none"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400">
            {text.length > MAX_REMARK - 100 ? `${text.length}/${MAX_REMARK}` : 'Enter to save'}
          </span>
          <button
            onClick={submit}
            disabled={Boolean(problem) || sending}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            <Send size={11} /> {sending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {failed && (
          <p className="mt-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-600">
            {failed}
          </p>
        )}
      </div>
    </div>,
    document.body
  )
}
