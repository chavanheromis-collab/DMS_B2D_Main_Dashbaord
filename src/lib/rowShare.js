// ---------------------------------------------------------------------
// Sending a row to somebody
// ---------------------------------------------------------------------
// "Can you look at this one?" is the commonest message anybody sends about
// a table -- and today it is a screenshot on WhatsApp, cropped wrong, with
// the one column that mattered cut off, sent to somebody who then has to
// find the same row again by scrolling.
//
// So a row can be sent from the table itself, into the chat. It arrives as
// a CARD: the record's name, its values, where it came from, and whatever
// the sender wanted to say about it.
//
// Three decisions shape everything here:
//
//   THE ADMIN SAYS WHICH COLUMNS GO. Not the sender, and not "whatever the
//   table shows". A message leaves the page: the person who receives it may
//   not be allowed to open that page at all, and a row carries margins,
//   phone numbers and customer names that were on screen for the reader,
//   not for whoever the reader chooses to forward them to. So nothing is
//   sent that an admin did not mark as sendable, the title included.
//
//   IT IS A SNAPSHOT. The values as they were when it was sent, stored on
//   the message. A live link would show the recipient today's values under
//   yesterday's question -- "why is this still pending?" answered by a row
//   that now says delivered -- and would need the recipient to have access
//   to the tab, which is exactly what sending it was for.
//
//   IT IS BOUNDED. A card, not a way to store a spreadsheet in a message:
//   so many fields, so long a value, checked here and again in the rules.
//
// Pure: a row and a widget in, a plain object out. No React, no Firestore.

/** Where the admin's choices live on the widget. */
export const ROW_SHARE = 'rowShare'
export const SHARE_COLUMNS = 'shareColumns'
export const SHARE_TITLE = 'shareTitleColumn'

/** The same number firestore.rules enforces on a message's `row.fields`. */
export const MAX_SHARED_FIELDS = 40
export const MAX_SHARED_VALUE = 500
export const MAX_SHARED_LABEL = 80
export const MAX_SHARED_TITLE = 120
export const MAX_SHARE_NOTE = 500

/** How many fields a card shows before "show all". */
export const PREVIEW_FIELDS = 6

/** Trimmed, and cut with an ellipsis rather than mid-word into nothing. */
function clip(value, max) {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The columns an admin has marked as sendable, in their order, once each. */
export function shareColumnsOf(widget) {
  const list = Array.isArray(widget?.[SHARE_COLUMNS]) ? widget[SHARE_COLUMNS] : []
  return [...new Set(list.filter((c) => typeof c === 'string' && c))]
}

/**
 * Whether this table offers a send button at all.
 *
 * The switch AND at least one column. A switch on with nothing ticked would
 * be a button that sends an empty card, which is a message saying nothing
 * with the confidence of one that says something.
 */
export function shareEnabled(widget) {
  return widget?.[ROW_SHARE] === true && shareColumnsOf(widget).length > 0
}

/**
 * The marked columns this tab still has.
 *
 * A column renamed or deleted in the sheet stays ticked in the admin's list
 * until they look; it must not become a field that is always blank.
 */
export function sharableColumns(widget, headers) {
  const chosen = shareColumnsOf(widget)
  if (!Array.isArray(headers) || headers.length === 0) return chosen
  return chosen.filter((c) => headers.includes(c))
}

/**
 * The list after ticking or unticking one column.
 *
 * Kept in the TAB's order, so the card reads the way the sheet does rather
 * than in the order somebody happened to click boxes. A ticked column the
 * tab no longer has is kept at the end rather than silently dropped -- it
 * may be a rename that is about to be undone.
 */
export function toggleShareColumn(widget, column, headers = []) {
  const current = shareColumnsOf(widget)
  const on = current.includes(column)
  const cols = Array.isArray(headers) ? headers : []
  const inOrder = cols.filter((c) => (c === column ? !on : current.includes(c)))
  const elsewhere = current.filter((c) => !cols.includes(c) && c !== column)
  if (!on && !cols.includes(column)) elsewhere.push(column)
  return [...inOrder, ...elsewhere]
}

/**
 * What the card is headed with.
 *
 * Only ever a SHARED column. The obvious heading -- the remarks key, the
 * detail panel's title -- is very often the customer's name, and heading a
 * card with a value the admin did not mark as sendable would send it anyway,
 * in bold. The admin's own choice first, then those two if they are shared,
 * then the first shared column with something in it.
 */
export function shareTitle(row, widget, allowed) {
  const shared = Array.isArray(allowed) ? allowed : sharableColumns(widget)
  const preferred = [widget?.[SHARE_TITLE], widget?.noteKeyColumn, widget?.detailTitleColumn].filter(
    (c) => c && shared.includes(c)
  )
  for (const column of [...preferred, ...shared]) {
    const value = clip(row?.[column], MAX_SHARED_TITLE)
    if (value) return value
  }
  return row?._row ? `Row ${row._row}` : 'A row'
}

/**
 * A shared row as it may be stored and drawn, or null.
 *
 * Run on the way IN (building the message) and on the way OUT (drawing one
 * that arrived). The second matters as much as the first: a message is a
 * document anybody with the right to send can write by hand, and a card
 * that trusted its shape would be a card that crashed the chat panel.
 */
export function cleanSharedRow(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.fields)) return null
  const seen = new Set()
  const fields = []
  for (const field of raw.fields) {
    if (fields.length >= MAX_SHARED_FIELDS) break
    const column = clip(field?.column, MAX_SHARED_LABEL)
    if (!column || seen.has(column)) continue
    seen.add(column)
    fields.push({ column, value: clip(field?.value, MAX_SHARED_VALUE) })
  }
  if (fields.length === 0) return null

  const pageId = String(raw.pageId ?? '')
  const sheetRow = Number(raw.sheetRow)
  return {
    title: clip(raw.title, MAX_SHARED_TITLE) || 'A row',
    fields,
    widget: clip(raw.widget, MAX_SHARED_LABEL),
    page: clip(raw.page, MAX_SHARED_LABEL),
    // Becomes part of a link, so only the characters a page id is made of.
    pageId: /^[\w-]{1,80}$/.test(pageId) ? pageId : '',
    sheetRow: Number.isInteger(sheetRow) && sheetRow > 0 ? sheetRow : null,
  }
}

