import { useEffect, useState } from 'react'
import { X, Check, Copy, Eraser, MessageSquare, Save } from 'lucide-react'
import { badgeStyle } from '../lib/dataUtils'
import { isStrayValue, optionsForCell } from '../lib/columnChoices'
import { useTypingBuffer } from '../hooks/useTypingBuffer'
import { isRequired, missingNote, missingRequired, requiredColumnsOf } from '../lib/requiredColumns'
import {
  fromDateInputValue,
  htmlInputType,
  inputMode,
  inputTypeFor,
  invalidChanges,
  invalidNote,
  toDateInput,
} from '../lib/inputRules'
import {
  NO_DRAFT,
  changeCount,
  changedFields,
  clearedDraft,
  draftField,
  fieldValue,
  unsavedNote,
} from '../lib/rowForm'

/**
 * One text field of the form.
 *
 * It owns what is being typed and tells the form when the typing pauses --
 * the same buffer the table's own cells and the sticky notes use. Handing
 * every keystroke straight to the form would re-render thirty fields per
 * letter, which is where fast typing starts dropping characters.
 *
 * It flushes on the way out, and blur fires on the mousedown that begins a
 * click -- so pressing Save with a half-typed field still saves what is in
 * it, without a race.
 */
function FormInput({ value, onChange, placeholder, type = 'text', dateOrder = 'DMY', invalid }) {
  const [text, onType, flush] = useTypingBuffer(value, onChange)
  const box = `w-full rounded border bg-white px-1.5 py-1 text-xs focus:outline-none ${
    invalid ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-indigo-400'
  }`

  // A remark is not a one-line field, and forcing one into a single line is
  // how a note gets cut short rather than written.
  if (type === 'textarea') {
    return (
      <textarea
        rows={3}
        value={text}
        onChange={(e) => onType(e.target.value)}
        onBlur={flush}
        placeholder={placeholder}
        className={`${box} resize-y`}
      />
    )
  }

  // The picker speaks ISO and the sheet speaks the page's own order, so the
  // conversion happens at the edge of the control rather than anywhere the
  // value is stored. See lib/inputRules.js.
  if (type === 'date') {
    return (
      <input
        type="date"
        value={toDateInput(value, dateOrder)}
        onChange={(e) => onChange(fromDateInputValue(e.target.value, dateOrder))}
        className={box}
      />
    )
  }

  return (
    <input
      type={htmlInputType(type)}
      inputMode={inputMode(type)}
      value={text}
      onChange={(e) => onType(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') flush()
      }}
      placeholder={placeholder}
      className={box}
    />
  )
}

/**
 * Slides in from the right when a row is clicked. Only rendered when the
 * admin has enabled "Open a detail panel on row click" for that table --
 * and it shows only the columns the admin chose for it.
 *
 * Columns this person is allowed to edit are boxes, ready to type in;
 * everything else is text, matching the same per-tab grant the table itself
 * uses. There is no pencil to press first. That made sense when a field
 * wrote itself the moment it closed -- the click was the "are you sure" for
 * a write -- but Save is the write now, so the click before every field
 * bought nothing and cost twenty-two of them to correct eleven fields.
 */
