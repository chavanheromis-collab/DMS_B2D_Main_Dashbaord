import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { activeSection, sectionMark, visibleSections } from './sectionTabs.js'

// ---------------------------------------------------------------------
// A long form as a row of buttons
// ---------------------------------------------------------------------

test('a count of zero is not a mark', () => {
  // Zero is a real answer and it is "none". Marking it would have every
  // widget on the page claim controls it does not have, and a mark that is
  // always there tells you nothing.
  assert.equal(sectionMark(0), null)
  assert.equal(sectionMark(undefined), null)
  assert.equal(sectionMark(null), null)
  assert.equal(sectionMark(false), null)
  assert.equal(sectionMark(''), null)
})

test('a count that means something is printed', () => {
  assert.equal(sectionMark(3), '3')
  assert.equal(sectionMark(12), '12')
})

test('a yes-or-no is a dot, because there is no number worth printing', () => {
  // A blend is on or off; a look is custom or stock.
  assert.equal(sectionMark(true), '•')
})

test('one section is not a choice', () => {
  // A lone button that cannot be turned off is a label pretending to be a
  // control.
  assert.deepEqual(visibleSections([{ key: 'a' }]), [])
  assert.deepEqual(visibleSections([]), [])
  assert.deepEqual(visibleSections(null), [])
})

test('a section written inline as a condition can be false', () => {
  // So a caller can write `BLENDABLE.has(type) && { key: 'blend' }` in
  // place rather than building the list in a variable above the JSX.
  const out = visibleSections([{ key: 'a' }, false, { key: 'b' }, null, undefined])
  assert.deepEqual(out.map((s) => s.key), ['a', 'b'])
})

test('a section that no longer exists falls back to the first', () => {
  // A widget can change type, and the section it was open at may not
  // survive that. A blank panel would look like a bug.
  const sections = [{ key: 'setup' }, { key: 'look' }]
  assert.equal(activeSection(sections, 'blend'), 'setup')
  assert.equal(activeSection(sections, 'look'), 'look')
  assert.equal(activeSection(sections, undefined), 'setup')
})

// ---------------------------------------------------------------------
// Wiring: the panels that were long stacks are now rows of buttons
// ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const ui = read('pages/admin/ui.jsx')
const widgets = read('pages/admin/WidgetsPanel.jsx')
const sources = read('pages/admin/DataSourcesPanel.jsx')
const pages = read('pages/admin/PagesPanel.jsx')

test('the button row is one component, not three', () => {
  assert.ok(ui.includes('export function SectionTabs('))
  assert.ok(ui.includes('const shown = visibleSections(sections)'))
  assert.ok(ui.includes('const mark = sectionMark(s.badge)'))
  for (const panel of [widgets, sources, pages]) assert.ok(panel.includes('<SectionTabs'))
})

test('a widget’s five sections are five buttons', () => {
  for (const key of ['setup', 'controls', 'blend', 'look', 'behaviour']) {
    assert.ok(widgets.includes(`key: '${key}'`), key)
    assert.ok(widgets.includes(`here === '${key}'`), `${key} is shown`)
  }
})

test('a widget’s section is remembered per widget', () => {
  // Keyed by id rather than held in a row component, because the row is a
  // body inside a map.
  assert.ok(widgets.includes("const sectionOf = (id) => section[id] || 'setup'"))
  assert.ok(widgets.includes('const here = sectionOf(widget.id)'))
})

test('the marks say what is configured without opening anything', () => {
  assert.ok(widgets.includes('badge: (widget.controls || []).length'))
  assert.ok(widgets.includes('badge: blendIsReady(widget.blend)'))
  assert.ok(widgets.includes('badge: hasCustomStyle(widget.style)'))
  assert.ok(sources.includes('badge: selected.length'))
  assert.ok(sources.includes('badge: computedCount'))
  assert.ok(pages.includes('badge: chosen.length'))
  assert.ok(pages.includes('badge: backgroundIsSet(draft.background)'))
})

test('a blend button is only offered where a blend is possible', () => {
  assert.ok(widgets.includes("BLENDABLE.has(widget.type) && { key: 'blend'"))
})

test('a source card opens at the section there is a reason to open', () => {
  // A connected source is opened to change its tabs, not to re-paste a link
  // nobody has touched since the day it was set up.
  assert.ok(sources.includes("useState(() => ((source.tabs || []).length > 0 ? 'tabs' : 'connect'))"))
})

test('the fold state is still a hook above the early return', () => {
  const hook = sources.indexOf('const [part, setPart] = useState(')
  const early = sources.indexOf('if (!open) {')
  assert.ok(hook !== -1 && early !== -1 && hook < early)
})

test('SAVE is not in a section', () => {
  // It acts on the whole card. An admin who has just changed a tab must not
  // have to find their way back to a particular strip to save it.
  for (const [name, panel, label] of [
    ['source', sources, 'Save source'],
    ['page', pages, 'Save page settings'],
  ]) {
    const save = panel.indexOf(label)
    assert.ok(save > 0, name)
    const gate = panel.lastIndexOf("{part === '", save)
    const closed = panel.lastIndexOf(')}', save)
    assert.ok(closed > gate, `${name}: the save button is inside a section`)
  }
})

test('what is WRONG is never behind a button', () => {
  // A load that failed, and widgets pointing at a sheet nobody selected any
  // more: hiding those behind a button is how they stay wrong.
  assert.ok(/\{message && \(/.test(sources))
  const gated = sources.slice(sources.indexOf("{part === 'connect'"), sources.indexOf('{message &&'))
  assert.ok(gated.includes(')}'), 'the connect section closes before the message')
  assert.ok(/\{orphaned\.length > 0 && \(/.test(pages))
})
