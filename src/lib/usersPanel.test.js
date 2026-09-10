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
  // And it speaks the name the SIDEBAR shows, which is the one the row is
  // labelled with -- a switch announced as something other than the thing
  // beside it is worse than one announced as nothing.
  assert.ok(panel.includes('ariaLabel={`Can view ${navLabelFor(page)}`}'))
  assert.ok(ui.includes('aria-label={label ? undefined : ariaLabel}'))
})

// ---------------------------------------------------------------------
// The pages, as the sidebar shows them
// ---------------------------------------------------------------------

test('the list is the sidebar’s structure, unrolled', () => {
  // Dashboard, then the sections in it, then the pages, then each page's
  // settings -- the same nesting the sidebar has, laid out end to end
  // rather than switched between.
  assert.ok(panel.includes('{pagesBySpace(spaces, pages).map((space) => ('))
  assert.ok(panel.includes('<SpaceHeading'))
  assert.ok(panel.includes('groupPages(space.pages).map(({ group, pages: inGroup }) =>'))
  assert.ok(panel.includes('{inGroup.map((page) => ( <AccessCard'))
})

test('the dashboard heading names it, counts it, and folds it', () => {
  const heading = panel.slice(panel.indexOf('function SpaceHeading('))
  assert.ok(heading.includes('{space.name}'))
  assert.ok(heading.includes('{granted}/{total}'))
  assert.ok(heading.includes('aria-expanded={open}'))
  assert.ok(heading.includes('onClick={onToggle}'))
})

test('the dashboard heading is WIRED to fold, per user and per dashboard', () => {
  // Its own chevron and aria-expanded prove nothing about the call site:
  // handed a constant, every dashboard is permanently open, and handed one
  // key, folding one folds them all.
  assert.ok(panel.includes('onToggle={() => toggleGroup(u.id, space.id)}'))
  assert.ok(panel.includes('open={!shutGroups.includes(groupKey(u.id, space.id))}'))
  // ...and the pages really are hidden when it is folded.
  assert.ok(
    panel.includes("className={ shutGroups.includes(groupKey(u.id, space.id)) ? 'hidden' : '' }")
  )
})

test('a whole dashboard can be granted or taken away at once', () => {
  assert.ok(panel.includes('onAll={(v) => setGroupPages(u.id, space.pages, v)}'))
  const heading = panel.slice(panel.indexOf('function SpaceHeading('))
  assert.ok(heading.includes('onClick={() => onAll(true)}'))
  assert.ok(heading.includes('onClick={() => onAll(false)}'))
  assert.ok(heading.includes('disabled={granted === total}'))
  assert.ok(heading.includes('disabled={granted === 0}'))
})

test('a folded dashboard still says something inside it is unsaved', () => {
  assert.ok(panel.includes('unsaved={space.pages.some((p) => unsavedCards.includes(`${u.id}:${p.id}`) )}'))
  const heading = panel.slice(panel.indexOf('function SpaceHeading('))
  assert.ok(heading.includes('{unsaved && ('))
})

test('a page whose dashboard was deleted is shown, and said to be odd', () => {
  // It is still grantable. Hiding it would make the grant impossible.
  const heading = panel.slice(panel.indexOf('function SpaceHeading('))
  assert.ok(heading.includes('{space.missing && ('))
  assert.ok(heading.includes('deleted dashboard'))
})

test('the panel asks for every dashboard, not the one being administered', () => {
  assert.ok(panel.includes('const { spaces } = useSpace()'))
  assert.ok(panel.includes("import { pagesBySpace } from '../../lib/spaces'"))
})

test('the access list is grouped by the SAME function the sidebar groups by', () => {
  // Two ideas about which pages belong together is how the list somebody
  // is granting access to stops being the list they will see. There is one
  // grouper, and both callers use it.
  assert.ok(panel.includes('groupPages(space.pages).map(({ group, pages: inGroup }) =>'))
  assert.ok(panel.includes("import { accessId, groupPages, navLabelFor } from '../../lib/workspace'"))
  const sidebar = read('components/Sidebar.jsx')
  assert.ok(sidebar.includes('groupPages(filtered)'))
})

test('a group is headed by its own title, and says how much of it they have', () => {
  // The question this panel is open to answer, at the level somebody
  // actually thinks about access: a whole section at a time.
  assert.ok(panel.includes('<span className="truncate">{group}</span>'))
  assert.ok(
    panel.includes('const grantedHere = inGroup.filter( (p) => accessMap[accessId(u.id, p.id)]?.canView ).length')
  )
  assert.ok(panel.includes('{grantedHere}/{inGroup.length}'))
})

