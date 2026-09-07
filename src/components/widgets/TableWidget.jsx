import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Filter, GripVertical, Rows3, Search, StickyNote, X } from 'lucide-react'
import { badgeColor, badgeStyle } from '../../lib/dataUtils'
import ExportButton from '../ExportButton.jsx'
import { fetchDownloadMeta, getDownloadActions, triggerDownload } from '../../lib/downloadActions.js'
import RowDetailPanel from '../RowDetailPanel.jsx'
import ColumnFilterMenu from '../ColumnFilterMenu.jsx'
import { activeFilterColumns, applyColumnFilters, columnIsFiltered } from '../../lib/columnFilters'
import RowNotePopover from '../RowNotePopover.jsx'
import { useRowNoteActions, useRowNotes } from '../../hooks/useRowNotes'
import { countLabel, latestSummary, noteIdFor, notesEnabled, remarkCount, rowKeyOf } from '../../lib/rowNotes'
import { isStrayValue, optionsForCell } from '../../lib/columnChoices'
import { clearedNote, columnsToClear } from '../../lib/clearRules'
import { liveRow } from '../../lib/openRow'
import { canFill, fillRange, fillTargets, filledNote, inFillRange } from '../../lib/fillDown'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The little note button on a row.
 *
 * Two states, and the difference between them is the whole point: an empty
 * note is a faint outline that does not compete with the data, and one that
 * has something in it is amber and carries a count. Somebody scanning a
 * table should be able to see WHICH rows have been talked about without
 * opening anything.
 *
 * A row with no key at all gets no button rather than a broken one -- see
 * `rowKeyOf`.
 */
