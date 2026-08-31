// ---------------------------------------------------------------------
// Remarks on a row
// ---------------------------------------------------------------------
// A sticky note on a record. Somebody opens a row's note, writes *"customer
// asked to postpone delivery to the 14th"*, and the next person to look at
// that row sees it -- with who said it and when. Several people can write on
// the same note; it is a thread, not a field.
//
// It is deliberately NOT a column. A column is the spreadsheet's business:
// it has a type, it is filtered on, it is exported, and adding one means
// editing the sheet. A remark is a conversation about one record, and the
// thing people actually do with it is read the last three.
//
// The whole design rests on one question: WHAT IS A REMARK ATTACHED TO?
//
//   NOT THE SPREADSHEET ROW NUMBER. `_row` is the position of a row in the
//   sheet today. Somebody inserts a row above it in Google Sheets tomorrow
//   and every remark below shifts down one record -- silently, and onto real
//   records that now carry somebody else's words. That is the worst thing
//   this feature could do, so the admin picks a KEY COLUMN (a deal id, a
//   chassis number, an invoice number) and the remark is attached to that
//   value. Rows can then be sorted, filtered, paged, re-imported or moved
//   and the note follows its record.
//
//   NOT THE WIDGET. Two tables showing the same tab are two views of the
//   same records, and a remark that appeared on one but not the other would
//   have people asking where their note went. The address is the TAB plus
//   the key, so a record has one note wherever it is shown.
//
// `_row` is still the fallback when no key column has been chosen, because a
// feature that refuses to work until it is configured perfectly is a feature
// nobody switches on -- but the editor says plainly what that costs.
//
// Pure: values in, values out. Firestore lives in hooks/useRowNotes.js.

/** Longest one remark may be. Past this it is a document, not a remark. */
export const MAX_REMARK = 500

/** Separates the parts of a note's address. */
export const NOTE_SEP = '::'

/**
 * Is this table showing remarks?
 *
 * Admin's switch, per widget. Absent means off -- unlike the messaging
 * rights, where absent means yes: this one adds something to a table that
 * did not have it, so every existing table stays exactly as it was.
 */
export function notesEnabled(widget) {
  return widget?.rowNotes === true
}

/**
 * What identifies the record this row is.
 *
 * The admin's key column if there is one and this row has a value in it;
 * the sheet row number otherwise. `null` when there is neither -- a remark
 * attached to nothing would be attached to every nothing.
 */
export function rowKeyOf(row, keyColumn) {
  if (!row) return null
  if (keyColumn) {
    const value = String(row[keyColumn] ?? '').trim()
    if (value) return value
  }
  const fallback = String(row._row ?? '').trim()
  return fallback || null
}

/**
 * A 32-bit FNV-1a of the raw address.
 *
 * Sanitising an id loses information -- "A/B" and "A_B" both become "A_B" --
 * and two different records sharing a note is the one failure nobody would
 * think to look for. The hash is taken over the RAW address, so distinct
 * records stay distinct however their ids are cleaned up.
 */
export function hash32(text) {
  let h = 0x811c9dc5
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * The document id for one note.
 *
 * Readable at the front so a document can be found by eye in the Firebase
 * console, exact at the back so it cannot collide. The `n_` is only a label
 * -- it is not what keeps the id legal. Sanitising collapses RUNS of
 * punctuation to a single underscore, so an address could never produce the
 * reserved `__.*__` shape with or without it.
 */
export function noteId(scope, key) {
  if (!scope || key === null || key === undefined || key === '') return null
  const raw = `${scope}${NOTE_SEP}${key}`
  const safe = raw.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 100)
  return `n_${safe}_${hash32(raw)}`
}

/** The note id for a row, or null if this row cannot carry one. */
export function noteIdFor(scope, row, keyColumn) {
  return noteId(scope, rowKeyOf(row, keyColumn))
}

