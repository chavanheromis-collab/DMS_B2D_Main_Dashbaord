import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_DETAILS,
  DETAIL_COLUMNS_MAX,
  DETAIL_MAX,
  canShowDetails,
  detailColumns,
  detailPairs,
  detailsFor,
} from './flowDetails.js'
import { DEFAULT_FLOW } from './flow.js'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const ROWS = [
  { _row: 2, VIN: 'V1', Customer: 'Asha', Amount: '70000', Remarks: '' },
  { _row: 3, VIN: 'V2', Customer: 'Ravi', Amount: '72000', Remarks: 'call back' },
  { _row: 4, VIN: 'V3', Customer: '', Amount: '60000', Remarks: '' },
]
const node = (extra = {}) => ({ label: 'SPLENDOR', tab: 'SALES', rows: ROWS, ...extra })
const flow = (extra = {}) => ({ ...DEFAULT_DETAILS, showDetails: true, detailColumns: ['VIN', 'Customer'], ...extra })

// --- when there is a window to open at all -------------------------------

test('nothing appears until an admin turns it on AND says which columns', () => {
  // Either half missing is a button that opens an empty box.
  assert.equal(canShowDetails(flow(), node()), true)
  assert.equal(canShowDetails(flow({ showDetails: false }), node()), false)
  assert.equal(canShowDetails(flow({ detailColumns: [] }), node()), false)
  assert.equal(canShowDetails(flow({ detailColumns: ['', null] }), node()), false)
})

test('a branch carrying no rows of its own has nothing to show', () => {
  assert.equal(canShowDetails(flow(), node({ rows: [] })), false)
  assert.equal(canShowDetails(flow(), node({ rows: undefined })), false)
  assert.equal(canShowDetails(flow(), null), false)
  assert.equal(canShowDetails(null, node()), false)
})

test('it is off on every flow that already exists', () => {
  // A button appearing on every row of every dashboard the day this ships
  // is a change nobody asked for.
  assert.equal(DEFAULT_DETAILS.showDetails, false)
  assert.equal(DEFAULT_FLOW.showDetails, false, 'the flow defaults disagree with the module')
  assert.deepEqual(DEFAULT_FLOW.detailColumns, [])
  assert.equal(canShowDetails(DEFAULT_FLOW, node()), false)
})

// --- which columns -------------------------------------------------------

test('the columns are the admin’s, in the admin’s order', () => {
  // Not the sheet's order: whoever chose the list put the identifying
  // column first, and that is the one the eye lands on.
  assert.deepEqual(detailColumns(flow({ detailColumns: ['Customer', 'VIN'] }), ROWS), ['Customer', 'VIN'])
})

test('a hop to another tab shows what it can rather than a panel of blanks', () => {
  // The columns were chosen on the starting tab. After a hop the flow is
  // reading a different one, where some or none of them exist.
  const service = [{ _row: 2, 'Chassis No': 'V1', Job: 'PDI' }]
  assert.deepEqual(detailColumns(flow({ detailColumns: ['VIN', 'Job'] }), service), ['Job'])
  assert.deepEqual(detailColumns(flow(), service), [])

  const data = detailsFor({ rows: service, tab: 'SERVICE' }, flow())
  assert.equal(data.mismatched, true, 'nothing says the columns do not fit')
  // Which is a different problem from "the admin chose none", and has a
  // different fix, so it is reported separately.
  assert.equal(detailsFor({ rows: service }, flow({ detailColumns: [] })).mismatched, false)
})

test('a window is not a table, so the column list is capped', () => {
  const many = Array.from({ length: 20 }, (_, i) => `C${i}`)
  const row = Object.fromEntries(many.map((c) => [c, 'x']))
  assert.equal(detailColumns(flow({ detailColumns: many }), [row]).length, DETAIL_COLUMNS_MAX)
})

// --- which rows ----------------------------------------------------------

test('a branch holding the whole sheet lists a few and says how many', () => {
  // The cap is not a detail. The top branch of a flow can hold every row in
  // the sheet, and a window listing forty thousand of them locks the tab.
  const big = Array.from({ length: 500 }, (_, i) => ({ _row: i + 2, VIN: `V${i}`, Customer: 'x' }))
  const data = detailsFor({ rows: big }, flow({ detailRows: 5 }))
  assert.equal(data.rows.length, 5)
  assert.equal(data.total, 500)
  assert.equal(data.hidden, 495)
  // In sheet order -- the only order nobody has to have explained.
  assert.equal(data.rows[0].VIN, 'V0')
})

test('the cap is clamped, so a hand-edited widget cannot ask for everything', () => {
  const big = Array.from({ length: 200 }, (_, i) => ({ VIN: `V${i}` }))
  assert.equal(detailsFor({ rows: big }, flow({ detailRows: 9999 })).rows.length, DETAIL_MAX)
  assert.equal(detailsFor({ rows: big }, flow({ detailRows: 0 })).rows.length, 1)
  assert.equal(detailsFor({ rows: big }, flow({ detailRows: 'lots' })).rows.length, DEFAULT_DETAILS.detailRows)
})

test('nothing is hidden when everything fits', () => {
  const data = detailsFor(node(), flow())
  assert.equal(data.hidden, 0)
  assert.equal(data.rows.length, 3)
})

test('an empty branch is an empty window, not a crash', () => {
  const data = detailsFor({ rows: [] }, flow())
  assert.deepEqual(data.rows, [])
  assert.equal(data.total, 0)
  assert.deepEqual(detailsFor(null, null).rows, [])
})

// --- the values ----------------------------------------------------------

