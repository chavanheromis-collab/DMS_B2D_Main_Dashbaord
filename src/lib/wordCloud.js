// ---------------------------------------------------------------------
// Word cloud -- what a free-text column is actually full of
// ---------------------------------------------------------------------
// Every sheet has one column nothing can chart: Remarks, Feedback, Reason
// for loss. It holds the most specific information in the file and no
// widget in the app can touch it, because it has as many distinct values
// as it has rows and grouping by it produces four hundred bars of one.
//
// Counting WORDS instead of cells is what makes it tractable. "Waiting for
// finance approval" and "finance not approved yet" are two distinct values
// and one recurring theme, and the theme is the thing worth seeing.
//
// This is a reading aid, not a measurement -- which is why it is honest
// about its limits:
//
//   - The stop-word list is visible and editable, because every business
//     has its own noise words and a hidden list is a hidden edit.
//   - Sizes are square-rooted, not linear. A word appearing 400 times is
//     not twenty times more important than one appearing 20 times, and
//     drawing it twenty times the height makes everything else unreadable.
//   - Counts come with the words. A cloud where the numbers are hidden is
//     a cloud that can be argued with and not checked.

import { isBlank } from './dataUtils.js'

/**
 * The words that carry no meaning on their own.
 *
 * Deliberately conservative: articles, pronouns, auxiliaries, prepositions.
 * Nothing domain-specific, because a list that quietly drops "delay" or
 * "finance" would be editing the finding rather than cleaning the input.
 */
export const DEFAULT_STOPWORDS = [
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its',
  'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'too', 'was', 'we', 'were', 'what', 'when',
  'which', 'who', 'will', 'with', 'would', 'you', 'your', 'na', 'nil', 'none', 'yes',
]

export const WORD_MODES = [
  { value: 'word', label: 'Single words' },
  { value: 'bigram', label: 'Pairs of words (“finance approval”)' },
  { value: 'phrase', label: 'The whole cell, as one phrase' },
]

export const WORD_LAYOUTS = [
  { value: 'flow', label: 'Flowing — centred, biggest first', hint: 'Reads like a cloud. Never overlaps.' },
  { value: 'ranked', label: 'Ranked list — word, bar and count', hint: 'Countable. Best when the numbers matter.' },
]

export const DEFAULT_WORDCLOUD = {
  column: '',
  mode: 'word',
  limit: 40,
  minLength: 3,
  minCount: 1,
  stopwords: DEFAULT_STOPWORDS.join(', '),
  useStopwords: true,
  layout: 'flow',
  minSize: 12,
  maxSize: 40,
  palette: 'default',
  color: '#4F46E5',
  // Colour by rank rather than at random. A random colour per word is
  // decoration that implies a grouping which does not exist; shading by
  // frequency at least says something true.
  colorMode: 'rank',
  caseSensitive: false,
}

const SPLIT = /[^\p{L}\p{N}'’-]+/u

/** A cell split into the tokens a cloud counts. */
export function tokenize(value, { mode = 'word', caseSensitive = false } = {}) {
  if (isBlank(value)) return []
  const text = String(value).trim()
  if (mode === 'phrase') return [caseSensitive ? text : text.toLowerCase()]

  const words = text
    .split(SPLIT)
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ''))
    .filter(Boolean)
    .map((w) => (caseSensitive ? w : w.toLowerCase()))

  if (mode !== 'bigram') return words
  const pairs = []
  for (let i = 0; i < words.length - 1; i += 1) pairs.push(`${words[i]} ${words[i + 1]}`)
  return pairs
}

