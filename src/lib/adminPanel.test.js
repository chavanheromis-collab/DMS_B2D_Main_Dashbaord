import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// The admin panel's own navigation
// ---------------------------------------------------------------------
// Nothing here has maths worth testing -- it is a header, a fold and a
// grouping. What is worth testing is that they are still CONNECTED, which is
// the half a refactor breaks silently.
//
// Comments are stripped first: an assertion that a name appears in a file
// has been satisfied by the comment explaining that name, in this very
// project, long after the code had gone.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const admin = read('pages/Admin.jsx')
const pagesPanel = read('pages/admin/PagesPanel.jsx')
const sources = read('pages/admin/DataSourcesPanel.jsx')

// --- the header follows you down -----------------------------------------

test('the section buttons are in a bar that sticks to the top', () => {
  // The panel is a long scroll and the thing anybody wants next is nearly
  // always a different section.
  assert.ok(admin.includes('sticky top-0 z-30'))
  const bar = admin.slice(admin.indexOf('sticky top-0 z-30'))
  assert.ok(bar.slice(0, 2000).includes('SECTIONS.map'), 'and the sections are inside it')
  assert.ok(bar.slice(0, 2500).includes('onChange={setPageId}'), 'along with the page being edited')
})

test('the publish bar sits below the header rather than on top of it', () => {
  assert.ok(admin.includes('sticky top-[3.25rem]'))
})

// --- pages read the way the sidebar reads --------------------------------

test('pages are grouped by their sidebar group', () => {
  assert.ok(pagesPanel.includes('function groupPages(pages)'))
  assert.ok(pagesPanel.includes('const { groups, children } = useMemo(() => groupPages(pages), [pages])'))
  assert.ok(pagesPanel.includes('groups.map((group) => {'))
})

test('a group folds away, and remembers by name rather than by index', () => {
  // Adding a page should not silently open something.
  assert.ok(pagesPanel.includes('const groupKey = `group:${group.name}`'))
  assert.ok(pagesPanel.includes('shut.has(groupKey)'))
  assert.ok(pagesPanel.includes('onClick={() => toggleShut(groupKey)}'))
})

test('a workspace with no groups grows no heading', () => {
  assert.ok(pagesPanel.includes('{group.name && ('))
})

test('sub-pages fold under the page they are tabs of', () => {
  assert.ok(pagesPanel.includes('const kids = children.get(page.id) || []'))
  assert.ok(pagesPanel.includes('kids.length > 0 && !kidsShut'))
  assert.ok(pagesPanel.includes('onToggleChildren={() => toggleShut(page.id)}'))
})

test('a sub-page is not also listed at the top level', () => {
  assert.ok(pagesPanel.includes('if (page.parentId && pages.some((p) => p.id === page.parentId)) continue'))
})

test('the order inside a group is left exactly as it is', () => {
  // It is the order the arrows move things in, and sorting it would make
  // those arrows lie.
  assert.ok(!pagesPanel.includes('group.pages.sort('))
  assert.ok(pagesPanel.includes('index={pages.indexOf(page)}'), 'and the arrows still address the real list')
})

test('one row serves a page and a sub-page alike', () => {
  assert.ok(pagesPanel.includes('function PageRow('))
  assert.equal((pagesPanel.match(/<PageRow/g) || []).length, 2)
})

// --- a data source folds -------------------------------------------------

test('a source card is folded until it is opened', () => {
  assert.ok(sources.includes('const [open, setOpen] = useState(false)'))
  assert.ok(sources.includes('if (!open) {'))
})

test('the folded row says enough to pick the right one', () => {
  assert.ok(sources.includes('{selected.length} tab'))
  assert.ok(sources.includes('computedCount > 0 &&'))
  assert.ok(sources.includes('synced ${lastSynced}') || sources.includes('` · synced ${lastSynced}`'))
  assert.ok(sources.includes('needsSync && !dirty'), 'and flags the two things that mean it needs opening')
})

test('the fold state is a hook ABOVE the early return it controls', () => {
  // A hook below that return is skipped whenever the card is folded, which
  // is the "rendered fewer hooks than expected" crash.
  const hook = sources.indexOf('const [open, setOpen] = useState(false)')
  const early = sources.indexOf('if (!open) {')
  assert.ok(hook !== -1 && early !== -1 && hook < early)

  const after = sources.slice(early)
  const nextHook = after.search(/use(State|Effect|Memo|Ref|Callback|LayoutEffect)\(/)
  const nextComponent = after.search(/\bfunction [A-Z]/)
  assert.ok(nextHook === -1 || (nextComponent !== -1 && nextHook > nextComponent), 'no hook after the early return')
})