/**
 * The row, as the card that goes into a message.
 *
 * Blank values are kept: "Delivery date: —" is the answer to the question
 * the sender is very often asking.
 */
export function rowSnapshot(row, widget, { headers, pageId, pageName } = {}) {
  if (!row) return null
  const allowed = sharableColumns(widget, headers)
  return cleanSharedRow({
    title: shareTitle(row, widget, allowed),
    fields: allowed.map((column) => ({ column, value: row[column] })),
    widget: widget?.title,
    page: pageName,
    pageId,
    sheetRow: row._row,
  })
}

/**
 * The message's text.
 *
 * The note when there is one. When there is not, a sentence that still says
 * what arrived -- a message is never empty (the rules refuse one), and the
 * notification, the tab title and anything else that only reads the text
 * must still make sense.
 */
export function shareBody(snapshot, note) {
  const text = String(note || '').trim()
  return text || `Shared a row: ${snapshot?.title || 'a record'}`
}

/** Is this message's text just the stand-in, with nothing the sender wrote? */
export function isDefaultShareBody(message) {
  const row = cleanSharedRow(message?.row)
  return Boolean(row) && String(message?.body || '').trim() === shareBody(row, '')
}

/** One line for the chat list, saying a row came as well as what was said. */
export function sharePreview(message) {
  const body = String(message?.body || '')
  const row = cleanSharedRow(message?.row)
  if (!row) return body
  return isDefaultShareBody(message) ? `Row · ${row.title}` : `Row · ${row.title} — ${body}`
}

/** What stops this being sent, or ''. */
export function shareProblem({ to, snapshot, note } = {}) {
  if (!cleanSharedRow(snapshot)) return 'Nothing on this row is set to be shared'
  if (!Array.isArray(to) || to.length === 0) return 'Pick who it goes to'
  const over = String(note || '').trim().length - MAX_SHARE_NOTE
  if (over > 0) return `The note is too long by ${over} characters`
  return ''
}

/** The card as plain text, for pasting into an email or a sheet. */
export function sharedRowText(raw) {
  const row = cleanSharedRow(raw)
  if (!row) return ''
  return [row.title, ...row.fields.map((f) => `${f.column}: ${f.value || '—'}`)].join('\n')
}

/**
 * A value that is a web link, or null.
 *
 * http and https only. The value came out of a spreadsheet cell somebody
 * typed into, and a `javascript:` "link" in a message is a script run by
 * whoever is curious enough to click it.
 */
export function linkOf(value) {
  const s = String(value ?? '').trim()
  return /^https?:\/\/\S+$/i.test(s) ? s : null
}

/**
 * The fields a card shows, and how many it is holding back.
 *
 * One hidden field is shown rather than hidden: "show 1 more" is a button
 * that takes more room than the field it is hiding.
 */
export function visibleFields(row, { expanded = false, limit = PREVIEW_FIELDS } = {}) {
  const fields = Array.isArray(row?.fields) ? row.fields : []
  if (expanded || fields.length <= limit + 1) return { shown: fields, hidden: 0 }
  return { shown: fields.slice(0, limit), hidden: fields.length - limit }
}

/** "Open deals · Nashik sales" -- which table, on which page. */
export function sharedFrom(row) {
  return [row?.widget, row?.page].filter(Boolean).join(' · ')
}

/** The page it came from, for the recipient who can open it. */
export function pageHref(row) {
  return row?.pageId ? `/d/${row.pageId}` : null
}
