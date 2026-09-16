import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, BookOpen, CheckCircle2, CircleDashed, Sigma, Wand2 } from 'lucide-react'

import {
  FORMULA_STARTERS,
  applyFix,
  applySuggestion,
  checkFormula,
  signatureParts,
  suggestionsAt,
} from '../../lib/conditionFormula'
import { FUNCTIONS, functionHelp } from '../../lib/formula'
import { SLOW_TYPING_PAUSE, useTypingBuffer } from '../../hooks/useTypingBuffer'
import { useLocalState } from '../../hooks/usePageData'
import { explainFormula, formulaToRule } from '../../lib/ruleBuilder'
import RuleBuilder from './RuleBuilder.jsx'

// ---------------------------------------------------------------------
// Writing a condition as a formula
// ---------------------------------------------------------------------
// A formula box is where people give up. Not because the language is
// hard -- it is the spreadsheet language they already know -- but because
// a box says nothing back: the column name typed from memory with the
// space in the wrong place, the IF whose "else" landed in the "then", the
// function that is called DAYSSINCE and not DAYSAGO. Each is found out a
// week later from a number that looks plausible.
//
// So this box talks back, as it is typed:
//
//   IT OFFERS THE NEXT WORD. Columns after a "[", functions and columns
//   on a bare word, with the keyboard. Nobody has to remember how a
//   column is spelt, or what a function is called.
//
//   IT SAYS WHERE YOU ARE. Inside IF( it shows IF(test, then, else) with
//   the argument being written picked out, so the order is never a guess.
//
//   IT SAYS WHETHER IT IS RIGHT -- in words, with the fix. "There is no
//   column called [Stauts]" is half the help; a button that makes it
//   [Status] is the other half.
//
// The checking is lib/conditionFormula.js, and it is the same parser the
// dashboard runs. A second implementation would eventually disagree, and
// the disagreement would be found by somebody trusting the wrong one.

const BORDER = {
  empty: 'border-slate-200 focus:border-violet-400',
  ok: 'border-emerald-300 focus:border-emerald-400',
  warning: 'border-amber-300 focus:border-amber-400',
  error: 'border-rose-300 bg-rose-50/30 focus:border-rose-400',
}

