// ---------------------------------------------------------------------
// Whole rows: removing them, and sending them somewhere else
// ---------------------------------------------------------------------
// Editing has always meant editing a CELL. Everything a table could do was
// something you could do to one value: type in it, pick from a dropdown,
// drag it down a column. The row itself was fixed -- it arrived from the
// sheet and the only way to remove one, or move one to another tab, was to
// open Google and do it there, which is exactly the round trip a dashboard
// exists to remove.
//
// Row operations are a different kind of write and are modelled as one.
// Three reasons they are not just "more editing":
//
//   THEY ARE ADDRESSED BY ROW, NOT BY COLUMN. A cell grant says "you may
//   write Status". There is no column-shaped way to say "you may throw this
//   record away", so deleting needs a grant of its own.
//
//   ONE OF THEM CANNOT BE UNDONE. A wrong cell value is visible and
//   correctable. A deleted row is gone, and nothing on the page says what
//   used to be there. So it is separately granted, separately switched on
//   per table, confirmed before it fires, and refused outright by the
//   server if the rows have moved underneath it (rowFingerprint.js).
//
//   THEY CROSS TABS. Sending a quotation to the Bookings tab is two writes
//   on two different spreadsheets, and every check has to hold on BOTH --
//   which is why a move is modelled as exactly what it is, an add over
//   there and a delete over here, rather than as a third kind of thing with
//   its own permission nobody would think to review.
//
// Rows are never CREATED here. A record is entered where records are
// entered; what a dashboard is for is what happens to it afterwards.
//
// This module is the model and nothing else: what a table offers, what a
// person may do, and what a row becomes when it lands on another tab. The
// component asks it what to draw and the server asks it what to allow, so
// there is one answer rather than two that drift.

import { requiredColumnsOf } from './requiredColumns.js'
import { dataValues } from './rowMeta.js'

// ---------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------
// Two grants, and they are not the two operations. A copy is an ADD on the
// tab the rows land on; a move is that plus a DELETE on the tab they leave.
// Modelling them as the writes they perform rather than as the buttons they
// sit behind is what stops "may move" being a right nobody thought to
// review -- there is no such grant, only the two halves it is made of, each
// checked on the tab it actually touches.

// CLEARING is the third, and it is deliberately not a grant. Emptying a
// cell is writing '' into it, which the column grants already govern
// perfectly: a person who may type in Status may empty Status, one row at
// a time, and doing forty at once changes the scale rather than the
// permission. Inventing a "may clear" right would mean an admin could
// grant somebody the ability to blank a column they cannot write, which is
// not a thing anybody means.
//
// It exists at all because the alternative -- delete the row and enter it
// again -- throws away the one thing worth keeping. A cleared row holds
// its place: the row number every other sheet's formula points at, its
// formatting, its dropdowns, and whatever the admin marked as the fields a
// record must always have. What goes is the data.

export const ROW_OP_GRANTS = [
  {
    value: 'add',
    label: 'Receive rows',
    hint: 'Accept rows copied or moved here from another tab. Granted on the tab they LAND on.',
  },
  {
    value: 'delete',
    label: 'Delete rows',
    hint: 'Remove rows for good. Also what lets a row be MOVED off this tab rather than copied.',
  },
]

export const ROW_OPS = ROW_OP_GRANTS.map((g) => g.value)

/**
 * The operations an admin has switched on for this table.
 *
 * `needs` is what the reader must hold ON THIS TAB. Copying needs nothing
 * here, which is not an oversight: the rows LAND on the target, so it is
 * the target's `add` grant that governs them -- and the target list handed
 * in has already been narrowed to the ones this person may write to (a
 * destination they cannot receive on is not a destination). Requiring
 * `add` here as well would hide a copy somebody is perfectly entitled to
 * make out of a tab they may only read.
 */
