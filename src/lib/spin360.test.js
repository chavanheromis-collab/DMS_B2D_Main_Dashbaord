import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { appliedFilters } from './printView.js'
import {
  DEFAULT_SPIN,
  MAX_SIZE,
  MAX_ZOOM,
  MIN_SIZE,
  MIN_ZOOM,
  clampPan,
  clampZoom,
  folderIdOf,
  frameFromKey,
  glideStep,
  loadPercent,
  panLimit,
  angleOf,
  clampSize,
  driverIn,
  filterFor,
  folderFor,
  frameFromDrag,
  frameNumber,
  keyColumnsOf,
  labelForRow,
  matchColumnsOf,
  matchTargets,
  modelKeyOf,
  modelsIn,
  nextFrame,
  orderFrames,
  sizesOf,
  spinProblem,
  stepModel,
  wrapFrame,
} from './spin360.js'

const file = (name, id = name) => ({ id, name })

// ---------------------------------------------------------------------
// Ordering the frames
// ---------------------------------------------------------------------

test('frames go in the order they were shot', () => {
  const files = [file('HDLHCDRSCFIBLK_005_003.jpg'), file('HDLHCDRSCFIBLK_005_001.jpg'), file('HDLHCDRSCFIBLK_005_002.jpg')]
  assert.deepEqual(orderFrames(files).map((f) => f.name.slice(-7)), ['001.jpg', '002.jpg', '003.jpg'])
})

test('by the NUMBER, not by the name', () => {
  // The day somebody exports without zero padding, a string sort puts
  // frame 10 between 1 and 2 and the bike jumps about as it turns.
  const files = [file('bike_10.jpg'), file('bike_2.jpg'), file('bike_1.jpg')]
  assert.deepEqual(orderFrames(files).map((f) => f.name), ['bike_1.jpg', 'bike_2.jpg', 'bike_10.jpg'])
})

test('the number is the one at the END', () => {
  // `HDLHCDRSCFIBLK_005_007` has two numbers in it and only the last is
  // the frame.
  assert.equal(frameNumber('HDLHCDRSCFIBLK_005_007.jpg'), 7)
  assert.equal(frameNumber('HDLHCDRSCFIBLK_005_012'), 12)
  assert.equal(frameNumber('no-number-here.jpg'), null)
  assert.equal(frameNumber(undefined), null)
})

test('anything with no frame number goes last, not first', () => {
  // A cover photo dropped in the same folder must not become frame 1.
  const files = [file('cover.jpg'), file('bike_002.jpg'), file('bike_001.jpg')]
  assert.deepEqual(orderFrames(files).map((f) => f.name), ['bike_001.jpg', 'bike_002.jpg', 'cover.jpg'])
})

test('a file with no id or no name is not a frame', () => {
  assert.deepEqual(orderFrames([{ name: 'x_1.jpg' }, { id: 'a' }, null]), [])
  assert.deepEqual(orderFrames(null), [])
})

test('ordering does not disturb what it was given', () => {
  const files = [file('b_2.jpg'), file('a_1.jpg')]
  const before = [...files]
  orderFrames(files)
  assert.deepEqual(files, before)
})

// ---------------------------------------------------------------------
// Turning it
// ---------------------------------------------------------------------

test('dragging the width of the viewer is one full turn', () => {
  // Twelve frames and forty feel the same to the hand; one is just
  // smoother.
  assert.equal(frameFromDrag(0, 600, 600, 12), 0, 'all the way round is back where it started')
  assert.equal(frameFromDrag(0, 300, 600, 12), 6, 'half way is half way')
  assert.equal(frameFromDrag(0, 300, 600, 40), 20)
})

test('it wraps, in both directions', () => {
  // A viewer that stops at the ends is a slider, and somebody will drag
  // past the end within three seconds. `%` keeps the sign of its left
  // operand, so a leftward drag off frame 0 lands on -1 without this.
  assert.equal(frameFromDrag(0, -50, 600, 12), 11)
  assert.equal(frameFromDrag(11, 50, 600, 12), 0)
  assert.equal(wrapFrame(-1, 12), 11)
  assert.equal(wrapFrame(12, 12), 0)
  assert.equal(wrapFrame(-25, 12), 11)
})

test('dragging right turns it one way, and reverse turns it the other', () => {
  assert.equal(frameFromDrag(0, 100, 1200, 12), 1)
  assert.equal(frameFromDrag(0, 100, 1200, 12, true), 11)
})

test('a set with nothing in it cannot be turned', () => {
  assert.equal(frameFromDrag(0, 300, 600, 0), 0)
  assert.equal(wrapFrame(3, 0), 0)
  assert.equal(nextFrame(0, 0), 0)
})

test('a zero width does not divide by zero', () => {
  // It is asked before layout has happened at least once.
  assert.equal(Number.isFinite(frameFromDrag(0, 100, 0, 12)), true)
})

test('the next frame goes round the end', () => {
  assert.equal(nextFrame(11, 12), 0)
  assert.equal(nextFrame(0, 12, true), 11)
})

test('how far round it is, in degrees', () => {
  assert.equal(angleOf(0, 12), 0)
  assert.equal(angleOf(3, 12), 90)
  assert.equal(angleOf(6, 12), 180)
  assert.equal(angleOf(12, 12), 0, 'and round again')
  assert.equal(angleOf(0, 0), 0)
})

// ---------------------------------------------------------------------
// How big
// ---------------------------------------------------------------------

test('a size somebody typed is clamped, not refused', () => {
  // A widget that refuses to render because somebody typed 4000 is worse
  // than one that quietly draws at its largest.
  assert.equal(clampSize(4000, 500), MAX_SIZE)
  assert.equal(clampSize(2, 500), MIN_SIZE)
  assert.equal(clampSize(520, 500), 520)
})

