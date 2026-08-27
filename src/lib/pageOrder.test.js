import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { canDrop, dragPages, orderOf, orderPages, personalOrder, reorder } from './pageOrder.js'
import { groupPages } from './workspace.js'

const PAGES = [
  { id: 'a', name: 'Sales', order: 0, group: '' },
  { id: 'b', name: 'Service', order: 1, group: '' },
  { id: 'c', name: 'Stock', order: 2, group: '' },
]
const ids = (list) => list.map((p) => p.id).join(' ')

// ---------------------------------------------------------------------
// Pick a page up, drop it where it belongs
// ---------------------------------------------------------------------

test('dropping on a page takes its place', () => {
  // Everything from there down shuffles along -- which is what a gap
  // opening under the cursor looks like, and matching the picture is worth
  // more than cleverness about which half of the row was hit.
  assert.equal(ids(reorder(PAGES, 'c', 'a')), 'c a b')
  assert.equal(ids(reorder(PAGES, 'a', 'c')), 'b c a')
})

test('a drag that goes nowhere changes nothing', () => {
  assert.equal(ids(reorder(PAGES, 'a', 'a')), 'a b c')
  assert.equal(ids(reorder(PAGES, 'ghost', 'a')), 'a b c')
  assert.equal(ids(reorder(PAGES, 'a', 'ghost')), 'a b c')
  assert.equal(canDrop('a', 'a'), false)
  assert.equal(canDrop(null, 'a'), false)
  assert.equal(canDrop('a', 'b'), true)
})

test('only the pages whose number CHANGED are written', () => {
  // Dropping something back where it started should not be sixteen
  // document writes.
  const { updates } = dragPages(PAGES, 'c', 'b')
  assert.deepEqual(updates, [
    { id: 'c', order: 1 },
    { id: 'b', order: 2 },
  ])
})

test('the order written back is dense, from zero', () => {
  // Pages arrive with whatever numbers history gave them -- gaps, ties, and
  // nothing at all on anything made before the field existed. A drag that
  // preserved those would land somewhere that depended on data nobody can
  // see.
  const messy = [{ id: 'a', order: 5 }, { id: 'b' }, { id: 'c', order: 5 }]
  const { updates } = dragPages(messy, 'c', 'a')
  assert.deepEqual(updates, [
    { id: 'c', order: 0 },
    { id: 'a', order: 1 },
    { id: 'b', order: 2 },
  ])
})

test('dropped into another group, it joins that group', () => {
  // The list you dropped it into IS the group. Leaving it out would send it
  // straight back the moment the sidebar redrew, which reads as the drag
  // having failed.
  const mixed = [
    { id: 'a', order: 0, group: '' },
    { id: 'b', order: 1, group: 'Sales' },
    { id: 'c', order: 2, group: 'Sales' },
  ]
  const moved = dragPages(mixed, 'a', 'c').updates.find((u) => u.id === 'a')
  assert.equal(moved.group, 'Sales')
})

test('dragging within one group leaves the group alone', () => {
  const mixed = [
    { id: 'a', order: 0, group: '' },
    { id: 'b', order: 1, group: 'Sales' },
    { id: 'c', order: 2, group: 'Sales' },
  ]
  for (const u of dragPages(mixed, 'c', 'b').updates) {
    assert.equal(u.group, undefined, u.id)
  }
})

test('a page with no number sorts after the ones that have one', () => {
  assert.equal(orderOf({ order: 3 }), 3)
  assert.equal(orderOf({}), null)
  assert.equal(orderOf({ order: 'first' }), null)
  assert.equal(orderOf({ order: 0 }), 0, 'and zero is a number')
})

// ---------------------------------------------------------------------
// Sorted for any user
// ---------------------------------------------------------------------

test('with no personal order, everybody sees the workspace order', () => {
  assert.equal(ids(orderPages(PAGES, {})), 'a b c')
  assert.equal(ids(orderPages(PAGES, undefined)), 'a b c')
})

test('A PERSONAL ORDER BEATS THE WORKSPACE ONE', () => {
  // The whole point of "sorted for any user": a rep who lives in two of
  // nine dashboards puts those two at the top without asking anybody.
  assert.equal(ids(orderPages(PAGES, { c: 0, a: 1 })), 'c a b')
})

test('a page somebody CHOSE beats one that merely inherited the number', () => {
  // Which is what makes moving a single page move that page: `c` and `a`
  // are both at 0, but only one of them was put there by this person.
  assert.equal(ids(orderPages(PAGES, { c: 0 })), 'c a b')
})

test('a personal order covers every page shown', () => {
  // One that named only the pages somebody moved would leave the rest on
  // the workspace default, and the two interleaved is neither order.
  const { pages: ordered } = dragPages(PAGES, 'c', 'a')
  const mine = personalOrder(ordered)
  assert.deepEqual(mine, { c: 0, a: 1, b: 2 })
  assert.equal(ids(orderPages(PAGES, mine)), 'c a b')
})

test('two pages sharing a number never swap between renders', () => {
  const tied = [{ id: 'a', order: 1 }, { id: 'b', order: 1 }, { id: 'c', order: 1 }]
  assert.equal(ids(orderPages(tied, {})), ids(orderPages(tied, {})))
  assert.equal(ids(orderPages(tied, {})), 'a b c')
})

