// ---------------------------------------------------------------------
// A vehicle you can turn round
// ---------------------------------------------------------------------
// A 360° viewer is a stack of photographs taken at even angles and a rule
// for which one to show. There is no 3D here and there should not be: the
// photographs already ARE the model, lit and finished, and nothing built in
// a browser is going to look more like the bike than the bike does.
//
// So the whole job is:
//
//   ORDER THE FRAMES. They arrive from a Drive folder named
//   `HDLHCDRSCFIBLK_005_001` … `_012`, and a plain string sort is a trap the
//   moment somebody drops the zero padding: "10" sorts before "2". Sorted by
//   the NUMBER at the end, falling back to the name.
//
//   TURN A DRAG INTO A FRAME. Dragging the width of the viewer is one full
//   revolution, whatever the frame count -- twelve frames and forty feel the
//   same to the hand, one is just smoother.
//
//   WRAP. Frame 12 is next to frame 1. A viewer that stops at the ends is a
//   slider, and somebody will drag past the end within three seconds.
//
// The count is never assumed. Twelve is what this set happens to have;
// eight, sixteen and thirty-six are all normal, and the only thing the code
// may know is `frames.length`.
//
// Pure: config and file lists in, numbers and urls out.

import { driveFolderId } from './imageUrl.js'

/** A viewer smaller than this is a thumbnail, larger is a wallpaper. */
export const MIN_SIZE = 120
export const MAX_SIZE = 1600

/** How far a flick has to be still travelling to keep coasting. */
export const GLIDE_STOP = 0.35

/** Zoom, as a multiple of the drawn size. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export const DEFAULT_SPIN = {
  folderId: '',
  // Where the folder id comes from when each model has its own: a column on
  // the row, rather than a folder typed into the dashboard per model. The
  // spreadsheet is where the business already keeps this.
  folderColumn: '',
  // Two columns identify a model -- a model code and a colour code, which
  // is exactly what `HDLHCDRSCFIBLK_005` is. Neither alone is unique.
  keyColumns: [],
  imageWidth: 520,
  platformWidth: 460,
  platformDepth: 90,
  platformColor: '#1e293b',
  autoSpin: false,
  spinMs: 90,
  reverse: false,
  shadow: true,
  // --- the image itself -------------------------------------------------
  // Product photographs come on white. On a dark page that is a white
  // rectangle, so the stage behind the vehicle is settable -- a light plate
  // makes a white-background photo look deliberate, and `transparent` is
  // for the cut-out PNGs somebody eventually supplies.
  stageBg: 'transparent',
  // No card at all: the vehicle stands on the page rather than in a box.
  // The Look tab still works on a bare viewer -- it simply has less to
  // paint, since the surface it would have painted is gone.
  bare: false,
  // `multiply` drops a white background into a light stage; `screen` drops
  // a black one into a dark stage. Neither is a substitute for a real
  // cut-out, which is why the default is to do nothing at all.
  blend: 'none',
  fit: 'contain',
  padding: 12,
  // A flick keeps turning and slows down. Without it the vehicle stops
  // dead the instant the finger lifts, which no real object does.
  glide: true,
  zoom: true,
  fullscreen: true,
  // Whether walking to a row narrows the rest of the page to that vehicle.
  // OFF by default, and deliberately: a viewer that silently filters every
  // KPI on the page the moment it is dropped on one is a surprise, and the
  // person who has to work out why the numbers changed is not the person
  // who added it.
  driveFilter: false,
}

/**
 * The folder a viewer is pointed at, from whatever was pasted.
 *
 * Through `driveFolderId`, so the link straight out of Drive's address bar
 * works -- which is the link everybody actually has. A bare id still works
 * too, and so does one with `?usp=sharing` on the end.
 */
export function folderIdOf(value) {
  return driveFolderId(value)
}

/**
 * Where a flick leaves it.
 *
 * `velocity` is frames per tick at the moment of release. Each tick it is
 * scaled down by `friction` until it is too slow to matter, which is what
 * makes a heavy object feel heavy rather than snapping to a stop.
 */
export function glideStep(index, velocity, count, friction = 0.94) {
  const next = velocity * friction
  return {
    index: wrapFrame(index + velocity, count),
    velocity: Math.abs(next) < GLIDE_STOP ? 0 : next,
  }
}

/** A zoom level, kept between "no zoom" and "unreadably close". */
export function clampZoom(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n))
}

/**
 * How far the image may be pushed about at this zoom.
 *
 * At 1× there is nowhere to go, and every zoom past that adds half the
 * overflow in each direction -- so the edge of the photograph can be
 * reached and nothing beyond it.
 */