test('ungrouped pages have no heading, exactly as in the sidebar', () => {
  // A heading over the pages that have no group would be a group that does
  // not exist -- and it is the one thing the sidebar does not draw.
  assert.ok(panel.includes('{group && ('))
  assert.ok(panel.includes("key={group || '__ungrouped__'}"))
})

test('every page in a group still gets its card', () => {
  // Grouping that dropped a page would take away the only way to grant it,
  // and the page would simply not be there to notice.
  assert.ok(panel.includes('{inGroup.map((page) => ( <AccessCard'))
})

test('a section folds, and its pages fold with it', () => {
  // Three levels, the way somebody thinks about it: the sidebar section,
  // the pages in it, then the settings of each page.
  assert.ok(panel.includes('onClick={() => toggleGroup(u.id, sectionKey)}'))
  assert.ok(panel.includes('aria-expanded={shown}'))
  assert.ok(panel.includes('const shown = !group || !shutGroups.includes(groupKey(u.id, sectionKey))'))
  // Keyed by dashboard too: two of them may both have a "Reports" section.
  assert.ok(panel.includes('const sectionKey = `${space.id}/${group}`'))
})

test('folds are remembered per user, not per group name', () => {
  // Two people's lists would otherwise share one set of folds, and opening
  // a section on one row would open it on every other.
  assert.ok(panel.includes('const groupKey = (uid, group) => `${uid}:${group}`'))
})

test('a section nobody has touched is open', () => {
  // CLOSED is what is remembered. The one thing this panel must never do
  // is make an access setting invisible to the person looking for it, and
  // a default that folds everything does exactly that.
  assert.ok(panel.includes('const [shutGroups, setShutGroups] = useState([])'))
  assert.ok(!panel.includes('const [openGroups'))
})

test('ungrouped pages cannot be folded away by their section', () => {
  // There would be no section heading left to unfold them from. The
  // DASHBOARD above them still folds, and that heading is always drawn.
  assert.ok(panel.includes('const shown = !group ||'))
})

test('a whole section can be granted or taken away at once', () => {
  // "Give them the DMS B2D Report" is the sentence people say. Page by
  // page is how the second one gets missed the day a third is added.
  assert.ok(panel.includes('function setGroupPages(uid, inGroup, canView) { inGroup.forEach((page) => saveAccess(uid, page.id, { canView })) }'))
  assert.ok(panel.includes('onClick={() => setGroupPages(u.id, inGroup, true)}'))
  assert.ok(panel.includes('onClick={() => setGroupPages(u.id, inGroup, false)}'))
  // ...and the button says nothing to do when there is nothing to do.
  assert.ok(panel.includes('disabled={grantedHere === inGroup.length}'))
  assert.ok(panel.includes('disabled={grantedHere === 0}'))
})

test('a folded section still says that something inside it is unsaved', () => {
  // The card puts its marker on the summary line precisely so collapsing
  // the CARD cannot hide it. Folding the section would hide that line, so
  // the same fact has to survive one level up.
  assert.ok(panel.includes('onDirty={(d) => markUnsaved(u.id, page.id, d)}'))
  assert.ok(panel.includes('const unsavedHere = inGroup.some((p) => unsavedCards.includes(`${u.id}:${p.id}`) )'))
  const heading = panel.slice(panel.indexOf('{unsavedHere && ('), panel.indexOf('setGroupPages(u.id, inGroup, true)'))
  assert.ok(heading.includes('unsaved'))
})

test('the card reports its unsaved state, rather than the list guessing at it', () => {
  // "Unsaved" is the difference between what the card is SHOWING and what
  // is stored, and only the card knows what it is showing.
  const card = panel.slice(panel.indexOf('function AccessCard('))
  assert.ok(card.includes('onDirty?.(dirty)'))
  assert.ok(card.includes('return () => onDirty?.(false)'))
})

test('a page is named the way the sidebar names it', () => {
  // The LABEL, specifically. `ariaLabel={`Can view ${navLabelFor(page)}`}`
  // contains the same characters, so an assertion that the name appears
  // anywhere is satisfied by the spoken label while the visible one says
  // something else.
  assert.ok(panel.includes('{navLabelFor(page)} </span>'))
  // ...with the real name kept alongside where the two differ, so the row
  // can still be matched to the Pages panel.
  assert.ok(panel.includes('{navLabelFor(page) !== page.name && ('))
  const sidebar = read('components/Sidebar.jsx')
  assert.ok(sidebar.includes('const label = navLabelFor(page)'))
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
