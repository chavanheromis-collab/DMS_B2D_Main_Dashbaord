import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download, GripVertical, Rows3, Search, X } from 'lucide-react'
import { badgeColor } from '../../lib/dataUtils'
import { fetchDownloadMeta, getDownloadActions, triggerDownload } from '../../lib/downloadActions.js'
import RowDetailPanel from '../RowDetailPanel.jsx'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

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
  canDownloadCsv = false,
  onEditCell,
  saving,
  dateOrder = 'DMY',
  canPersistLayout = false,
  onSaveColumnOrder,
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

  const searched = useMemo(() => {
    const q = localSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => columns.some((c) => String(r[c] ?? '').toLowerCase().includes(q)))
  }, [rows, localSearch, columns])

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

  function exportCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [columns.map(esc).join(','), ...sorted.map((r) => columns.map((c) => esc(r[c])).join(','))]
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${widget.title || widget.tab}.csv`.replace(/[^\w.-]+/g, '_')
    a.click()
    URL.revokeObjectURL(url)
  }

  const detailColumns = widget.detailColumns?.length ? widget.detailColumns : tabHeaders || []
  const titleColumn = widget.detailTitleColumn || columns[0]
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
            <h2 className="flex items-center gap-1.5 font-semibold text-slate-800">📋 {widget.title}</h2>
            {widget.rowDetail && (
              <div className="flex h-6 w-auto px-2 items-center justify-center rounded-xl border border-slate-200 bg-cyan-200 text-base font-semibold text-slate-900 shadow-sm">
                {sorted.length.toLocaleString('en-IN')}
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            {widget.tab} · {sorted.length.toLocaleString('en-IN')} rows
            {saving && ' · saving…'}
            {widget.rowDetail && ' · click a row for details'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
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
          {canDownloadCsv && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
              title="Download the filtered rows as CSV"
            >
              <Download size={12} /> CSV
            </button>
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
                    <td colSpan={columns.length + (hasDownloadColumn ? 1 : 0) || 1} className="py-10 text-center text-slate-300">
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
