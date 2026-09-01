import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------
// Users & access
// ---------------------------------------------------------------------
// Nothing here has maths worth testing -- it is a table, a selection and a
// fold. What is worth testing is that they are still CONNECTED, and that the
// two things which can do real damage still cannot: a bulk sweep taking an
// admin's own rights off, and a page card that hides unsaved work.
//
// Comments are stripped first: an assertion that a name appears in a file
// has been satisfied by the comment explaining that name, in this very
// project, long after the code had gone.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const panel = read('pages/admin/UsersPanel.jsx')
const ui = read('pages/admin/ui.jsx')

// ---------------------------------------------------------------------
// Acting on several people at once
// ---------------------------------------------------------------------

test('several people can be selected, and all of them at once', () => {
  // Twelve people joining in the same week is the normal shape of this job.
  assert.ok(panel.includes('const [picked, setPicked] = useState([])'))
  assert.ok(panel.includes('setPicked(allPicked ? [] : sorted.map((u) => u.id))'))
  assert.ok(panel.includes('onChange={() => togglePick(u.id)}'))
})

test('select-all covers what is on screen, not what is filtered away', () => {
  // `sorted` is the filtered list. Selecting every user in the database from
  // a search box showing three of them is a sweep nobody asked for.
  assert.ok(panel.includes('const allPicked = sorted.length > 0 && sorted.every((u) => picked.includes(u.id))'))
  assert.ok(!panel.includes('users.map((u) => u.id))'))
})

test('a bulk action never touches your own account', () => {
  // A sweep that sets everybody to "User", or to "Removed", is one click
  // from an admin taking their own rights off -- and the panel that would
  // put them back is the one they just locked.
  assert.ok(panel.includes('const targets = useMemo(() => picked.filter((id) => id !== me?.uid), [picked, me?.uid])'))
  for (const fn of [
    'const bulkUser = (patch) => targets.forEach((id) => saveUser(id, patch))',
    'const bulkPages = (canView) => targets.forEach((id) => setAllPages(id, canView))',
  ]) {
    assert.ok(panel.includes(fn), fn)
  }
})

test('and says so where the action is, not afterwards', () => {
  assert.ok(panel.includes('const droppedSelf = picked.length !== targets.length'))
  assert.ok(panel.includes('{droppedSelf && ('))
  assert.ok(panel.includes('will be left alone'))
})

test('copying permissions does not copy them onto their source', () => {
  // Selecting Ravi and then copying "from Ravi" is a no-op that would
  // otherwise write his own settings back over themselves.
  assert.ok(panel.includes('targets.forEach((id) => id !== sourceUid && copyFrom(id, sourceUid))'))
})

test('every bulk control acts through the guarded helpers', () => {
  // A control wired straight to `picked.forEach` would bypass the
  // leave-yourself-alone rule entirely.
  const bar = panel.slice(panel.indexOf('{picked.length > 0 && ('), panel.indexOf('<div className="overflow-x-auto">'))
  assert.ok(bar.length > 0)
  assert.ok(!bar.includes('picked.forEach'))
  for (const call of ['bulkUser({ status: v })', 'bulkUser({ role: v })', 'bulkPages(true)', 'bulkPages(false)', 'bulkCopy(v)']) {
    assert.ok(bar.includes(call), call)
  }
})

test('the bar is only there when it has something to act on', () => {
  assert.ok(panel.includes('{picked.length > 0 && ('))
  // And follows the list down: the people it acts on are the ones you
  // scrolled past to pick them.
  assert.ok(panel.includes('sticky top-0'))
})

test('messaging rights can be set for everybody at once', () => {
  for (const v of ['send-on', 'send-off', 'recv-on', 'recv-off']) {
    assert.ok(panel.includes(`'${v}'`), v)
  }
  assert.ok(panel.includes('bulkUser({ canSendMessages: true })'))
  assert.ok(panel.includes('bulkUser({ canReceiveMessages: false })'))
})

// ---------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------

test('a person is one cell, not three', () => {
  // Name, email and job title in one column. Three columns for one person
  // was three columns of mostly white space.
  assert.ok(panel.includes('const face = avatarSpec(u.name || u.email, u.id)'))
  assert.ok(panel.includes('{face.initials}'))
})

