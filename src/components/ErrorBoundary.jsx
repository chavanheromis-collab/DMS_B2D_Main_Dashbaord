import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * One widget failing must not take the page with it.
 *
 * A dashboard draws thirty-odd widget types over whatever a spreadsheet
 * happens to contain that morning: a column renamed, a date that is now the
 * word "pending", a chart configured against a tab somebody deleted. React's
 * default answer to a render error is to unmount the whole tree, so any one
 * of those turned the entire page white -- no widgets, no header, no
 * sidebar, no way back except the browser's own back button.
 *
 * That is the worst possible failure mode for a dashboard, because the
 * ONE widget that broke is invisible and the twenty-nine that are fine are
 * gone too.
 *
 * A boundary per widget turns that into a card that says which widget
 * failed. The rest of the page carries on, and an admin can open the one
 * that broke and fix it.
 *
 * A class, because there is still no hook for this -- `componentDidCatch`
 * has no functional equivalent.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  /**
   * A changed `resetKey` clears the error.
   *
   * Without it, fixing the widget in the editor leaves its card stuck on the
   * error it threw a minute ago -- the config is right, the data is right,
   * and the only way to see it is a full reload. Derived rather than an
   * effect so the recovery happens in the same render as the new props.
   */
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey }
    return null
  }

  componentDidCatch(error, info) {
    // Swallowed silently, this is a card that says "something went wrong"
    // and a developer with nothing to go on. The console is where they will
    // look first.
    console.error(`[${this.props.label || 'widget'}] render failed`, error, info?.componentStack)
    this.props.onError?.(error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) return this.props.fallback(error, () => this.setState({ error: null }))

    return (
      <div className="card flex h-full min-h-[120px] flex-col items-start justify-center gap-1.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-rose-600">
          <AlertTriangle size={14} />
          {this.props.label || 'This widget'} could not be drawn
        </p>
        {/* The message, not the stack. An admin reading "Cannot read
            properties of undefined" can often tell which setting is empty;
            forty lines of minified frames tell nobody anything. */}
        <p className="text-[11px] leading-snug text-slate-500">{String(error?.message || error).slice(0, 200)}</p>
        <p className="text-[10px] text-slate-400">
          The rest of the page is unaffected. Check this widget’s columns and conditions.
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
        >
          <RotateCcw size={11} /> Try again
        </button>
      </div>
    )
  }
}

/**
 * The same, for a whole page.
 *
 * A widget boundary cannot catch a failure in the page's own scaffolding --
 * the layout, the control bar, the header -- and that failure is the one
 * that produces the white screen. This one at least leaves something on it.
 */
export function PageErrorBoundary({ children }) {
  return (
    <ErrorBoundary
      label="This page"
      fallback={(error, retry) => (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle size={28} className="text-rose-500" />
          <p className="text-base font-semibold text-slate-800">This page could not be drawn</p>
          <p className="max-w-md text-xs leading-relaxed text-slate-500">
            {String(error?.message || error).slice(0, 300)}
          </p>
          <div className="flex gap-2">
            <button
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw size={12} /> Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
