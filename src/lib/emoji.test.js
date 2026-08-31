import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EMOJI_COUNT, EMOJI_GROUPS } from './emojiData.js'
import {
  RECENT_LIMIT,
  SEARCH_LIMIT,
  emojiName,
  firstEmoji,
  graphemes,
  knownEmoji,
  looksLikeEmoji,
  rememberEmoji,
  searchEmoji,
} from './emoji.js'

const find = (q, n = 10) => searchEmoji(EMOJI_GROUPS, q, { limit: n }).map((e) => e.char)

// ---------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------

test('all of them are here, grouped the way Unicode groups them', () => {
  assert.ok(EMOJI_COUNT > 1800, `only ${EMOJI_COUNT}`)
  assert.equal(EMOJI_GROUPS.length, 9)
  assert.equal(
    EMOJI_GROUPS.reduce((n, g) => n + g.emoji.length, 0),
    EMOJI_COUNT,
    'the count is the count, not a number somebody typed'
  )
})

test('every group has a name and a picture to stand for it', () => {
  for (const g of EMOJI_GROUPS) {
    assert.ok(g.name && g.name.length < 12, `${g.name} is too long for a tab`)
    assert.ok(looksLikeEmoji(g.icon), g.name)
    assert.ok(g.emoji.length > 0, g.name)
  }
})

test('every entry is a picture, a name, a subgroup and its extra words', () => {
  for (const g of EMOJI_GROUPS) {
    for (const [char, name, subgroup, extra] of g.emoji) {
      assert.ok(looksLikeEmoji(char), `${g.name}: ${JSON.stringify(char)}`)
      assert.ok(name && subgroup !== undefined && extra !== undefined, char)
    }
  }
})

test('nothing is in the set twice', () => {
  const seen = new Set()
  for (const g of EMOJI_GROUPS) {
    for (const [char] of g.emoji) {
      assert.equal(seen.has(char), false, char)
      seen.add(char)
    }
  }
})

test('the skin-tone variants are left out', () => {
  // One emoji times five tones is five rows of the same picture, and this is
  // a picker for a widget icon rather than a chat composer.
  for (const g of EMOJI_GROUPS) {
    for (const [char, name] of g.emoji) {
      assert.equal(/skin tone/.test(name), false, char)
      assert.equal(/[\u{1F3FB}-\u{1F3FF}]/u.test(char), false, `${char} carries a tone modifier`)
    }
  }
})

// ---------------------------------------------------------------------
// Finding one
// ---------------------------------------------------------------------

test('a search finds the picture people are thinking of', () => {
  assert.ok(find('rocket').includes('🚀'))
  assert.ok(find('bird')[0] === '🐦')
  assert.ok(find('target').includes('🎯'))
  assert.ok(find('money').includes('💰'))
  assert.ok(find('chart').includes('📊'))
})

test('it searches what people CALL them, not only what Unicode does', () => {
  // Unicode's name for 🚗 is "automobile". A picker where searching "car"
  // returns a carrot is one nobody uses twice.
  assert.ok(find('car', 40).includes('🚗'))
  assert.equal(emojiName(EMOJI_GROUPS, '🚗'), 'automobile', 'and its own name really is that')
})

test('a proper noun is reachable in lower case', () => {
  // The names are lowercase EXCEPT the proper nouns, which is exactly the
  // set somebody searches for by typing a country.
  assert.ok(find('india').includes('🇮🇳'))
  assert.ok(find('japan').length > 0)
})

test('the subgroup is searched too, so a bird whose name never says so is found', () => {
  // "animal-bird" is Unicode's own grouping, and a decent thesaurus.
  assert.ok(find('bird', 30).includes('🦃'), 'a turkey is a bird')
})

test('every word has to match, not any', () => {
  // "red heart" should find the red heart, not every red thing followed by
  // every heart.
  const out = searchEmoji(EMOJI_GROUPS, 'red heart', { limit: 5 })
  assert.equal(out[0].char, '❤️')
  assert.ok(out.length < 5, `${out.length} matches for two specific words`)
})

test('a word is matched at its START, not anywhere inside it', () => {
  // "art" finding "heart", "dart" and "quarter" is the behaviour that makes
  // a search box feel broken.
  const out = find('art', 40)
  assert.equal(out.includes('❤️'), false, 'heart is not an art')
  assert.ok(out.includes('🎭'), 'performing arts is')
})

test('an exact word beats one that merely starts the same', () => {
  // "car" legitimately prefixes "cardio" and "carrot", so an unranked list
  // hands back a beating heart and a vegetable first -- which is
  // indistinguishable from not working.
  const out = find('car', 6)
  assert.equal(out.includes('💓'), false, 'a beating heart is not a car')
  assert.equal(out.includes('🥕'), false, 'nor is a carrot')
})

test('nothing typed is nothing found, not everything', () => {
  // And it RETURNS, rather than hanging: `indexOf('')` matches at every
  // position including the end, so a scan for an empty word never advances.
  assert.deepEqual(searchEmoji(EMOJI_GROUPS, ''), [])
  assert.deepEqual(searchEmoji(EMOJI_GROUPS, '   '), [])
  assert.deepEqual(searchEmoji(null, 'car'), [])
  assert.deepEqual(searchEmoji(EMOJI_GROUPS, 'zzzzqqq'), [])
})

