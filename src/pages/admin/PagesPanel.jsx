import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Copy, CornerDownRight, Plus, Trash2 } from 'lucide-react'
import { uid } from '../../lib/config'
import { PAGE_ICONS, emptyPage, navLabelFor } from '../../lib/workspace'
import { Btn, Field, SectionTabs, Select, TextInput, Toggle, stableEqual } from './ui.jsx'
import BackgroundEditor from './BackgroundEditor.jsx'
import { backgroundIsSet } from '../../lib/pageBackground'
import { WIDGET_THEMES } from '../../lib/widgetStyle'
import { PageIcon } from '../../components/PageIcon.jsx'
import { isDriveUrl, safeImageUrl } from '../../lib/imageUrl'

/**
 * Creates and organises the dashboard pages that make up the sidebar.
 *
 * A page is a canvas plus the list of spreadsheets it may draw on. Ticking a
 * source here is what makes its tabs appear in that page's widget, filter and
 * button pickers -- and what the API checks before reading anything, so a
 * page can never read a spreadsheet it wasn't given.
 */
/**
 * The page list, arranged the way the SIDEBAR arranges it.
 *
 * A flat list of thirty pages in save order is a list you search rather than
 * read. The sidebar already groups them under a heading and nests sub-pages
 * as tabs of their parent, and the panel that builds that arrangement should
 * show it -- otherwise an admin is holding two different mental models of
 * one thing.
 *
 * Order inside a group is left exactly as it is: it is the order the arrows
 * move things in, and quietly sorting it would make those arrows lie.
 */
function groupPages(pages) {
  const children = new Map()
  for (const page of pages) {
    if (!page.parentId) continue
    if (!children.has(page.parentId)) children.set(page.parentId, [])
    children.get(page.parentId).push(page)
  }

  const groups = []
  const byName = new Map()
  for (const page of pages) {
    // A sub-page belongs to its parent, not to a heading of its own.
    if (page.parentId && pages.some((p) => p.id === page.parentId)) continue

    const name = (page.group || '').trim()
    if (!byName.has(name)) {
      const group = { name, pages: [] }
      byName.set(name, group)
      groups.push(group)
    }
    byName.get(name).pages.push(page)
  }

  return { groups, children }
}