test('and nonsense falls back to the default', () => {
  assert.equal(clampSize('', 500), 500)
  assert.equal(clampSize(null, 500), 500)
  assert.equal(clampSize('abc', 500), 500)
  assert.equal(clampSize(-40, 500), 500)
  assert.equal(clampSize(0, 500), 500)
})

test('every measurement has a default, so a fresh widget draws', () => {
  const s = sizesOf({})
  assert.equal(s.imageWidth, DEFAULT_SPIN.imageWidth)
  assert.equal(s.platformWidth, DEFAULT_SPIN.platformWidth)
  assert.equal(s.platformDepth, DEFAULT_SPIN.platformDepth)
})

test('the platform depth is free of its width', () => {
  // How far above the disc you stand is a different question from how big
  // it is, and tying them makes one of the two unusable.
  const s = sizesOf({ platformWidth: 800, platformDepth: 130 })
  assert.equal(s.platformWidth, 800)
  assert.equal(s.platformDepth, 130)
})

// ---------------------------------------------------------------------
// Which vehicle
// ---------------------------------------------------------------------

const FOLDER_A = '1-kcGrtxjjJb59EFjtnNJ-GC-thSY6gyr'
const FOLDER_B = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const FOLDER_C = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654'

const ROWS = [
  { Model: 'HF Deluxe', Colour: 'Black', Folder: FOLDER_A },
  { Model: 'HF Deluxe', Colour: 'Red', Folder: FOLDER_B },
  { Model: 'HF Deluxe', Colour: 'Black', Folder: FOLDER_A },
  { Model: 'Splendor', Colour: '', Folder: FOLDER_C },
]

test('it takes two columns to name a vehicle', () => {
  // A model code repeats across every colour it is sold in, and a colour
  // code repeats across every model.
  assert.equal(modelKeyOf(ROWS[0], ['Model', 'Colour']), 'HF Deluxe · Black')
  assert.notEqual(
    modelKeyOf(ROWS[0], ['Model', 'Colour']),
    modelKeyOf(ROWS[1], ['Model', 'Colour'])
  )
})

test('a row missing either half names nothing', () => {
  // Half a key would collapse every colour of a model onto one 360° set.
  assert.equal(modelKeyOf(ROWS[3], ['Model', 'Colour']), '')
  assert.equal(modelKeyOf({}, ['Model', 'Colour']), '')
  assert.equal(modelKeyOf(ROWS[0], []), '')
})

test('only ever two columns are used', () => {
  assert.deepEqual(keyColumnsOf({ keyColumns: ['A', 'B', 'C'] }), ['A', 'B'])
  assert.deepEqual(keyColumnsOf({ keyColumns: ['A', '', 'C'] }), ['A', 'C'])
  assert.deepEqual(keyColumnsOf({}), [])
})

test('one entry per FOLDER, walking the rows', () => {
  // Not per model key: the key columns are optional, and a table whose rows
  // each carry a folder is the ordinary case.
  const models = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')
  assert.deepEqual(models.map((m) => m.key), ['HF Deluxe · Black', 'HF Deluxe · Red', 'Splendor'])
})

test('the same folder on two rows is one set, and the FIRST row names it', () => {
  // The same twelve photographs. Walking onto it twice is a Next button
  // that appears not to have worked.
  //
  // The first row, because a Map dedupes whichever way round the check
  // goes -- what changes is which row's name is kept, and taking the last
  // silently is how a mislabelled set stays mislabelled.
  const rows = [
    { M: 'A', C: 'X', F: FOLDER_A },
    { M: 'B', C: 'Y', F: FOLDER_A },
  ]
  const models = modelsIn(rows, ['M', 'C'], 'F')
  assert.equal(models.length, 1)
  assert.equal(models[0].key, 'A · X')
})

test('a row with no folder is not a set', () => {
  const rows = [{ M: 'A', C: 'X', F: '' }, { M: 'B', C: 'Y', F: FOLDER_A }]
  assert.deepEqual(modelsIn(rows, ['M', 'C'], 'F').map((m) => m.key), ['B · Y'])
})

test('a table with only a folder column still walks', () => {
  // Requiring both keys before anything appeared meant a perfectly good
  // table showed nothing at all.
  const rows = [{ F: FOLDER_A }, { F: FOLDER_B }]
  const models = modelsIn(rows, [], 'F')
  assert.equal(models.length, 2)
  assert.deepEqual(models.map((m) => m.key), ['Set 1', 'Set 2'])
})

test('and it is the FIRST row that wins', () => {
  // A Map dedupes whichever way round the check goes; what changes is
  // which row's folder is kept. Two rows for one vehicle disagreeing is a
  // data problem, and taking the last one silently is how it stays hidden.
  const rows = [
    { M: 'A', C: 'X', F: FOLDER_A },
    { M: 'A', C: 'X', F: FOLDER_B },
  ]
  assert.equal(modelsIn(rows, ['M', 'C'], 'F')[0].folderId, FOLDER_A)
})

test('in the order the sheet put them, not alphabetical', () => {
  // The sheet's own order is somebody's decision -- newest first, or by
  // price -- and re-sorting throws that away for no gain.
  const rows = [{ M: 'Zeta', C: 'X', F: FOLDER_A }, { M: 'Alpha', C: 'X', F: FOLDER_B }]
  assert.deepEqual(modelsIn(rows, ['M', 'C'], 'F').map((m) => m.key), ['Zeta · X', 'Alpha · X'])
})

// ---------------------------------------------------------------------
// What each row is called
// ---------------------------------------------------------------------

test('both key columns name a row when it has both', () => {
  assert.equal(labelForRow({ M: 'HF', C: 'Black' }, ['M', 'C'], '', 0), 'HF · Black')
})