export const ROW_OP_SWITCHES = [
  {
    key: 'canDeleteRows',
    label: 'Delete rows',
    needs: ['delete'],
    hint: 'Remove the selected rows. Cannot be undone.',
  },
  {
    key: 'canClearRows',
    label: 'Clear rows',
    needs: [],
    // Not a grant but a column question: this empties cells, so it offers
    // itself only where there is a cell this person may write.
    columns: true,
    hint: 'Empty the selected rows without removing them. Only the columns this person may edit, and never one that cannot be left empty.',
  },
  {
    key: 'canCopyRows',
    label: 'Copy rows to another tab',
    needs: [],
    hint: 'Send a copy. The rows stay here as well.',
  },
  {
    key: 'canMoveRows',
    label: 'Move rows to another tab',
    needs: ['delete'],
    hint: 'Send them and take them off this tab. Needs Delete granted here, because that is the half it performs.',
  },
]

/** The switches that send rows somewhere -- both use the same destinations. */
export const TRANSFER_SWITCHES = ['canCopyRows', 'canMoveRows']

/** Does this table send rows anywhere at all? */
export function sendsRows(widget) {
  return TRANSFER_SWITCHES.some((key) => Boolean(widget?.[key]))
}

// ---------------------------------------------------------------------
// What a person may do
// ---------------------------------------------------------------------

/**
 * The row-operation grants this person holds on one ref.
 *
 * Admins hold both, everywhere, exactly as they do for columns -- the
 * alternative is an admin who cannot fix a page they can see.
 */
export function grantsFor(access, ref, isAdmin = false) {
  if (isAdmin) return [...ROW_OPS]
  const held = access?.rowOps?.[ref]
  return ROW_OPS.filter((op) => (held || []).includes(op))
}

export const canAdd = (access, ref, isAdmin) => grantsFor(access, ref, isAdmin).includes('add')
export const canDelete = (access, ref, isAdmin) => grantsFor(access, ref, isAdmin).includes('delete')

// ---------------------------------------------------------------------
// A route: where rows go, and how their columns line up
// ---------------------------------------------------------------------
// A destination used to be a bare ref, and the columns were matched by
// name. That is right exactly when the two tabs were built by the same
// person on the same day. In every other case the quotation sheet says
// "Quotation No" and the booking sheet says "Booking Ref", and matching by
// name carries four of eleven columns and silently drops the rest.
//
// So a destination is a ROUTE -- a target plus the pairs that say which
// column becomes which. Two rules keep it usable:
//
//   NO PAIRS MEANS MATCH BY NAME. Which is what it did before, so nothing
//   already configured changes, and a route between two tabs that agree
//   needs no setting up at all.
//
//   PAIRS, ONCE THERE, ARE THE WHOLE ANSWER. Not a set of overrides laid
//   over name-matching: that would mean a column carrying because of a rule
//   nobody wrote down, and the way to stop it carrying would be to invent a
//   pair pointing at nothing. A configured route says exactly what travels.
//
// The route belongs to the ADMIN and to nobody else. The reader sees what
// will happen and presses the button; they cannot re-point a column on the
// way past. Two reasons, and the second is the one that decided it:
//
//   A MAPPING IS A DECISION ABOUT THE SHEET, not about today's batch. Once
//   anyone sending rows can change where a column lands, "what is in the
//   Booking Ref column" stops having one answer, and the person
//   reconciling the month cannot tell a typo from a re-mapping.
//
//   IT LETS THE SERVER STOP TRUSTING THE BROWSER. The route is read from
//   the stored widget, exactly as the permitted refs are -- so a crafted
//   request cannot name its own pairs any more than it can name its own
//   destination. Nothing the browser sends decides where a value lands.

/**
 * One route, from either the old shape (a bare ref) or the new one.
 *
 * A HALF-WRITTEN pair is kept. That looks wrong and is the whole reason
 * "Add column" works: the button appends a blank pair and saves it, and a
 * normalizer that dropped anything with an empty side deleted the new row
 * before it could be drawn -- so the button appeared to do nothing at all.
 *
 * Nothing downstream is harmed by keeping them, because deciding what a
 * pair MEANS is `resolvePairs`'s job and it ignores the incomplete ones.
 * This function's job is only to read the stored shape faithfully, and a
 * row somebody is halfway through typing is part of that shape.
 */
