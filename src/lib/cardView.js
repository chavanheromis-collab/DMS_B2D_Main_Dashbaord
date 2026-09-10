// ---------------------------------------------------------------------
// The same rows, as cards
// ---------------------------------------------------------------------
// A grid is the right shape for comparing forty records on one number and
// the wrong shape for reading one record. Eleven columns of a quotation
// scroll sideways off the screen, the header goes with them, and by the
// third column nobody remembers whose row they are on -- which is why the
// person checking a booking prints it.
//
// So the same rows, laid out as cards: one record per block, its own name
// at the top, its fields stacked under it where they can be read down
// rather than across. Nothing about the DATA changes -- the same filters,
// the same sort, the same paging, the same selection and the same row
// operations. It is a different arrangement of the identical rows, which
// is the whole reason it can be a toggle rather than a second widget.
//
// Three decisions here, and the first is the one that makes it useful
// rather than decorative:
//
//   THE COLOUR IS DECORATION, AND IS TREATED AS SUCH. It was briefly
//   hashed from a column's value, so that every "Pending" card came out
//   the same colour -- information rather than ornament. That is a real
//   thing to want and it is not this: it needed an admin to nominate the
//   column, it left every other table grey, and it could not promise the
//   one property a decorative colour has to have, which is that the card
//   next to this one looks different. Three "Pending" quotations in a row
//   are three identical blocks.
//
//   So the palette is cycled by POSITION, and nothing configures it. Every
//   card differs from its neighbours, on every table, with nobody setting
//   anything up. The cost is that sorting re-colours the grid -- which is
//   exactly what zebra striping has always done, and nobody has ever
//   expected the fifth row to stay grey after a sort. A colour that is
//   admitted to be decoration may be positional; one pretending to be
//   information may not.
//
//   THE CARD IS THE ADMIN'S COLUMN CHOICE, in the admin's order. A card
//   showing fields the table does not is a second configuration to keep in
//   step; a card showing the same ones is a re-arrangement.
//
//   A CARD IS A SUMMARY AND SAYS SO. It shows the first few fields and
//   states how many it is holding back, because a card that silently stops
//   at six of fourteen is the failure this codebase keeps finding and
//   removing. The rest are one click away, in the zoom.

export const VIEW_MODES = [
  { value: 'table', label: 'Table', hint: 'Rows and columns — for comparing many records at once.' },
  { value: 'cards', label: 'Cards', hint: 'One block per record — for reading one at a time.' },
]

/**
 * Is the card arrangement offered on this table at all?
 *
 * Off until an admin turns it on. Cards want a heading worth reading and a
 * handful of fields worth stacking; a forty-column register turned into
 * cards is forty postage stamps saying "and 32 more". So it is a decision
 * somebody makes about a particular table rather than something every
 * table grows.
 */
export function cardViewEnabled(widget) {
  return Boolean(widget?.cardView)
}

/**
 * Which arrangement this table opens in.
 *
 * A table, unless the admin both switched cards ON and made them the
 * default. Reading the default without the switch is how a table that
 * nobody enabled cards for opens as cards after somebody experiments in
 * the panel and turns the switch back off.
 */
export function viewModeOf(widget) {
  if (!cardViewEnabled(widget)) return 'table'
  return widget?.viewMode === 'cards' ? 'cards' : 'table'
}

export const CARD_SIZES = [
  { value: 'sm', label: 'Small', min: 200, minHeight: 150 },
  { value: 'md', label: 'Medium', min: 260, minHeight: 190 },
  { value: 'lg', label: 'Large', min: 330, minHeight: 240 },
]

const sizeOf = (widget) => CARD_SIZES.find((s) => s.value === widget?.cardSize) || CARD_SIZES[1]

/** How narrow a card may get before the grid drops a column. */
export const cardMinWidth = (widget) => sizeOf(widget).min

/**
 * How short a card may get.
 *
 * A floor rather than a fixed height: a card with two filled fields and
 * one with six should not be two different shapes in the same row, and a
 * grid of ragged blocks reads as broken rather than as varied. The floor
 * evens them out; anything taller than it still grows.
 */
export const cardMinHeight = (widget) => sizeOf(widget).minHeight

// ---------------------------------------------------------------------
// The colours
// ---------------------------------------------------------------------
// Twelve tints, and they are their own palette rather than the badge one.
// A badge colour is designed for a pill four millimetres tall, where the
// background is a hint and the text carries the contrast. A card is a
// block the size of a playing card, and the same colours at that size are
// either garish or invisible.
//
// So: a very light ground, a slightly deeper edge to hold its shape
// against the page, a dark ink that stays readable on the ground, and one
// saturated accent for the bar. All four of each row are the same hue, so
// a card reads as one object rather than as a coloured rectangle with an
// unrelated stripe.

