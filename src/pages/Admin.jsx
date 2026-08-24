import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc } from 'firebase/firestore'
import { ArrowLeft, Save, Undo2 } from 'lucide-react'
import { db } from '../firebase'
import { EMPTY_LAYOUT, PAGES } from '../lib/config'
import { buildLabelMap, makeRef } from '../lib/refs'
import { migrateLegacy, newPageId, sortPages } from '../lib/workspace'
import { normalizeControls } from '../lib/pageControls'
import { computedFor, computedHeaders } from '../lib/computed'
import { stripUndefined } from '../lib/firestoreSafe'
import { Btn, Select, WorkspaceCtx, stableEqual } from './admin/ui.jsx'
import DataSourcesPanel from './admin/DataSourcesPanel.jsx'
import PagesPanel from './admin/PagesPanel.jsx'
import WidgetsPanel from './admin/WidgetsPanel.jsx'
import ControlsPanel from './admin/ControlsPanel.jsx'
import UsersPanel from './admin/UsersPanel.jsx'
import EntrancePanel from './admin/EntrancePanel.jsx'

const SECTIONS = [
  { key: 'sources', label: '🗄️ Data Sources', scope: 'workspace' },
  { key: 'pages', label: '📄 Pages', scope: 'workspace' },
  { key: 'widgets', label: '🧱 Widgets', scope: 'page' },
  // One section, not the old "Filters" + "Buttons" pair -- see
  // lib/pageControls.js for why that split was a modelling accident.
  { key: 'controls', label: '🎛️ Controls', scope: 'page' },
  { key: 'users', label: '👥 Users & Access', scope: 'workspace' },
  { key: 'entrance', label: '✨ Entrance', scope: 'workspace' },
]

/**
 * The admin panel.
 *
 * Two scopes, which is why the "Editing <page>" bar only appears for some
 * sections: data sources, pages and users belong to the WORKSPACE, while
 * widgets, filters and buttons belong to ONE page and are edited as a local
 * draft so a half-built widget is never pushed live mid-edit.
 */