export function panLimit(size, zoom) {
  const z = clampZoom(zoom)
  return Math.max(0, ((size || 0) * (z - 1)) / 2)
}

/** A pan offset, held inside what the zoom allows. */
export function clampPan(offset, size, zoom) {
  const limit = panLimit(size, zoom)
  const n = Number(offset) || 0
  return Math.min(limit, Math.max(-limit, n))
}

/**
 * How far through the preload we are, as a whole percentage.
 *
 * Shown rather than hidden: twelve photographs at retina width is a real
 * wait on a phone, and a viewer that sits blank for four seconds is one
 * people press again.
 */
export function loadPercent(loaded, total) {
  if (!total) return 0
  return Math.min(100, Math.round((Math.min(loaded, total) / total) * 100))
}

/** Which frame a keyboard press lands on. */
export function frameFromKey(key, index, count, reverse = false) {
  const back = reverse ? 1 : -1
  const fwd = reverse ? -1 : 1
  if (key === 'ArrowLeft') return wrapFrame(index + back, count)
  if (key === 'ArrowRight') return wrapFrame(index + fwd, count)
  if (key === 'Home') return 0
  if (key === 'End') return wrapFrame(count - 1, count)
  return null
}

/** The trailing number in `HDLHCDRSCFIBLK_005_007.jpg`, or null. */
export function frameNumber(name) {
  const m = String(name || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .match(/(\d+)\s*$/)
  return m ? Number(m[1]) : null
}

/**
 * The frames of one set, in the order they were shot.
 *
 * By the trailing NUMBER, not by name: the day somebody exports without zero
 * padding, a string sort puts frame 10 between 1 and 2 and the bike jumps
 * about as it turns. Files with no number at the end keep their relative
 * order, after the numbered ones -- they are almost certainly not frames.
 */
export function orderFrames(files) {
  // `filter` has already produced a new array, so sorting it in place
  // cannot reach the caller's -- a spread here would be a copy of a copy.
  const list = (files || []).filter((f) => f && f.id && f.name)
  return list.sort((a, b) => {
    const na = frameNumber(a.name)
    const nb = frameNumber(b.name)
    if (na !== null && nb !== null) return na - nb
    if (na !== null) return -1
    if (nb !== null) return 1
    return String(a.name).localeCompare(String(b.name))
  })
}

/**
 * Which frame a drag has landed on.
 *
 * `dx` is how far the pointer has moved from where it went down, `width` the
 * viewer's own width. One viewer-width of travel is one full turn, so the
 * gesture means the same thing on a 300px card and a 900px one.
 *
 * Wraps in both directions -- JavaScript's `%` keeps the sign of the left
 * operand, so `-1 % 12` is `-1` and a leftward drag off frame 0 would land
 * on a frame that does not exist.
 */
export function frameFromDrag(startFrame, dx, width, count, reverse = false) {
  // No count guard of its own: `wrapFrame` below answers 0 for an empty
  // set, and `NaN` from the division wraps to 0 through the same path.
  const span = Math.max(1, width || 1)
  const turned = Math.round((dx / span) * count) * (reverse ? -1 : 1)
  return wrapFrame(startFrame + turned, count)
}

/** Always a real index, however far past either end the sum went. */
export function wrapFrame(index, count) {
  if (!count || count < 1) return 0
  return ((Math.round(index) % count) + count) % count
}

/** The next frame for the auto-spin timer. */
export function nextFrame(index, count, reverse = false) {
  return wrapFrame(index + (reverse ? -1 : 1), count)
}

/** How far round the object is, for a progress ring or a label. */
export function angleOf(index, count) {
  if (!count || count < 1) return 0
  return Math.round((wrapFrame(index, count) / count) * 360)
}

/**
 * Sizes an admin typed in, made safe.
 *
 * Clamped rather than rejected: a widget that refuses to render because
 * somebody typed 4000 is worse than one that quietly draws at its largest.
 */
export function clampSize(value, fallback) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n))
}

/** Every measurement the viewer draws with, from what was configured. */
export function sizesOf(widget) {
  const imageWidth = clampSize(widget?.imageWidth, DEFAULT_SPIN.imageWidth)
  const platformWidth = clampSize(widget?.platformWidth, DEFAULT_SPIN.platformWidth)
  // The ellipse's depth is what sells the platform as a disc seen from a
  // low angle rather than a circle drawn flat on the screen. Free of the
  // width, because how far above it you stand is a different question from
  // how big it is.
  const platformDepth = clampSize(widget?.platformDepth, DEFAULT_SPIN.platformDepth)
  return { imageWidth, platformWidth, platformDepth }
}