test('a search stops at a screenful', () => {
  assert.ok(searchEmoji(EMOJI_GROUPS, 'face').length <= SEARCH_LIMIT)
  assert.equal(searchEmoji(EMOJI_GROUPS, 'face', { limit: 5 }).length, 5)
})

// ---------------------------------------------------------------------
// The ones you keep reaching for
// ---------------------------------------------------------------------

test('using one again moves it to the front rather than adding a copy', () => {
  assert.deepEqual(rememberEmoji(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
  assert.deepEqual(rememberEmoji(['a'], 'a'), ['a'])
  assert.deepEqual(rememberEmoji([], '🚗'), ['🚗'])
})

test('the list stays short enough to be a row', () => {
  const many = Array.from({ length: 50 }, (_, i) => `e${i}`)
  assert.equal(rememberEmoji(many, 'new').length, RECENT_LIMIT)
})

test('nothing chosen changes nothing', () => {
  assert.deepEqual(rememberEmoji(['a'], ''), ['a'])
  assert.deepEqual(rememberEmoji(undefined, ''), [])
})

test('a remembered emoji that no longer exists is dropped', () => {
  // Or it renders as tofu in the row that is meant to be the shortcut.
  assert.deepEqual(knownEmoji(EMOJI_GROUPS, ['🚗', 'not-an-emoji', '😀']), ['🚗', '😀'])
  assert.deepEqual(knownEmoji(EMOJI_GROUPS, null), [])
})

// ---------------------------------------------------------------------
// What lands in the box
// ---------------------------------------------------------------------

test('pasting a sentence keeps the picture and drops the words', () => {
  // Which is what happens when somebody copies out of a chat. A paragraph
  // where a 16px glyph belongs is not an icon.
  assert.equal(firstEmoji('hello 🚗 world'), '🚗')
  assert.equal(firstEmoji('  😀  '), '😀')
  assert.equal(firstEmoji('just words'), '')
  assert.equal(firstEmoji(''), '')
  assert.equal(firstEmoji(null), '')
})

test('an emoji is not a character, and is not cut in half', () => {
  // A flag is two regional indicators; a family is four people and three
  // joiners. `text[0]` on either is half a symbol.
  assert.equal(firstEmoji('🇮🇳 India'), '🇮🇳')
  assert.equal(firstEmoji('👨‍💻 at work'), '👨‍💻')
  assert.deepEqual(graphemes('a🇮🇳b'), ['a', '🇮🇳', 'b'])
})

test('a letter is not a picture, and a flag is', () => {
  assert.equal(looksLikeEmoji('A'), false)
  assert.equal(looksLikeEmoji('7'), false)
  assert.equal(looksLikeEmoji(''), false)
  assert.equal(looksLikeEmoji('🚗'), true)
  assert.equal(looksLikeEmoji('🇮🇳'), true, 'made of two letters that are not pictures themselves')
})

test('a name is looked up, not stored beside the value', () => {
  // An icon is one character in the document; putting its English name in
  // there too would be a second copy to fall out of step, and a column of
  // "grinning face" in everybody's Firestore.
  assert.equal(emojiName(EMOJI_GROUPS, '😀'), 'grinning face')
  assert.equal(emojiName(EMOJI_GROUPS, 'nope'), '')
  assert.equal(emojiName(EMOJI_GROUPS, ''), '')
})

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const picker = read('src/pages/admin/EmojiPicker.jsx')

test('the set is fetched only when a picker is opened', () => {
  // 146KB behind a dynamic import: a page that never opens one never
  // downloads it, which is every page except an admin's.
  assert.ok(picker.includes("import('../../lib/emojiData')"))
  assert.ok(!picker.includes("from '../../lib/emojiData'"), 'never a static import')
  assert.ok(picker.includes('if (!open || data) return'), 'and only the first time')
})

test('it is still a box you can paste into', () => {
  // Pasting one straight in has always worked, and somebody who knows which
  // emoji they want should not have to hunt for it in a grid.
  assert.ok(picker.includes('onChange={(e) => onChange(firstEmoji(e.target.value))}'))
})

test('every icon field in the app is one of these', () => {
  // Otherwise the picker is a feature on the widget somebody happened to
  // look at, and a text box everywhere else.
  const files = [
    'src/pages/admin/CanvasEditors.jsx',
    'src/pages/admin/ControlsPanel.jsx',
    'src/pages/admin/EntrancePanel.jsx',
    'src/pages/admin/FlowEditor.jsx',
    'src/pages/admin/PagesPanel.jsx',
    'src/pages/admin/WidgetEditors.jsx',
    'src/pages/admin/WidgetsPanel.jsx',
  ]
  let pickers = 0
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    pickers += (src.match(/<EmojiPicker/g) || []).length

    // No TextInput anywhere still holds an icon.
    const inputs = src.match(/<TextInput(?:(?!<TextInput)[\s\S])*?\/>/g) || []
    for (const tag of inputs) {
      assert.equal(/\bicon\b/.test(tag), false, `${f} still edits an icon in a text box`)
    }
  }
  assert.ok(pickers >= 13, `only ${pickers} pickers`)
})

test('the generated file says it is generated', () => {
  // The next regeneration silently reverts whatever was hand-edited into
  // it, so the file has to say so before somebody tries.
  const data = fs.readFileSync(path.join(ROOT, 'src/lib/emojiData.js'), 'utf8')
  assert.ok(data.includes('GENERATED'))
  assert.ok(data.includes('emoji-test.txt'), 'and names its source')
  assert.ok(data.includes('CLDR annotations'), 'and its second one')
})