test('one of them names it when the other is blank', () => {
  // Not enough to be an identity, but perfectly good as a name.
  assert.equal(labelForRow({ M: 'HF', C: '' }, ['M', 'C'], '', 0), 'HF')
})

test('a name column is used when there are no keys', () => {
  assert.equal(labelForRow({ Name: 'HF Deluxe' }, [], 'Name', 0), 'HF Deluxe')
})

test('and a position when there is nothing to go on', () => {
  // A folder id is not a name: `1-kcGrtxjjJb59EF…` tells nobody which bike
  // they are looking at.
  assert.equal(labelForRow({ F: FOLDER_A }, [], '', 0), 'Set 1')
  assert.equal(labelForRow({}, ['M'], 'Name', 4), 'Set 5')
})

// ---------------------------------------------------------------------
// Next, and previous
// ---------------------------------------------------------------------

test('next goes to the next row, and wraps at the end', () => {
  // Somebody at the last vehicle pressing Next expects the first one, not
  // a dead button.
  assert.equal(stepModel(0, 1, 3), 1)
  assert.equal(stepModel(2, 1, 3), 0)
})

test('previous wraps the other way', () => {
  assert.equal(stepModel(0, -1, 3), 2)
  assert.equal(stepModel(1, -1, 3), 0)
})

test('with one set there is nowhere to go', () => {
  assert.equal(stepModel(0, 1, 1), 0)
  assert.equal(stepModel(0, -1, 1), 0)
})

test('and with none it does not divide by zero', () => {
  assert.equal(stepModel(0, 1, 0), 0)
  assert.equal(stepModel(3, -1, undefined), 0)
})

test('each carries the folder its own row named', () => {
  const models = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')
  assert.equal(models[0].folderId, FOLDER_A)
  assert.equal(models[1].folderId, FOLDER_B)
})

test('a folder on the row beats one typed into the widget', () => {
  // One widget then serves every model in the table, and next year's bike
  // is a row somebody adds rather than a dashboard somebody edits.
  const widget = { folderId: FOLDER_C }
  assert.equal(folderFor(widget, { folderId: FOLDER_A }), FOLDER_A)
  assert.equal(folderFor(widget, { folderId: '' }), FOLDER_C)
  assert.equal(folderFor(widget, undefined), FOLDER_C)
  assert.equal(folderFor({}, undefined), '')
})

// ---------------------------------------------------------------------
// Saying what is wrong
// ---------------------------------------------------------------------

test('one key column alone is no longer a fault', () => {
  // The keys only decide what a row is CALLED now. A viewer with one of
  // them and a folder column works perfectly well.
  const w = { keyColumns: ['Model'], folderColumn: 'Folder' }
  const models = modelsIn(ROWS, ['Model'], 'Folder')
  assert.equal(spinProblem(w, { models, frames: [{ id: 'a' }] }), '')
})

test('nowhere to get the frames is called out', () => {
  assert.ok(spinProblem({ keyColumns: ['Model', 'Colour'] }).toLowerCase().includes('folder'))
})

test('a folder column that yields nothing is its own mistake', () => {
  // The wrong column and the wrong folder are two different problems, and
  // one message for both sends somebody looking in the wrong place.
  const w = { folderColumn: 'Nope' }
  assert.ok(spinProblem(w, { models: [] }).includes('No rows have a Drive folder'))
})

test('a folder with no images in it says so', () => {
  // An empty black box is indistinguishable from a broken one, and the
  // admin who set it up is not the person looking at it.
  const w = { folderId: FOLDER_A }
  assert.ok(spinProblem(w, { frames: [] }).includes('no images'))
  assert.equal(spinProblem(w, { frames: [{ id: 'a' }] }), '')
})

test('nothing is wrong while it is still loading', () => {
  // "That folder has no images in it" flashing before the listing returns
  // is a lie the viewer tells for half a second.
  assert.equal(spinProblem({ folderId: FOLDER_A }, { frames: [], loading: true }), '')
})

test('a properly set up walk has nothing to say', () => {
  const w = { keyColumns: ['Model', 'Colour'], folderColumn: 'Folder' }
  const models = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')
  assert.equal(spinProblem(w, { models, frames: [{ id: 'a' }] }), '')
})