export function normalizeRoute(entry) {
  if (typeof entry === 'string') return { ref: entry, pairs: [] }
  return {
    ref: entry?.ref || '',
    pairs: (entry?.pairs || [])
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({ from: String(p.from ?? ''), to: String(p.to ?? '') })),
  }
}

/** Every route this table offers, in the admin's order. */
export function copyRoutesOf(widget) {
  return (widget?.copyTargets || []).map(normalizeRoute).filter((r) => r.ref)
}

/** Just the destinations, for the places that only need to know where. */
export function copyTargetsOf(widget) {
  return copyRoutesOf(widget).map((r) => r.ref)
}

/** The route to one destination, or an unmapped one if it has no entry. */
export function routeFor(widget, ref) {
  return copyRoutesOf(widget).find((r) => r.ref === ref) || { ref, pairs: [] }
}

export const blankPair = () => ({ from: '', to: '' })

/**
 * How many pairs are actually filled in.
 *
 * The same question `resolvePairs` asks before it decides whether a route
 * is mapped or falls back to matching by name -- so anything SAYING which
 * of those is happening has to ask it the same way, or a route reading "0
 * columns" will quietly be matching eleven of them by name.
 */
export const mappedCount = (pairs) => (pairs || []).filter((p) => p?.from && p?.to).length

/**
 * The pairs that will actually be used, against the columns that exist.
 *
 * An empty list falls back to name-matching -- see above. Either way the
 * result is filtered to columns BOTH tabs still have, so a pair naming a
 * column somebody deleted in Google is dropped rather than writing into
 * nowhere, and the dialog can say how many were dropped.
 *
 * A target column is used once. Two source columns aimed at one destination
 * is a mapping where the answer depends on iteration order, which is not an
 * answer; the first pair wins and the second is reported as unused.
 */
export function resolvePairs(pairs, sourceHeaders, targetHeaders) {
  const here = new Set((sourceHeaders || []).filter(Boolean))
  const there = new Set((targetHeaders || []).filter(Boolean))

  // Whether the admin has mapped anything is judged on the COMPLETE pairs,
  // not on the length of the list. A route holding one row somebody has
  // not finished typing has not been mapped yet, and should still match by
  // name rather than silently carrying nothing.
  const complete = (pairs || []).filter((p) => p?.from && p?.to)

  const wanted =
    complete.length > 0
      ? complete
      : // Nothing mapped: every name the two tabs share, which is what this
        // did before routes existed.
        (sourceHeaders || []).filter((c) => there.has(c)).map((c) => ({ from: c, to: c }))

  const used = new Set()
  const kept = []
  const unusable = []
  for (const pair of wanted) {
    const from = pair?.from
    const to = pair?.to
    if (!from || !to) continue
    // Unknown columns are only "unusable" when we actually know the lists.
    // A target whose headers have never been synced is not evidence that a
    // pair is wrong -- see `mappingNote`.
    if ((here.size > 0 && !here.has(from)) || (there.size > 0 && !there.has(to)) || used.has(to)) {
      unusable.push(pair)
      continue
    }
    used.add(to)
    kept.push({ from, to })
  }
  return { pairs: kept, unusable }
}

/**
 * One row, as it will look on the other tab.
 *
 * Keyed by the TARGET's column names, because that is the shape the append
 * writes against. A source column with no pair simply is not here -- which
 * is the difference between "not carried" and "carried as empty", and the
 * append leaves the cell blank either way.
 */
export function mapRow(row, pairs) {
  const values = dataValues(row)
  const out = {}
  for (const { from, to } of pairs || []) {
    if (!from || !to) continue
    out[to] = values[from] ?? ''
  }
  return out
}

/**
 * Which actions this table actually shows, for this person, right now.
 *
 * Three things have to agree before a button exists, and they are three
 * different people's decisions: the admin switched the action on for this
 * table, this reader holds whatever it needs HERE, and -- for a copy --
 * there is at least one tab left they may send rows to. A button that
 * appears and then fails is worse than one that was never there.
 *
 * `targets` is expected to arrive already narrowed to the destinations this
 * person may write to. That is where a copy's permission lives, so an empty
 * list is the whole answer for it.
 *
 * `columns` is the tab's own header list, and it is what settles clearing:
 * that one is governed by the column grants rather than by a row grant, so
 * "may this person empty anything here at all" is a question about columns
 * and cannot be answered without them. A table with nothing writable on it
 * offers no Clear button -- one that appeared and then emptied nothing
 * would be read as the operation having failed silently.
 */