test('a blank cell stays blank rather than becoming a dash', () => {
  // A dash reads as "not applicable". An empty cell means nobody has
  // filled it in, which on a follow-up list is the interesting bit.
  const pairs = detailPairs(ROWS[2], ['VIN', 'Customer'])
  assert.deepEqual(pairs, [
    { column: 'VIN', value: 'V3' },
    { column: 'Customer', value: '' },
  ])
  // And a missing key is the same as an empty one, not "undefined".
  assert.deepEqual(detailPairs({}, ['VIN']), [{ column: 'VIN', value: '' }])
  assert.deepEqual(detailPairs(null, null), [])
})

test('every value is text, so a number is not turned into one at the last moment', () => {
  for (const pair of detailPairs({ n: 0, b: false }, ['n', 'b'])) {
    assert.equal(typeof pair.value, 'string')
  }
  assert.equal(detailPairs({ n: 0 }, ['n'])[0].value, '0', 'zero is a value, not an absence')
})

// --- the wiring ----------------------------------------------------------

test('the button is on the row, and only where there is something to show', () => {
  const widget = read('components/widgets/FlowWidget.jsx')
  assert.ok(widget.includes('canShowDetails(flow, node)'), 'the button appears on every row')
  assert.ok(widget.includes('onDetails(node, e.currentTarget.getBoundingClientRect())'), 'nothing is anchored')
  assert.ok(widget.includes('<FlowRowDetails'), 'the window is never rendered')
})

test('the button is on EVERY row, not only the top of the tree', () => {
  // The bug this exists for, and it shipped: the handler was threaded into
  // the root row and not into the recursion, so the eye appeared once per
  // tree -- on "All rows" -- and on none of the breakdown rows underneath,
  // which are the only ones anybody wants it on.
  //
  // The guards that missed it both asked whether the row COULD draw the
  // button. Neither asked whether the row ever gets told to.
  const widget = read('components/widgets/FlowWidget.jsx')
  const at = widget.indexOf('{node.children.map((child) => (')
  assert.ok(at >= 0, 'the recursion has moved')
  const recursion = widget.slice(at, widget.indexOf('))}', at))

  // Every handler a row can use has to reach the rows below it. Listed
  // together because they are the same mistake, and the next one added
  // will be the same mistake again.
  for (const handler of ['onToggle', 'onDrill', 'onFocus', 'onDetails']) {
    assert.match(
      recursion,
      new RegExp(`${handler}=\{${handler}\}`),
      `${handler} stops at the top row, so no branch below it has one`
    )
  }
})

test('a row tool is reachable on a screen with no pointer to hover with', () => {
  // These buttons wait for the pointer, which on a tablet never arrives:
  // tapping the row opens the branch and nothing reveals them, so the
  // feature is invisible AND unreachable on half the devices a dashboard
  // gets read on.
  const widget = read('components/widgets/FlowWidget.jsx')
  assert.ok(!/group-hover:opacity-100/.test(widget), 'a row tool is hover-only again')
  assert.equal((widget.match(/row-tool/g) || []).length, 3, 'the three row tools do not behave alike')

  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/, 'the hover question is not asked')
  const at = css.indexOf('.row-tool {')
  assert.match(css.slice(at, at + 60), /opacity: 1/, 'hidden by default is hidden on a phone for ever')
  assert.match(css, /\.row-tool:focus/, 'a keyboard cannot reach it')
})

test('one window at a time, held by the widget rather than by each row', () => {
  // A window per row is a hundred pieces of state and no way to close them.
  const widget = read('components/widgets/FlowWidget.jsx')
  assert.ok(widget.includes('const [details, setDetails] = useState(null)'))
  assert.equal((widget.match(/setDetails\(/g) || []).length, 2, 'opening and closing, and nothing else')
})

test('the window escapes the zoom and the card, like the magnifier does', () => {
  // Inside the diagram it would be scaled by the zoom -- and the card it
  // sits in has a backdrop filter, which traps a fixed child.
  const popup = read('components/widgets/FlowRowDetails.jsx')
  assert.ok(popup.includes('createPortal('), 'it is drawn inside the widget')
  assert.ok(popup.includes('document.body'))
  // Straight into the placement, with nothing computing coordinates on the
  // way: a hand-rolled position beside the row is the version that hangs
  // off the bottom of the screen on the last row of a long tree.
  assert.match(popup, /setPlace\(\s*peekPlacement\(/, 'it has its own idea of where to sit')
  assert.ok(!/[xy]:\s*anchor\./.test(popup), 'a position is worked out here as well')
})

test('it closes on Escape and on a press anywhere else', () => {
  const popup = read('components/widgets/FlowRowDetails.jsx')
  assert.ok(popup.includes("e.key === 'Escape'"))
  assert.ok(popup.includes("document.addEventListener('pointerdown', onDown, true)"), 'a stray window cannot be shut')
  // Captured, so a click on another row's eye opens that one rather than
  // being swallowed by the close.
  assert.ok(popup.includes("removeEventListener('pointerdown', onDown, true)"), 'the listener outlives the window')
})

test('the admin can choose the columns, and is told when they have not', () => {
  const editor = read('pages/admin/FlowEditor.jsx')
  assert.ok(editor.includes('setFlow({ showDetails: v })'), 'there is no way to turn it on')
  assert.ok(editor.includes('detailColumns:'), 'there is no way to choose columns')
  assert.ok(editor.includes('setFlow({ detailRows:'), 'there is no way to cap the rows')
  assert.match(editor, /No columns chosen, so no button will appear/, 'an empty list fails silently')
})