/**
 * The remarks on a note, oldest first.
 *
 * Oldest first because it is a conversation and a conversation is read
 * downwards -- and because the newest one is then next to the box you type
 * the next one into.
 */
export function remarksOf(note) {
  const list = Array.isArray(note?.remarks) ? note.remarks : []
  return [...list].sort((a, b) => String(a?.at || '').localeCompare(String(b?.at || '')))
}

/** How many, for the badge on the button. */
export function remarkCount(note) {
  return remarksOf(note).length
}

/**
 * The badge's text. Capped, because past a point the number stops being
 * information and starts being width -- the same rule the bell follows.
 */
export function countLabel(n) {
  const count = Number(n) || 0
  if (count <= 0) return ''
  return count > 9 ? '9+' : String(count)
}

/** Why this remark cannot be saved, or '' if it can. */
export function remarkProblem(text) {
  const body = String(text ?? '').trim()
  if (!body) return 'Write something first'
  if (body.length > MAX_REMARK) return `${body.length} characters — the limit is ${MAX_REMARK}`
  return ''
}

/**
 * One remark, as stored.
 *
 * The author's NAME is written into the remark rather than looked up from
 * their user document when it is read. A remark is a record of what was said
 * and who said it at the time; resolving the name later would rewrite
 * history every time somebody edited their profile, and would show a blank
 * where somebody has since left.
 */
export function remarkDoc(text, user, now = new Date()) {
  return {
    text: String(text ?? '').trim().slice(0, MAX_REMARK),
    by: user?.uid || '',
    byName: user?.name || user?.email || 'Someone',
    at: now.toISOString(),
  }
}

/** The document a note starts life as. */
export function noteDoc(scope, key) {
  return { scope: String(scope || ''), key: String(key ?? ''), remarks: [] }
}

/** Whose remark this is. Only the author may take one back. */
export function isMine(remark, uid) {
  return Boolean(uid) && remark?.by === uid
}

/**
 * Up to two initials, for the avatar.
 *
 * Split on whitespace so "Ravi Kumar" is RK; an email falls back to its
 * first letter, which is still better than a grey circle.
 */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * A stable colour per person.
 *
 * Same author, same tint, every time -- which is what makes a thread
 * skimmable without reading a single name. Hashed rather than assigned in
 * order, so it does not change when somebody else writes first.
 */
const AVATAR_TINTS = [
  { bg: '#EEF2FF', fg: '#4338CA' },
  { bg: '#ECFDF5', fg: '#047857' },
  { bg: '#FFF7ED', fg: '#C2410C' },
  { bg: '#FDF2F8', fg: '#BE185D' },
  { bg: '#F0F9FF', fg: '#0369A1' },
  { bg: '#FEFCE8', fg: '#A16207' },
  { bg: '#F5F3FF', fg: '#6D28D9' },
  { bg: '#F0FDFA', fg: '#0F766E' },
]

export function tintFor(person) {
  const key = String(person || '')
  if (!key) return AVATAR_TINTS[0]
  return AVATAR_TINTS[parseInt(hash32(key), 36) % AVATAR_TINTS.length]
}

/**
 * The exact moment, spelled out.
 *
 * `whenText` gives "2d ago", which is what somebody skimming wants. But a
 * remark is a record -- *"he said that on the 3rd"* -- so the precise stamp
 * is always there too, in the tooltip and under anything older than a day.
 */
export function exactWhen(iso) {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  return then.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * A one-line summary for the button's tooltip.
 *
 * The most recent remark, because that is the one somebody wants to know
 * about before deciding whether to open anything.
 */
export function latestSummary(note) {
  const list = remarksOf(note)
  if (list.length === 0) return 'Add a remark'
  const last = list[list.length - 1]
  const text = String(last.text || '').replace(/\s+/g, ' ').trim()
  const short = text.length > 80 ? `${text.slice(0, 79)}…` : text
  return `${last.byName}: ${short}`
}
