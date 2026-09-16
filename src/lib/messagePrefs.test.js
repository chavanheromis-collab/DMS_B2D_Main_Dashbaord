import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TONE, MESSAGING_PREFS, TONE_CHOICES, TONES, defaultToneOf, isTone } from './messages.js'

// ---------------------------------------------------------------------
// What YOUR messages start as
// ---------------------------------------------------------------------
// The four buttons say what you are asking of the reader, and most people
// mean the same one nearly every time: a workshop that only ever posts
// notices, a manager whose every message is a question. Choosing it again
// on each message is a tax on the people who use this most, and the ones
// who forget send questions nobody knows are questions.

const SRC = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(SRC, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('unset, a message starts as the mildest one that can still be chosen', () => {
  assert.equal(defaultToneOf(null), DEFAULT_TONE)
  assert.equal(defaultToneOf({}), DEFAULT_TONE)
  // Which is no longer a quiet one: with "can be ignored" removed, every
  // new message covers the reader's page until they close it.
  assert.equal(DEFAULT_TONE, 'seen')
  assert.equal(TONE_CHOICES[0].value, DEFAULT_TONE)
})

test('set, it is what this person said', () => {
  for (const t of TONE_CHOICES) assert.equal(defaultToneOf({ defaultTone: t.value }), t.value)
})

test('a retired tone cannot be somebody’s default', () => {
  // Pinned before it was removed, it would otherwise be a setting they can
  // neither see nor change.
  const retired = TONES.find((t) => t.retired)
  assert.ok(retired, 'the old tone is still known, for messages already sent')
  assert.equal(defaultToneOf({ defaultTone: retired.value }), DEFAULT_TONE)
  assert.equal(isTone(retired.value), false)
})

test('a tone this build does not know is not obeyed', () => {
  // A stored value from a future version, or edited by hand: it must fall
  // back rather than become a message nothing can render.
  assert.equal(defaultToneOf({ defaultTone: 'siren' }), DEFAULT_TONE)
  assert.equal(defaultToneOf({ defaultTone: '' }), DEFAULT_TONE)
  assert.equal(defaultToneOf({ defaultTone: 5 }), DEFAULT_TONE)
  assert.equal(isTone('ask'), true)
  assert.equal(isTone('siren'), false)
})

test('it is kept where a person may already write their own settings', () => {
  // userPrefs/{uid}_messaging: the same collection and the same rule as a
  // widget order or a sticky note, so this needs no new permission.
  assert.equal(MESSAGING_PREFS, 'messaging')
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
  const block = rules.slice(rules.indexOf('match /userPrefs/'), rules.indexOf('match /messages/'))
  assert.ok(block.includes("allow write: if isSignedIn() && prefId.matches(request.auth.uid + '_.*')"))
  assert.ok(`u_ravi_${MESSAGING_PREFS}`.startsWith('u_ravi_'), 'the id must begin with the owner')
})

// --- wiring -----------------------------------------------------------------

test('the preference is one document, read live and written as itself', () => {
  const hook = read('hooks/useMessages.js')
  assert.ok(hook.includes('export function useMessagePrefs()'))
  assert.ok(hook.includes('const id = uid ? `${uid}_${MESSAGING_PREFS}` : null'))
  assert.ok(hook.includes("setDoc(doc(db, 'userPrefs', id), { defaultTone: tone }, { merge: true })"))
  // Merge, so saving a tone cannot wipe anything else kept for this person.
  assert.ok(hook.includes('if (!id || !isTone(tone)) return'))
  assert.ok(hook.includes('return { defaultTone: defaultToneOf(prefs), setDefaultTone }'))
})

test('the composer starts there, returns there, and offers to be told', () => {
  const chat = read('components/Conversations.jsx')
  assert.ok(chat.includes('const { defaultTone, setDefaultTone } = useMessagePrefs()'))
  assert.ok(chat.includes('const [tone, setTone] = useState(defaultTone)'))
  // After sending, and when opening another chat.
  assert.ok(chat.includes('setText(\'\') setTone(defaultTone)'))
  assert.ok(chat.includes('useEffect(() => { setTone(defaultTone) }, [id, defaultTone])'))
  // The pin, only when the choice is not already the default.
  assert.ok(chat.includes('{tone !== defaultTone && onDefaultTone && ('))
  assert.ok(chat.includes('onClick={() => onDefaultTone(tone)}'))
  // Nothing now starts from the app's own default here.
  assert.equal(chat.includes('DEFAULT_TONE'), false)
})

test('a row sent from a table asks for the same thing', () => {
  const dialog = read('components/ShareRowDialog.jsx')
  assert.ok(dialog.includes('const { defaultTone } = useMessagePrefs()'))
  assert.ok(dialog.includes('const [tone, setTone] = useState(defaultTone)'))
  assert.equal(dialog.includes('DEFAULT_TONE'), false)
})

test('the app-wide default is imported only where it is still used', () => {
  // It stays the fallback inside the model; the message centre had been
  // importing it and using it nowhere.
  assert.equal(read('components/MessageCenter.jsx').includes('DEFAULT_TONE'), false)
})