export const CARD_PALETTE = [
  { bg: '#F0F9FF', border: '#BAE6FD', fg: '#075985', accent: '#0EA5E9' },
  { bg: '#ECFDF5', border: '#A7F3D0', fg: '#065F46', accent: '#10B981' },
  { bg: '#FFF7ED', border: '#FED7AA', fg: '#9A3412', accent: '#F97316' },
  { bg: '#EEF2FF', border: '#C7D2FE', fg: '#3730A3', accent: '#6366F1' },
  { bg: '#FDF2F8', border: '#FBCFE8', fg: '#9D174D', accent: '#EC4899' },
  { bg: '#F0FDFA', border: '#99F6E4', fg: '#115E59', accent: '#14B8A6' },
  { bg: '#FFFBEB', border: '#FDE68A', fg: '#92400E', accent: '#F59E0B' },
  { bg: '#F5F3FF', border: '#DDD6FE', fg: '#5B21B6', accent: '#8B5CF6' },
  { bg: '#FFF1F2', border: '#FECDD3', fg: '#9F1239', accent: '#F43F5E' },
  { bg: '#ECFEFF', border: '#A5F3FC', fg: '#155E75', accent: '#06B6D4' },
  { bg: '#F7FEE7', border: '#D9F99D', fg: '#3F6212', accent: '#84CC16' },
  { bg: '#FDF4FF', border: '#F5D0FE', fg: '#86198F', accent: '#D946EF' },
]

// Twelve is chosen against the widest grid anybody reads this on: at four
// or five cards across, cycling twelve means neither the card beside a
// given one nor the card under it repeats its colour.

/**
 * How many fields a card shows before it starts saying "and 6 more".
 *
 * A card is a summary. Past about eight lines it is a table row turned on
 * its side, with all of that shape's problems and none of its density.
 */
export const CARD_FIELDS_MAX = 8

/**
 * The column whose value names the card.
 *
 * The admin's choice, or the first column they put on the table -- which
 * is nearly always the identifier, because that is where people put it.
 */
export function cardTitleColumn(widget, columns = []) {
  const chosen = widget?.cardTitle
  if (chosen && columns.includes(chosen)) return chosen
  return columns[0] || ''
}

/**
 * What one card shows: its name, and the fields under it.
 *
 * The title column is not repeated in the body -- it is already the
 * heading, and a card whose first line is its own name twice looks like a
 * rendering fault.
 */
export function cardSpec(widget, columns = []) {
  const title = cardTitleColumn(widget, columns)

  // The line under the heading. An identifier alone -- "Q-1041" -- names a
  // record without saying anything about it, and the second column is
  // almost always the thing that does: the customer, the branch, the
  // model. Set explicitly, or the next column along.
  const wanted = widget?.cardSubtitle
  const subtitle =
    wanted === '' || (wanted && !columns.includes(wanted))
      ? ''
      : wanted || columns.filter((c) => c !== title)[0] || ''

  const rest = columns.filter((c) => c !== title && c !== subtitle)
  return {
    title,
    subtitle,
    fields: rest.slice(0, CARD_FIELDS_MAX),
    // Counted, not dropped silently. See the header comment.
    hidden: Math.max(0, rest.length - CARD_FIELDS_MAX),
    // Every field the zoom shows, the subtitle included -- it is a column
    // like any other once there is room for all of them.
    all: columns.filter((c) => c !== title),
  }
}

/**
 * The colours one card is drawn in: the palette, cycled by position.
 *
 * Nothing to configure and nothing to read off the row -- see the header
 * for why a decorative colour is positional. `index` is the card's place
 * in what is currently on screen, so the guarantee it buys is the one that
 * matters: no card is the colour of the card beside it.
 *
 * A negative or missing index still lands somewhere in the palette rather
 * than off the end of it; a card drawn grey because of an arithmetic
 * accident would look like a state nobody can explain.
 */
export function cardTone(index = 0) {
  const n = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0
  return CARD_PALETTE[n % CARD_PALETTE.length]
}

/** What the "and N more" line says, or '' when nothing is held back. */
export function moreNote(hidden) {
  return hidden > 0 ? `and ${hidden} more field${hidden === 1 ? '' : 's'}` : ''
}

/**
 * A field worth putting on a card.
 *
 * Blank ones are dropped from the CARD and kept in the zoom. On a card
 * they are noise -- eight labels with nothing after them, pushing the
 * fields that do have values off the bottom. In the zoom they are the
 * answer to "was this ever filled in?", which is a real question.
 */
export function cardLines(row, fields) {
  return (fields || [])
    .map((column) => ({ column, value: String(row?.[column] ?? '').trim() }))
    .filter((line) => line.value !== '')
}

/** Every field, blanks included, for the zoomed card. */
export function zoomLines(row, fields) {
  return (fields || []).map((column) => ({ column, value: String(row?.[column] ?? '').trim() }))
}

// ---------------------------------------------------------------------
// How big the zoom should be
// ---------------------------------------------------------------------
// A fixed panel is wrong at both ends. A record with three fields in a
// 480px box is a small amount of text marooned in the middle of a lot of
// nothing; a record with thirty is that same box scrolled four times, for
// a window whose whole purpose was to show the record at once.
//
// So it follows the field count. Height already does -- the panel hugs
// its content and caps at the viewport -- and this is the other axis: a
// little narrower when there is little to say, wider and in two columns
// when there is a lot, which is what turns four scrolls into one.

export const ZOOM_SIZES = [
  { upTo: 6, width: 380, columns: 1 },
  { upTo: 16, width: 500, columns: 1 },
  { upTo: Infinity, width: 680, columns: 2 },
]

/**
 * The width and column count for a record with this many fields.
 *
 * Two columns only past the point where one would scroll: side by side is
 * harder to read down, and it is worth it exactly when the alternative is
 * not being able to see the record at once, which was the point.
 */
export function zoomSize(fieldCount) {
  const n = Number.isFinite(fieldCount) ? Math.max(0, fieldCount) : 0
  return ZOOM_SIZES.find((size) => n <= size.upTo) || ZOOM_SIZES[ZOOM_SIZES.length - 1]
}
