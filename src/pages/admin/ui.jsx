import { createContext, useContext } from 'react'
import { activeSection, sectionMark, visibleSections } from '../../lib/sectionTabs.js'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

// ---------------------------------------------------------------------
// Workspace context
// ---------------------------------------------------------------------
// Every picker in the admin panel offers TABS, but a tab is now addressed
// by an opaque ref ("<sourceId>::MASTER") that no human should ever be shown.
// Rather than thread a label resolver through five levels of editor props,
// the admin shell publishes it once here.
//
// `tabOptions` is the full list of refs the current page may use, already
// shaped as { value, label } for <Select>; `tabHeaders` is keyed by ref.
export const WorkspaceCtx = createContext({
  tabOptions: [],
  tabHeaders: {},
  sources: [],
  labelFor: (ref) => ref,
})

export function useWorkspaceCtx() {
  return useContext(WorkspaceCtx)
}

/** The value of an option that may be a bare string or a { value, label }. */
export const optValue = (o) => (typeof o === 'string' ? o : o?.value)

/**
 * Deep equality that ignores key ORDER.
 *
 * The "unsaved changes" checks compare an editable draft against the stored
 * document, and a plain `JSON.stringify` comparison fails there: Firestore
 * does not guarantee it returns fields in the order they were written, so a
 * document that came back from the server serialises differently to the
 * identical object built locally -- leaving Save permanently lit with nothing
 * actually changed.
 */
export function stableEqual(a, b) {
  return stableJson(a) === stableJson(b)
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
}

/**
 * Normalises a tab list to { value, label } options.
 *
 * Editors that restrict a picker to a single tab pass a bare ref array
 * (`tabs={[widget.tab]}`); this turns those into properly labelled options
 * so a condition row reads "MASTER · Premia Sales" and never a raw ref.
 */
export function toTabOptions(list, labelFor = (r) => r) {
  return (list || []).map((t) => (typeof t === 'string' ? { value: t, label: labelFor(t) } : t))
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-slate-400">{hint}</span>}
    </label>
  )
}

export function Select({ value, onChange, options, placeholder, disabled, className = '' }) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        return (
          <option key={val} value={val}>
            {label}
          </option>
        )
      })}
    </select>
  )
}

export function TextInput({ value, onChange, placeholder, type = 'text', className = '', disabled }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50 ${className}`}
    />
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Btn({ children, onClick, variant = 'ghost', className = '', disabled, title }) {
  const styles = {
    primary: 'bg-ink text-white hover:opacity-90',
    ghost: 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
    danger: 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50',
    accent: 'bg-indigo-600 text-white hover:bg-indigo-700',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

/** Reorder + delete controls shared by widget / filter / button rows. */
export function RowControls({ onUp, onDown, onDelete, isFirst, isLast }) {
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={onUp} disabled={isFirst} className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25" title="Move up">
        <ChevronUp size={14} />
      </button>
      <button onClick={onDown} disabled={isLast} className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25" title="Move down">
        <ChevronDown size={14} />
      </button>
      <button onClick={onDelete} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500" title="Delete">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

/** Small helpers for immutably editing an array held in the layout draft. */
export function listOps(list, setList) {
  return {
    update: (id, patch) => setList(list.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    remove: (id) => setList(list.filter((x) => x.id !== id)),
    add: (item) => setList([...list, item]),
    move: (index, delta) => {
      const next = [...list]
      const target = index + delta
      if (target < 0 || target >= next.length) return
      ;[next[index], next[target]] = [next[target], next[index]]
      setList(next)
    },
  }
}

/**
 * A row of buttons that pick which part of a long form is on screen.
 *
 * A widget has a setup, its own controls, a blend, a look and a couple of
 * behaviours. Stacked as five open sections that is a form nobody can see
 * the end of, and finding the one you came for means scrolling past four
 * you did not. As five buttons it is one line, and the section you want is
 * one click rather than one hunt.
 *
 * The catch with hiding things behind buttons is that a setting nobody can
 * see is a setting nobody remembers making -- so a section holding
 * something carries a MARK: a count where a count means something, a dot
 * where it does not. The row therefore says what is configured as well as
 * what exists, which the stack of open sections never did.
 */
export function SectionTabs({ sections, active, onPick, className = '' }) {
  const shown = visibleSections(sections)
  if (shown.length === 0) return null
  const here = activeSection(sections, active)

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map((s) => {
        const on = s.key === here
        const mark = sectionMark(s.badge)
        return (
          <button
            key={s.key}
            onClick={() => onPick(s.key)}
            title={s.hint || s.label}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              on
                ? 'bg-ink text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {s.label}
            {mark && (
              <span
                className={`rounded-full px-1 text-[9px] font-semibold leading-4 ${
                  on ? 'bg-white/25 text-white' : 'bg-indigo-50 text-indigo-600'
                }`}
              >
                {mark}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