export function availableActions(widget, { access, ref, isAdmin = false, targets = [], columns = [] } = {}) {
  const grants = grantsFor(access, ref, isAdmin)
  const editable = access?.editable?.[ref] || []
  const out = []
  for (const action of ROW_OP_SWITCHES) {
    if (!widget?.[action.key]) continue
    if (!action.needs.every((need) => grants.includes(need))) continue
    if (action.key === 'canCopyRows' && targets.length === 0) continue
    if (action.columns && clearPlan(widget, columns, { editable, isAdmin }).clear.length === 0) continue
    out.push(action.key)
  }
  return out
}

/** Is there anything at all to put in the selection bar? */
export function hasRowActions(widget, context) {
  return availableActions(widget, context).length > 0
}

/**
 * Whether a MOVE is on offer, as opposed to only a copy.
 *
 * Its own switch, because they are different decisions: a table that feeds
 * a register wants Copy and must never offer Move, and a table that is a
 * queue wants the opposite. One switch covering both meant an admin who
 * wanted either got both.
 *
 * It still needs the delete grant on the tab the rows are leaving, because
 * that is literally the second half of what it does. Offering it without
 * would be a button whose second half is refused after its first half has
 * already landed -- rows duplicated onto the target and still sitting here,
 * which is the one outcome worse than either operation failing outright.
 */
export function canMove(widget, { access, ref, isAdmin = false } = {}) {
  return Boolean(widget?.canMoveRows) && canDelete(access, ref, isAdmin)
}

// ---------------------------------------------------------------------
// What an arriving row may carry
// ---------------------------------------------------------------------

/**
 * The columns a row arriving on a tab may carry.
 *
 * The SAME grant that governs editing a cell there. A row is a set of
 * cells, and letting somebody land a column on a tab that they could not
 * then write would make a copy a way around the column grants -- put it
 * there wrong, and be unable to correct it.
 *
 * Admins get every column the tab has, for the same reason they always do.
 */
export function creatableColumns(columns, editableColumns, isAdmin = false) {
  const all = (columns || []).filter(Boolean)
  return isAdmin ? all : all.filter((c) => (editableColumns || []).includes(c))
}

/**
 * A row's values, trimmed to what this person may actually write.
 *
 * A reader who cannot write Amount on the destination does not get to carry
 * an Amount there by copying a row that has one. The cell is left blank
 * rather than the row refused: the record is still worth having, and what
 * is missing is visible in the column it is missing from.
 */
export function scrubRow(values, allowed) {
  const keep = new Set(allowed || [])
  const out = {}
  for (const [column, value] of Object.entries(dataValues(values))) {
    if (keep.has(column)) out[column] = value
  }
  return out
}

// ---------------------------------------------------------------------
// Emptying rows in place
// ---------------------------------------------------------------------

/**
 * Exactly which columns a clear touches, and which it leaves alone.
 *
 * Three groups, and every one of them has to be on screen before anybody
 * presses the button -- "Clear rows" that quietly leaves four columns
 * filled is discovered by whoever assumes the row is empty.
 *
 *   CLEARED. What this person may write here. The same rule that governs
 *   a cell edit and a row arriving from another tab (`creatableColumns`),
 *   because it is the same act: putting a value -- here, no value -- into
 *   a cell on this tab.
 *
 *   KEPT. Columns the admin marked as ones a record must always have. This
 *   is the difference between clearing and deleting: a cleared row is
 *   still a row, and a row that has lost the field identifying it is worse
 *   than one that is gone, because it still looks like a record. The
 *   detail form refuses to empty these one at a time (requiredColumns.js);
 *   forty at once cannot be the way round that.
 *
 *   LOCKED. Everything else on the tab -- not this person's to empty, and
 *   not claimed to be.
 */