test('a properly set up viewer has nothing to say', () => {
  const w = { keyColumns: ['Model', 'Colour'], folderColumn: 'Folder' }
  const models = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')
  assert.equal(spinProblem(w, { models, frames: [{ id: 'a' }] }), '')
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const widget = read('src/components/widgets/Spin360Widget.jsx')
const hook = read('src/hooks/useSpinFrames.js')
const api = read('api/_lib/googleDrive.js')
const route = read('api/drive.js')
const local = read('server/local-api.js')

test('the frame count is read, never assumed', () => {
  // Twelve is what this set happens to have; eight, sixteen and thirty-six
  // are all normal.
  assert.ok(widget.includes('const count = frames.length'))
  assert.ok(!/\b12\b/.test(widget.replace(/size=\{\d+\}/g, ' ')), 'no hard-coded frame count')
})

test('every frame is rendered once and all but one hidden', () => {
  // Swapping one `src` re-requests on every frame, and the bike flickers
  // as it turns.
  assert.ok(widget.includes("display: i === frame ? 'block' : 'none',"))
})

test('the drag is followed outside the widget, and let go anywhere', () => {
  // A pointer that leaves the card mid-drag must keep turning the bike,
  // and must still stop when it is released somewhere else entirely.
  assert.ok(widget.includes("window.addEventListener('pointermove', move)"))
  assert.ok(widget.includes("window.addEventListener('pointerup', up)"))
  assert.ok(widget.includes("window.removeEventListener('pointermove', move)"))
  assert.ok(widget.includes("window.removeEventListener('pointerup', up)"))
})

test('a touch turns the bike without scrolling the page', () => {
  assert.ok(widget.includes("touchAction: count > 1 ? 'pan-y' : 'auto'"))
})

test('auto-spin stops while somebody is holding it', () => {
  // A bike that keeps turning under the finger cannot be pointed at
  // anything.
  assert.ok(widget.includes('if (!widget.autoSpin || dragging || count < 2) return undefined'))
  // Within the auto-spin effect: the glide has its own `clearInterval`, so
  // a bare search for one is satisfied with this cleanup deleted -- and an
  // uncleared interval keeps calling setState on an unmounted widget.
  // Ended at its OWN dependency array: the glide effect sits between this
  // one and `const problem`, and slicing to that swept its cleanup in.
  const auto = widget.slice(
    widget.indexOf('if (!widget.autoSpin'),
    widget.indexOf('}, [widget.autoSpin,')
  )
  assert.ok(auto.includes('return () => clearInterval(timer)'))
})

test('a new set starts at its first frame', () => {
  // Moving from a twelve-frame vehicle to an eight-frame one otherwise
  // leaves the index past the end and the viewer blank.
  // And everything else the old set left behind: a zoom held over from
  // one vehicle is the next one arriving already magnified.
  const reset = widget.slice(widget.indexOf('useEffect(() => { setFrame(0)'))
  assert.ok(reset.slice(0, 200).includes('}, [folderId, count])'))
  for (const line of ['setLoaded(0)', 'setZoom(1)', "setPan({ x: 0, y: 0 })"]) {
    assert.ok(reset.slice(0, 200).includes(line), line)
  }
})

test('a filter that empties the table cannot leave it pointing at nothing', () => {
  assert.ok(widget.includes('models[Math.min(pick, Math.max(0, models.length - 1))]'))
})

test('the frames are asked for once per folder, not once per render', () => {
  assert.ok(hook.includes('const cache = new Map()'))
  assert.ok(hook.includes('if (cache.has(key))'))
})

test('and fetched at twice the size they are drawn', () => {
  // A photograph shown at 520px and fetched at 520px is visibly soft.
  assert.ok(hook.includes('driveImageUrl(f.id, width * 2)'))
})

test('the listing is ordered by the model, not by whatever Drive returned', () => {
  assert.ok(hook.includes('orderFrames(body.files)'))
})

test('the folder is listed on the server, because it has to be', () => {
  // A folder id plus a file NAME is not a URL and cannot be made into one.
  assert.ok(api.includes("mimeType contains 'image/'"))
  assert.ok(api.includes('trashed = false'))
  assert.ok(api.includes('fields'))
})

test('a Shared Drive folder is visible to the listing', () => {
  // "The folder is shared but comes back empty" is a support call nobody
  // can diagnose.
  assert.ok(api.includes("supportsAllDrives: 'true'"))
  assert.ok(api.includes("includeItemsFromAllDrives: 'true'"))
})

test('a set longer than one page is not silently cut short', () => {
  // The names survive the loop being wired to stop after one page, so
  // assert the ASSIGNMENT and the condition that uses it.
  assert.ok(api.includes("pageToken = data.nextPageToken || ''"))
  assert.ok(api.includes('} while (pageToken &&'))
  assert.ok(api.includes("if (pageToken) params.set('pageToken', pageToken)"))
})

test('Drive gets its own scope, not the spreadsheets’ one widened', () => {
  // A Drive misconfiguration must never be able to stop a spreadsheet
  // loading.
  assert.ok(api.includes("scopes: ['https://www.googleapis.com/auth/drive.readonly']"))
  const sheets = read('api/_lib/googleSheets.js')
  assert.ok(!sheets.includes('drive.readonly'))
})

test('a folder nobody shared says exactly what to do about it', () => {
  assert.ok(api.includes('not shared with'))
  assert.ok(api.includes('press Share'))
})

test('the route is signed in, and read-only', () => {
  assert.ok(route.includes('await requireUser(req)'))
  assert.ok(route.includes("if (req.method !== 'GET')"))
})

test('and the same route exists when running locally', () => {
  // A viewer that works deployed and not on a developer's machine is one
  // nobody can fix.
  assert.ok(local.includes("app.all('/api/drive'"))
})

// ---------------------------------------------------------------------
// The link people actually have
// ---------------------------------------------------------------------

test('the folder link straight out of Drive works', () => {
  // Which is the link everybody has to hand. Nothing parsed it before --
  // pasting it produced no folder at all, and the viewer said there was
  // none.
  const id = '1-kcGrtxjjJb59EFjtnNJ-GC-thSY6gyr'
  for (const pasted of [
    `https://drive.google.com/drive/folders/${id}`,
    `https://drive.google.com/drive/folders/${id}?usp=sharing`,
    `https://drive.google.com/drive/folders/${id}?usp=drive_link`,
    `https://drive.google.com/drive/u/0/folders/${id}`,
    `https://drive.google.com/open?id=${id}`,
    id,
  ]) {
    assert.equal(folderIdOf(pasted), id, pasted)
  }
})

test('and a folder pasted into the SHEET works the same way', () => {
  // A column in the spreadsheet is filled in by hand just as often as the
  // widget's own field.
  const id = '1-kcGrtxjjJb59EFjtnNJ-GC-thSY6gyr'
  assert.equal(folderFor({}, { folderId: `https://drive.google.com/drive/folders/${id}` }), id)
  assert.equal(folderFor({ folderId: `https://drive.google.com/drive/folders/${id}` }, null), id)
})

test('something that is not a folder link is not a folder', () => {
  assert.equal(folderIdOf('nonsense'), '')
  assert.equal(folderIdOf(''), '')
  assert.equal(folderIdOf(undefined), '')
  assert.equal(folderIdOf('https://example.com/photos'), '')
})

// ---------------------------------------------------------------------
// A flick, and where it stops
// ---------------------------------------------------------------------

test('a flick keeps turning and slows down', () => {
  // Without it the vehicle stops dead the instant the finger lifts, which
  // no real object does.
  const a = glideStep(0, 4, 12)
  assert.equal(a.index, 4)
  assert.ok(a.velocity < 4 && a.velocity > 0, 'slower, but still going')
})

test('and it stops rather than creeping for ever', () => {
  // Below the threshold it is over at once...
  assert.equal(glideStep(0, 0.2, 12).velocity, 0)
  assert.equal(glideStep(0, -0.2, 12).velocity, 0, 'in both directions')

  // ...and from any speed it CONVERGES, which is the property that
  // matters: a glide that never quite reaches zero is a vehicle that never
  // stops turning and a timer that never stops firing.
  for (const start of [40, 8, 1, -40, -8, -1]) {
    let v = start
    let ticks = 0
    while (v !== 0 && ticks < 500) {
      v = glideStep(0, v, 12).velocity
      ticks += 1
    }
    assert.equal(v, 0, `from ${start} it never stopped`)
    assert.ok(ticks < 200, `from ${start} it took ${ticks} ticks`)
  }
})

test('a glide wraps like any other turn', () => {
  assert.equal(glideStep(11, 3, 12).index, 2)
  assert.equal(glideStep(1, -3, 12).index, 10)
})

test('a heavier friction coasts further', () => {
  assert.ok(glideStep(0, 4, 12, 0.99).velocity > glideStep(0, 4, 12, 0.8).velocity)
})

// ---------------------------------------------------------------------
// Looking closer
// ---------------------------------------------------------------------

test('zoom stays between no zoom and unreadably close', () => {
  assert.equal(clampZoom(0.2), MIN_ZOOM)
  assert.equal(clampZoom(99), MAX_ZOOM)
  assert.equal(clampZoom(2), 2)
  assert.equal(clampZoom('x'), MIN_ZOOM)
})

test('at 1x there is nowhere to pan', () => {
  assert.equal(panLimit(500, 1), 0)
  assert.equal(clampPan(200, 500, 1), 0)
})

test('and every zoom past that reaches the edge and no further', () => {
  assert.equal(panLimit(500, 2), 250)
  assert.equal(clampPan(400, 500, 2), 250)
  assert.equal(clampPan(-400, 500, 2), -250)
  assert.equal(clampPan(100, 500, 2), 100)
})

test('a pan of nothing is nothing', () => {
  assert.equal(clampPan(undefined, 500, 2), 0)
  assert.equal(panLimit(undefined, 2), 0)
})

// ---------------------------------------------------------------------
// The wait
// ---------------------------------------------------------------------

test('the preload says how far through it is', () => {
  // Twelve photographs at retina width is a real wait on a phone, and a
  // viewer that sits blank for four seconds is one people press again.
  assert.equal(loadPercent(0, 12), 0)
  assert.equal(loadPercent(6, 12), 50)
  assert.equal(loadPercent(12, 12), 100)
})

test('and never claims more than all of them', () => {
  assert.equal(loadPercent(20, 12), 100)
  assert.equal(loadPercent(1, 0), 0, 'nothing to load is not 100%')
})

// ---------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------

test('arrow keys step one frame', () => {
  assert.equal(frameFromKey('ArrowRight', 0, 12), 1)
  assert.equal(frameFromKey('ArrowLeft', 0, 12), 11, 'and wrap')
  assert.equal(frameFromKey('ArrowRight', 0, 12, true), 11, 'reverse turns them round')
})

test('home and end go to the ends', () => {
  assert.equal(frameFromKey('Home', 5, 12), 0)
  assert.equal(frameFromKey('End', 5, 12), 11)
})

test('any other key is not ours to swallow', () => {
  // Returning a frame for Tab would trap the keyboard inside the widget.
  assert.equal(frameFromKey('Tab', 5, 12), null)
  assert.equal(frameFromKey('a', 5, 12), null)
})

// ---------------------------------------------------------------------
// The image, and everything you can do to it
// ---------------------------------------------------------------------

test('every frame is fetched, not lazily', () => {
  // A lazy frame starts downloading at the moment somebody drags onto it,
  // which is a gap in the turn every single time.
  assert.ok(widget.includes('loading="eager"'))
  assert.ok(!widget.includes("loading={i === 0 ? 'eager' : 'lazy'}"))
})

test('and a frame that will not load does not stall the counter for ever', () => {
  // The viewer would sit at 11/12 and never start.
  assert.ok(widget.includes('onLoad={() => setLoaded((n) => n + 1)}'))
  assert.ok(widget.includes('onError={() => setLoaded((n) => n + 1)}'))
})

test('the wait is shown, with a count', () => {
  assert.ok(widget.includes('{loaded}/{count} frames'))
  assert.ok(widget.includes('const percent = loadPercent(loaded, count)'))
})

test('zoom and pan are one transform, not two', () => {
  // Two would fight over the same property and the last one written wins.
  assert.ok(widget.includes('transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`'))
})

test('zoomed in, the drag moves the photograph rather than the vehicle', () => {
  // Turning the bike while somebody is trying to look at the exhaust is
  // the one thing a zoom must not do.
  assert.ok(widget.includes('if (start.zoomed) {'))
  assert.ok(widget.includes('setPan({'))
})

test('and back at 1x it is centred again, both ways out', () => {
  // A pan left behind means the vehicle is off-centre next time. There are
  // TWO ways back to 1x -- the wheel and the button -- and asserting the
  // line once was satisfied by whichever of them still had it.
  const wheel = widget.slice(widget.indexOf('function onWheel('), widget.indexOf('function onKeyDown('))
  const button = widget.slice(widget.indexOf("label=\"Zoom out\""))
  assert.ok(wheel.includes('if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })'), 'the wheel')
  assert.ok(button.slice(0, 400).includes('if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })'), 'the button')
})

test('the stage and the blend are the answer to a white-background photo', () => {
  assert.ok(widget.includes("widget.stageBg && widget.stageBg !== 'transparent' ? widget.stageBg : undefined"))
  assert.ok(widget.includes("mixBlendMode: widget.blend && widget.blend !== 'none' ? widget.blend : undefined"))
})

test('a flick coasts, and catching it stops it', () => {
  assert.ok(widget.includes('glide.current = start.velocity'))
  assert.ok(widget.includes('glide.current = 0'))
  assert.ok(widget.includes('if (!step.velocity) clearInterval(timer)'), 'and the timer ends itself')
})

test('a click is not a flick', () => {
  // Coasting from a twitch feels like a fault.
  assert.ok(widget.includes('Math.abs(start.velocity || 0) >= 1'))
})

test('it can be driven from the keyboard', () => {
  // A control that only answers to a mouse is one half the people cannot
  // use at all.
  assert.ok(widget.includes('onKeyDown={onKeyDown}'))
  assert.ok(widget.includes('tabIndex={count > 1 ? 0 : -1}'))
  assert.ok(widget.includes('frameFromKey(e.key, frame, count, widget.reverse)'))
})

test('and announces itself as something that turns', () => {
  assert.ok(widget.includes("role={count > 1 ? 'slider' : undefined}"))
  assert.ok(widget.includes('aria-valuenow={wrapFrame(frame, count)}'))
  assert.ok(widget.includes('aria-valuetext={`${angleOf(frame, count)} degrees`}'))
})

test('there is a scrubber, not only two arrows', () => {
  // Somebody who wants the far side does not want to press an arrow six
  // times.
  assert.ok(widget.includes('type="range"'))
  assert.ok(widget.includes('max={count - 1}'))
})

test('the buttons over the stage do not also turn it', () => {
  assert.ok(widget.includes('onPointerDown={(e) => e.stopPropagation()}'))
})

test('a deliberate zero is not turned back into the default', () => {
  // No padding is a perfectly reasonable thing to ask for.
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes("Number.isFinite(n) && v !== '' ? n : DEFAULT_SPIN[field]"))
})

test('every image option is settable', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  for (const field of ['stageBg', 'blend', 'fit', 'glide', 'zoom', 'fullscreen']) {
    assert.ok(panel.includes(`set({ ${field}:`), field)
  }
})