function NoteButton({ row, scope, keyColumn, notes, open, onOpen }) {
  const id = noteIdFor(scope, row, keyColumn)
  if (!id) return null

  const note = notes[id]
  const count = remarkCount(note)
  const label = countLabel(count)

  return (
    <button
      type="button"
      title={latestSummary(note)}
      aria-label={count ? `${count} remarks on this row` : 'Add a remark to this row'}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(e.currentTarget.getBoundingClientRect())
      }}
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
        count
          ? 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
          : 'border-slate-200 bg-white text-slate-300 hover:border-indigo-300 hover:text-indigo-500'
      } ${open ? 'ring-2 ring-indigo-300' : ''}`}
    >
      <StickyNote size={13} />
      {label && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
          {label}
        </span>
      )}
    </button>
  )
}

/**
 * The workhorse table.
 *
 *  - Drag a column header to reorder columns (the grip appears on hover).
 *  - Click a header to sort. SHIFT-click a second header to sort by it as
 *    a tie-breaker; each sorted column shows its priority number, so a
 *    3-level sort is readable at a glance.
 *  - Click a row to open the detail panel (only if the admin enabled it).
 *  - Its own search box narrows just this table, on top of the page filters.
 *
 * Column order and sort live in component state, so each user can rearrange
 * their own view without changing what anyone else sees.
 */
/**
 * One cell being edited, and the typing that goes with it.
 *
 * Its own component with its own state, and that is the point rather than
 * tidiness. The draft used to live on the TABLE, so every keystroke re-drew
 * every visible row -- four hundred of them on a full page, each with its
 * badges, its column filters and its remark markers. Typing quickly then
 * drops characters, because the next keystroke arrives while the browser is
 * still drawing the last one.
 *
 * Nothing is debounced here: an edit is committed deliberately, by Enter or
 * by looking away, so there is nothing to send while the typing is going
 * on. What was needed was simply for the letters to stop costing a table.
 */
function CellEditor({ initial, onCommit, onCancel }) {
  const [text, setText] = useState(initial ?? '')
  return (
    <input
      autoFocus
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(text)
        if (e.key === 'Escape') onCancel()
      }}
      className="w-36 rounded border border-indigo-300 px-1.5 py-0.5 text-sm"
    />
  )
}

export default function TableWidget({
  widget,
  rows,
  tabHeaders,
  tabError,
  editableColumns = [],
  downloadableColumns = [],
  canExport = false,
  onEditCell,
  // Many cells of one column in a single request. A fill drag needs it, and
  // a clearing cascade uses it too -- see writeCell.
  onEditCells,
  saving,
  dateOrder = 'DMY',
  canPersistLayout = false,
  onSaveColumnOrder,
  noteScope = '',
  columnChoices = {},
}) {
  const defaultSorts = useMemo(
    () => (widget.sortBy ? [{ column: widget.sortBy, dir: widget.sortDir || 'asc' }] : []),
    [widget.sortBy, widget.sortDir]
  )
  const [sorts, setSorts] = useState(() => defaultSorts) // [{ column, dir }] -- priority order
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [localSearch, setLocalSearch] = useState('')
  const [order, setOrder] = useState(null) // user's own column order
  const [dragCol, setDragCol] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const [dense, setDense] = useState(false)
  // What was on screen when a panel was opened -- NOT what it shows.
  //
  // Saving a cell reloads the tab, and the reload rebuilds every row from
  // the API response rather than mutating the old ones, so a row captured
  // on click is frozen at the values it had before the edit. Each of these
  // is therefore looked up again in the live rows on every render, by the
  // sheet row number the write itself is addressed by. See lib/openRow.js.
  const [openDetail, setOpenDetail] = useState(null)
  const [savedOrder, setSavedOrder] = useState(false)
  const [openDownloads, setOpenDownloads] = useState(null)
  const [downloadSizes, setDownloadSizes] = useState({})
  // Spreadsheet-style per-column filters: { [column]: { exclude, text } }.
  const [colFilters, setColFilters] = useState({})
  // The last thing that happened WITHOUT being asked for, said out loud:
  // fields a rule emptied, rows a drag filled. One banner rather than one
  // per feature -- a single gesture can do both, and two things to dismiss
  // for one gesture is two things nobody reads.
  const [notice, setNotice] = useState(null)
  // An in-progress fill drag: { column, anchorIndex, toIndex } over the
  // rows AS DISPLAYED. See lib/fillDown.js.
  const [fill, setFill] = useState(null)
  const [menuCol, setMenuCol] = useState(null)
  const [menuRect, setMenuRect] = useState(null)
  // { row, rect } -- the row whose note is open, and the button it hangs off.
  const [openNote, setOpenNote] = useState(null)

  // --- remarks ---------------------------------------------------------
  // Off unless an admin switched it on for this table, and then one listener
  // for the whole tab rather than one per row. See lib/rowNotes.js for what
  // a remark is attached to, which is the only decision here that matters.
  const showNotes = notesEnabled(widget)
  const noteKeyColumn = widget.noteKeyColumn || ''
  const { notes, error: noteError } = useRowNotes(noteScope, showNotes)
  const { addRemark, editRemark, removeRemark, me } = useRowNoteActions()
  const uid = me.uid

  const pageSize = widget.pageSize || 25

  // Admin's chosen columns, intersected with what the tab really has.
  const adminColumns = useMemo(() => {
    const chosen = widget.columns?.length ? widget.columns : tabHeaders
    return (chosen || []).filter((c) => (tabHeaders || []).includes(c))
  }, [widget.columns, tabHeaders])

  // Reset a stale user order whenever the admin's column set changes.
  useEffect(() => {
    setOrder(null)
  }, [adminColumns.join('|')])

  useEffect(() => {
    setSorts(defaultSorts)
  }, [defaultSorts])

  const columns = useMemo(() => {
    if (!order) return adminColumns
    const kept = order.filter((c) => adminColumns.includes(c))
    const added = adminColumns.filter((c) => !kept.includes(c))
    return [...kept, ...added]
  }, [order, adminColumns])

  const badgeCols = widget.badgeColumns || []

  // The three rows a panel may be open on, as they are NOW.
  const detailRow = useMemo(() => liveRow(rows, openDetail), [rows, openDetail])
  const downloadMenuRow = useMemo(() => liveRow(rows, openDownloads), [rows, openDownloads])
  const noteOpen = useMemo(
    () => (openNote ? { ...openNote, row: liveRow(rows, openNote.row) } : null),
    [rows, openNote]
  )

  // Column filters run FIRST, then the table's own search box narrows what
  // they left -- the same order a spreadsheet uses.
  const columnFiltered = useMemo(() => applyColumnFilters(rows, colFilters), [rows, colFilters])

  const searched = useMemo(() => {
    const q = localSearch.trim().toLowerCase()
    if (!q) return columnFiltered
    return columnFiltered.filter((r) => columns.some((c) => String(r[c] ?? '').toLowerCase().includes(q)))
  }, [columnFiltered, localSearch, columns])

  const filteredColumns = activeFilterColumns(colFilters)

  // A filter on a column the admin has since removed would narrow the table
  // with no visible way to clear it.
  useEffect(() => {
    const stale = filteredColumns.filter((c) => !columns.includes(c))
    if (stale.length === 0) return
    setColFilters((current) => {
      const next = { ...current }
      for (const c of stale) delete next[c]
      return next
    })
  }, [columns, filteredColumns])

  function setColumnFilter(column, filter) {
    setColFilters((current) => ({ ...current, [column]: filter }))
    setPage(0)
  }

  function sortFromMenu(column, dir) {
    setSorts([{ column, dir }])
    setPage(0)
  }

  const isDefaultSort = useMemo(
    () =>
      sorts.length === defaultSorts.length &&
      sorts.every((sort, index) => {
        const defaultSort = defaultSorts[index]
        return defaultSort && sort.column === defaultSort.column && sort.dir === defaultSort.dir
      }),
    [sorts, defaultSorts]
  )

  const sorted = useMemo(() => {
    if (sorts.length === 0) return searched
    const out = [...searched]
    out.sort((a, b) => {
      for (const { column, dir } of sorts) {
        const cmp = collator.compare(String(a[column] ?? ''), String(b[column] ?? ''))
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
    return out
  }, [searched, sorts])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  function toggleSort(col, additive) {
    setSorts((current) => {
      const idx = current.findIndex((s) => s.column === col)
      if (!additive) {
        if (idx === 0 && current.length === 1) {
          return current[0].dir === 'asc' ? [{ column: col, dir: 'desc' }] : defaultSorts
        }
        return [{ column: col, dir: 'asc' }]
      }
      if (idx === -1) return [...current, { column: col, dir: 'asc' }]
      const next = [...current]
      if (next[idx].dir === 'asc') next[idx] = { column: col, dir: 'desc' }
      else next.splice(idx, 1)
      return next.length > 0 ? next : defaultSorts
    })
    setPage(0)
  }

  function handleDrop(target) {
    if (!dragCol || dragCol === target) return
    const next = [...columns]
    next.splice(next.indexOf(dragCol), 1)
    next.splice(next.indexOf(target), 0, dragCol)
    setOrder(next)
    setDragCol(null)
    setOverCol(null)
  }

  function startEdit(e, row, col) {
    e.stopPropagation() // don't also open the detail panel
    if (!editableColumns.includes(col)) return
    setEditing(`${row._row}:${col}`)
    setDraft(row[col] ?? '')
  }

  /**
   * `next` is passed when a dropdown supplies the value.
   *
   * A `<select>` changes and blurs in the same breath, and reading the value
   * back off `draft` would race the state update -- the cell would save the
   * value BEFORE the one just picked.
   */
  async function commitEdit(row, col, next) {
    setEditing(null)
    const value = next === undefined ? draft : next
    await writeCell(row, col, value)
  }

  /**
   * One row's changes and everything they make no longer true, as the
   * columns to write and the value each one ends up with.
   *
   * `changes` is column -> value, because a form saved in one go is not
   * several independent edits: three fields have to be judged against the
   * row as it will be with all three on it.
   *
   * The clears are applied OVER the changes rather than beside them,
   * because a rule may name a column being written: "Return to PDI" resets
   * the row and then takes itself off. Laid over, that cell is written once
   * and blank; laid beside, it would be set and then unset a moment later
   * -- two writes and a visible flicker between them.
   */
  function editPlan(row, changes) {
    const also = columnsToClear(widget, row, {
      changes,
      editable: editableColumns,
      dateOrder,
    })
    const plan = new Map(Object.entries(changes))
    for (const target of also) plan.set(target, '')
    return { also, plan }
  }

  /**
   * A plan, sent.
   *
   * One request, one column each. Sent one at a time this was a write and a
   * full page reload per cell, so a keystroke that cleared three fields
   * took four round trips -- and a failure at the second left the row half
   * cleared with nothing on screen to say so.
   */
  async function sendPlan(row, plan) {
    if (plan.size === 0) return
    if (onEditCells) {
      await onEditCells(
        widget.tab,
        [...plan].map(([column, next]) => ({ column, cells: [{ row: row._row, value: next }] }))
      )
    } else {
      for (const [column, next] of plan) await onEditCell?.(widget.tab, row, column, next)
    }
  }

  /**
   * Several fields of one row, saved together.
   *
   * The form's Save button, and the one place a row-wide change goes: the
   * fields that have not actually moved are dropped first, so saving a form
   * where one field was touched writes one cell rather than twenty.
   */
  async function writeRow(row, changes) {
    const real = Object.fromEntries(
      Object.entries(changes || {}).filter(([col, next]) => next !== (row[col] ?? ''))
    )
    if (Object.keys(real).length === 0) return
    const { also, plan } = editPlan(row, real)
    await sendPlan(row, plan)
    if (also.length > 0) setNotice(`Row ${row._row}: ${clearedNote(also)}`)
  }

  /**
   * One edit, and whatever it makes no longer true.
   *
   * Every edit goes through here -- a cell, a dropdown, and the row form --
   * because a rule that fires in the table and not in the form is a rule
   * that half exists. See lib/clearRules.js for what it will and will not
   * touch.
   */
  async function writeCell(row, col, value) {
    await writeRow(row, { [col]: value })
  }

  // --- the fill drag ---------------------------------------------------
  // Off entirely without a batch writer: filling forty rows one request at
  // a time is not a slower version of this feature, it is a different and
  // much worse one.
  const canDragFill = (col) => Boolean(onEditCells) && canFill(widget, col, editableColumns)
  const fillSpan = fill ? fillRange(fill.anchorIndex, fill.toIndex, pageRows.length) : null

  /**
   * The drag, let go of.
   *
   * `span` is passed in rather than read from state: the pointer is
   * released and the state cleared in the same breath, and reading it back
   * would commit whatever was left after the clear, which is nothing.
   */
  async function commitFill(span) {
    if (!span) return
    const { writes, capped } = fillTargets(pageRows, {
      column: span.column,
      anchorIndex: span.anchorIndex,
      toIndex: span.toIndex,
    })
    if (writes.length === 0) return

    // Every row's plan, gathered per column, so the whole drag AND
    // everything its values make no longer true is a handful of requests
    // rather than one per cell. The same rules a single edit fires: one
    // that applies when you type Cancelled and not when you drag it is a
    // rule nobody can rely on.
    const byColumn = new Map()
    const cleared = new Set()
    for (const { row, value } of writes) {
      const { also, plan } = editPlan(row, { [span.column]: value })
      for (const target of also) cleared.add(target)
      for (const [column, next] of plan) {
        if (!byColumn.has(column)) byColumn.set(column, [])
        byColumn.get(column).push({ row: row._row, value: next })
      }
    }
    const batches = [...byColumn].map(([column, cells]) => ({ column, cells }))

    await onEditCells(widget.tab, batches)

    const parts = [filledNote(span.column, writes.length, capped)]
    if (cleared.size > 0) parts.push(clearedNote([...cleared]))
    setNotice(parts.join(' · '))
  }

  // The span is followed on the DOCUMENT, not on the cells: the pointer
  // leaves the handle the instant the drag starts, and a listener per cell
  // would lose it the moment it crossed a gap between two of them.
  const dragging = fill !== null
  const fillRef = useRef(null)
  fillRef.current = fill

  useEffect(() => {
    if (!dragging) return

    // `pageRows` is captured once, at the moment the drag starts, which is
    // exactly right: nothing reloads mid-drag, and the rows somebody is
    // dragging over are the rows that were under the pointer when they
    // started.
    function onMove(e) {
      const under = document.elementFromPoint(e.clientX, e.clientY)
      const tr = under?.closest?.('[data-fill-row]')
      if (!tr) return
      const to = Number(tr.dataset.fillRow)
      if (!Number.isInteger(to)) return
      setFill((current) => (current && current.toIndex !== to ? { ...current, toIndex: to } : current))
    }
    function onUp() {
      const span = fillRef.current
      setFill(null)
      commitFill(span)
    }
    // Let go of it without writing anything. The gesture covers a lot of
    // rows at once, so there has to be a way out of it that is not "undo".
    function onKey(e) {
      if (e.key === 'Escape') setFill(null)
    }

    // Dragging across a table otherwise selects it, and the blue selection
    // over the span makes the highlight impossible to read.
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.userSelect = previous
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  const detailColumns = widget.detailColumns?.length ? widget.detailColumns : tabHeaders || []
  const titleColumn = widget.detailTitleColumn || columns[0]
  // A note is headed by whatever IDENTIFIES the record -- the key column the
  // remarks are attached to, if there is one. That is the value somebody
  // would quote back, and it is the one thing on the note guaranteed to
  // still mean something after the table is re-sorted.
  const noteTitleColumn = noteKeyColumn || titleColumn
  const allDownloadColumns = widget.downloadButtons ? widget.downloadColumns || [] : []
  const enabledDownloadColumns = useMemo(
    () => allDownloadColumns.filter((col) => downloadableColumns.includes(col)),
    [allDownloadColumns, downloadableColumns]
  )
  const hasDownloadColumn = widget.downloadButtons && enabledDownloadColumns.length > 0
  const downloadMenuActions = useMemo(
    () => (downloadMenuRow ? getDownloadActions(downloadMenuRow, enabledDownloadColumns) : []),
    [downloadMenuRow, enabledDownloadColumns]
  )

  useEffect(() => {
    if (!downloadMenuRow) return

    let cancelled = false
    async function loadSizes() {
      const next = {}
      for (const action of downloadMenuActions) {
        const size = await fetchDownloadMeta(action.url)
        if (!cancelled) next[`${downloadMenuRow._row}-${action.column}`] = size
      }
      if (!cancelled) setDownloadSizes((current) => ({ ...current, ...next }))
    }

    loadSizes()
    return () => {
      cancelled = true
    }
  }, [downloadMenuRow, downloadMenuActions])

  const cellPad = dense ? 'px-2 py-0.5' : 'px-2 py-1.5'

  // How tall the card is, the admin's choice:
  //   auto   grow to fit the rows on the page -- no inner scroll at all
  //   fixed  a set pixel height with the grid scrolling inside it
  //   full   as tall as the viewport allows, minus room for the page chrome
  //
  // `auto` is the one that changes behaviour rather than just size: the grid
  // must NOT be given a bounded flex height, or it would still scroll inside
  // a card that has grown to fit it.
  const heightMode = widget.heightMode || 'fixed'
  const cardHeight =
    heightMode === 'auto'
      ? undefined
      : heightMode === 'full'
        ? { height: 'calc(100vh - 150px)', minHeight: 320 }
        : { height: widget.height || 560 }

  // Dragging columns is instant for everyone, but only an admin can make it
  // stick for every user -- so the Save button only appears for them, and
  // only once the order actually differs from what's stored.
  const orderChanged = !!order && order.join('|') !== adminColumns.join('|')

  return (
    <div
      className={`card flex flex-col ${heightMode === 'auto' ? '' : 'overflow-hidden'}`}
      style={cardHeight}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="widget-title"><span className="widget-icon">📋</span> {widget.title}</h2>
            {widget.rowDetail && (
              <div className="flex h-6 w-auto px-2 items-center justify-center rounded-xl border border-slate-200 bg-cyan-200 text-base font-semibold text-slate-900 shadow-sm">
                {sorted.length.toLocaleString('en-IN')}
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            {widget.tab} · {sorted.length.toLocaleString('en-IN')} rows
            {/* How many the column filters removed. Without this the table
                just looks short, and there is no clue why. */}
            {filteredColumns.length > 0 && (
              <span className="text-indigo-600">
                {' '}
                · filtered from {rows.length.toLocaleString('en-IN')}
              </span>
            )}
            {saving && ' · saving…'}
            {widget.rowDetail && ' · click a row for details'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {filteredColumns.length > 0 && (
            <button
              onClick={() => {
                setColFilters({})
                setPage(0)
              }}
              title={`Clear filters on ${filteredColumns.join(', ')}`}
              className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-rose-600"
            >
              <Filter size={11} />
              Clear
              <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold tabular-nums">
                {filteredColumns.length}
              </span>
            </button>
          )}
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              value={localSearch}
              onChange={(e) => {
                setLocalSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Search this table…"
              className="w-40 rounded-lg border border-slate-200 py-1 pl-7 pr-2 text-xs"
            />
          </div>
          {!isDefaultSort && (
            <button
              onClick={() => setSorts(defaultSorts)}
              className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-600"
              title="Restore admin default sort"
            >
              <X size={11} /> Reset
            </button>
          )}
          <button
            onClick={() => setDense((d) => !d)}
            className={`rounded-lg border px-2 py-1 text-xs ${
              dense ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500'
            }`}
            title="Toggle compact rows"
          >
            <Rows3 size={12} />
          </button>
          {canExport && (
            <ExportButton
              name={widget.title || widget.tab}
              // Every row the filters left, in the column order and sort
              // currently on screen -- not just the page being looked at,
              // which is a paging artefact and not a fact about the data.
              rows={() => sorted}
              columns={() => columns}
              count={sorted.length}
            />
          )}
        </div>
      </div>

      {/* This widget's own controls used to render here. They now live in
          the canvas wrapper above the card, where every widget type can have
          them -- so `rows` already arrives narrowed by them. */}

      {canPersistLayout && orderChanged && (

        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">

          <span className="text-[11px] text-amber-700">You reordered the columns — save it for everyone?</span>

          <button

            onClick={() => {

              onSaveColumnOrder?.(columns)

              setSavedOrder(true)

              setTimeout(() => setSavedOrder(false), 2000)

            }}

            className="rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-700"

          >

            {savedOrder ? 'Saved ✓' : 'Save column order'}

          </button>

          <button onClick={() => setOrder(null)} className="text-[11px] text-amber-600 underline">

            revert

          </button>

        </div>

      )}


      {tabError ? (
        <p className="py-8 text-center text-sm text-rose-500">
          Tab “{widget.tab}” could not be read: {tabError}
        </p>
      ) : (
        <>
          <div
            className={`rounded-lg border border-slate-100 ${
              // In `auto` the card has no bounded height, so the grid must
              // not claim one either -- otherwise it would scroll inside a
              // card that already grew to fit it.
              heightMode === 'auto' ? 'overflow-x-auto' : 'min-h-0 flex-1 overflow-auto'
            }`}
          >
            <table className="w-full min-w-max text-sm">
              <thead className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-slate-50/95 backdrop-blur">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  {showNotes && <th className="w-10 px-2 py-2" aria-label="Remarks" />}
                  {hasDownloadColumn && (
                    <th className="whitespace-nowrap px-2 py-2 font-medium text-slate-500">Files</th>
                  )}
                  {columns.map((col) => {
                    const sortIdx = sorts.findIndex((s) => s.column === col)
                    const sort = sorts[sortIdx]
                    return (
                      <th
                        key={col}
                        draggable
                        onDragStart={() => setDragCol(col)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setOverCol(col)
                        }}
                        onDragLeave={() => setOverCol(null)}
                        onDrop={() => handleDrop(col)}
                        onDragEnd={() => {
                          setDragCol(null)
                          setOverCol(null)
                        }}
                        onClick={(e) => toggleSort(col, e.shiftKey)}
                        title="Click to sort · Shift-click to add a second sort · Drag to reorder"
                        className={`group cursor-pointer select-none whitespace-nowrap px-2 py-2 font-medium transition-colors hover:text-indigo-600 ${
                          overCol === col ? 'bg-indigo-100' : ''
                        } ${dragCol === col ? 'opacity-40' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <GripVertical size={11} className="text-slate-300 opacity-0 group-hover:opacity-100" />
                          {col}
                          {sort && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1 text-[10px] font-bold text-indigo-700">
                              {sorts.length > 1 && sortIdx + 1}
                              {sort.dir === 'asc' ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                            </span>
                          )}
                          {/* The funnel. Always rendered once a column IS
                              filtered, so a narrowed table can never hide the
                              fact -- only the idle ones wait for a hover. */}
                          <button
                            onClick={(e) => {
                              // The header itself sorts; the funnel must not.
                              e.stopPropagation()
                              setMenuRect(e.currentTarget.getBoundingClientRect())
                              setMenuCol(menuCol === col ? null : col)
                            }}
                            title={`Filter ${col}`}
                            className={`rounded p-0.5 transition-opacity ${
                              columnIsFiltered(colFilters[col])
                                ? 'bg-indigo-100 text-indigo-700 opacity-100'
                                : 'text-slate-400 opacity-0 hover:bg-slate-200 group-hover:opacity-100'
                            }`}
                          >
                            <Filter size={10} />
                          </button>
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>

              <tbody>
                {pageRows.map((row, rowIndex) => (
                  <tr
                    key={row._row}
                    // How a fill drag knows which row the pointer is over.
                    // The DISPLAYED position, since that is what was
                    // dragged across -- see lib/fillDown.js.
                    data-fill-row={rowIndex}
                    onClick={() => widget.rowDetail && setOpenDetail(row)}
                    className={`relative border-b border-slate-50 transition-colors hover:bg-indigo-50/40 ${
                      widget.rowDetail ? 'cursor-pointer' : ''
                    } ${detailRow?._row === row._row ? 'bg-indigo-50' : ''}`}
                  >
                    {showNotes && (
                      <td className="px-2 py-2 align-middle">
                        <NoteButton
                          row={row}
                          scope={noteScope}
                          keyColumn={noteKeyColumn}
                          notes={notes}
                          open={noteOpen?.row?._row === row._row}
                          onOpen={(rect) =>
                            setOpenNote((current) =>
                              current?.row?._row === row._row ? null : { row, rect }
                            )
                          }
                        />
                      </td>
                    )}

                    {hasDownloadColumn && (
                      <td className="px-2 py-2 align-middle">
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenDownloads((current) => (current?._row === row._row ? null : row))
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                          >
                            <Download size={12} /> Files
                          </button>

                          {downloadMenuRow?._row === row._row && downloadMenuActions.length > 0 && (
                            <div className="absolute left-0 z-20 mt-2 min-w-44 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
                              {downloadMenuActions.map((action) => {
                                const key = `${row._row}-${action.column}`
                                const size = downloadSizes[key]
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      triggerDownload(action.url, action.label)
                                      setOpenDownloads(null)
                                    }}
                                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                                  >
                                    <span className="min-w-0 truncate">{action.label}</span>
                                    <span className="shrink-0 text-[10px] text-slate-400">
                                      {size || '…'}
                                    </span>
                                    <Download size={11} className="shrink-0 text-slate-400" />
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                    )}

                    {columns.map((col) => {
                      const editable = editableColumns.includes(col)
                      const isEditing = editing === `${row._row}:${col}`
                      const value = row[col]
                      // Only where the column is editable: a dropdown on a
                      // read-only column is a control that cannot do
                      // anything, which is worse than no control.
                      const choices = editable ? columnChoices[col] : null
                      const asBadge = badgeCols.includes(col) && String(value ?? '').trim() !== ''

                      const fillable = canDragFill(col)
                      // Only the column being dragged lights up. The span
                      // is over rows, but the write is one column wide, and
                      // highlighting the whole row would promise otherwise.
                      const inSpan = fill?.column === col && inFillRange(fillSpan, rowIndex)

                      return (
                        <td
                          key={col}
                          onClick={(e) => editable && !isEditing && startEdit(e, row, col)}
                          title={editable ? 'Click to edit' : undefined}
                          className={`relative whitespace-nowrap ${cellPad} ${
                            editable ? 'cursor-text hover:bg-indigo-100/60' : ''
                          } ${inSpan ? 'bg-indigo-100/70 ring-1 ring-inset ring-indigo-400' : ''}`}
                        >
                          {isEditing && choices ? (
                            /* A list, not a box. Typed by hand, "Delivered",
                               "delivered" and "Deliverd" are three statuses,
                               and the chart counting them says so. */
                            <select
                              autoFocus
                              value={draft}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => commitEdit(row, col, e.target.value)}
                              onBlur={() => setEditing(null)}
                              onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                              className="w-40 rounded border border-indigo-300 px-1 py-0.5 text-sm"
                              // Coloured where the COLUMN is a badge column,
                              // which is the admin's own answer to "is this a
                              // status?". On a column of two hundred customer
                              // names, eight rotating colours is confetti --
                              // so the menu is coloured exactly where the
                              // cells already are, and the two never
                              // disagree.
                              //
                              // The closed box takes the current value's
                              // colour too: that is the state anybody spends
                              // their time looking at.
                              style={asBadge ? badgeStyle(draft) : undefined}
                            >
                              {/* Clearing a cell has to stay possible: a
                                  dropdown with no empty option is a cell
                                  that can never be emptied once it is set. */}
                              <option value="">—</option>
                              {optionsForCell(choices, value).map((option) => (
                                <option
                                  key={option}
                                  value={option}
                                  style={badgeCols.includes(col) ? badgeStyle(option) : undefined}
                                >
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : isEditing ? (
                            <CellEditor
                              initial={draft}
                              onCommit={(text) => commitEdit(row, col, text)}
                              onCancel={() => setEditing(null)}
                            />
                          ) : asBadge ? (
                            <span
                              className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: badgeColor(value).bg, color: badgeColor(value).fg }}
                            >
                              {value}
                            </span>
                          ) : choices && isStrayValue(choices, value) ? (
                            /* Says so rather than quietly correcting it: the
                               salesman who left is still who sold it. */
                            <span
                              className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700"
                              title="Not one of the values this column offers"
                            >
                              {value}
                            </span>
                          ) : (
                            value || (editable ? <span className="text-slate-300">—</span> : '')
                          )}

                          {/* The square at the corner of the cell. Nothing
                              else in the app looks like this, because
                              everybody already knows what it does. */}
                          {fillable && !isEditing && (
                            <span
                              role="button"
                              aria-label={`Fill ${col} down from this row`}
                              title={`Drag to copy this ${col} into the rows you cross`}
                              data-active={fill?.column === col && fill?.anchorIndex === rowIndex}
                              className="fill-handle"
                              onPointerDown={(e) => {
                                // Not a click on the cell, and not a click
                                // on the row: this opens neither the editor
                                // nor the detail panel.
                                e.preventDefault()
                                e.stopPropagation()
                                setFill({ column: col, anchorIndex: rowIndex, toIndex: rowIndex })
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}

                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + (hasDownloadColumn ? 1 : 0) + (showNotes ? 1 : 0) || 1}
                      className="py-10 text-center text-slate-300"
                    >
                      No rows match the current filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>
              Showing {pageRows.length} of {sorted.length.toLocaleString('en-IN')}
            </span>
            <div className="flex items-center gap-3">
              <button disabled={safePage === 0} onClick={() => setPage(0)} className="disabled:opacity-30">
                «
              </button>
              <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="disabled:opacity-30">
                Prev
              </button>
              <span className="tabular-nums">
                {safePage + 1} / {pageCount}
              </span>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                className="disabled:opacity-30"
              >
                Next
              </button>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(pageCount - 1)}
                className="disabled:opacity-30"
              >
                »
              </button>
            </div>
          </div>
        </>
      )}

      {menuCol && (
        <ColumnFilterMenu
          column={menuCol}
          anchorRect={menuRect}
          // Options come from the rows BEFORE column filters, so a menu can
          // always offer back a value its own filter is currently hiding.
          rows={rows}
          filters={colFilters}
          sort={sorts.find((s) => s.column === menuCol)}
          onSort={sortFromMenu}
          onChange={setColumnFilter}
          onClose={() => setMenuCol(null)}
        />
      )}

      {/* A rejected read is a rule problem, not a network one, and it is
          silent unless somebody says so. Said once, under the table, rather
          than as a broken button on every row. */}
      {showNotes && noteError && (
        <p className="mt-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-600">
          Remarks: {noteError}
        </p>
      )}

      {/* Cells changing because of something other than the keystroke that
          caused them is exactly the kind of thing a person has to be TOLD
          about. It says what happened and waits to be dismissed rather than
          fading -- an edit that quietly emptied three fields, or a drag
          that filled forty rows, is one nobody can check afterwards. */}
      {notice && (
        <div className="mt-1 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
          <span className="text-[11px] leading-snug text-amber-800">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="ml-auto shrink-0 rounded p-0.5 text-amber-500 hover:bg-white hover:text-amber-700"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {noteOpen && (
        <RowNotePopover
          anchorRect={noteOpen.rect}
          title={String(noteOpen.row[noteTitleColumn] ?? `Row ${noteOpen.row._row}`)}
          note={notes[noteIdFor(noteScope, noteOpen.row, noteKeyColumn)]}
          uid={uid}
          onAdd={(text) =>
            addRemark(noteIdFor(noteScope, noteOpen.row, noteKeyColumn), {
              scope: noteScope,
              key: rowKeyOf(noteOpen.row, noteKeyColumn),
              text,
            })
          }
          onEdit={(remark, text) =>
            editRemark(noteIdFor(noteScope, noteOpen.row, noteKeyColumn), remark, text)
          }
          onRemove={(remark) =>
            removeRemark(noteIdFor(noteScope, noteOpen.row, noteKeyColumn), remark)
          }
          onClose={() => setOpenNote(null)}
        />
      )}

      <RowDetailPanel
        open={!!detailRow && !!widget.rowDetail}
        row={detailRow}
        columns={detailColumns}
        title={detailRow ? String(detailRow[titleColumn] ?? `Row ${detailRow._row}`) : ''}
        editableColumns={editableColumns}
        // The same lists the cells offer, so the form and the table cannot
        // disagree about what a column may contain.
        columnChoices={columnChoices}
        // The SAME popover the table's own marker opens, with the same
        // state behind it -- a remark is on the record, and one added from
        // the panel has to be the one the row shows.
        onOpenNotes={
          showNotes && detailRow ? (rect) => setOpenNote({ row: detailRow, rect }) : undefined
        }
        noteCount={
          detailRow ? remarkCount(notes[noteIdFor(noteScope, detailRow, noteKeyColumn)]) : 0
        }
        onSaveRow={writeRow}
        onClose={() => setOpenDetail(null)}
        saving={saving}
      />
    </div>
  )
}
