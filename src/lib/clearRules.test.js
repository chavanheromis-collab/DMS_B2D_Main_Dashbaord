import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  clearReport,
  clearRulesOf,
  clearedNote,
  columnsToClear,
  hasClearRules,
  newClearRule,
  ruleIsComplete,
  ruleProblem,
  skippedNote,
} from './clearRules.js'

const COLS = ['Status', 'Delivery Date', 'Finance', 'Handover By', 'Remark']

const CANCELLED = {
  id: 'r1',
  column: 'Status',
  operator: 'equals',
  value: 'Cancelled',
  clear: ['Delivery Date', 'Finance', 'Handover By'],
}

const widget = (rules) => ({ type: 'table', tab: 'MASTER', editable: true, clearRules: rules })

const ROW = {
  _row: 12,
  Status: 'In Progress',
  'Delivery Date': '20/03/2026',
  Finance: 'HDFC',
  'Handover By': 'Ravi',
  Remark: 'keep me',
}

// The grant a reader actually has. Never "everything" in these tests,
// because "everything" is the one case that hides a missing check.
const GRANTED = ['Status', 'Delivery Date', 'Finance', 'Handover By']

// ---------------------------------------------------------------------
// The moment it fires
// ---------------------------------------------------------------------

test('a status reaching the configured value empties the fields that no longer apply', () => {
  const got = columnsToClear(widget([CANCELLED]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance', 'Handover By'])
})

test('the rule is judged on the row AFTER the edit, not before it', () => {
  // The whole point: the cell being typed into is the one the rule is
  // about. Reading `row.Status` -- which is still the old value while the
  // write is in flight -- would mean the rule only ever fired one edit
  // late, on whatever was changed next.
  const before = { ...ROW, Status: 'Cancelled' }
  const got = columnsToClear(widget([CANCELLED]), before, {
    column: 'Status',
    value: 'In Progress',
    editable: GRANTED,
  })
  assert.deepEqual(got, [], 'a row that has just STOPPED being cancelled must not be emptied')
})

test('an edit that does not match the rule changes nothing else', () => {
  const got = columnsToClear(widget([CANCELLED]), ROW, {
    column: 'Status',
    value: 'Delivered',
    editable: GRANTED,
  })
  assert.deepEqual(got, [])
})

test('an edit to an unrelated column can still satisfy a rule about a matching row', () => {
  // The row is already cancelled; somebody edits the remark. The fields
  // still do not apply, so they still go.
  const got = columnsToClear(widget([CANCELLED]), { ...ROW, Status: 'Cancelled' }, {
    column: 'Remark',
    value: 'called customer',
    editable: [...GRANTED, 'Remark'],
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance', 'Handover By'])
})

test('no rules means no writes, and no work', () => {
  assert.deepEqual(
    columnsToClear(widget([]), ROW, { column: 'Status', value: 'Cancelled', editable: GRANTED }),
    []
  )
  assert.deepEqual(columnsToClear({ type: 'table' }, ROW, { column: 'Status', value: 'Cancelled' }), [])
  assert.deepEqual(columnsToClear(widget([CANCELLED]), null, { column: 'Status', value: 'Cancelled' }), [])
})

// ---------------------------------------------------------------------
// The four things it refuses to do
// ---------------------------------------------------------------------

test('a column the reader may not edit is skipped, not attempted', () => {
  // The server would refuse the write anyway, and a refusal halfway
  // through a cascade leaves a row nobody can explain.
  const got = columnsToClear(widget([CANCELLED]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: ['Status', 'Finance'],
  })
  assert.deepEqual(got, ['Finance'])
})

test('with no grant at all, nothing is cleared', () => {
  const got = columnsToClear(widget([CANCELLED]), ROW, { column: 'Status', value: 'Cancelled' })
  assert.deepEqual(got, [])
})

// ---------------------------------------------------------------------
// ...and it is never skipped in silence
// ---------------------------------------------------------------------

test('a column the rule could not touch is reported, not swallowed', () => {
  // Three fields go, a fourth stays, and the reader is told the record has
  // been tidied up. The only person who can see that the rule half ran is
  // the one who cannot do anything about it.
  const { clear, skipped } = clearReport(widget([CANCELLED]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: ['Status', 'Finance'],
  })
  assert.deepEqual(clear, ['Finance'])
  assert.deepEqual(skipped, ['Delivery Date', 'Handover By'])
})

test('a rule that ran in full has nothing to report', () => {
  const { clear, skipped } = clearReport(widget([CANCELLED]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(clear, ['Delivery Date', 'Finance', 'Handover By'])
  assert.deepEqual(skipped, [])
})

test('the harmless skips stay quiet', () => {
  // A cell that was already empty had nothing to lose, and the cell just
  // typed into was never a candidate. Reporting either would train people
  // to ignore the line that matters.
  const row = { ...ROW, 'Delivery Date': '', 'Handover By': '' }
  const { skipped } = clearReport(widget([{ ...CANCELLED, clear: ['Delivery Date', 'Handover By', 'Status'] }]), row, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(skipped, [])
})

test('a forbidden column that was empty anyway is not worth mentioning', () => {
  // Both reasons to skip at once. Nothing was lost, so there is nothing to
  // tell anybody -- and a warning about a field that was already blank is
  // how a warning stops being read.
  const row = { ...ROW, 'Delivery Date': '', 'Handover By': '   ' }
  const { clear, skipped } = clearReport(widget([CANCELLED]), row, {
    column: 'Status',
    value: 'Cancelled',
    editable: ['Status'],
  })
  assert.deepEqual(clear, [])
  assert.deepEqual(skipped, ['Finance'], 'only the one that actually still holds something')
})

test('a column is reported once, however many rules wanted it', () => {
  const twice = { ...CANCELLED, id: 'r2', clear: ['Handover By'] }
  const { skipped } = clearReport(widget([CANCELLED, twice]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: ['Status'],
  })
  assert.deepEqual(skipped, ['Delivery Date', 'Finance', 'Handover By'])
})

test('a rule that did not fire reports nothing it would have skipped', () => {
  const { skipped } = clearReport(widget([CANCELLED]), ROW, {
    column: 'Status',
    value: 'Delivered',
    editable: [],
  })
  assert.deepEqual(skipped, [])
})

test('the note names the reason, not just the column', () => {
  // "Delivery Date was not cleared" invites the reader to try again;
  // "you cannot edit it" tells them who to ask.
  assert.equal(skippedNote(['Finance']), 'Finance still applies — you cannot edit it')
  assert.equal(
    skippedNote(['Delivery Date', 'Finance']),
    'Delivery Date and Finance still apply — you cannot edit them'
  )
  assert.equal(skippedNote([]), '')
  assert.equal(skippedNote(null), '')
})

test('the two views cannot drift, because there is one computation', () => {
  const options = { column: 'Status', value: 'Cancelled', editable: ['Status', 'Finance'] }
  assert.deepEqual(
    columnsToClear(widget([CANCELLED]), ROW, options),
    clearReport(widget([CANCELLED]), ROW, options).clear
  )
})

test('a cell that is already empty is left alone', () => {
  const row = { ...ROW, Finance: '', 'Handover By': '   ' }
  const got = columnsToClear(widget([CANCELLED]), row, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Delivery Date'], 'writing an empty string over an empty cell is a round trip for nothing')
})

test('the column that triggered the rule is never cleared by it', () => {
  const suicidal = { ...CANCELLED, clear: ['Status', 'Finance'] }
  const got = columnsToClear(widget([suicidal]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Finance'], 'setting Status to Cancelled and having Status wiped is a bug, not a rule')
})

// ---------------------------------------------------------------------
// Rules that are not finished yet
// ---------------------------------------------------------------------

test('a half-written rule does nothing while it is being written', () => {
  const blank = newClearRule('r9')
  assert.equal(ruleIsComplete(blank), false)
  assert.deepEqual(clearRulesOf(widget([blank])), [])
  assert.equal(hasClearRules(widget([blank])), false)
})

test('a rule with no column never runs, however tempting the match looks', () => {
  // `testCondition` answers TRUE for a condition with no column -- it is
  // "no filter" to every other caller. Here that would mean "clear these
  // fields on every edit", so the incomplete check has to catch it before
  // the matcher is ever asked.
  const headless = { id: 'r2', column: '', operator: 'equals', value: 'Cancelled', clear: ['Finance'] }
  assert.equal(ruleIsComplete(headless), false)
  assert.deepEqual(
    columnsToClear(widget([headless]), ROW, { column: 'Remark', value: 'x', editable: GRANTED }),
    []
  )
})

test('a rule with nothing to clear is not a rule', () => {
  assert.equal(ruleIsComplete({ column: 'Status', operator: 'equals', value: 'Cancelled', clear: [] }), false)
  assert.equal(ruleIsComplete({ column: 'Status', operator: 'equals', value: 'Cancelled', clear: [''] }), false)
})

test('an operator that needs no value is complete without one', () => {
  const emptied = { id: 'r3', column: 'Finance', operator: 'is_empty', value: '', clear: ['Handover By'] }
  assert.equal(ruleIsComplete(emptied), true)
  const got = columnsToClear(widget([emptied]), ROW, { column: 'Finance', value: '', editable: GRANTED })
  assert.deepEqual(got, ['Handover By'])
})

test('an operator that needs a value is not complete without one', () => {
  const naked = { column: 'Status', operator: 'equals', value: '', clear: ['Finance'] }
  assert.equal(ruleIsComplete(naked), false)
  assert.equal(ruleIsComplete({ ...naked, value: '   ' }), false, 'nor with a space in it')
  assert.equal(ruleIsComplete({ ...naked, value: 'Cancelled' }), true)
  // And an unfinished rule must not reach the sheet.
  assert.deepEqual(
    columnsToClear(widget([{ ...naked, id: 'r7' }]), ROW, {
      column: 'Status',
      value: '',
      editable: GRANTED,
    }),
    []
  )
})

test('an operator that needs two values is not complete with one', () => {
  const span = { id: 'r4', column: 'Amount', operator: 'between', value: '1', clear: ['Finance'] }
  assert.equal(ruleIsComplete(span), false)
  assert.equal(ruleIsComplete({ ...span, value2: '9' }), true)
})

test('how many values an operator needs is asked of the operator, not restated here', () => {
  // Every arity-0 operator in the app, complete with no value at all. A
  // hand-written list of "the value-less ones" is the thing this defends
  // against: it would be missing whichever one is added next, and rules
  // using it would silently stop running.
  for (const op of ['is_empty', 'is_not_empty', 'this_month', 'not_this_month', 'today']) {
    assert.equal(
      ruleIsComplete({ column: 'Status', operator: op, value: '', clear: ['Finance'] }),
      true,
      op + ' needs no value, so a rule using it is finished'
    )
  }
})

// ---------------------------------------------------------------------
// A value that is an action, not a state
// ---------------------------------------------------------------------

const RETURN_TO_PDI = {
  id: 'p1',
  column: 'Status',
  operator: 'equals',
  value: 'Return to PDI',
  clear: ['Delivery Date', 'Finance'],
  clearTrigger: true,
}

test('a rule may empty its own condition column, when it says so', () => {
  const got = columnsToClear(widget([RETURN_TO_PDI]), ROW, {
    column: 'Status',
    value: 'Return to PDI',
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance', 'Status'])
})

test('and does not, when it does not', () => {
  // The default is unchanged: an ordinary rule leaves its trigger alone,
  // and the switch is the only thing that changes that.
  const got = columnsToClear(widget([{ ...RETURN_TO_PDI, clearTrigger: false }]), ROW, {
    column: 'Status',
    value: 'Return to PDI',
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance'])
})

test('emptying its own column is enough on its own', () => {
  // A rule whose whole job is to put a status back to blank has nothing in
  // its target list, and is finished all the same.
  const reset = { id: 'p2', column: 'Status', operator: 'equals', value: 'Return to PDI', clear: [], clearTrigger: true }
  assert.equal(ruleIsComplete(reset), true)
  assert.equal(ruleProblem(reset, COLS), null)
  assert.deepEqual(
    columnsToClear(widget([reset]), ROW, { column: 'Status', value: 'Return to PDI', editable: GRANTED }),
    ['Status']
  )
})

test('the self-clear still obeys the grant', () => {
  const got = columnsToClear(widget([RETURN_TO_PDI]), ROW, {
    column: 'Status',
    value: 'Return to PDI',
    editable: ['Delivery Date'],
  })
  assert.deepEqual(got, ['Delivery Date'], 'a column this reader cannot write is not written')
})

test('a rule triggered by an edit ELSEWHERE still empties its own column', () => {
  // The row is already "Return to PDI" and somebody edits the remark. The
  // status still has to come off -- otherwise which column you happened to
  // touch decides whether the reset finished.
  const got = columnsToClear(widget([RETURN_TO_PDI]), { ...ROW, Status: 'Return to PDI' }, {
    column: 'Remark',
    value: 'called customer',
    editable: [...GRANTED, 'Remark'],
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance', 'Status'])
})

test('a self-clearing rule is not flagged for naming its own column', () => {
  const both = { ...RETURN_TO_PDI, clear: ['Status', 'Finance'] }
  assert.equal(ruleProblem(both, COLS), null)
  // ...and it is still flagged when the switch is off.
  assert.match(ruleProblem({ ...both, clearTrigger: false }, COLS), /never cleared/)
})

test('the column is emptied once, however many ways it is named', () => {
  const both = { ...RETURN_TO_PDI, clear: ['Status', 'Finance'] }
  const got = columnsToClear(widget([both]), ROW, {
    column: 'Status',
    value: 'Return to PDI',
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Status', 'Finance'])
})

// ---------------------------------------------------------------------
// A whole form, saved at once
// ---------------------------------------------------------------------

test('several fields saved together are judged against the row with all of them on it', () => {
  // A rule about a field that was part of the same save has to see the new
  // value. Judged one field at a time, a rule needing the branch would
  // never fire on a save that set the branch and the remark together.
  const moved = {
    id: 'f1',
    column: 'Branch',
    operator: 'equals',
    value: 'Pune',
    clear: ['Finance'],
  }
  const row = { ...ROW, Branch: 'Nashik' }
  const got = columnsToClear(widget([moved]), row, {
    changes: { Branch: 'Pune', Remark: 'moved the job' },
    editable: [...GRANTED, 'Branch', 'Remark'],
  })
  assert.deepEqual(got, ['Finance'])
})

test('no field of the save is cleared by the save', () => {
  // Every column in the form was just typed into, so none of them is a
  // leftover -- clearing one would throw away what was just entered.
  const got = columnsToClear(widget([CANCELLED]), ROW, {
    changes: { Status: 'Cancelled', Finance: 'Axis' },
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Delivery Date', 'Handover By'], 'Finance was part of the save, so it stands')
})

test('a self-clearing rule still empties its own column out of a form', () => {
  const got = columnsToClear(widget([RETURN_TO_PDI]), ROW, {
    changes: { Status: 'Return to PDI', Remark: 'back to PDI' },
    editable: [...GRANTED, 'Remark'],
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance', 'Status'])
})

// ---------------------------------------------------------------------
// Several rules
// ---------------------------------------------------------------------

test('two rules that fire together clear the union, once each, in order', () => {
  const lost = {
    id: 'r5',
    column: 'Status',
    operator: 'contains',
    value: 'cancel',
    clear: ['Finance', 'Remark'],
  }
  const got = columnsToClear(widget([CANCELLED, lost]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: [...GRANTED, 'Remark'],
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance', 'Handover By', 'Remark'])
})

test('one rule firing does not drag in the targets of one that did not', () => {
  const other = { id: 'r6', column: 'Status', operator: 'equals', value: 'Delivered', clear: ['Remark'] }
  const got = columnsToClear(widget([CANCELLED, other]), ROW, {
    column: 'Status',
    value: 'Cancelled',
    editable: [...GRANTED, 'Remark'],
  })
  assert.equal(got.includes('Remark'), false)
})

test('the match is case- and space-insensitive, like every other condition in the app', () => {
  const got = columnsToClear(widget([CANCELLED]), ROW, {
    column: 'Status',
    value: '  cancelled ',
    editable: GRANTED,
  })
  assert.deepEqual(got, ['Delivery Date', 'Finance', 'Handover By'])
})

test('a date rule reads the sheet in the order the page reads it', () => {
  // 03/04/2026 is the third of April to a reader set to DMY and the fourth
  // of March to one set to MDY. A rule that dropped the setting would
  // answer one of those two everywhere -- and clear the wrong rows on
  // whichever half of the workspace disagreed.
  const rule = {
    id: 'r8',
    column: 'Delivery Date',
    operator: 'date_before',
    value: '2026-03-20',
    clear: ['Finance'],
  }
  const row = { ...ROW, 'Delivery Date': '03/04/2026' }
  const args = { column: 'Delivery Date', value: '03/04/2026', editable: GRANTED }

  assert.deepEqual(columnsToClear(widget([rule]), row, { ...args, dateOrder: 'DMY' }), [])
  assert.deepEqual(columnsToClear(widget([rule]), row, { ...args, dateOrder: 'MDY' }), ['Finance'])
})

// ---------------------------------------------------------------------
// Telling somebody afterwards
// ---------------------------------------------------------------------

test('the note names every field that went', () => {
  assert.equal(clearedNote(['Finance']), 'Cleared Finance — it no longer applies')
  assert.equal(clearedNote(['Finance', 'Handover By']), 'Cleared Finance and Handover By — they no longer apply')
  assert.equal(
    clearedNote(['Delivery Date', 'Finance', 'Handover By']),
    'Cleared Delivery Date, Finance and Handover By — they no longer apply'
  )
})

test('nothing cleared says nothing', () => {
  assert.equal(clearedNote([]), '')
  assert.equal(clearedNote(null), '')
})

// ---------------------------------------------------------------------
// What the admin is told while writing one
// ---------------------------------------------------------------------

test('a finished rule has nothing wrong with it', () => {
  assert.equal(ruleProblem(CANCELLED, COLS), null)
})

test('every way of leaving a rule unfinished is named', () => {
  assert.match(ruleProblem(newClearRule('x'), COLS), /Pick the column/)
  assert.match(ruleProblem({ column: 'Status', operator: 'equals', value: '', clear: ['Finance'] }, COLS), /value/)
  assert.match(
    ruleProblem({ column: 'Status', operator: 'between', value: '1', clear: ['Finance'] }, COLS),
    /second value/
  )
  assert.match(ruleProblem({ column: 'Status', operator: 'today', clear: [] }, COLS), /at least one field/)
})

test('a column that has left the sheet is named, on either side of the rule', () => {
  assert.match(ruleProblem({ ...CANCELLED, column: 'Stage' }, COLS), /Stage/)
  assert.match(ruleProblem({ ...CANCELLED, clear: ['Deposit'] }, COLS), /Deposit/)
})

test('a rule pointed at its own trigger says so rather than looking like it works', () => {
  const problem = ruleProblem({ ...CANCELLED, clear: ['Status'] }, COLS)
  assert.match(problem, /Status/)
  assert.match(problem, /never cleared/)
})

test('with no headers loaded yet, columns are not called missing', () => {
  // The tab has not synced. Every column looks unknown, and a panel full
  // of red is worse than a panel that waits.
  assert.equal(ruleProblem(CANCELLED, []), null)
})

// ---------------------------------------------------------------------
// Wiring: the table, and the panel that configures it
// ---------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const TABLE = read('src/components/widgets/TableWidget.jsx')
const PANEL = read('src/pages/admin/WidgetsPanel.jsx')

test('the table asks what to clear on every edit, with the reader grant and the date order', () => {
  const call = TABLE.slice(TABLE.indexOf('clearReport(widget, row, {'))
  const body = call.slice(0, call.indexOf('})') + 2)
  assert.match(body, /editable: editableColumns/, 'a rule must not clear what this reader cannot write')
  assert.match(body, /dateOrder/, 'a date rule read in the wrong order matches the wrong rows')
  assert.match(body, /\n\s*changes: wanted,/, 'the whole set of changes, judged together')
})

test('a rule that clears a column being written wins over the value', () => {
  // "Return to PDI" ends as a blank cell. Written beside the value instead
  // of over it, that cell is set and then unset -- two writes, two overlay
  // entries, and a visible flicker between them.
  const start = TABLE.indexOf('function editPlan(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /const plan = new Map\(Object\.entries\(wanted\)\)/)
  assert.match(body, /for \(const target of also\) plan\.set\(target, ''\)/)
})

test('the row form and the cell editor commit down the same path', () => {
  // A rule that fires in the grid and not in the form is a rule that half
  // exists -- and which half you get depends on where you happened to type.
  // A cell is now the one-column case of a row, so there is one path, not
  // two that agree.
  assert.match(TABLE, /onSaveRow=\{writeRow\}/)
  assert.match(TABLE, /async function writeCell\(row, col, value\) \{\s*await writeRow\(row, \{ \[col\]: value \}\)/)
  assert.match(TABLE, /async function commitEdit\([\s\S]*?await writeCell\(row, col, value\)/)
})

test('the cleared fields are announced and wait to be dismissed', () => {
  const start = TABLE.indexOf('function say(row, also, skipped, kept, bad, lead)')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /if \(also\.length > 0\) parts\.push\(clearedNote\(also\)\)/)
  assert.match(TABLE, /\{notice &&/, 'several cells emptying themselves is not a silent event')
  assert.match(TABLE, /onClick=\{\(\) => setNotice\(null\)\}/)
})

test('what a rule could NOT do is said in the same breath', () => {
  // A rule that tidied three fields and could not touch a fourth has to
  // say so with them, or the reader is told the record is consistent when
  // it is not -- and the only person who can see that it half ran is the
  // one who cannot do anything about it.
  const start = TABLE.indexOf('function say(row, also, skipped, kept, bad, lead)')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /if \(skipped\.length > 0\) parts\.push\(skippedNote\(skipped\)\)/)
  assert.match(body, /if \(kept\.length > 0\) parts\.push\(keptNote\(kept\)\)/, 'and a required field held back')
  assert.match(
    body,
    /blocked: skipped\.length > 0 \|\| kept\.length > 0 \|\| bad\.length > 0/,
    'and reads as a refusal, not as news'
  )
  // Both callers go through it, so neither can grow its own idea of what
  // is worth mentioning.
  assert.match(TABLE, /say\(row, also, skipped, kept, bad\)/, 'a typed edit, or a form saved')
  assert.match(
    TABLE,
    /say\(\s*null,\s*\[\.\.\.cleared\],\s*\[\.\.\.blocked\],\s*\[\.\.\.held\],\s*\[\.\.\.refused\.values\(\)\],\s*filledNote\(/,
    'and a drag'
  )
  assert.match(TABLE, /notice\.blocked \? 'border-rose-200/, 'a colour somebody reads before the words')

  // The plan has to ASK. Handing `say` an empty list it never filled is
  // the same silence, one step further back -- and it still reads as a
  // call that reports skips.
  assert.match(TABLE, /const \{ clear: also, skipped, kept \} = clearReport\(widget, row, \{/)
  const fill = TABLE.indexOf('async function commitFill(')
  const fillBody = TABLE.slice(fill, TABLE.indexOf('\n  }\n', fill))
  assert.match(fillBody, /const \{ also, skipped, kept, bad, plan \} = editPlan\(/, 'the drag asks too')
  assert.match(fillBody, /for \(const target of skipped\) blocked\.add\(target\)/, 'and keeps the answer')
  assert.match(fillBody, /for \(const target of kept\) held\.add\(target\)/)
})

test('the edit and its cascade are one request per column, not one per cell', () => {
  // A keystroke that cleared three fields was four writes and four full
  // page reloads. The fallback stays for a table wired without a batch
  // writer -- an admin preview -- because a rule that runs in one place and
  // not the other is the half-existing rule again.
  const start = TABLE.indexOf('async function sendPlan(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /await onEditCells\(\s*widget\.tab,\s*\[\.\.\.plan\]\.map\(/)
  assert.match(body, /for \(const \[column, next\] of plan\) await onEditCell\?\.\(widget\.tab, row, column, next\)/)
})

test('nothing short-circuits the clearing before it happens', () => {
  // The cheapest way to break this feature completely is one `return` in
  // the wrong place, and the result looks exactly like a table with no
  // rules configured -- so the shape of the body is checked, not just that
  // the right calls appear somewhere inside it.
  const start = TABLE.indexOf('async function writeRow(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  const lines = body.split('\n').map((l) => l.trim())
  assert.equal(lines.includes('return'), false, 'an unconditional return would skip every rule, silently')
  const plan = body.indexOf('editPlan(row, real)')
  assert.ok(plan >= 0, 'the plan is still built')
  assert.ok(plan < body.indexOf('await sendPlan('), 'and built before anything is written')
  assert.match(body, /say\(row, also, skipped, kept, bad\)/, 'and said out loud after')
})

test('a field that has not moved is not written, and fires no rule', () => {
  const start = TABLE.indexOf('async function writeRow(')
  const body = TABLE.slice(start, TABLE.indexOf('\n  }\n', start))
  assert.match(body, /filter\(\(\[col, next\]\) => next !== \(row\[col\] \?\? ''\)\)/)
  assert.match(body, /if \(Object\.keys\(real\)\.length === 0\) return/)
})

test('the admin can reach the rules, and sees how many there are', () => {
  assert.match(PANEL, /key: 'clearing'/)
  assert.match(PANEL, /badge: \(widget\.clearRules \|\| \[\]\)\.length/)
  assert.match(PANEL, /part === 'clearing' && <ClearEditor/)
})

test('an admin can make a status erase itself, and is told what that means', () => {
  const editor = PANEL.slice(PANEL.indexOf('function ClearEditor('))
  const body = editor.slice(0, editor.indexOf('\nfunction '))
  assert.match(body, /checked=\{Boolean\(rule\.clearTrigger\)\}/)
  assert.match(body, /ops\.update\(rule\.id, \{ clearTrigger: e\.target\.checked \}\)/)
  assert.match(body, /Return to PDI/, 'the example that explains why it exists')
  // The summary has to describe what the rule will actually do.
  assert.match(body, /rule\.clearTrigger \? \[rule\.column\] : \[\]/)
})

test('the panel warns that rules cannot run on a table nobody can edit', () => {
  const editor = PANEL.slice(PANEL.indexOf('function ClearEditor('))
  assert.match(editor.slice(0, editor.indexOf('\nfunction ')), /!widget\.editable/)
})

test('a column cannot be made to clear itself', () => {
  const editor = PANEL.slice(PANEL.indexOf('function ClearEditor('))
  const body = editor.slice(0, editor.indexOf('\nfunction '))
  assert.match(body, /clear: targets\.filter\(\(c\) => c !== v\)/, 'becoming the trigger takes it off its own list')
  assert.match(body, /\.filter\(\(col\) => col !== rule\.column\)/, 'and it is not offered as a target')
})
