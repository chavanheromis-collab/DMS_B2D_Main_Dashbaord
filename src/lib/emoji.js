// ---------------------------------------------------------------------
// Picking an icon
// ---------------------------------------------------------------------
// Every icon in this app -- a widget's, a page's, a stage's, a KPI's, a
// flow branch's, a saved view's -- was a text box with an emoji as its
// placeholder. Which meant that using one required already knowing which
// one you wanted, finding it somewhere else, and pasting it in. In practice
// that means everybody uses the placeholder, and a workspace of forty
// widgets is forty identical 📊.
//
// So the whole set is here (lib/emojiData.js, generated from Unicode's own
// list) and this file is the part that makes 1,898 of anything usable: a
// search that matches how people actually describe a picture, and a memory
// of the ones this person keeps reaching for.
//
// Pure: a list and a query in, a list out. No React, no storage.

/** More than a screenful is a scroll bar, not a result. */
export const SEARCH_LIMIT = 120

/** How many of your own to keep on the top row. */
export const RECENT_LIMIT = 24

/**
 * The emoji matching every word of the query, best first.
 *
 * Every word, not any: "red car" should find the red car and not every red
 * thing followed by every car.
 *
 * Matched as PREFIXES of words rather than anywhere in the string, because
 * "art" finding "heart", "dart" and "quarter" is the behaviour that makes a
 * search box feel broken.
 *
 * And RANKED, because matching is not enough. "car" legitimately prefixes
 * "cardio" and "carrot", so a purely positional list hands back a beating
 * heart and a vegetable before the car -- which is indistinguishable from
 * not working. A word that IS the query beats a word that merely starts
 * with it, and the name beats the keywords.
 */
export function searchEmoji(groups, query, { limit = SEARCH_LIMIT } = {}) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    // Not cosmetic. `indexOf('')` matches at every position INCLUDING the
    // end, and `indexOf('', length + 1)` keeps returning `length` -- so a
    // scan for an empty word never advances and the page hangs. Splitting
    // "  a  " yields two empty strings, which is how one would get here.
    .filter(Boolean)
  if (words.length === 0) return []

  const hits = []
  for (const group of groups || []) {
    for (const entry of group.emoji || []) {
      const [char, name, subgroup, extra] = entry
      // Lowercased, or "India" is unreachable from "india" -- the names are
      // lowercase except the proper nouns, which is exactly the set somebody
      // searches for by typing a country.
      //
      // The subgroup goes in as it comes: `face-smiling` needs no
      // unhyphenating, because the word test below counts anything that is
      // not a letter or a digit as a break.
      const title = name.toLowerCase()
      const rest = `${subgroup || ''} ${extra || ''}`.toLowerCase()

      let score = 0
      let all = true
      for (const word of words) {
        const inTitle = wordScore(title, word)
        const inRest = wordScore(rest, word)
        if (!inTitle && !inRest) {
          all = false
          break
        }
        // The name is what the thing IS; a keyword is what it is also
        // called. Doubling the title keeps "bird" ahead of "birdie".
        score += Math.max(inTitle * 2, inRest)
      }
      if (all) hits.push({ char, name, group: group.name, score })
    }
  }

  // Stable within a score, so the Unicode ordering -- which is a considered
  // ordering, not an accident -- survives wherever the score cannot choose.
  return hits
    .map((hit, i) => ({ hit, i }))
    .sort((a, b) => b.hit.score - a.hit.score || a.i - b.i)
    .slice(0, limit)
    .map(({ hit }) => ({ char: hit.char, name: hit.name, group: hit.group }))
}

/** 2 for a whole word, 1 for a word starting with it, 0 for neither. */
function wordScore(text, prefix) {
  let best = 0
  let at = text.indexOf(prefix)
  while (at !== -1) {
    const startsWord = at === 0 || !/[a-z0-9]/.test(text[at - 1])
    if (startsWord) {
      const after = text[at + prefix.length]
      if (after === undefined || !/[a-z0-9]/.test(after)) return 2
      best = 1
    }
    at = text.indexOf(prefix, at + 1)
  }
  return best
}

/**
 * The recently used list, with `char` moved to the front.
 *
 * Moved rather than added, so reaching for the same one twice does not fill
 * the row with copies of it -- and so the order is genuinely "how recently",
 * which is the only thing that makes a short list worth having.
 */
export function rememberEmoji(list, char, { limit = RECENT_LIMIT } = {}) {
  if (!char) return list || []
  return [char, ...(list || []).filter((c) => c !== char)].slice(0, limit)
}

/** Only the entries still in the set, so a stale one cannot render as tofu. */
export function knownEmoji(groups, chars) {
  const known = new Set()
  for (const group of groups || []) for (const [char] of group.emoji || []) known.add(char)
  return (chars || []).filter((c) => known.has(c))
}

/**
 * The name of one emoji, for a tooltip.
 *
 * Looked up rather than stored beside the value: an icon is one character
 * in the document, and putting its English name in there too would be a
 * second copy to fall out of step and a column of "grinning face" in
 * everybody's Firestore.
 */
export function emojiName(groups, char) {
  if (!char) return ''
  for (const group of groups || []) {
    for (const [c, name] of group.emoji || []) if (c === char) return name
  }
  return ''
}

/**
 * The first emoji in some text, or ''.
 *
 * An icon field holds ONE picture. Pasting a whole line into it -- which is
 * what happens when somebody copies from a chat -- should take the picture
 * and leave the sentence, rather than rendering a paragraph where a 16px
 * glyph belongs.
 *
 * `Intl.Segmenter` because an emoji is not a character: a flag is two
 * regional indicators, a family is four people and three joiners, and
 * `text[0]` on any of them is half a symbol.
 */
export function firstEmoji(text) {
  const value = String(text ?? '').trim()
  if (!value) return ''

  for (const piece of graphemes(value)) {
    if (looksLikeEmoji(piece)) return piece
  }
  return ''
}

/** Grapheme clusters, or a rough split where Intl.Segmenter is missing. */
export function graphemes(text) {
  const value = String(text ?? '')
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (s) => s.segment)
  }
  // Array.from splits on code POINTS, which keeps surrogate pairs together
  // and breaks joined sequences apart. Worse than the real thing and better
  // than cutting a surrogate in half.
  return Array.from(value)
}

/**
 * Whether one grapheme is a picture rather than a letter.
 *
 * `\p{Extended_Pictographic}` covers the emoji proper, and then two whole
 * families that are not pictographic at all:
 *
 *   FLAGS are two regional indicators -- letters, by Unicode's reckoning --
 *   and a flag is the icon people most want for a branch.
 *
 *   KEYCAPS are an ordinary `#`, `*` or digit with a combining enclosing
 *   keycap after it. A circled 1 for a first stage is exactly the sort of
 *   thing somebody reaches for, and every character in it is one this
 *   function would otherwise call a letter.
 */
export function looksLikeEmoji(piece) {
  if (!piece) return false
  return (
    /\p{Extended_Pictographic}/u.test(piece) ||
    /[\u{1F1E6}-\u{1F1FF}]/u.test(piece) ||
    /⃣/.test(piece)
  )
}