export default function Admin() {
  const [sources, setSources] = useState([])
  const [pages, setPages] = useState([])
  const [pageId, setPageId] = useState('')
  const [section, setSection] = useState('sources')
  const [draft, setDraft] = useState(EMPTY_LAYOUT)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    const unsubSources = onSnapshot(collection(db, 'dataSources'), (snap) =>
      setSources(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubPages = onSnapshot(collection(db, 'dashboards'), (snap) =>
      setPages(sortPages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    )
    return () => {
      unsubSources()
      unsubPages()
    }
  }, [])

  const page = pages.find((p) => p.id === pageId) || null

  // Default to the first page once one exists, so opening "Widgets" doesn't
  // land on an empty picker with no explanation.
  useEffect(() => {
    if (!pageId && pages.length > 0) setPageId(pages[0].id)
  }, [pages, pageId])

  // Load the selected page's layout into an editable local draft.
  // The draft always holds the UNIFIED control list. A page saved before
  // filters and buttons were merged is stitched together on read; the stored
  // document is only rewritten when the admin actually publishes, so merely
  // opening a page never modifies it.
  const liveLayout = useMemo(
    () => ({
      widgets: page?.widgets || [],
      controls: normalizeControls(page),
      views: page?.views || [],
      hideSearch: !!page?.hideSearch,
    }),
    [page]
  )

  useEffect(() => {
    setDraft(liveLayout)
  }, [pageId, liveLayout])

  const dirty = useMemo(() => !stableEqual(draft, liveLayout), [draft, liveLayout])

  // --- Workspace-wide ref helpers ---------------------------------------
  // Labels are computed across EVERY connected tab, not just this page's, so
  // a tab keeps the same name in the widget picker and in Users & Access.
  const allRefs = useMemo(
    () => sources.flatMap((s) => (s.tabs || []).map((t) => makeRef(s.id, t))),
    [sources]
  )
  const labelByRef = useMemo(() => buildLabelMap(allRefs, sources), [allRefs, sources])
  const labelFor = useMemo(
    () => (ref) => labelByRef[ref] || String(ref || '').split('::').pop() || '',
    [labelByRef]
  )

  // Every column a tab offers -- including the calculated ones, because to
  // everything downstream of the source they are simply columns, and a
  // picker that could not offer one would make it useless.
  const tabHeaders = useMemo(() => {
    const out = {}
    for (const source of sources) {
      for (const [tab, headers] of Object.entries(source.tabHeaders || {})) {
        out[makeRef(source.id, tab)] = computedHeaders(headers, computedFor(source, tab))
      }
    }
    return out
  }, [sources])

  // Only the tabs THIS page's spreadsheets offer. Selecting a source for a
  // page is what makes its tabs appear here -- and the API enforces exactly
  // the same list, so this picker can't offer something that would be
  // refused at read time.
  const tabOptions = useMemo(() => {
    const ids = new Set(page?.sourceIds || [])
    return sources
      .filter((s) => ids.has(s.id))
      .flatMap((s) => (s.tabs || []).map((t) => ({ value: makeRef(s.id, t), label: labelFor(makeRef(s.id, t)) })))
  }, [sources, page, labelFor])

  const ctx = useMemo(
    () => ({ tabOptions, tabHeaders, sources, labelFor }),
    [tabOptions, tabHeaders, sources, labelFor]
  )

  // --- Writes ------------------------------------------------------------
  const saveSource = (source) => setDoc(doc(db, 'dataSources', source.id), stripUndefined(source), { merge: true })
  const deleteSource = (id) => deleteDoc(doc(db, 'dataSources', id))

  async function savePage(next) {
    const id = next.id || newPageId()
    await setDoc(doc(db, 'dashboards', id), stripUndefined({ ...next, id }), { merge: true })
    if (!next.id) setPageId(id)
  }

  async function deletePage(id) {
    await deleteDoc(doc(db, 'dashboards', id))
    if (pageId === id) setPageId('')
  }

  async function publishLayout() {
    if (!page) return
    // Publishing completes the merge: the legacy arrays are emptied so the
    // document has one source of truth rather than two that could drift.
    await setDoc(doc(db, 'dashboards', page.id), stripUndefined({ ...draft, filters: [], buttons: [] }), { merge: true })
    setSavedAt(new Date())
  }

  const setPart = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }))

  const activeSection = SECTIONS.find((s) => s.key === section)
  const needsPage = activeSection?.scope === 'page'

  return (
    <WorkspaceCtx.Provider value={ctx}>
      <div className="min-h-screen space-y-4 p-4 md:p-6">
        <Link
          to="/"
          title="Back to dashboard"
          className="fixed left-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-md backdrop-blur transition-all hover:scale-105 hover:border-slate-300 hover:shadow-lg active:scale-95"
        >
          <ArrowLeft size={16} />
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <div className="h-9 w-9 shrink-0" />
          <h1 className="text-xl font-semibold text-ink">⚙️ Admin Panel</h1>
          <p className="text-xs text-slate-400">
            {sources.length} spreadsheet{sources.length === 1 ? '' : 's'} · {pages.length} page
            {pages.length === 1 ? '' : 's'}
          </p>

          {needsPage && pages.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500">Editing</span>
              <Select
                value={pageId}
                onChange={setPageId}
                options={pages.map((p) => ({ value: p.id, label: `${p.icon || '📊'} ${p.name}` }))}
                className="w-56"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                section === s.key
                  ? 'bg-ink text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {needsPage && page && (
          <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
            <span className="text-xs text-slate-500">
              Editing <strong className="text-ink">{page.name}</strong>
            </span>
            {dirty ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                Unsaved changes
              </span>
            ) : (
              savedAt && <span className="text-[11px] text-emerald-600">Saved {savedAt.toLocaleTimeString()}</span>
            )}
            <div className="ml-auto flex gap-2">
              <Btn onClick={() => setDraft(liveLayout)} disabled={!dirty}>
                <Undo2 size={12} /> Discard
              </Btn>
              <Btn variant="primary" onClick={publishLayout} disabled={!dirty}>
                <Save size={12} /> Publish to dashboard
              </Btn>
            </div>
          </div>
        )}

        <div className="card">
          {section === 'sources' && (
            <>
              <DataSourcesPanel sources={sources} pages={pages} onSave={saveSource} onDelete={deleteSource} />
              <MigrationCard sources={sources} pages={pages} />
            </>
          )}

          {section === 'pages' && (
            <PagesPanel
              pages={pages}
              sources={sources}
              onSave={savePage}
              onDelete={deletePage}
              onOpen={(id) => {
                setPageId(id)
                setSection('widgets')
              }}
            />
          )}

          {needsPage && !page && (
            <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
              No page selected. Create one under “Pages” first.
            </p>
          )}

          {section === 'widgets' && page && (
            <WidgetsPanel
              tabs={tabOptions}
              tabHeaders={tabHeaders}
              widgets={draft.widgets || []}
              setWidgets={setPart('widgets')}
              // A filter panel arranges the page's existing controls, so the
              // widget editor has to know what they are.
              pageControls={draft.controls || []}
            />
          )}

          {section === 'controls' && page && (
            <ControlsPanel
              tabs={tabOptions}
              tabHeaders={tabHeaders}
              controls={draft.controls || []}
              setControls={setPart('controls')}
              views={draft.views || []}
              setViews={setPart('views')}
              hideSearch={!!draft.hideSearch}
              setHideSearch={(v) => setDraft((d) => ({ ...d, hideSearch: v }))}
            />
          )}

          {section === 'users' && <UsersPanel pages={pages} tabHeaders={tabHeaders} labelFor={labelFor} />}

          {section === 'entrance' && <EntrancePanel />}
        </div>
      </div>
    </WorkspaceCtx.Provider>
  )
}