test('a personal order for a page that has gone is simply ignored', () => {
  // `c` is chosen at 1, so it beats `b`, which inherited 1 -- and neither
  // of them beats `a` at 0.
  assert.equal(ids(orderPages(PAGES, { deleted: 0, c: 1 })), 'a c b')
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const sidebar = read('components/Sidebar.jsx')
const shell = read('components/AppShell.jsx')
const dashboard = read('pages/Dashboard.jsx')
const prefs = read('hooks/useUserPrefs.js')

test('the sidebar is where pages are picked up and put down', () => {
  assert.ok(sidebar.includes('draggable={canDrag}'))
  assert.ok(sidebar.includes('onDragStart={(e) => {'))
  assert.ok(sidebar.includes('onDrop={(e) => {'))
  assert.ok(sidebar.includes('onMovePage(moved, page.id)'))
})

test('the browser is told the drop is allowed', () => {
  // Without preventDefault on dragover the browser refuses the drop and the
  // whole thing silently does nothing.
  // Bounded to the dragover handler's OWN body: the drop handler next door
  // has a preventDefault of its own, and a slice that ran into it would
  // pass whatever dragover did.
  const from = sidebar.indexOf('onDragOver={(e) => {')
  const to = sidebar.indexOf('onDragLeave=', from)
  assert.ok(from > 0 && to > from)
  assert.ok(sidebar.slice(from, to).includes('e.preventDefault()'))
  assert.ok(sidebar.includes("e.dataTransfer.setData('text/plain', page.id)"), 'and given a payload to carry')
})

test('ANY user can sort, not just an admin in edit mode', () => {
  assert.ok(sidebar.includes('const canDrag = Boolean(onMovePage) && !collapsed'))
  assert.ok(!sidebar.includes('const canDrag = editing &&'))
  assert.ok(dashboard.includes('onMovePage={movePage}'))
  assert.ok(!dashboard.includes('onMovePage={isAdmin ? movePage : undefined}'))
})

test('what the drag changes depends on who is doing it, and it says so', () => {
  assert.ok(dashboard.includes('if (isAdmin && editing) {'), 'the workspace order')
  assert.ok(dashboard.includes('await setPageOrder(personalOrder(ordered))'), 'or your own')
  assert.ok(dashboard.includes("moveScope={isAdmin && editing ? 'everyone' : 'you'}"))
  assert.ok(sidebar.includes("moveScope === 'everyone' ? 'Setting the order for everyone' : 'Setting your own order'"))
})

test('the sidebar draws in the order the reader is owed', () => {
  assert.ok(dashboard.includes('orderPages(sidebarPages(allowedPages), pageOrder)'))
})

test('a personal order is stored where a user is allowed to write', () => {
  // `userPrefs/{uid}_...` is the one collection an ordinary user may write
  // to, and the rule matches on that prefix.
  assert.ok(prefs.includes('const id = uid ? `${uid}_pages` : null'))
  assert.ok(prefs.includes("setDoc(doc(db, 'userPrefs', id), stripUndefined({ pageOrder: next || {} }), { merge: true })"))
})

test('an unreadable preference is a shrug, not an error', () => {
  // A preference is a convenience, never a gate: the sidebar still shows
  // the workspace order.
  const hook = fs.readFileSync(path.join(SRC, 'hooks/useUserPrefs.js'), 'utf8')
  const body = hook.slice(hook.indexOf('export function usePagePrefs'))
  assert.ok(body.includes('() => setOrder(null)'))
})

// --- and nothing downstream may re-sort it -------------------------------

test('GROUPING DOES NOT RE-SORT', () => {
  // This is the bug a reader saw as "it picks up and puts down, then takes
  // its old place again": the sidebar grouped the pages by first sorting
  // them on the workspace order, which threw away whichever order the
  // caller had just worked out.
  const pages = [
    { id: 'c', order: 2, group: '' },
    { id: 'a', order: 0, group: '' },
    { id: 'b', order: 1, group: '' },
  ]
  assert.equal(ids(groupPages(pages)[0].pages), 'c a b')
})

test('a personal order survives the whole way to the screen', () => {
  // The round trip the sidebar actually makes: order it, filter it, group
  // it. Any step that re-sorts breaks the drag, and the break is invisible
  // until somebody who is not an admin tries it.
  const mine = { c: 0, a: 1, b: 2 }
  const ordered = orderPages(PAGES, mine)
  const grouped = groupPages(ordered)
  assert.equal(ids(grouped[0].pages), 'c a b')
})

test('grouping still separates the groups, and keeps ungrouped first', () => {
  // The part that WAS its job, and still is.
  const mixed = [
    { id: 'b', group: 'Sales' },
    { id: 'a', group: '' },
    { id: 'c', group: 'Sales' },
  ]
  const groups = groupPages(mixed)
  assert.equal(groups[0].group, '')
  assert.equal(ids(groups[0].pages), 'a')
  assert.equal(ids(groups[1].pages), 'b c')
})

test('nothing between the order and the screen sorts pages again', () => {
  // Belt and braces on the above: the sidebar must not grow its own idea
  // of the order later.
  assert.ok(!sidebar.includes('sortPages'))
  const workspace = fs.readFileSync(path.join(SRC, 'lib/workspace.js'), 'utf8')
  const body = workspace.slice(workspace.indexOf('export function groupPages'))
  assert.ok(!body.slice(0, 700).includes('sortPages('))
})
