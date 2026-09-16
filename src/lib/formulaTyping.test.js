import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { checkFormula } from './conditionFormula.js'
import { explainFormula, formulaToRule } from './ruleBuilder.js'

// ---------------------------------------------------------------------
// Typing a formula at the speed of the keyboard
// ---------------------------------------------------------------------
// The box lagged badly, and the obvious suspect -- parsing the formula on
// every keystroke -- turned out to cost around a twentieth of a
// millisecond. The real cost was everything ELSE that happened per letter:
// the owning editor re-rendered, and the value dropdown beside the box
// rebuilt two hundred options.
//
// So one test keeps the per-keystroke thinking cheap, and the others keep
// the two re-render fixes in place.

const SRC = path.resolve(import.meta.dirname, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const COLUMNS = ['Model', 'Source', 'Scheduled For', 'Status', 'Amount', 'Invoice Date', 'Remarks', 'Reg No']
const FORMULA =
  'IF(STARTSWITH([Model], "VIDA"), IN([Source], "1ST FOLL", "2 FOLL", "3 FOLL"), IN([Source], "1ST FOLL", "2 FOLL", "3 FOLL", "4 FOLL", "5 FOLL"))'

test('everything the box works out per keystroke stays far inside one frame', () => {
  // Typed once, character by character -- every prefix is a keystroke, and
  // each one is checked, explained and read back as clicks.
  const prefixes = Array.from({ length: FORMULA.length }, (_, i) => FORMULA.slice(0, i + 1))
  const once = () => {
    for (const prefix of prefixes) {
      checkFormula(prefix, COLUMNS)
      explainFormula(prefix)
      formulaToRule(prefix)
    }
  }

  once() // warm, so this measures the work rather than the first compile
  const started = performance.now()
  once()
  const perKeystroke = (performance.now() - started) / prefixes.length

  // A frame is 16ms. This is generous by two orders of magnitude on the
  // machine that wrote it, and is here to catch a change that makes the
  // work grow with the length of the formula rather than to time a laptop.
  assert.ok(perKeystroke < 2, `${perKeystroke.toFixed(3)}ms per keystroke`)
})

test('the formula box waits for a real pause before telling the rest of the app', () => {
  const hook = read('hooks/useTypingBuffer.js')
  const quick = Number(hook.match(/TYPING_PAUSE = (\d+)/)[1])
  const slow = Number(hook.match(/SLOW_TYPING_PAUSE = (\d+)/)[1])
  // Longer than the gaps inside a word: at the default, thinking mid-formula
  // read as "finished" and re-rendered the whole widget editor, per letter.
  assert.ok(slow >= 400, `${slow}ms is not longer than a typist's pause`)
  assert.ok(slow > quick * 2)

  const input = read('pages/admin/FormulaInput.jsx')
  assert.ok(input.includes("useTypingBuffer(value || '', onChange, { pause: SLOW_TYPING_PAUSE })"))
  // Waiting longer is only safe because leaving the box commits it.
  assert.ok(input.includes('flush()'))
})

test('a column’s values are not rebuilt into a dropdown on every keystroke', () => {
  const builder = read('pages/admin/RuleBuilder.jsx')
  assert.ok(builder.includes('const options = useMemo(() => (Array.isArray(known) ? known.map((v) => String(v)) : []), [known])'))
  // Two of them: the single-value box and the chips.
  assert.equal(builder.split('const suggestions = useMemo(').length - 1, 2)
  assert.ok(builder.includes('const unpicked = useMemo('))
  // Every list there is lives inside one of those memos, and the boxes
  // render the kept element rather than building their own.
  assert.equal(builder.split('<datalist id={listId}>').length - 1, 2)
  assert.ok(builder.includes('{suggestions}'))
})