export default function PagesPanel({ pages, sources, onSave, onDelete, onOpen }) {
  const [expanded, setExpanded] = useState(null)
  // Which groups and which parents are folded away. Collapsed by NAME rather
  // than by index, so adding a page does not silently open something.
  const [shut, setShut] = useState(() => new Set())
  const toggleShut = (key) =>
    setShut((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const { groups, children } = useMemo(() => groupPages(pages), [pages])

  function addPage() {
    onSave(emptyPage(`Page ${pages.length + 1}`, pages.length))
  }

  function duplicate(page) {
    // New ids throughout: a copied widget must not share an id with its
    // original, or hiding one in Users & Access would hide both.
    const remap = (list, prefix) => (list || []).map((item) => ({ ...item, id: uid(prefix) }))
    // Omit the id rather than setting it to `undefined`: the caller assigns a
    // fresh one, and Firestore rejects a document containing any undefined
    // value outright (see lib/firestoreSafe.js).
    const { id: _oldId, ...rest } = page
    onSave({
      ...rest,
      name: `${page.name} (copy)`,
      order: pages.length,
      widgets: remap(page.widgets, 'w'),
      filters: remap(page.filters, 'f'),
      buttons: remap(page.buttons, 'b'),
    })
  }

  function move(index, delta) {
    const target = index + delta
    if (target < 0 || target >= pages.length) return
    // Persist an explicit order on BOTH pages so the swap survives a reload
    // (a page with no order falls to the bottom, which would undo the move).
    onSave({ ...pages[index], order: target })
    onSave({ ...pages[target], order: index })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <Btn variant="accent" onClick={addPage}>
          <Plus size={13} /> New dashboard page
        </Btn>
        <p className="max-w-xl text-[11px] text-slate-400">
          Each page becomes an entry in the sidebar. Give pages the same <strong>group</strong> name to nest them under
          one collapsible heading.
        </p>
      </div>

      {pages.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No pages yet. Create the first one above, then add widgets to it.
        </p>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const groupKey = `group:${group.name}`
          const groupShut = shut.has(groupKey)
          return (
            <div key={groupKey}>
              {/* A heading only where there IS one. A workspace where nobody
                  has used groups should not grow an "Ungrouped" bar. */}
              {group.name && (
                <button
                  onClick={() => toggleShut(groupKey)}
                  className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
                >
                  {groupShut ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  {group.name}
                  <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium normal-case text-slate-500">
                    {group.pages.length}
                  </span>
                </button>
              )}

              {!groupShut && (
                <div className="space-y-2">
                  {group.pages.map((page) => {
                    const kids = children.get(page.id) || []
                    const kidsShut = shut.has(page.id)
                    return (
                      <div key={page.id}>
                        <PageRow
                          page={page}
                          pages={pages}
                          index={pages.indexOf(page)}
                          expanded={expanded}
                          setExpanded={setExpanded}
                          sources={sources}
                          onSave={onSave}
                          onDelete={onDelete}
                          onOpen={onOpen}
                          duplicate={duplicate}
                          move={move}
                          childCount={kids.length}
                          childrenShut={kidsShut}
                          onToggleChildren={() => toggleShut(page.id)}
                        />

                        {/* Sub-pages fold under the page they are tabs of --
                            which is where they are on the dashboard, and so
                            the only place anybody looks for them. */}
                        {kids.length > 0 && !kidsShut && (
                          <div className="mt-2 space-y-2 border-l-2 border-slate-100 pl-4">
                            {kids.map((kid) => (
                              <PageRow
                                key={kid.id}
                                page={kid}
                                pages={pages}
                                index={pages.indexOf(kid)}
                                expanded={expanded}
                                setExpanded={setExpanded}
                                sources={sources}
                                onSave={onSave}
                                onDelete={onDelete}
                                onOpen={onOpen}
                                duplicate={duplicate}
                                move={move}
                                nested
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A page's own settings.
 *
 * Exported because the page itself now shows them: an admin editing a page
 * should not have to leave it to rename it. Same component in both places --
 * two forms for one document would disagree about a field within a month.
 */
export function PageSettings({ page, pages, sources, onSave, onDraft }) {
  const [draft, setDraft] = useState(page)
  // Four sections as four buttons. Stacked open they are a form nobody can
  // see the end of, and the Save button that belongs to all four is off the
  // bottom of it.
  const [part, setPart] = useState('basics')
  const set = (patch) =>
    setDraft((d) => {
      const next = { ...d, ...patch }
      // The page editing itself watches this, so a rename shows in the
      // heading and a new backdrop appears behind the widgets while the
      // form is still open. The admin panel passes nothing and is unchanged.
      onDraft?.(next)
      return next
    })
  const dirty = !stableEqual(draft, page)
  const chosen = draft.sourceIds || []

  // A page can't be its own parent, and can't be the parent of its own
  // parent -- either would make the tab strip recurse forever. Only pages
  // that aren't themselves sub-canvases are offered, keeping the hierarchy
  // one level deep, which is all a tab strip can actually render.
  const parentOptions = pages.filter((p) => p.id !== page.id && !p.parentId)
  const hasChildren = pages.some((p) => p.parentId === page.id)

  function toggleSource(id) {
    set({ sourceIds: chosen.includes(id) ? chosen.filter((s) => s !== id) : [...chosen, id] })
  }

  // Removing a source that widgets still read would leave them pointing at
  // tabs the API now refuses -- warn rather than silently break the canvas.
  const orphaned = (page.widgets || []).filter((w) => {
    const sourceId = String(w.tab || '').split('::')[0]
    return sourceId && !chosen.includes(sourceId)
  })

  return (
    <div className="space-y-3 border-t border-slate-100 p-3">
      <SectionTabs
        active={part}
        onPick={setPart}
        sections={[
          { key: 'basics', label: 'Basics', hint: 'Title, icon and description' },
          {
            key: 'placement',
            label: 'Placement',
            badge: Boolean(draft.parentId) || Boolean(String(draft.group || '').trim()),
            hint: 'Where in the sidebar this page appears',
          },
          { key: 'look', label: 'Look', badge: Boolean(draft.theme), hint: 'The widget theme for this page' },
          {
            key: 'background',
            label: 'Background',
            badge: backgroundIsSet(draft.background),
            hint: 'The canvas behind the widgets',
          },
          {
            key: 'sources',
            label: 'Spreadsheets',
            badge: chosen.length,
            hint: 'Which sheets this page may read',
          },
        ]}
      />

      {part === 'basics' && (
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <Field label="Page title" hint="The heading shown above the widgets.">
          <TextInput value={draft.name} onChange={(v) => set({ name: v })} placeholder="Sales Performance — FY25" />
        </Field>
        <Field
          label="Sidebar label"
          hint={
            draft.navLabel?.trim()
              ? 'Used in the sidebar and tab strips.'
              : `Blank — the sidebar shows “${draft.name || 'the page title'}”.`
          }
        >
          <TextInput
            value={draft.navLabel || ''}
            onChange={(v) => set({ navLabel: v })}
            placeholder={draft.name || 'Sales'}
          />
        </Field>
        <Field label="Sidebar group" hint="Pages sharing a group collapse together.">
          <TextInput value={draft.group || ''} onChange={(v) => set({ group: v })} placeholder="e.g. Sales" />
        </Field>
        <Field label="Icon">
          <div className="flex gap-1">
            <TextInput value={draft.icon || ''} onChange={(v) => set({ icon: v })} placeholder="📊" className="w-16" />
            <div className="flex flex-wrap gap-0.5">
              {PAGE_ICONS.map((icon) => (
                <button
                  key={icon}
                  onClick={() => set({ icon })}
                  className={`rounded px-1 text-sm hover:bg-slate-100 ${draft.icon === icon ? 'bg-indigo-50' : ''}`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </Field>
        <Field
          label="Icon image (optional)"
          hint={
            draft.iconUrl && !safeImageUrl(draft.iconUrl)
              ? '⚠️ Not a usable image link — the emoji will be used instead.'
              : isDriveUrl(draft.iconUrl)
                ? '✓ Google Drive link — make sure it’s shared “Anyone with the link”.'
                : 'Paste a Google Drive share link or any https:// image.'
          }
        >
          <div className="flex items-center gap-1.5">
            <TextInput
              value={draft.iconUrl || ''}
              onChange={(v) => set({ iconUrl: v })}
              placeholder="https://drive.google.com/file/d/…/view"
            />
            {/* Rendered by the same component the sidebar uses, so what you
                see here is exactly what the navigation will show. */}
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              <PageIcon page={draft} size={22} />
            </span>
          </div>
        </Field>
        <Field label="Subtitle" hint="Shown under the page title.">
          <TextInput
            value={draft.description || ''}
            onChange={(v) => set({ description: v })}
            placeholder="Bookings, invoices and follow-ups"
          />
        </Field>
      </div>
      )}

      {/* --- Where this page appears ---------------------------------- */}
      {part === 'placement' && (
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
        <p className="mb-1.5 text-[11px] font-medium text-slate-500">Where this page appears</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Field
            label="Part of which canvas?"
            hint="Sub-canvases appear as tabs inside their parent page instead of in the sidebar."
          >
            <Select
              value={draft.parentId || ''}
              onChange={(v) => set({ parentId: v })}
              options={[
                { value: '', label: '— a top-level page of its own —' },
                ...parentOptions.map((p) => ({ value: p.id, label: `${p.icon || '📊'} ${p.name}` })),
              ]}
              disabled={hasChildren}
            />
          </Field>

          <div className="flex flex-col justify-end pb-1.5">
            <Toggle
              checked={draft.showInSidebar !== false}
              onChange={(v) => set({ showInSidebar: v })}
              label="Show in the sidebar"
            />
            <p className="mt-1 text-[10px] text-slate-400">
              {draft.showInSidebar === false
                ? 'Hidden from the sidebar — reachable only by direct link, or as a tab of its parent.'
                : draft.parentId
                  ? 'Also gets its own sidebar entry, on top of appearing as a tab.'
                  : 'Listed in the sidebar for everyone who has access to it.'}
            </p>
          </div>
        </div>

        {/* Which name the canvas TAB shows. Only worth asking once the page
            is actually part of a canvas -- otherwise there is no tab. */}
        {(draft.parentId || hasChildren) && (
          <div className="mt-2 border-t border-slate-200/70 pt-2">
            <Toggle
              checked={!!draft.tabUsesPageName}
              onChange={(v) => set({ tabUsesPageName: v })}
              label="In the canvas tab, show the full page title instead of the sidebar label"
            />
            <p className="mt-1 text-[10px] text-slate-400">
              This tab will read “
              <strong className="text-slate-600">
                {draft.tabUsesPageName
                  ? draft.name || '—'
                  : String(draft.navLabel || '').trim() || draft.name || '—'}
              </strong>
              ”. A tab strip runs the width of the page, so it can often afford the longer name where the sidebar
              can’t.
            </p>
          </div>
        )}

        {hasChildren && (
          <p className="mt-1.5 rounded bg-white px-2 py-1 text-[10px] text-slate-500">
            This page is a canvas with {pages.filter((p) => p.parentId === page.id).length} sub-page(s), so it can’t
            itself become a tab of another page — tab strips are one level deep.
          </p>
        )}
      </div>
      )}

      {/* --- The page's look --------------------------------------------- */}
      {part === 'look' && (
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Widget theme" className="w-52" hint="Applies to every widget on the page.">
            <Select
              value={draft.theme || ''}
              onChange={(v) => set({ theme: v })}
              options={WIDGET_THEMES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>
          <p className="max-w-lg pb-1.5 text-[10px] text-slate-400">
            A <strong>default</strong>, not an override: a widget you restyled by hand keeps its own look, so one
            page setting can never silently undo a dozen individual decisions. Each theme sets a surface, a corner
            radius and an accent that go together — the accent is what colours the selected buttons in a filter
            panel.
          </p>
        </div>
      </div>
      )}

      {/* --- Canvas background ----------------------------------------- */}
      {part === 'background' && (
        <BackgroundEditor background={draft.background} onChange={(background) => set({ background })} />
      )}

      {part === 'sources' && (
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-slate-500">
          Spreadsheets this page may use{' '}
          <span className="font-normal text-slate-400">
            (their tabs become available in this page’s widget, filter and button pickers)
          </span>
        </p>
        {sources.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
            No spreadsheets connected yet — add one under “Data Sources”.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
            {sources.map((source) => (
              <label
                key={source.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                  chosen.includes(source.id)
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <input type="checkbox" checked={chosen.includes(source.id)} onChange={() => toggleSource(source.id)} />
                <span className="min-w-0 flex-1 truncate" title={source.name}>
                  {source.name}
                </span>
                <span className="shrink-0 text-slate-400">{(source.tabs || []).length} tabs</span>
              </label>
            ))}
          </div>
        )}
      </div>
      )}

      {/* A warning about widgets pointing at a sheet that is no longer
          selected belongs to no section: it is a thing that is WRONG, and
          hiding it behind a button is how it stays wrong. */}
      {orphaned.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
          ⚠️ {orphaned.length} widget{orphaned.length === 1 ? '' : 's'} on this page read a spreadsheet that is no
          longer selected ({orphaned.map((w) => w.title).join(', ')}). They’ll show “could not be read” until you
          re-select it or point them elsewhere.
        </p>
      )}

      {/* Save belongs to every section, so it is not in any of them. */}
      <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
        <Btn variant="primary" disabled={!dirty} onClick={() => onSave(draft)}>
          Save page settings
        </Btn>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
    </div>
  )
}

/**
 * One page in the list.
 *
 * The same row whether it is a top-level page or a tab of one, because they
 * are the same thing and an admin should not have to learn two layouts to
 * find the Delete button.
 */
function PageRow({
  page,
  pages,
  index,
  expanded,
  setExpanded,
  sources,
  onSave,
  onDelete,
  onOpen,
  duplicate,
  move,
  childCount = 0,
  childrenShut = false,
  onToggleChildren,
  nested = false,
}) {
  const open = expanded === page.id
  const usedSources = (page.sourceIds || []).length

  return (
            <div key={page.id} className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 p-3">
                {/* The fold, where a page has tabs under it. */}
                {childCount > 0 ? (
                  <button
                    onClick={onToggleChildren}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title={childrenShut ? `Show its ${childCount} sub-pages` : 'Fold its sub-pages away'}
                  >
                    {childrenShut ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                ) : (
                  nested && <CornerDownRight size={13} className="shrink-0 text-slate-300" />
                )}
                <PageIcon page={page} size={20} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {page.name}
                    {/* Only shown when the two actually differ, so the list
                        stays quiet for pages that use one name for both. */}
                    {navLabelFor(page) !== page.name && (
                      <span className="ml-1.5 font-normal text-slate-400">
                        (sidebar: {navLabelFor(page)})
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {page.group ? `${page.group} · ` : ''}
                    {(page.widgets || []).length} widgets · {usedSources} source{usedSources === 1 ? '' : 's'}
                    {page.parentId && (
                      <span className="text-indigo-500">
                        {' '}
                        · tab of {pages.find((p) => p.id === page.parentId)?.name || '—'}
                      </span>
                    )}
                    {childCount > 0 && (
                      <span className="text-indigo-500">
                        {' '}
                        · {childCount} sub-page{childCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {page.showInSidebar === false && <span className="text-amber-600"> · hidden from sidebar</span>}
                  </p>
                </div>

                <Btn onClick={() => onOpen(page.id)}>Build</Btn>
                <button
                  onClick={() => setExpanded(open ? null : page.id)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {open ? 'Close' : 'Settings'}
                </button>

                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => duplicate(page)}
                    className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                    title="Duplicate page"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25"
                    title="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === pages.length - 1}
                    className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25"
                    title="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    onClick={() => {
                      // eslint-disable-next-line no-alert
                      if (window.confirm(`Delete the page "${page.name}"? Its widgets and filters are deleted with it. Your spreadsheets are untouched.`)) {
                        onDelete(page.id)
                      }
                    }}
                    className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                    title="Delete page"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {open && <PageSettings page={page} pages={pages} sources={sources} onSave={onSave} />}
            </div>
  )
}
