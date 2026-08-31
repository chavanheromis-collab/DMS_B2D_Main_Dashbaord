import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus, Send, StickyNote, Trash2, X } from 'lucide-react'
import {
  MAX_REMARK,
  exactWhen,
  initialsOf,
  isMine,
  remarkProblem,
  remarksOf,
  tintFor,
} from '../lib/rowNotes'
import { whenText } from '../lib/messages'

const MARGIN = 8
const WIDTH = 320

/**
 * The note behind a row's button.
 *
 * Portalled to `<body>` and positioned fixed, for the same reason the column
 * filter menu is: the table scrolls inside a card with `overflow: auto`, so
 * a panel rendered in the row would be clipped by the row below it.
 *
 * It is a THREAD, not a field. Several people write on the same note, each
 * remark keeps the name of whoever wrote it and the moment they did, and
 * nothing is ever edited -- taking your own back is the only way a remark
 * changes, because a remark somebody else has already acted on should not
 * quietly become a different sentence.
 */
export default function RowNotePopover({
  anchorRect,
  title,
  note,
  uid,
  onAdd,
  onRemove,
  onClose,
}) {
  const ref = useRef(null)
  const boxRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [text, setText] = useState('')
  const [failed, setFailed] = useState('')
  const [sending, setSending] = useState(false)

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
          return (
            <div key={`${r.at}-${r.by}-${i}`} className="flex gap-2">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
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
                  {mine && (
                    <button
                      onClick={() => onRemove(r)}
                      title="Delete this remark"
                      aria-label="Delete this remark"
                      className="ml-auto rounded p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words rounded-lg rounded-tl-none bg-slate-50 px-2 py-1.5 text-[12px] leading-snug text-slate-700">
                  {r.text}
                </p>
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