export default function FormulaInput({
  value,
  onChange,
  columns = [],
  // (column) => every value that column holds, so a rule is built by
  // picking values rather than spelling them. Absent, the boxes are typed.
  valuesOf = null,
  className = '',
  placeholder = 'AND([Status] = "Delivered", [Amount] > 0)',
}) {
  // The same buffer every other text box in the admin panel uses: a
  // condition's owner is a whole page editor, and re-rendering it on every
  // letter is how a formula box comes to lag behind the typing.
  // And it waits longer than an ordinary box before doing so: a condition
  // is not previewed live anywhere, its owner is a whole widget editor,
  // and a formula is typed with thinking in the middle of it -- which the
  // ordinary pause read as "finished" over and over. See
  // hooks/useTypingBuffer.js.
  const [text, onType, flush] = useTypingBuffer(value || '', onChange, { pause: SLOW_TYPING_PAUSE })

  const ref = useRef(null)
  const pendingCursor = useRef(null)
  const [cursor, setCursor] = useState(null)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const [help, setHelp] = useState(false)

  const suggest = useMemo(
    () => suggestionsAt(text, cursor ?? text.length, columns),
    [text, cursor, columns]
  )
  const check = useMemo(() => checkFormula(text, columns), [text, columns])

  // Clicks, or a formula. Remembered per browser -- somebody who writes
  // formulas should not have to say so on every condition -- but a formula
  // the clicks cannot fully show is never opened as clicks.
  const [preferred, setPreferred] = useLocalState('dash.formulaMode', 'build')
  const readable = useMemo(() => formulaToRule(text) !== null, [text])
  const building = preferred === 'build'
  const words = useMemo(
    () => (check.state === 'ok' || check.state === 'warning' ? explainFormula(text) : ''),
    [check.state, text]
  )
  const open = focused && !dismissed && suggest.items.length > 0

  // A new list starts at its top, rather than on whatever row the last
  // list happened to be highlighting.
  useEffect(() => {
    setActive(0)
  }, [suggest.replaceFrom, suggest.items.length])

  // After a suggestion, a fix or a starter rewrites the text, the cursor
  // goes where the writing continues -- not to the end of the box, which
  // is where a controlled textarea otherwise leaves it.
  useEffect(() => {
    if (pendingCursor.current === null || !ref.current) return
    const at = pendingCursor.current
    pendingCursor.current = null
    ref.current.focus()
    ref.current.setSelectionRange(at, at)
    setCursor(at)
  })

  const trackCursor = () => setCursor(ref.current ? ref.current.selectionStart : null)

  function write(next, at) {
    onType(next)
    pendingCursor.current = at
    setDismissed(false)
  }

  function accept(item) {
    if (!item) return
    const { text: next, cursor: at } = applySuggestion(text, item, suggest)
    write(next, at)
  }

  function insertAtCursor(snippet) {
    const at = ref.current ? ref.current.selectionStart : text.length
    write(text.slice(0, at) + snippet + text.slice(at), at + snippet.length)
  }

  function onKeyDown(e) {
    if (!open) return
    const count = suggest.items.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % count)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + count) % count)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      accept(suggest.items[Math.min(active, count - 1)])
    } else if (e.key === 'Escape') {
      // Escape closes the list and nothing else -- it must not throw away
      // a formula somebody has half written.
      e.preventDefault()
      setDismissed(true)
    }
  }

  const signature = suggest.signature ? signatureParts(suggest.signature.hint, suggest.signature.argIndex) : null
  const lines = Math.min(4, Math.max(1, Math.ceil(text.length / 64)))

  return (
    <div className={`relative min-w-[260px] flex-1 ${className}`}>
      <ModeSwitch building={building} onPick={setPreferred} />

      {building ? (
        readable ? (
          <div className="ml-5">
            <RuleBuilder value={text} onChange={onType} columns={columns} valuesOf={valuesOf} />
          </div>
        ) : (
          <div className="ml-5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
            This formula does more than the clicks can show, so it stays a formula.{' '}
            <button type="button" onClick={() => setPreferred('write')} className="font-medium underline">
              Show the formula
            </button>{' '}
            or{' '}
            <button type="button" onClick={() => onType('')} className="font-medium underline">
              clear it and build a new one with clicks
            </button>
            .
          </div>
        )
      ) : (
      <>
      <div className="flex items-start gap-1.5">
        <Sigma size={13} className="mt-1.5 shrink-0 text-violet-500" aria-hidden />
        <textarea
          ref={ref}
          value={text}
          rows={lines}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => {
            onType(e.target.value)
            setCursor(e.target.selectionStart)
            setDismissed(false)
          }}
          onKeyDown={onKeyDown}
          onKeyUp={trackCursor}
          onClick={trackCursor}
          onSelect={trackCursor}
          onFocus={() => {
            setFocused(true)
            trackCursor()
          }}
          onBlur={() => {
            setFocused(false)
            flush()
          }}
          aria-label="Condition formula"
          aria-autocomplete="list"
          aria-expanded={open}
          className={`w-full resize-y rounded-lg border px-2 py-1.5 font-mono text-[11px] leading-snug outline-none ${
            BORDER[check.state] || BORDER.empty
          }`}
        />
      </div>

      {/* --- the next word ------------------------------------------------ */}
      {open && (
        <ul
          role="listbox"
          className="absolute left-5 right-0 z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
        >
          {suggest.items.map((item, i) => (
            <li key={`${item.kind}-${item.label}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown rather than click: the textarea's blur fires
                // before a click lands, closes this list, and the click
                // then hits nothing at all.
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(item)
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 px-2 py-1 text-left ${
                  i === active ? 'bg-violet-50' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`shrink-0 rounded px-1 text-[9px] font-bold uppercase ${
                    item.kind === 'function' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'
                  }`}
                >
                  {item.kind === 'function' ? 'ƒ' : 'col'}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-800">{item.label}</span>
                {item.kind === 'function' && (
                  <span className="min-w-0 truncate text-[10px] text-slate-400">{item.detail}</span>
                )}
              </button>
            </li>
          ))}
          <li className="mt-0.5 border-t border-slate-100 px-2 pt-1 text-[9px] text-slate-400">
            ↑ ↓ to choose · Enter or Tab to insert · Esc to close
          </li>
        </ul>
      )}

      {/* --- where you are ------------------------------------------------ */}
      {signature && signature.name && (
        <p className="ml-5 mt-1 font-mono text-[10px] text-slate-500">
          <span className="font-semibold text-violet-700">{signature.name}</span>(
          {signature.args.map((arg, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <span className={i === signature.current ? 'rounded bg-violet-100 px-0.5 font-bold text-violet-800' : ''}>
                {arg}
              </span>
            </span>
          ))}
          )
          {signature.note && <span className="ml-1.5 font-sans text-slate-400">— {signature.note}</span>}
        </p>
      )}
      </>
      )}

      {/* --- whether it is right ------------------------------------------ */}
      <div className="ml-5 mt-1 flex flex-wrap items-center gap-1.5">
        <CheckLine check={check} />
        {!building && check.fixes.map((fix) => (
          <button
            key={`${fix.kind}-${fix.from}`}
            type="button"
            onClick={() => {
              const next = applyFix(text, fix)
              write(next, next.length)
            }}
            className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px font-mono text-[10px] text-emerald-700 hover:bg-emerald-100"
          >
            {/* A misspelling is a question; a mended shape -- NOT() around
                a call, TRUE as IF's last part -- is said as what it does. */}
            {fix.prompt ? fix.prompt : <>did you mean {fix.label}?</>}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setHelp((h) => !h)}
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-indigo-600 underline"
        >
          <BookOpen size={10} /> {help ? 'hide help' : 'what can I write?'}
        </button>
      </div>

      {/* --- what it means ------------------------------------------------ */}
      {/* Read back in plain words, from the same parse the dashboard runs:
          the one check anybody can make, whether or not they could have
          written the formula themselves. */}
      {words && (
        <p className="ml-5 mt-1 text-[11px] leading-snug text-slate-600">
          <span className="font-semibold text-slate-400">In words: </span>
          {words}
        </p>
      )}

      {/* --- somewhere to start ------------------------------------------- */}
      {!building && check.state === 'empty' && (
        <div className="ml-5 mt-1 flex flex-wrap gap-1">
          {FORMULA_STARTERS.map((starter) => (
            <button
              key={starter.id}
              type="button"
              onClick={() => {
                const next = starter.build(columns)
                write(next, next.length)
              }}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
            >
              <Wand2 size={9} /> {starter.label}
            </button>
          ))}
        </div>
      )}

      {help && <FormulaHelp columns={columns} onInsert={insertAtCursor} />}
    </div>
  )
}

/**
 * Clicks or a formula.
 *
 * One condition either way: the clicks write a formula, and a formula the
 * clicks can read opens as clicks, so switching loses nothing. Clicks are
 * for anybody; the formula is for what clicks cannot say.
 */
function ModeSwitch({ building, onPick }) {
  const pill = (on) =>
    `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
      on ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-violet-50 hover:text-violet-700'
    }`
  return (
    <div
      role="tablist"
      aria-label="How to write this condition"
      className="mb-1 ml-5 inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5"
    >
      <button type="button" role="tab" aria-selected={building} onClick={() => onPick('build')} className={pill(building)}>
        <Wand2 size={10} /> Build with clicks
      </button>
      <button type="button" role="tab" aria-selected={!building} onClick={() => onPick('write')} className={pill(!building)}>
        <Sigma size={10} /> Write a formula
      </button>
    </div>
  )
}

/** The verdict, in one line, coloured by how much it matters. */
function CheckLine({ check }) {
  const look = {
    empty: { Icon: CircleDashed, tone: 'text-slate-400' },
    ok: { Icon: CheckCircle2, tone: 'text-emerald-600' },
    warning: { Icon: AlertTriangle, tone: 'text-amber-600' },
    error: { Icon: AlertCircle, tone: 'text-rose-600' },
  }[check.state] || { Icon: CircleDashed, tone: 'text-slate-400' }

  return (
    <span className={`inline-flex items-start gap-1 text-[10px] leading-snug ${look.tone}`} role="status">
      <look.Icon size={11} className="mt-px shrink-0" aria-hidden />
      <span>{check.message}</span>
    </span>
  )
}

/**
 * What the language can say, where it is being written.
 *
 * Every entry inserts itself at the cursor. The whole-table functions are
 * left out rather than listed and then refused: offering TOTAL() here and
 * calling it an error the moment it is chosen would be the help panel
 * contradicting the check line under it.
 */
function FormulaHelp({ columns, onInsert }) {
  const groups = functionHelp()
    .map(({ group, items }) => ({ group, items: items.filter((item) => !FUNCTIONS[item.name]?.agg) }))
    .filter(({ items }) => items.length > 0)

  return (
    <div className="ml-5 mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2">
      <p className="text-[11px] leading-snug text-slate-600">
        Write it like a spreadsheet, and make it come out <strong>yes or no</strong> for each row.{' '}
        <code className="rounded bg-white px-1">[Column Name]</code> is a column,{' '}
        <code className="rounded bg-white px-1">"text"</code> is a value, and{' '}
        <code className="rounded bg-white px-1">=</code> compares without caring about capitals.
      </p>

      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Comparing</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {['=', '<>', '>', '>=', '<', '<=', 'AND', 'OR', '&'].map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => onInsert(` ${op} `)}
            className="rounded border border-slate-200 bg-white px-1.5 font-mono text-[10px] text-slate-600 hover:bg-violet-50 hover:text-violet-700"
          >
            {op}
          </button>
        ))}
      </div>

      {columns.length > 0 && (
        <>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">This tab’s columns</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {columns.slice(0, 60).map((column) => (
              <button
                key={column}
                type="button"
                onClick={() => onInsert(`[${column}]`)}
                className="rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-600 hover:bg-sky-50 hover:text-sky-700"
              >
                {column}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
            {items.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => onInsert(`${item.name}(`)}
                title={item.hint}
                className="block w-full truncate rounded px-1 text-left font-mono text-[10px] text-slate-600 hover:bg-violet-50 hover:text-violet-700"
              >
                {item.hint}
              </button>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-snug text-slate-400">
        TOTAL, RANK, SHAREOF and the other whole-table measures are not here: a condition is asked one row at a
        time. Build that measure as a calculated column on the data source, then compare against it.
      </p>
    </div>
  )
}
