// ---------------------------------------------------------------------
// The small amount of Markdown a note needs
// ---------------------------------------------------------------------
// A dashboard that cannot be annotated is a dashboard that gets explained
// in a separate email. "These figures exclude the Nagpur branch until the
// 15th" is the most important sentence on some pages, and until now there
// was nowhere to put it.
//
// The obvious implementation -- take the admin's text, run it through a
// Markdown library, hand the HTML to `dangerouslySetInnerHTML` -- is the
// one thing this must not do. The text is written by an admin and read by
// everybody, so an admin who pasted something they did not write would be
// injecting script into every other user's session. There is no amount of
// sanitising that makes that a good trade for bold and bullet points.
//
// So this parses to a TREE OF TOKENS and React renders the tokens as real
// elements. Nothing is ever interpreted as HTML at any point, which means
// the worst an admin can do with a note is write a rude one.
//
// The grammar is deliberately tiny: headings, bullets, numbers, quotes,
// rules, and four inline marks. Everything left out was left out because a
// dashboard note that needs tables and footnotes is a document, and should
// live somewhere a document lives.

/** Only these schemes may become a link. */
const SAFE_SCHEME = /^(https?:\/\/|mailto:|\/)/i

/**
 * A URL, or null.
 *
 * `javascript:` is the reason this function exists; the allow-list is what
 * makes it safe rather than the blocklist that would have to keep up with
 * `JaVaScRiPt:`, `data:text/html`, and whatever is next.
 */
export function safeLinkUrl(url) {
  const s = String(url || '').trim()
  if (!s) return null
  return SAFE_SCHEME.test(s) ? s : null
}

// One expression for all four inline marks plus links, so a single pass
// over the line finds them in the order they occur. Alternation order
// matters: `**` has to be tried before `*`, or bold parses as two italics
// with nothing in between.
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\))/

/**
 * One line of text as a list of spans.
 *
 * Marks do not nest. `**bold *and italic* **` is a thing Markdown allows
 * and a thing nobody types into a dashboard caption, and supporting it
 * would mean a real parser rather than twenty lines -- so the inner mark
 * is left as literal text, which is at least visible and correctable.
 */
export function parseInline(text) {
  const out = []
  const parts = String(text ?? '').split(INLINE)

  for (const part of parts) {
    if (!part) continue

    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      out.push({ type: 'strong', text: part.slice(2, -2) })
    } else if (part.startsWith('~~') && part.endsWith('~~')) {
      out.push({ type: 'strike', text: part.slice(2, -2) })
    } else if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      out.push({ type: 'em', text: part.slice(1, -1) })
    } else if (part.startsWith('`') && part.endsWith('`')) {
      out.push({ type: 'code', text: part.slice(1, -1) })
    } else if (part.startsWith('[')) {
      const match = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      const href = match ? safeLinkUrl(match[2]) : null
      // A link to somewhere that is not allowed keeps its LABEL. Dropping
      // the whole thing would silently delete a sentence; showing the raw
      // markup would look like a bug the reader caused.
      if (match && href) out.push({ type: 'link', text: match[1], href })
      else if (match) out.push({ type: 'text', text: match[1] })
      else out.push({ type: 'text', text: part })
    } else {
      out.push({ type: 'text', text: part })
    }
  }

  return out.length ? out : [{ type: 'text', text: '' }]
}

const HEADING = /^(#{1,4})\s+(.*)$/
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^\s*(?:---+|___+|\*\*\*+)\s*$/
const CHECK = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/

/**
 * Text as a list of blocks.
 *
 * Consecutive list items fuse into one list, which is what makes a `<ul>`
 * possible; everything else is a block per line. Blank lines separate
 * paragraphs and are otherwise dropped, so the note reflows to the width
 * of whatever widget it lands in rather than keeping the admin's own line
 * breaks, which were about their textarea and not about the page.
 */
export function parseBlocks(source) {
  const lines = String(source ?? '').split(/\r?\n/)
  const blocks = []
  let paragraph = []
  let list = null

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'p', spans: parseInline(paragraph.join(' ')) })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push(list)
      list = null
    }
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    if (!line.trim()) {
      flushAll()
      continue
    }

    if (RULE.test(line)) {
      flushAll()
      blocks.push({ type: 'rule' })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      flushAll()
      blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2]) })
      continue
    }

    const quote = line.match(QUOTE)
    if (quote) {
      flushList()
      flushParagraph()
      blocks.push({ type: 'quote', spans: parseInline(quote[1]) })
      continue
    }

    // Checked before the plain bullet, because `- [ ] thing` is also a
    // valid bullet and would otherwise swallow the box.
    const check = line.match(CHECK)
    if (check) {
      flushParagraph()
      if (!list || list.ordered || !list.checklist) {
        flushList()
        list = { type: 'list', ordered: false, checklist: true, items: [] }
      }
      list.items.push({ spans: parseInline(check[2]), checked: check[1].toLowerCase() === 'x' })
      continue
    }

    const bullet = line.match(BULLET)
    if (bullet) {
      flushParagraph()
      if (!list || list.ordered || list.checklist) {
        flushList()
        list = { type: 'list', ordered: false, checklist: false, items: [] }
      }
      list.items.push({ spans: parseInline(bullet[1]) })
      continue
    }

    const numbered = line.match(NUMBERED)
    if (numbered) {
      flushParagraph()
      if (!list || !list.ordered) {
        flushList()
        list = { type: 'list', ordered: true, checklist: false, start: Number(numbered[1]) || 1, items: [] }
      }
      list.items.push({ spans: parseInline(numbered[2]) })
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flushAll()
  return blocks
}

/** Plain text, for a tooltip or a title attribute. */
export function plainText(source) {
  return String(source ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