export default function RowDetailPanel({
  open,
  row,
  columns,
  title,
  editableColumns = [],
  // The same lists the table's own cells offer. A form beside a table that
  // asks for the status as free text, while the table two inches away
  // offers a menu of five, is two different rules for one column -- and the
  // typed one is the one that produces "Deliverd" in the chart.
  columnChoices = {},
  // The row's remarks, opened through the table's own popover rather than
  // reimplemented here: they belong to the RECORD, so a remark added from
  // the panel has to be the same note the table's marker shows.
  onOpenNotes,
  noteCount = 0,
  // The whole form, saved in one go. Field-at-a-time meant six writes and
  // six page reloads to correct six fields, no way to change your mind
  // about the third, and a rule firing on a half-corrected row.
  onSaveRow,
  onClose,
  saving,
  // The widget, for the rules that are the ADMIN's rather than the
  // reader's: what each column takes, and which cannot be left empty.
  widget,
  dateOrder = 'DMY',
}) {
  // What has been typed into the form and not yet saved: column -> value.
  // Kept apart from the row so the row can keep moving underneath -- it is
  // re-read live from the sheet, and somebody else's edit to a field this
  // person has not touched should still show. See lib/rowForm.js.
  const [form, setForm] = useState(NO_DRAFT)
  const [copied, setCopied] = useState(null)

  // A DIFFERENT record drops the draft: unsaved changes belong to the
  // record they were typed against, not to the panel. Keyed on the sheet
  // row number rather than the object, because the object is replaced on
  // every reload, and reloading is exactly what saving does -- keying on
  // identity would throw away the rest of the form the moment the first
  // save came back.
  useEffect(() => {
    setForm(NO_DRAFT)
  }, [row?._row])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !row) return null

  /** A field, filled in. Nothing is written until Save. */
  function commit(col, next) {
    setForm((current) => draftField(current, col, next))
  }

  const changes = changedFields(row, form)
  const pendingCount = changeCount(row, form)

  // Asked of the row AS THE FORM HAS IT -- what will be on the sheet if
  // this is saved -- rather than of the row as it stands. Filling a
  // required field in is the whole point, and a check against the sheet
  // would still be complaining about it while the value sat on screen.
  const missing = missingRequired(
    widget,
    { ...row, ...form },
    { columns, editable: editableColumns }
  )

  // What is wrong with the values TYPED, not with the ones already on the
  // record: a row that has always held a malformed phone number is not a
  // row somebody is forbidden to fix the remark on.
  const bad = invalidChanges(widget, changes, dateOrder)
  const badBy = Object.fromEntries(bad.map((p) => [p.column, p.problem]))

  async function save() {
    if (pendingCount === 0 || missing.length > 0 || bad.length > 0) return
    // Cleared FIRST. The save reloads the page, the row comes back with the
    // new values on it, and a draft still holding them would then read as
    // "0 unsaved" anyway -- but only after a render in which the bar was
    // still offering to save what had just been saved.
    setForm(NO_DRAFT)
    await onSaveRow?.(row, changes)
  }

  function copy(col) {
    navigator.clipboard?.writeText(String(row[col] ?? ''))
    setCopied(col)
    setTimeout(() => setCopied(null), 1200)
  }

  const filled = columns.filter((c) => String(fieldValue(row, form, c)).trim() !== '').length

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
          <div className="flex shrink-0 items-center gap-1">
            {onOpenNotes && (
              <button
                onClick={(e) => onOpenNotes(e.currentTarget.getBoundingClientRect())}
                title={noteCount > 0 ? `${noteCount} remark${noteCount === 1 ? '' : 's'}` : 'Add a remark'}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium ${
                  noteCount > 0
                    ? 'bg-white/70 text-indigo-600'
                    : 'text-slate-400 hover:bg-white/70 hover:text-slate-700'
                }`}
              >
                <MessageSquare size={13} />
                {noteCount > 0 && <span className="tabular-nums">{noteCount}</span>}
              </button>
            )}
            <button
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <dl className="space-y-1">
            {columns.map((col) => {
              // What the field SHOWS: what has been typed into the form,
              // falling back to the sheet. Reading the row directly would
              // mean a field went back to its old value the moment it lost
              // focus, and stayed there until Save.
              const value = fieldValue(row, form, col)
              const canEdit = editableColumns.includes(col)
              const touched = Object.prototype.hasOwnProperty.call(form, col) && value !== (row[col] ?? '')
              const needed = isRequired(widget, col, editableColumns)
              const blank = needed && String(value).trim() === ''
              const wrong = badBy[col]
              const type = canEdit ? inputTypeFor(widget, col) : 'text'
              // Only where the field can be edited: a list of choices on a
              // read-only field is a promise the panel cannot keep.
              const choices = canEdit ? columnChoices[col] : null
              const empty = String(value).trim() === ''
              const short = !empty && String(value).length <= 24

              return (
                <div
                  key={col}
                  className={`group grid grid-cols-5 items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 ${
                    blank || wrong
                      ? 'bg-rose-50/70 ring-1 ring-inset ring-rose-200'
                      : touched
                        ? 'bg-amber-50/70 ring-1 ring-inset ring-amber-200'
                        : ''
                  }`}
                >
                  <dt className="col-span-2 pt-1 text-[11px] font-medium text-slate-500">
                    {col}
                    {/* Marked on the field, not only in the bar at the
                        bottom: a list of names down there is a hunt back up
                        the form for each one. */}
                    {needed && (
                      <span className="ml-0.5 text-rose-500" title="Required">
                        *
                      </span>
                    )}
                    {/* Which fields are waiting, without having to
                        remember. A form of twenty fields with three changed
                        is otherwise a memory test. */}
                    {touched && <span className="ml-1 text-[10px] font-normal text-amber-600">edited</span>}
                  </dt>
                  <dd className="col-span-3 flex items-start gap-1">
                    {canEdit ? (
                      // A box, ready to type in. Not a pencil that reveals
                      // one: this is a FORM, and a form whose fields have to
                      // be unlocked one at a time is a form that hides what
                      // it is for. The pencil made sense when each field
                      // wrote itself the moment it was closed -- it was the
                      // "are you sure" for a write. Now that Save is the
                      // write, there is nothing to be sure about yet, and
                      // the click before every field is pure cost:
                      // twenty-two clicks to correct eleven fields.
                      choices ? (
                        /* A list, not a box -- the same rule the table's own
                           cells follow. Typed by hand, "Delivered",
                           "delivered" and "Deliverd" are three statuses, and
                           the chart counting them says so. */
                        <select
                          value={value}
                          onChange={(e) => commit(col, e.target.value)}
                          className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                          // The colour a value is shown in here, so the menu
                          // and the field agree. This panel paints a SHORT
                          // value as a pill -- its own rule, and the one the
                          // options follow, rather than a second idea about
                          // which values are worth a colour.
                          style={short ? badgeStyle(value) : undefined}
                        >
                          {/* Clearing a field has to stay possible: a list
                              with no empty option is a field that can never
                              be emptied once it is set. */}
                          <option value="">—</option>
                          {optionsForCell(choices, value).map((option) => (
                            <option
                              key={option}
                              value={option}
                              style={String(option).length <= 24 ? badgeStyle(option) : undefined}
                            >
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <FormInput
                          value={value}
                          onChange={(next) => commit(col, next)}
                          placeholder="—"
                          type={type}
                          dateOrder={dateOrder}
                          invalid={Boolean(wrong)}
                        />
                      )
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 break-words pt-0.5 text-xs text-slate-700">
                          {empty ? (
                            <span className="text-slate-300">—</span>
                          ) : short ? (
                            <span className="inline-block rounded px-1.5 py-0.5 font-medium" style={badgeStyle(value)}>
                              {value}
                            </span>
                          ) : (
                            value
                          )}
                        </span>
                        {!empty && (
                          <button
                            onClick={() => copy(col)}
                            className="mt-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                            title="Copy"
                          >
                            {copied === col ? (
                              <Check size={12} className="text-emerald-600" />
                            ) : (
                              <Copy size={12} className="text-slate-300 hover:text-slate-600" />
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </dd>

                  {/* Said under the box rather than instead of it: the
                      salesman who left is still who sold it, so the value
                      stays exactly as the sheet has it and the list simply
                      notes that it is not one of its own. */}
                  {/* Under the box it belongs to, and in its words: a list
                      of complaints in the footer is a hunt back up the form
                      for each one. */}
                  {wrong && (
                    <p className="col-span-5 -mt-0.5 pl-2 text-[10px] font-medium text-rose-600">
                      {col} {wrong}
                    </p>
                  )}

                  {choices && !empty && isStrayValue(choices, value) && (
                    <p className="col-span-5 -mt-0.5 pl-2 text-[10px] text-amber-600">
                      “{value}” is not one of the values this column offers.
                    </p>
                  )}
                </div>
              )
            })}
          </dl>
        </div>

        {/* Save and Clear, on the form rather than on each field.
            Going through a record and putting it right is one gesture, and
            it ends when the person says it does -- not when a field
            happens to lose focus. */}
        {editableColumns.length > 0 && (
          <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2">
            <button
              onClick={() =>
                setForm(clearedDraft(row, columns, editableColumns, requiredColumnsOf(widget)))
              }
              disabled={saving}
              title="Empty every field you can edit, except the ones that are required — nothing is written until you press Save"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:border-rose-200 hover:text-rose-600 disabled:opacity-40"
            >
              <Eraser size={13} /> Clear
            </button>

            <button
              onClick={save}
              disabled={pendingCount === 0 || missing.length > 0 || bad.length > 0 || saving}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>

            {missing.length > 0 || bad.length > 0 ? (
              // Ahead of the unsaved count, because it is the reason the
              // button is dead and the count is not.
              <span className="text-[11px] font-medium text-rose-600">
                {missing.length > 0 ? missingNote(missing) : invalidNote(bad)}
              </span>
            ) : (
              pendingCount > 0 && (
                <span className="text-[11px] font-medium text-amber-700">{unsavedNote(pendingCount)}</span>
              )
            )}

            {pendingCount > 0 && (
              <>
                {/* A way back that is not "retype the record". Clear is one
                    press and it empties everything, so undoing it has to be
                    one press too. */}
                <button
                  onClick={() => setForm(NO_DRAFT)}
                  className="ml-auto text-[11px] text-slate-400 underline hover:text-slate-600"
                >
                  discard
                </button>
              </>
            )}
          </div>
        )}

        <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
          Press <kbd className="rounded border border-slate-200 px-1">Esc</kbd> to close
          {editableColumns.length === 0 && ' · you have read-only access to this tab'}
          {pendingCount > 0 && ' · closing loses unsaved changes'}
        </div>
      </aside>
    </>
  )
}
