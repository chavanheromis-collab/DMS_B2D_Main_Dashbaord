import { Download } from 'lucide-react'
import { exportRowsAsCsv } from '../lib/csv.js'

/**
 * "Give me this, as a file."
 *
 * One button, shared by every widget that has rows worth taking away, so a
 * table, a chart's plotted series and a flow's branches all export the same
 * way and produce the same shape of file.
 *
 * `rows` is built lazily. A chart holding 40,000 rows should not assemble an
 * export on every render on the off-chance somebody clicks -- so the caller
 * passes a function, and nothing is built until it is asked for.
 */
export default function ExportButton({ name, rows, columns, count, label = 'CSV', title, className = '' }) {
  const disabled = count === 0

  function run() {
    const data = typeof rows === 'function' ? rows() : rows
    if (!data?.length) return
    const cols = typeof columns === 'function' ? columns() : columns
    exportRowsAsCsv(name, data, cols)
  }

  return (
    <button
      onClick={run}
      disabled={disabled}
      className={`flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-40 ${className}`}
      title={
        title ||
        (disabled
          ? 'Nothing to export'
          : `Download ${count === undefined ? 'this' : count.toLocaleString('en-IN')} row${count === 1 ? '' : 's'} as CSV — exactly what is on screen`)
      }
    >
      <Download size={12} /> {label}
    </button>
  )
}