export function clearPlan(widget, columns, { editable = [], isAdmin = false } = {}) {
  const all = (columns || []).filter(Boolean)
  const writable = creatableColumns(all, editable, isAdmin)
  const required = new Set(requiredColumnsOf(widget))
  return {
    clear: writable.filter((c) => !required.has(c)),
    kept: writable.filter((c) => required.has(c)),
    locked: all.filter((c) => !writable.includes(c)),
  }
}

const andList = (names) => {
  const list = (names || []).filter(Boolean)
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** What a clear will do, said before it does it. */
export function clearNote({ clear = [], kept = [], locked = [] } = {}) {
  if (clear.length === 0) return 'There is nothing here that you can empty.'

  const shown = clear.slice(0, 4).join(', ')
  const rest = clear.length > 4 ? ` and ${clear.length - 4} more` : ''
  const parts = [`Empties ${clear.length === 1 ? 'one column' : `${clear.length} columns`}: ${shown}${rest}.`]

  if (kept.length > 0) {
    parts.push(`${andList(kept)} ${kept.length === 1 ? 'stays' : 'stay'} — ${kept.length === 1 ? 'it cannot' : 'they cannot'} be left empty.`)
  }
  if (locked.length > 0) {
    parts.push(`${locked.length} ${locked.length === 1 ? 'column is' : 'columns are'} not yours to edit and ${locked.length === 1 ? 'is' : 'are'} untouched.`)
  }
  return parts.join(' ')
}

// ---------------------------------------------------------------------
// Sending rows to another tab
// ---------------------------------------------------------------------

/**
 * How one tab's columns land on another's: by NAME, and only by name.
 *
 * Position would be the other option and it is indefensible -- two tabs
 * that happen to both have six columns would map Chassis onto Customer and
 * write it, with every value in the right shape and the wrong place.
 *
 * Returns { matched, dropped, blank } so the dialog can say what will
 * happen BEFORE it happens. A copy that silently drops four columns is
 * discovered a week later by whoever is reconciling; a copy that says "4
 * columns have nowhere to go on Bookings" is a decision.
 */
export function mapColumns(fromColumns, toColumns) {
  const from = (fromColumns || []).filter(Boolean)
  const to = (toColumns || []).filter(Boolean)
  const there = new Set(to)
  const here = new Set(from)

  return {
    matched: from.filter((c) => there.has(c)),
    // Columns this tab has that the target does not: their values have
    // nowhere to land.
    dropped: from.filter((c) => !there.has(c)),
    // Columns the target has that this tab does not: they arrive empty.
    blank: to.filter((c) => !here.has(c)),
  }
}

/** Is a copy to this target worth offering at all? */
export function targetIsUsable(fromColumns, toColumns) {
  return mapColumns(fromColumns, toColumns).matched.length > 0
}

/**
 * What the dialog says about a mapping, in one line.
 *
 * Deliberately says the number that is LOST rather than the number that
 * carries: the reader already assumes it all carries, and the only figure
 * that can change their mind is the one that does not.
 *
 * `null` means the destination's column list is not known here -- it is a
 * tab this page does not read and whose source has not been synced. That is
 * NOT a reason to refuse: the server maps at the moment it writes, and it
 * will do so perfectly well without this page having an opinion. Saying so
 * is the honest answer; disabling the button over it would block a copy
 * that works.
 */
export function mappingNote(mapping) {
  if (!mapping) {
    return 'The column list for that tab is not known here yet — the mapping will still be applied when the rows are sent.'
  }
  const { matched, dropped } = mapping
  if (matched.length === 0) return 'No column names match — nothing would carry across.'
  if (dropped.length === 0) return `All ${matched.length} columns carry across.`
  const names = dropped.slice(0, 3).join(', ')
  const rest = dropped.length > 3 ? ` and ${dropped.length - 3} more` : ''
  return `${matched.length} columns carry across. ${dropped.length} have nowhere to go: ${names}${rest}.`
}

/** What a route carries, said in one line, for the dialog and the editor. */
export function routeNote({ pairs, unusable }, { known = true } = {}) {
  if (!known) {
    return 'The column list for that tab is not known here yet — the mapping will still be applied when the rows are sent.'
  }
  if (pairs.length === 0) return 'Nothing is mapped, so nothing would carry across.'
  // The verb agrees as well as the noun. "1 column carry across" is the
  // sort of thing nobody reports and everybody notices.
  const one = pairs.length === 1
  const tail =
    unusable.length > 0
      ? ` ${unusable.length} pair${unusable.length === 1 ? ' no longer fits' : 's no longer fit'} and will be skipped.`
      : ''
  return `${pairs.length} column${one ? ' carries' : 's carry'} across.${tail}`
}

/** How many column pairs one route may carry. */
export const MAX_PAIRS = 100

// ---------------------------------------------------------------------
// Saying what is about to happen
// ---------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export const rowCount = (n) => plural(n, 'row', 'rows')

/**
 * The sentence on the confirm button.
 *
 * Every one of them carries the COUNT, because the whole failure mode this
 * guards against is acting on a selection that is not the one you think you
 * have -- rows ticked on a page you have since paged away from, or a
 * select-all that took in more than the screen was showing.
 */
export function confirmLabel(action, n, target = '') {
  switch (action) {
    case 'delete':
      return `Delete ${rowCount(n)}`
    case 'clear':
      return `Clear ${rowCount(n)}`
    case 'copy':
      return `Copy ${rowCount(n)} to ${target}`
    case 'move':
      return `Move ${rowCount(n)} to ${target}`
    default:
      return ''
  }
}

// ---------------------------------------------------------------------
// How much one press may do
// ---------------------------------------------------------------------
// There has to be a cap. A row operation is a gesture -- somebody ticked
// rows they were looking at -- and past a few hundred it is not that any
// more, it is a script, and the difference between "the ones I meant" and
// "everything the filter happened to leave" stops being visible on the
// screen that is about to act on it.
//
// But the right number is not the same everywhere, which is why it is now
// the admin's. A master register wants a cap of ten, so that a slip with
// select-all cannot take the month out. A staging tab that gets emptied
// every Friday wants five hundred, and a cap of two hundred there just
// means doing it three times and losing count.
//
// Two numbers, and only one of them is a decision:
//
//   THE DEFAULT is what every table has always had, so nothing configured
//   before this existed changes.
//
//   THE CEILING is not configurable at all. Above it the write stops being
//   the risk and the request does: the move path alone is two reads, an
//   append and a delete, and a serverless function that runs out of time
//   half way through has appended rows nobody can see and deleted none of
//   them. Five hundred is what fits with room to spare.

/** How many rows one request may carry when nobody has said otherwise. */
export const MAX_ROWS_PER_OP = 200

/** The most any table can be set to, whatever is in the document. */
export const ROW_LIMIT_CEILING = 500

/** Where the admin's number lives on the widget. */
export const ROW_LIMIT = 'maxRowsPerOp'

/**
 * This table's cap, from a document that may say anything.
 *
 * Clamped rather than validated, and clamped in the MODEL rather than at
 * the form, so the page's own answer and the server's are the same
 * function of the same field. A hand-edited document asking for fifty
 * thousand gets the ceiling; one asking for nothing gets the default;
 * one asking for zero or a word gets the default too, because neither is
 * somebody saying "no rows at a time".
 */
export function rowLimitOf(widget) {
  const raw = Math.floor(Number(widget?.[ROW_LIMIT]))
  if (!Number.isFinite(raw) || raw < 1) return MAX_ROWS_PER_OP
  return Math.min(raw, ROW_LIMIT_CEILING)
}

/** Does this table offer any whole-row action at all? */
export function offersRowOps(widget) {
  return ROW_OP_SWITCHES.some((action) => Boolean(widget?.[action.key]))
}

export function tooMany(n, limit = MAX_ROWS_PER_OP) {
  return n > limit
}

export function limitNote(n, limit = MAX_ROWS_PER_OP) {
  return tooMany(n, limit)
    ? `That is ${rowCount(n)}. ${limit} at a time is the most this table will do in one go.`
    : ''
}