test('the face is the one the rest of the app draws', () => {
  // Two ideas of what somebody looks like is one of them being wrong.
  assert.ok(panel.includes("import { avatarSpec } from '../../lib/avatar'"))
  assert.ok(!panel.includes('function initialsOf'))
})

test('the two message switches are switches, and say which is which', () => {
  // A column of forty rows cannot afford a labelled checkbox each, so the
  // words live where a screen reader and a hesitating admin both find them.
  assert.ok(panel.includes('role="switch"'))
  assert.ok(panel.includes('aria-checked={on}'))
  assert.ok(panel.includes('aria-label={label}'))
  assert.ok(panel.includes('title={`${title} — ${on ? \'on\' : \'off\'}`}'))
})

test('off is not carried by colour alone', () => {
  // A slash through the icon, so the state survives being colour-blind or
  // printed in grey.
  assert.ok(panel.includes('{!on && <span aria-hidden className="absolute h-4 w-px rotate-45 bg-slate-300" />}'))
})

// ---------------------------------------------------------------------
// Pages, one line each
// ---------------------------------------------------------------------

test('pages are a list, not a wall of cards', () => {
  assert.ok(panel.includes('divide-y divide-slate-100'))
  assert.ok(!panel.includes('grid grid-cols-1 gap-3 xl:grid-cols-2'))
})

test('one page detail is open at a time, per user', () => {
  // Keyed by user AND page: two users' cards would otherwise share one open
  // slot and the wrong one would unfold.
  assert.ok(panel.includes('const [openPage, setOpenPage] = useState(null)'))
  assert.ok(panel.includes('open={openPage === `${u.id}:${page.id}`}'))
  // And clicking one actually opens it: the prop above survives the handler
  // being wired to nothing, and then the list never unfolds.
  assert.ok(
    panel.includes('setOpenPage((cur) => cur === `${u.id}:${page.id}` ? null : `${u.id}:${page.id}` )')
  )
})

test('granting a page takes one click, without opening anything', () => {
  // The commonest thing an admin does here.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  assert.ok(card.includes('<Toggle checked={canView} onChange={setCanView} label=""'))
})

test('a switch with no visible label still has a spoken one', () => {
  assert.ok(panel.includes('ariaLabel={`Can view ${page.name}`}'))
  assert.ok(ui.includes('aria-label={label ? undefined : ariaLabel}'))
})

test('the line says what the page grants without being opened', () => {
  // Opening each card to find out which pages are narrowed is the thing
  // that made this a wall.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  assert.ok(card.includes('const shownWidgets = widgets.length - hidden.length'))
  assert.ok(card.includes('const editCount = Object.values(editable).reduce('))
  assert.ok(card.includes('const downloadCount = Object.values(downloadable).reduce('))
  assert.ok(card.includes("const limited = (scope?.conditions || []).some((c) => c?.column)"))
  assert.ok(card.includes('{limited && ('))
})

test('unsaved work shows on the line, not only inside the fold', () => {
  // Collapsing a card must not hide the fact that there is something to
  // save in it.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  const summary = card.slice(0, card.indexOf('{open && ('))
  assert.ok(summary.includes('{dirty && ('))
  assert.ok(summary.includes('unsaved'))
})

test('a collapsed card keeps its edits, because it stays mounted', () => {
  // The BODY is conditional, not the component. Unmounting it would throw
  // away half-finished work every time somebody looked at another page.
  // The fold must wrap the BODY. `{open && (` moved one line inwards
  // leaves the div mounted and the contents conditional, which reads the
  // same and is not the same: the card unmounts, and with it the state.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  assert.ok(card.includes('{open && ( <div className="border-t border-slate-100 px-3 pb-3 pt-2">'))
  assert.ok(card.indexOf('{open && (') > card.indexOf('const [canView, setCanView]'))
})

test('the per-user page tools are still there', () => {
  // The bulk bar is for several people; these are for one, and losing them
  // would make the common single-user case worse to serve the rare one.
  assert.ok(panel.includes('onClick={() => setAllPages(u.id, true)}'))
  assert.ok(panel.includes('onClick={() => setAllPages(u.id, false)}'))
  assert.ok(panel.includes('onChange={(v) => v && copyFrom(u.id, v)}'))
  assert.ok(panel.includes('onChange={(v) => v && copyLayoutFrom(u.id, v)}'))
})

test('an admin is told why they have no pages to grant', () => {
  assert.ok(panel.includes('Admins can see and edit every page'))
})