/** The stop-word list as a Set, from the comma-separated string an admin typed. */
export function stopwordSet(text) {
  return new Set(
    String(text ?? '')
      .split(/[,\n]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * Word counts, and the rows each word came from.
 *
 * Keeping the rows is what lets a click on a word filter the page to the
 * cells that contain it -- without them a cloud is a picture you cannot
 * interrogate, which is half of what makes clouds untrustworthy.
 *
 * A word is credited to a row ONCE however many times it appears in that
 * cell. Otherwise a single ranting remark outvotes forty terse ones, and
 * the cloud describes one customer rather than the column.
 */
export function wordCounts(rows, config) {
  const c = { ...DEFAULT_WORDCLOUD, ...(config || {}) }
  if (!c.column) return []

  const stop = c.useStopwords ? stopwordSet(c.stopwords) : new Set()
  const minLength = Math.max(1, Math.round(Number(c.minLength) || 1))
  const counts = new Map()

  for (const row of rows || []) {
    const seen = new Set()
    for (const token of tokenize(row[c.column], c)) {
      if (token.length < minLength) continue
      if (stop.has(token)) continue
      // A bare number is almost never a theme -- it is an order id or an
      // amount that belongs in a different chart.
      if (/^\d+$/.test(token)) continue
      if (seen.has(token)) continue
      seen.add(token)

      const bucket = counts.get(token)
      if (bucket) {
        bucket.count += 1
        bucket.rows.push(row)
      } else {
        counts.set(token, { text: token, count: 1, rows: [row] })
      }
    }
  }

  const minCount = Math.max(1, Math.round(Number(c.minCount) || 1))
  return [...counts.values()]
    .filter((w) => w.count >= minCount)
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
}

/**
 * Counts turned into type sizes.
 *
 * The square root is the point. Font size is perceived by AREA, so a
 * linear map on the height squares the apparent difference -- twice as
 * common looks four times as loud, and the top word swamps the card. The
 * root cancels that out, which is the same reason bubble charts size by
 * area rather than radius.
 */
export function sizedWords(words, config) {
  const c = { ...DEFAULT_WORDCLOUD, ...(config || {}) }
  const limit = Math.max(1, Math.min(200, Math.round(Number(c.limit) || 40)))
  const shown = words.slice(0, limit)
  if (shown.length === 0) return []

  const min = Math.max(8, Number(c.minSize) || 12)
  const max = Math.max(min + 2, Number(c.maxSize) || 40)

  const counts = shown.map((w) => w.count)
  const lo = Math.min(...counts)
  const hi = Math.max(...counts)
  const rootLo = Math.sqrt(lo)
  const rootHi = Math.sqrt(hi)
  const spread = rootHi - rootLo || 1

  return shown.map((word, index) => {
    const t = (Math.sqrt(word.count) - rootLo) / spread
    return {
      ...word,
      index,
      rank: index + 1,
      size: Math.round(min + t * (max - min)),
      // 0 → 1 across the cloud, for shading. Independent of the size so a
      // palette change never silently rescales the type.
      weight: t,
      share: hi > 0 ? word.count / hi : 0,
    }
  })
}

/**
 * A deterministic order that puts the big words in the middle.
 *
 * Real cloud packers solve a collision problem and need a canvas to
 * measure against; this instead interleaves the ranked list outwards from
 * the centre, so the heaviest words land centrally and the tail spreads to
 * the edges. Laid out by the browser's own line-breaking, it can never
 * overlap -- which is the failure mode that makes most word clouds
 * unreadable.
 *
 * Deterministic, so the cloud does not reshuffle itself on every render
 * and make the reader think the data changed.
 */
export function cloudOrder(words) {
  const left = []
  const right = []
  words.forEach((word, i) => {
    if (i % 2 === 0) right.push(word)
    else left.unshift(word)
  })
  return [...left, ...right]
}

/** Everything the widget needs. */
export function wordCloudData(widget, { rows = [] } = {}) {
  const config = { ...DEFAULT_WORDCLOUD, ...(widget || {}) }
  if (!config.column) return { ready: false, words: [], laidOut: [], total: 0, distinct: 0 }

  const counted = wordCounts(rows, config)
  const words = sizedWords(counted, config)

  return {
    ready: true,
    words,
    laidOut: config.layout === 'ranked' ? words : cloudOrder(words),
    distinct: counted.length,
    hidden: Math.max(0, counted.length - words.length),
    total: counted.reduce((a, w) => a + w.count, 0),
    filled: (rows || []).filter((r) => !isBlank(r[config.column])).length,
  }
}