/**
 * One-click upgrade from the v2 two-page setup.
 *
 * Deliberately additive: the old `sheetConfigs/*` and `layouts/*` documents
 * are left exactly where they are, so if the result looks wrong the fix is to
 * delete the new pages, not to restore a backup. Only offered while the
 * workspace is still empty, since running it twice would duplicate
 * everything.
 */
function MigrationCard({ sources, pages }) {
  const [state, setState] = useState({ status: 'idle', message: '' })

  if (sources.length > 0 || pages.length > 0) return null

  async function migrate() {
    setState({ status: 'working', message: 'Reading your existing setup…' })
    try {
      const configs = {}
      const layouts = {}
      for (const name of PAGES) {
        const [cfg, lay] = await Promise.all([
          getDoc(doc(db, 'sheetConfigs', name)),
          getDoc(doc(db, 'layouts', name)),
        ])
        if (cfg.exists()) configs[name] = cfg.data()
        if (lay.exists()) layouts[name] = lay.data()
      }

      if (Object.keys(configs).length === 0) {
        setState({ status: 'error', message: 'Nothing to migrate — no v2 configuration was found.' })
        return
      }

      const accessDocs = {}
      const accessSnap = await getDocs(collection(db, 'access'))
      accessSnap.forEach((d) => {
        accessDocs[d.id] = d.data()
      })

      const result = migrateLegacy(PAGES, configs, layouts, accessDocs)

      await Promise.all([
        ...result.sources.map((s) => setDoc(doc(db, 'dataSources', s.id), stripUndefined(s))),
        ...result.pages.map((p) => setDoc(doc(db, 'dashboards', p.id), stripUndefined(p))),
        ...result.accessPatches.map((a) => setDoc(doc(db, 'access', a.id), stripUndefined(a.data), { merge: true })),
      ])

      setState({
        status: 'done',
        message: `Migrated ${result.sources.length} spreadsheet(s) and ${result.pages.length} page(s). Your old documents were left untouched.`,
      })
    } catch (e) {
      setState({ status: 'error', message: e.message })
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <p className="mb-1 text-sm font-semibold text-indigo-900">Import your existing PREMIA / HERO setup</p>
      <p className="mb-3 text-xs text-indigo-700/80">
        This workspace is empty. If you were running the previous two-page version, this converts each page into a data
        source plus a dashboard page — widgets, filters, buttons and per-user grants included. Your old documents are
        left in place, so nothing is lost either way.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="accent" onClick={migrate} disabled={state.status === 'working'}>
          {state.status === 'working' ? 'Importing…' : 'Import previous setup'}
        </Btn>
        {state.message && (
          <span className={`text-xs ${state.status === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>
            {state.message}
          </span>
        )}
      </div>
    </div>
  )
}