// ---------------------------------------------------------------------
// Walking the rows, in the viewer
// ---------------------------------------------------------------------

test('Next and Previous walk the rows', () => {
  assert.ok(widget.includes('const goto = (step) => setPick((i) => stepModel(i, step, models.length))'))
  assert.ok(widget.includes('onClick={() => goto(1)}'))
  assert.ok(widget.includes('onClick={() => goto(-1)}'))
  assert.ok(widget.includes('aria-label="Next vehicle"'))
})

test('and say where in the table you are', () => {
  assert.ok(widget.includes('{pick + 1} of {models.length}'))
  assert.ok(widget.includes('{model?.key}'))
})

test('up and down walk the vehicles, because left and right turn one', () => {
  // Two lists, two axes.
  assert.ok(widget.includes("e.key === 'ArrowUp' || e.key === 'ArrowDown'"))
  assert.ok(widget.includes("goto(e.key === 'ArrowDown' ? 1 : -1)"))
})

test('the label column reaches the walk', () => {
  assert.ok(widget.includes('modelsIn(rows, keyColumns, widget.folderColumn, widget.labelColumn)'))
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('set({ labelColumn: v })'))
})

// ---------------------------------------------------------------------
// Driving the rest of the page
// ---------------------------------------------------------------------

const DRIVER = {
  id: 'w1',
  type: 'spin360',
  driveFilter: true,
  keyColumns: ['Model', 'Colour'],
  folderColumn: 'Folder',
}

