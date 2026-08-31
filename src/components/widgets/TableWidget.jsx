import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Filter, GripVertical, Rows3, Search, StickyNote, X } from 'lucide-react'
import { badgeColor } from '../../lib/dataUtils'
import ExportButton from '../ExportButton.jsx'
import { fetchDownloadMeta, getDownloadActions, triggerDownload } from '../../lib/downloadActions.js'
import RowDetailPanel from '../RowDetailPanel.jsx'
import ColumnFilterMenu from '../ColumnFilterMenu.jsx'
import { activeFilterColumns, applyColumnFilters, columnIsFiltered } from '../../lib/columnFilters'
import RowNotePopover from '../RowNotePopover.jsx'
import { useRowNoteActions, useRowNotes } from '../../hooks/useRowNotes'
import { countLabel, latestSummary, noteIdFor, notesEnabled, remarkCount, rowKeyOf } from '../../lib/rowNotes'

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
export default function TableWidget({
  widget,
  rows,
  tabHeaders,
  tabError,
  editableColumns = [],
  downloadableColumns = [],
  canExport = false,
  onEditCell,
  saving,
  dateOrder = 'DMY',
  canPersistLayout = false,
  onSaveColumnOrder,
  noteScope = '',
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
  const [detailRow, setDetailRow] = useState(null)
  const [savedOrder, setSavedOrder] = useState(false)
  const [downloadMenuRow, setDownloadMenuRow] = useState(null)
  const [downloadSizes, setDownloadSizes] = useState({})
  // Spreadsheet-style per-column filters: { [column]: { exclude, text } }.
  const [colFilters, setColFilters] = useState({})
  const [menuCol, setMenuCol] = useState(null)
  const [menuRect, setMenuRect] = useState(null)
  // { row, rect } -- the row whose note is open, and the button it hangs off.
  const [noteOpen, setNoteOpen] = useState(null)

  // --- remarks ---------------------------------------------------------
  // Off unless an admin switched it on for this table, and then one listener
  // for the whole tab rather than one per row. See lib/rowNotes.js for what
  // a remark is attached to, which is the only decision here that matters.
  const showNotes = notesEnabled(widget)
  const noteKeyColumn = widget.noteKeyColumn || ''
  const { notes, error: noteError } = useRowNotes(noteScope, showNotes)
  const { addRemark, removeRemark, me } = useRowNoteActions()
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

  async function commitEdit(row, col) {
    setEditing(null)
    if (draft !== (row[col] ?? '')) await onEditCell?.(widget.tab, row, col, draft)
  }

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
            <h2 className="widget-title">📋 {widget.title}</h2>
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
                {pageRows.map((row) => (
                  <tr
                    key={row._row}
                    onClick={() => widget.rowDetail && setDetailRow(row)}
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
                            setNoteOpen((current) =>
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
                              setDownloadMenuRow((current) => (current?._row === row._row ? null : row))
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
                                      setDownloadMenuRow(null)
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
                      const asBadge = badgeCols.includes(col) && String(value ?? '').trim() !== ''

                      return (
                        <td
                          key={col}
                          onClick={(e) => editable && !isEditing && startEdit(e, row, col)}
                          title={editable ? 'Click to edit' : undefined}
                          className={`whitespace-nowrap ${cellPad} ${editable ? 'cursor-text hover:bg-indigo-100/60' : ''}`}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={draft}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => commitEdit(row, col)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitEdit(row, col)
                                if (e.key === 'Escape') setEditing(null)
                              }}
                              className="w-36 rounded border border-indigo-300 px-1.5 py-0.5 text-sm"
                            />
                          ) : asBadge ? (
                            <span
                              className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: badgeColor(value).bg, color: badgeColor(value).fg }}
                            >
                              {value}
                            </span>
                          ) : (
                            value || (editable ? <span className="text-slate-300">—</span> : '')
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
          onRemove={(remark) =>
            removeRemark(noteIdFor(noteScope, noteOpen.row, noteKeyColumn), remark)
          }
          onClose={() => setNoteOpen(null)}
        />
      )}

      <RowDetailPanel
        open={!!detailRow && !!widget.rowDetail}
        row={detailRow}
        columns={detailColumns}
        title={detailRow ? String(detailRow[titleColumn] ?? `Row ${detailRow._row}`) : ''}
        editableColumns={editableColumns}
        onEditCell={(row, col, value) => onEditCell?.(widget.tab, row, col, value)}
        onClose={() => setDetailRow(null)}
        saving={saving}
      />
    </div>
  )
}
