// ---------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------
// Exporting is not a nice-to-have on a dashboard built over spreadsheets.
// The whole point of narrowing a page down to eleven rows is usually to do
// something with those eleven rows, and "select the table and hope the paste
// lands right" is not a workflow.
//
// So: what you export is exactly what you are looking at. The rows the
// filters left, the columns in the order you dragged them into, the sort you
// clicked -- not the tab as it exists in Google Sheets. A file that disagrees
// with the screen is worse than no file, because the disagreement is
// invisible until someone acts on it.

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/

/**
 * One CSV field.
 *
 * Quoted only when it has to be. Over-quoting every field is valid CSV and
 * still opens fine, but it makes a diff of two exports unreadable and it
 * makes the file bigger for no reason -- and these files are read by people,
 * not only by parsers.
 */
export function csvField(value, delimiter = ',') {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : String(value)
  if (text === '') return ''
  if (text.includes(delimiter) || NEEDS_QUOTES.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * Rows and columns to a CSV document.
 *
 * CRLF line endings, per RFC 4180 and per what Excel expects. The header row
 * is the column names as shown, so a blended column exports under the same
 * name it has on screen.
 */
export function toCsv(rows, columns, { delimiter = ',', header = true } = {}) {
  const cols = (columns || []).filter(Boolean)
  if (cols.length === 0) return ''

  const lines = []
  if (header) lines.push(cols.map((c) => csvField(c, delimiter)).join(delimiter))
  for (const row of rows || []) {
    lines.push(cols.map((c) => csvField(row?.[c], delimiter)).join(delimiter))
  }
  return lines.join('\r\n')
}

/** Every column any of these rows has, in first-seen order. */
export function columnsOfRows(rows, { skip = ['_row'] } = {}) {
  const seen = []
  const has = new Set(skip)
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) {
      if (has.has(key)) continue
      has.add(key)
      seen.push(key)
    }
  }
  return seen
}

/**
 * A file name that survives every operating system.
 *
 * Dated, because the same export run twice a week apart is two different
 * files and a downloads folder full of `MASTER.csv (3)` helps nobody.
 */
export function csvFileName(name, date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')

  const safe = String(name || 'export')
    .replace(/[^\w\s.-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)

  return `${safe || 'export'}_${stamp}.csv`
}

/**
 * Hands the file to the browser.
 *
 * The BOM is not decoration: without it Excel on Windows reads UTF-8 as the
 * system codepage, and every ₹, every name with an accent and every emoji in
 * the sheet arrives as mojibake. The object URL is revoked on the next tick
 * rather than immediately, because revoking it in the same frame as the
 * click cancels the download in some browsers.
 */
export function downloadCsv(fileName, csvText) {
  if (typeof document === 'undefined') return false

  const blob = new Blob(['\uFEFF', csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

/** The whole job: build the file and hand it over. */
export function exportRowsAsCsv(name, rows, columns) {
  const cols = columns?.length ? columns : columnsOfRows(rows)
  return downloadCsv(csvFileName(name), toCsv(rows, cols))
}