test('the vehicle on screen narrows the rest of the page', () => {
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  const cf = filterFor(DRIVER, model, 'MASTER')
  assert.equal(cf.kind, 'conditions')
  assert.equal(cf.match, 'all')
  assert.deepEqual(
    cf.conditions.map((c) => [c.tab, c.column, c.operator, c.value]),
    [
      ['MASTER', 'Model', 'equals', 'HF Deluxe'],
      ['MASTER', 'Colour', 'equals', 'Black'],
    ]
  )
})

test('on BOTH key columns, not the model alone', () => {
  // On the model alone every colour of it stays in the numbers, which is
  // the wrong answer that looks like a right one.
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  assert.equal(filterFor(DRIVER, model, 'MASTER').conditions.length, 2)
})

test('one id per widget, so walking replaces rather than stacks', () => {
  // Two contradictory filters on one page match nothing at all.
  const [a, b] = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')
  assert.equal(filterFor(DRIVER, a, 'MASTER').id, filterFor(DRIVER, b, 'MASTER').id)
  assert.ok(filterFor(DRIVER, a, 'MASTER').id.includes('w1'))
})

test('and the value tells the two apart', () => {
  // `toggleCrossFilter` compares values; two rows that looked identical to
  // it would toggle each other off.
  const [a, b] = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')
  assert.notEqual(filterFor(DRIVER, a, 'MASTER').value, filterFor(DRIVER, b, 'MASTER').value)
})