// ---------------------------------------------------------------------
// Which model is being shown
// ---------------------------------------------------------------------

/**
 * The two columns that name a model.
 *
 * Two, because neither alone is unique: a model code repeats across every
 * colour it is sold in, and a colour code repeats across every model. The
 * pair is the thing a 360° set actually belongs to.
 */
export function keyColumnsOf(widget) {
  return (widget?.keyColumns || []).filter(Boolean).slice(0, 2)
}

/** One row's model key, or '' when the row does not have both parts. */
export function modelKeyOf(row, keyColumns) {
  const cols = (keyColumns || []).filter(Boolean)
  if (cols.length === 0) return ''
  const parts = cols.map((c) => String(row?.[c] ?? '').trim())
  if (parts.some((p) => !p)) return ''
  return parts.join(' · ')
}

/**
 * What one row is called in the picker.
 *
 * A chain, because the key columns are optional and the folder id is not a
 * name -- `1-kcGrtxjjJb59EF…` tells nobody which bike they are looking at.
 * Falls all the way back to a position, which is at least honest.
 */
export function labelForRow(row, keyColumns, labelColumn, position) {
  const key = modelKeyOf(row, keyColumns)
  if (key) return key

  // One key column filled in is still a name, even though it is not enough
  // to be an identity -- see `modelKeyOf`.
  for (const column of [labelColumn, ...(keyColumns || [])]) {
    const value = String(row?.[column] ?? '').trim()
    if (value) return value
  }
  return `Set ${position + 1}`
}

/**
 * Every 360° set in these rows, in the order the sheet put them.
 *
 * ONE ENTRY PER FOLDER, walking the rows. Not per model key: the key
 * columns are optional, and a table whose rows each carry a folder is the
 * ordinary case -- requiring both keys before anything appeared meant a
 * perfectly good table showed nothing at all.
 *
 * Deduplicated by FOLDER, because the same folder on two rows is the same
 * twelve photographs, and walking onto it twice is a Next button that
 * appears not to have worked.
 *
 * First-appearance rather than sorted: the sheet's own order is somebody's
 * decision -- newest first, or by price -- and re-sorting alphabetically
 * throws that away for no gain.
 */
export function modelsIn(rows, keyColumns, folderColumn, labelColumn) {
  const seen = new Map()
  for (const row of rows || []) {
    const folderId = folderIdOf(row?.[folderColumn])
    if (!folderId || seen.has(folderId)) continue
    seen.set(folderId, {
      key: labelForRow(row, keyColumns, labelColumn, seen.size),
      row,
      folderId,
    })
  }
  return [...seen.values()]
}

/**
 * The set `step` places along from `index`, wrapping.
 *
 * Wraps for the same reason the frames do: somebody at the last vehicle
 * pressing Next expects the first one, not a dead button. With one set
 * there is nowhere to go and it stays put.
 */
export function stepModel(index, step, total) {
  if (!total || total < 1) return 0
  return ((((index + step) % total) + total) % total)
}

/**
 * The folder to show frames from.
 *
 * A column on the row wins over a folder typed into the widget: one widget
 * then serves every model in the table, and adding next year's bike is a
 * row in a spreadsheet rather than a dashboard edit. The typed one is the
 * fallback for a widget showing one vehicle and nothing else.
 */
export function folderFor(widget, model) {
  // Both go through the parser, because both are pasted by hand: a column
  // in the sheet holds whatever somebody copied out of Drive just as often
  // as the widget's own field does.
  const fromRow = folderIdOf(model?.folderId)
  if (fromRow) return fromRow
  return folderIdOf(widget?.folderId)
}

/**
 * The 360° viewer on this page that is driving the others, if any.
 *
 * One, deliberately: two viewers each narrowing the page to a different
 * vehicle is a page showing nothing, and the second one to be switched on
 * would silently win. The first is the one that counts, and the editor says
 * so where the second one is configured.
 */
export function driverIn(widgets) {
  return (
    (widgets || []).find(
      (w) => w?.type === 'spin360' && w?.driveFilter && keyColumnsOf(w).length > 0
    ) || null
  )
}

/**
 * Which of a widget's OWN columns hold the driver's key values.
 *
 * Positional, against the driver's key columns: the first entry is where
 * this tab keeps the model, the second where it keeps the colour. A tab
 * calls them whatever it calls them -- "Model Name" here, "Variant" there --
 * and that is exactly why this cannot be inferred.
 */
export function matchColumnsOf(widget, driver) {
  const wanted = keyColumnsOf(driver).length
  const given = Array.isArray(widget?.matchColumns) ? widget.matchColumns : []
  return Array.from({ length: wanted }, (_, i) => given[i] || '')
}

