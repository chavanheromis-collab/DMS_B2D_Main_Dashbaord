import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// Saving every connected spreadsheet at once
// ---------------------------------------------------------------------
// Each source is a card and each card is a form, so the draft lives inside
// the card -- which means the panel above cannot see the unsaved work, and
// an admin who has been through three cards has to remember which two they
// changed. That memory is the thing that fails.
//
// So the cards report themselves up and the panel grows a Save button
// beside Sync all. Nothing here has maths worth testing; what is worth
// testing is that the two Saves agree about what "saveable" means, and
// that the reporting cannot leave a save behind pointing at a card that
// has gone.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const panel = read('pages/admin/DataSourcesPanel.jsx')

test('there is a Save beside Sync all, and it says the count', () => {
  // An admin who has been through three cards wants to know there are two
  // changes waiting, not merely that a button is available.
  assert.match(panel, /onClick=\{saveAll\} disabled=\{unsaved\.length === 0\}/)
  assert.match(panel, /Save \$\{unsaved\.length\} change/)
  assert.match(panel, /'All saved'/)
  // Beside Sync all, not instead of it.
  assert.ok(panel.indexOf('onClick={saveAll}') < panel.indexOf('onClick={syncAll}'))
  assert.match(panel, /Sync all \$\{syncable\.length\}/)
})

test('both Saves ask the same question', () => {
  // A card being filled in for the first time is dirty from the first
  // keystroke and cannot be saved until it has a spreadsheet and a tab.
  // One definition, used by the card's own button and by Save-all, so
  // Save-all can never write a half-filled source the card itself would
  // have refused.
  assert.match(panel, /const saveable = dirty && Boolean\(sheetId\) && \(draft\.tabs \|\| \[\]\)\.length > 0/)
  assert.match(panel, /<Btn variant="primary" disabled=\{!saveable\} onClick=\{commit\}>/)
  assert.match(panel, /saveable \? \{ dirty: true, save: commit \} : null/)
  // The old hand-rolled copy of the condition is gone, so the two cannot
  // drift apart.
  assert.equal(/disabled=\{!dirty \|\| !sheetId \|\| selected\.length === 0\}/.test(panel), false)
})

test('a card withdraws its save when it goes', () => {
  // Or deleting a source leaves a save behind pointing at a document that
  // no longer exists.
  assert.match(panel, /useEffect\(\(\) => \(\) => onReport\?\.\(source\.id, null\), \[onReport, source\.id\]\)/)
})

test('what is reported cannot change identity on every keystroke', () => {
  // `onSave` arrives from the admin page as a fresh arrow each time it
  // renders. Put that in the effect's dependencies -- through a `commit`
  // rebuilt from it -- and the card re-reports itself on renders that
  // changed nothing here at all.
  assert.match(panel, /const commitRef = useRef\(null\)/)
  assert.match(panel, /const commit = useCallback\(\(\) => commitRef\.current\?\.\(\), \[\]\)/)
  // The effect turns on a BOOLEAN and two stable things.
  assert.match(panel, /\}, \[onReport, source\.id, saveable, commit\]\)/)
})

test('the count is state, and an unchanged card is absent from it', () => {
  // Held as state because the button's label counts them; a ref would
  // leave "Save 2 changes" on screen after both had been saved. Absent
  // rather than present-and-false, so the count is the key count and
  // cannot drift.
  assert.match(panel, /const \[pending, setPending\] = useState\(\{\}\)/)
  assert.match(panel, /if \(!entry\?\.dirty\) \{/)
  assert.match(panel, /delete next\[id\]/)
  assert.match(panel, /const unsaved = Object\.values\(pending\)/)
})

test('the register does not churn when nothing changed', () => {
  // Reporting "still clean" on a card that was already clean must hand
  // back the same object, or every such report re-renders the panel.
  assert.match(panel, /if \(!current\[id\]\) return current/)
  assert.match(panel, /const report = useCallback\(\(id, entry\) => \{/)
  // Stable, so the cards' effects do not fire because the panel rendered.
  assert.match(panel, /\}, \[\]\)/)
})