test('nothing is driven until it is switched on', () => {
  // A viewer that silently filters every KPI the moment it is dropped on a
  // page is a surprise, and whoever has to work out why the numbers moved
  // is not whoever added it.
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  assert.equal(filterFor({ ...DRIVER, driveFilter: false }, model, 'MASTER'), null)
  assert.equal(filterFor({ ...DRIVER, driveFilter: undefined }, model, 'MASTER'), null)
})

test('a filter with no conditions is never sent', () => {
  // It would match everything, which looks exactly like a filter that is
  // not working.
  assert.equal(filterFor({ ...DRIVER, keyColumns: [] }, { row: ROWS[0] }, 'MASTER'), null)
  assert.equal(filterFor(DRIVER, { row: {} }, 'MASTER'), null)
  assert.equal(filterFor(DRIVER, null, 'MASTER'), null)
})

test('a row that fills only one key drives on that one', () => {
  // Half a key is not an identity, but it is a perfectly good filter -- and
  // narrowing to the model is better than narrowing to nothing.
  const cf = filterFor(DRIVER, { row: { Model: 'HF Deluxe', Colour: '' } }, 'MASTER')
  assert.equal(cf.conditions.length, 1)
  assert.equal(cf.conditions[0].column, 'Model')
})

// ---------------------------------------------------------------------
// Wiring the drive
// ---------------------------------------------------------------------

test('the viewer announces the vehicle it is showing', () => {
  assert.ok(widget.includes('onFilter(filterId, filterFor(widget, model, tab, targets))'))
  assert.ok(widget.includes('const filterId = `spin360:${widget.id}`'))
})

test('and takes it back on the way out', () => {
  // A filter left behind by a widget that is no longer on the page is one
  // nobody can find to switch off.
  assert.ok(widget.includes('return () => onFilter(filterId, null)'))
})

test('it re-announces when the row changes, not on every render', () => {
  assert.ok(widget.includes('filterId, model?.key, widget.driveFilter,'))
  // A widget added to the page, or one just told which columns to match on,
  // has to reach the filter without waiting for somebody to press Next.
  assert.ok(widget.includes('JSON.stringify(targets || []),'))
})

test('the page SETS it rather than toggling it', () => {
  // `toggleCrossFilter` clears when the same id arrives with the same
  // value. A viewer re-announcing the vehicle it is already showing, after
  // a remount, would silently clear the filter it had just applied.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('const setCrossFilter = useCallback((id, cf) => {'))
  assert.ok(dash.includes('return cf ? [...rest, cf] : rest'))
  assert.ok(dash.includes('onFilter={setCrossFilter}'))
})

test('the viewer is handed the tab the page knows it by', () => {
  // A cross-filter's conditions are matched against the label, which is
  // what a widget holds by the time it renders.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('tab={widget.tab}'))
})

test('and there is a switch for it, which says what it does', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('set({ driveFilter: v })'))
  assert.ok(panel.includes('narrows every other widget on this page'))
  assert.ok(panel.includes('Pick at least one key column above'), 'and what it needs to work')
})

// ---------------------------------------------------------------------
// Reaching a widget on another tab
// ---------------------------------------------------------------------

const KPI = { id: 'k1', type: 'kpi', tab: 'SALES', matchColumns: ['Model Name', 'Shade'] }
const CHART = { id: 'c1', type: 'chart', tab: 'STOCK', matchColumns: ['Variant', ''] }
const IGNORING = { id: 'x1', type: 'kpi', tab: 'OTHER' }

test('the driver is the viewer that is switched on', () => {
  assert.equal(driverIn([KPI, DRIVER]).id, 'w1')
  assert.equal(driverIn([KPI]), null)
  // A widget of some other type that happens to carry the same field is
  // not a viewer -- the type is what makes it one.
  assert.equal(
    driverIn([{ id: 'z', type: 'kpi', driveFilter: true, keyColumns: ['Model', 'Colour'] }]),
    null
  )
  assert.equal(driverIn([{ ...DRIVER, driveFilter: false }]), null)
  assert.equal(driverIn([{ ...DRIVER, keyColumns: [] }]), null, 'with nothing to match on it drives nothing')
  assert.equal(driverIn(null), null)
})

test('two viewers driving is one page showing nothing, so the first wins', () => {
  const second = { ...DRIVER, id: 'w2' }
  assert.equal(driverIn([DRIVER, second]).id, 'w1')
})

test('a widget says which of ITS columns hold the key values', () => {
  // A tab calls the model "Model Name" here and "Variant" there, which is
  // exactly why this cannot be inferred.
  assert.deepEqual(matchColumnsOf(KPI, DRIVER), ['Model Name', 'Shade'])
})

test('and is padded to the driver’s key count, not its own', () => {
  // The driver gaining a second key must not leave old widgets matching on
  // a column that is no longer asked for.
  assert.deepEqual(matchColumnsOf(CHART, DRIVER), ['Variant', ''])
  assert.deepEqual(matchColumnsOf(IGNORING, DRIVER), ['', ''])
  assert.deepEqual(matchColumnsOf(KPI, { ...DRIVER, keyColumns: ['Model'] }), ['Model Name'])
})

test('a widget that said nothing is not a target', () => {
  // Leaving them blank means "ignore the viewer", which has to stay the
  // default -- otherwise adding a viewer would empty every card on the page.
  const targets = matchTargets([KPI, IGNORING], DRIVER)
  assert.deepEqual(targets.map((t) => t.tab), ['SALES'])
})

test('the driver is never a target of itself', () => {
  // Given match columns of its own -- otherwise it is skipped for having
  // said nothing, and the check that matters is never reached.
  const selfish = { ...DRIVER, tab: 'MASTER', matchColumns: ['Model', 'Colour'] }
  assert.deepEqual(matchTargets([selfish], selfish), [])
})