/** Is this widget set up to follow the viewer? */
export function followsDriver(widget, driver) {
  return matchColumnsOf(widget, driver).some(Boolean)
}

/**
 * Every tab the filter can speak to, from the widgets on the page.
 *
 * Collected per TAB rather than per widget, because rows are filtered once
 * per tab and shared by everything reading it -- two widgets on one tab
 * declaring different match columns would be one question with two answers,
 * so the first to declare wins and the editor says which.
 */
export function matchTargets(widgets, driver) {
  const out = new Map()
  for (const widget of widgets || []) {
    if (!widget?.tab || widget === driver) continue
    const columns = matchColumnsOf(widget, driver)
    if (!columns.some(Boolean) || out.has(widget.tab)) continue
    out.set(widget.tab, { tab: widget.tab, matchColumns: columns })
  }
  return [...out.values()]
}

/**
 * The filter one row puts on the rest of the page.
 *
 * A `conditions` cross-filter, which is the shape the page already speaks.
 * Both key columns are sent, matched with `all`, because that pair is what
 * identifies the vehicle: filtering on the model alone would leave every
 * colour of it in the numbers.
 *
 * `targets` is how it reaches a widget on ANOTHER tab. A conditions filter
 * only touches tabs it names -- that is the engine's own rule, and it is
 * what stops one drill emptying every unrelated tab on the page -- so a
 * widget elsewhere is reached by NAMING ITS TAB and its own column. Each
 * one says which of its columns holds the model and which the colour; the
 * values are the driver's.
 *
 * Null when there is nothing to say -- no keys configured, or a row that
 * does not fill them in. A filter with no conditions matches everything,
 * which looks exactly like a filter that is not working.
 */
export function filterFor(widget, model, tab, targets = []) {
  if (!widget?.driveFilter) return null

  const columns = keyColumnsOf(widget)
  const values = columns.map((column) => String(model?.row?.[column] ?? '').trim())

  const own = columns
    .map((column, i) => ({ tab, column, operator: 'equals', value: values[i] }))
    .filter((c) => c.column && c.value)

  // The same values, said again in each other tab's own vocabulary.
  const elsewhere = []
  for (const target of targets || []) {
    if (!target?.tab || target.tab === tab) continue
    for (const [i, column] of (target.matchColumns || []).entries()) {
      if (!column || !values[i]) continue
      elsewhere.push({ tab: target.tab, column, operator: 'equals', value: values[i] })
    }
  }

  const conditions = [...own, ...elsewhere]
  if (conditions.length === 0) return null

  return {
    // One id per widget, so walking to the next row REPLACES this filter
    // rather than stacking a second contradictory one on the page.
    id: `spin360:${widget.id}`,
    kind: 'conditions',
    // NOT a drill. A drill is something a reader did by clicking and can
    // undo by clicking again; this is what the page IS -- it follows the
    // vehicle on screen, and there is no state where the viewer shows one
    // bike and the numbers beside it belong to another.
    //
    // So it is hidden from the chip bar and survives Reset. Hidden and
    // permanent have to travel together: a filter somebody can see but
    // cannot remove is a button that does not work.
    pinned: true,
    match: 'all',
    // What the page shows in its filter bar, and what tells the two apart
    // when the same widget moves from one vehicle to the next. The DRIVER's
    // values only -- the same vehicle said four times in four vocabularies
    // is one vehicle, and a label listing it four times says nothing.
    value: values.filter(Boolean).join(' · '),
    conditions,
    icon: '🏍️',
    label: values.filter(Boolean).join(' · '),
  }
}

/**
 * Why this viewer cannot draw yet, or '' when it can.
 *
 * Said in the widget rather than left blank: an empty black box is
 * indistinguishable from a broken one, and the admin who set it up is not
 * the person looking at it.
 */
export function spinProblem(widget, { models = [], frames = null, loading = false } = {}) {
  if (!widget?.folderColumn && !widget?.folderId) {
    return 'Pick the column holding each row’s Drive folder link'
  }
  // A folder column that yields nothing is the common setup mistake, and it
  // is not the same mistake as an empty folder -- one is the wrong column,
  // the other is the wrong folder.
  if (widget?.folderColumn && models.length === 0 && !widget?.folderId) {
    return 'No rows have a Drive folder link in that column'
  }
  if (!folderFor(widget, models[0])) return 'No Drive folder for this row'
  if (loading) return ''
  if (frames && frames.length === 0) return 'That folder has no images in it'
  return ''
}