test('one answer per tab, because rows are filtered once per tab', () => {
  // Two widgets on one tab declaring different match columns is one
  // question with two answers.
  const second = { id: 'k2', type: 'kpi', tab: 'SALES', matchColumns: ['Other', 'Thing'] }
  const targets = matchTargets([KPI, second], DRIVER)
  assert.equal(targets.length, 1)
  assert.deepEqual(targets[0].matchColumns, ['Model Name', 'Shade'], 'the first to declare')
})

test('the selection reaches the other tab in its own vocabulary', () => {
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  const cf = filterFor(DRIVER, model, 'MASTER', matchTargets([KPI, CHART], DRIVER))
  const byTab = (t) => cf.conditions.filter((c) => c.tab === t).map((c) => [c.column, c.value])

  assert.deepEqual(byTab('MASTER'), [['Model', 'HF Deluxe'], ['Colour', 'Black']])
  assert.deepEqual(byTab('SALES'), [['Model Name', 'HF Deluxe'], ['Shade', 'Black']])
  assert.deepEqual(byTab('STOCK'), [['Variant', 'HF Deluxe']], 'and a half-mapped tab matches on what it has')
})

test('a tab that mapped nothing is left out entirely', () => {
  // A conditions filter says nothing about a tab it does not name, which is
  // what leaves an unrelated card alone rather than emptying it.
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  const cf = filterFor(DRIVER, model, 'MASTER', matchTargets([KPI, IGNORING], DRIVER))
  assert.equal(cf.conditions.some((c) => c.tab === 'OTHER'), false)
})

test('a target naming the driver’s own tab is not said twice', () => {
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  const same = { id: 's1', type: 'kpi', tab: 'MASTER', matchColumns: ['Model', 'Colour'] }
  const cf = filterFor(DRIVER, model, 'MASTER', matchTargets([same], DRIVER))
  assert.equal(cf.conditions.length, 2)
})

test('the label is the vehicle, not the same vehicle said four times', () => {
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  const cf = filterFor(DRIVER, model, 'MASTER', matchTargets([KPI, CHART], DRIVER))
  assert.equal(cf.label, 'HF Deluxe · Black')
  assert.equal(cf.value, 'HF Deluxe · Black')
})

test('targets alone are not a filter', () => {
  // Without the driver's own keys filled in there is nothing to send, and
  // a filter with no conditions matches everything.
  assert.equal(filterFor(DRIVER, { row: {} }, 'MASTER', matchTargets([KPI], DRIVER)), null)
})

// ---------------------------------------------------------------------
// Wiring the match
// ---------------------------------------------------------------------

test('the page collects the targets and hands them over', () => {
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('targets={matchTargets(view.widgets, widget)}'))
  // `view.widgets` and not the raw list: a cross-filter's conditions are
  // matched against the tab LABEL, which is what these carry.
  assert.ok(!dash.includes('matchTargets(allowedWidgets'))
})

test('every widget on the page is offered the match', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('const driver = driverIn(widgets)'))
  assert.ok(panel.includes('<MatchToSpin widget={widget} driver={driver} cols={cols} set={set} />'))
  // ...except the viewer itself, and anything with no tab to match on.
  assert.ok(panel.includes('if (!driver || driver.id === widget.id || !widget.tab) return null'))
})

test('and it offers one dropdown per key the driver matches on', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('{keys.map((key, i) => ('))
  assert.ok(panel.includes('set({ matchColumns: next })'))
  // And the dropdown is actually wired to it: `setAt` survives every
  // `onChange` on the page being replaced with nothing.
  assert.ok(panel.includes('onChange={(v) => setAt(i, v)}'))
  assert.ok(panel.includes("placeholder=\"— ignore —\""), 'and blank means ignore')
})

test('a half-matched widget is told what that costs', () => {
  const panel = read('src/pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('every row sharing that one value'))
})

// ---------------------------------------------------------------------
// Not a drill
// ---------------------------------------------------------------------

test('the viewer’s filter is pinned, not drilled', () => {
  // A drill is something a reader did by clicking and can undo by clicking
  // again. This is what the page IS: there is no state where the viewer
  // shows one bike and the numbers beside it belong to another.
  const model = modelsIn(ROWS, ['Model', 'Colour'], 'Folder')[0]
  assert.equal(filterFor(DRIVER, model, 'MASTER').pinned, true)
})

test('it is not offered as a chip', () => {
  // Hidden and permanent travel together: a filter somebody can see but
  // cannot remove is a button that does not work.
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('crossFilters={crossFilters.filter((c) => !c.pinned)}'))
})

test('and cannot be removed one at a time', () => {
  const dash = read('src/pages/Dashboard.jsx')
  assert.ok(dash.includes('setCrossFilters((c) => c.filter((x) => x.id !== id || x.pinned))'))
})

test('nor cleared with the rest', () => {
  // Three ways to clear, and all three have to spare it: the chip bar's
  // "clear", Reset, and applying a saved view.
  const dash = read('src/pages/Dashboard.jsx')
  const clears = dash.split('setCrossFilters(').slice(1)
  const wipes = clears.filter((c) => c.startsWith('[])'))
  assert.deepEqual(wipes, [], 'nothing may wipe the list outright any more')
  assert.equal(dash.includes('setCrossFilters((c) => c.filter((x) => x.pinned))'), true)
})

test('a printout still says which vehicle it is', () => {
  // Nothing on screen shows it, which makes it the easiest filter of all to
  // forget -- and it changes what every number on the page means.
  const lines = appliedFilters([], {}, [], [
    { id: 'spin360:w1', pinned: true, label: 'HF Deluxe · Black' },
    { id: 'other', label: 'Nashik' },
  ])
  assert.deepEqual(lines, [
    { label: 'Showing', value: 'HF Deluxe · Black', fixed: true },
    { label: 'Drilled into', value: 'Nashik', drilled: true },
  ])
})
