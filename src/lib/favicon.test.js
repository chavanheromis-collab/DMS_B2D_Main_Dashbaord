import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { STATIC_FAVICON, applyFavicon, faviconHref, faviconSource } from './favicon.js'
import { BASE_TITLE } from './notify.js'

// ---------------------------------------------------------------------
// The tab: its name and its icon
// ---------------------------------------------------------------------
// Both are held in two places, and both break the same way -- the markup
// says one thing, something in the app says another, and the tab renames
// itself a second after it opens.

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const app = fs
  .readFileSync(path.join(ROOT, 'src', 'App.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/\s+/g, ' ')

test('the tab is named the same thing by the markup and by the app', () => {
  // index.html is what a cold tab shows; BASE_TITLE is what the message
  // centre writes over it the moment it mounts. Two strings would mean
  // the tab renaming itself a beat after it opens.
  assert.match(html, /<title>Chavan Dealer Dashboard<\/title>/)
  assert.equal(BASE_TITLE, 'Chavan Dealer Dashboard')
})

test('the page ships with an icon at all', () => {
  // A default globe is not a cosmetic gap. In a row of fifteen narrowed
  // tabs it is the one identifying mark, missing.
  assert.match(html, /<link rel="icon" type="image\/png" href="\/favicon\.png" \/>/)
  assert.match(html, /rel="apple-touch-icon"/)
  assert.equal(STATIC_FAVICON, '/favicon.png')
})

test('a dashboard with its own logo wears it on the tab', () => {
  // Set once for the entrance, and the tab agrees without anybody
  // maintaining a second copy of the same file.
  assert.equal(faviconHref({ logoUrl: 'https://example.com/cus.png' }), 'https://example.com/cus.png')
})

test('a Drive link is turned into one a browser can actually draw', () => {
  // The link everybody has to hand is a VIEWER page, which serves HTML to
  // an <img> tag and silently shows nothing.
  const href = faviconHref({ logoUrl: 'https://drive.google.com/file/d/1DwTJabcdefghij/view?usp=sharing' })
  assert.ok(href.includes('1DwTJabcdefghij'), href)
  assert.equal(href.includes('/view'), false)
})

test('anything that is not plainly an image location is dropped', () => {
  // It is admin-entered text going into the document head.
  assert.equal(faviconHref({ logoUrl: 'javascript:alert(1)' }), STATIC_FAVICON)
  assert.equal(faviconHref({ logoUrl: 'https://example.com/a").png' }), STATIC_FAVICON)
  assert.equal(faviconHref({}), STATIC_FAVICON)
  assert.equal(faviconHref(null), STATIC_FAVICON)
})

test('the bundled file covers the wait, so no tab sits blank', () => {
  // The entrance document arrives from Firestore a moment after the page
  // does, and until it has there is still a tab on screen.
  assert.equal(faviconHref(undefined), STATIC_FAVICON)
  assert.equal(faviconHref({ logoUrl: '' }, '/other.png'), '/other.png')
})

// --- putting it on the page ---------------------------------------------

/** Barely a DOM: enough to prove which element gets written to. */
function fakeDoc() {
  const links = []
  const make = () => {
    const attrs = {}
    return {
      rel: '',
      setAttribute: (k, v) => {
        attrs[k] = v
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      get href() {
        return attrs.href
      },
      writes: () => Object.keys(attrs).length,
    }
  }
  return {
    links,
    head: { appendChild: (el) => links.push(el) },
    createElement: make,
    querySelector: (sel) => (sel.includes('icon') ? links[0] || null : null),
  }
}

test('the icon link is reused, never added a second time', () => {
  // Two icon links leave the browser choosing between them, and which one
  // wins differs by browser -- a tab icon that depends on who is looking.
  const doc = fakeDoc()
  applyFavicon('/a.png', doc)
  applyFavicon('/b.png', doc)
  applyFavicon('/c.png', doc)
  assert.equal(doc.links.length, 1)
  assert.equal(doc.links[0].getAttribute('href'), '/c.png')
})

test('setting the same icon again writes nothing', () => {
  // Re-setting href makes some browsers re-fetch and blink the tab, which
  // on a re-render is a flicker with no cause on screen.
  const doc = fakeDoc()
  applyFavicon('/a.png', doc)
  const link = doc.links[0]
  const before = link.writes()
  applyFavicon('/a.png', doc)
  assert.equal(link.writes(), before)
})

test('it does nothing at all without a document, or without an icon', () => {
  // It runs in an effect, and an effect that throws takes the app with it.
  assert.equal(applyFavicon('/a.png', null), null)
  assert.equal(applyFavicon('', fakeDoc()), null)
})

test('the app re-runs it when the dashboard changes, and not otherwise', () => {
  // Each dashboard has its own brand: coming back to a different one's
  // icon would read as landing in the wrong account.
  assert.ok(app.includes('applyFavicon(faviconHref(entrance))'))
  assert.ok(app.includes('}, [entrance?.faviconUrl, entrance?.mainLogoUrl, entrance?.logoUrl])'))
})

// ---------------------------------------------------------------------
// Which of the three
// ---------------------------------------------------------------------
// The icon is its own setting rather than the logo reused, because the
// two are drawn at 96 pixels and at 16 and almost no logo survives both.

const panel = fs
  .readFileSync(path.join(ROOT, 'src', 'pages', 'admin', 'EntrancePanel.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/\s+/g, ' ')

test('the icon an admin chose beats the logo', () => {
  const entrance = { faviconUrl: 'https://example.com/mark.png', logoUrl: 'https://example.com/lockup.png' }
  assert.equal(faviconHref(entrance), 'https://example.com/mark.png')
  assert.equal(faviconSource(entrance), 'chosen')
})

test('...and without one, a logo is still better than a globe', () => {
  const entrance = { logoUrl: 'https://example.com/lockup.png' }
  assert.equal(faviconHref(entrance), 'https://example.com/lockup.png')
  assert.equal(faviconSource(entrance), 'logo')
  assert.equal(faviconSource({ faviconUrl: '', logoUrl: 'https://example.com/l.png' }), 'logo')
})

test('...and of the two logos it is the main one, the mark led with', () => {
  const both = { mainLogoUrl: 'https://example.com/group.png', logoUrl: 'https://example.com/division.png' }
  assert.equal(faviconHref(both), 'https://example.com/group.png')
  assert.equal(faviconSource(both), 'logo')
  // Either alone still answers.
  assert.equal(faviconHref({ mainLogoUrl: 'https://example.com/group.png' }), 'https://example.com/group.png')
  assert.equal(faviconSource({ mainLogoUrl: 'https://example.com/group.png' }), 'logo')
})

test('a link that will not serve an image is reported as what the tab will really show', () => {
  // "I pasted something and nothing happened" has to be answerable on the
  // screen where it was pasted.
  const junk = { faviconUrl: 'javascript:alert(1)', logoUrl: 'https://example.com/l.png' }
  assert.equal(faviconSource(junk), 'logo')
  assert.equal(faviconHref(junk), 'https://example.com/l.png')
  assert.equal(faviconSource({ faviconUrl: 'not a url' }), 'default')
  assert.equal(faviconSource({}), 'default')
  assert.equal(faviconSource(null), 'default')
})

test('a Drive link works for the icon as it does for the logo', () => {
  const href = faviconHref({ faviconUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKl/view?usp=sharing' })
  assert.ok(href.includes('1AbCdEfGhIjKl'), href)
  assert.equal(href.includes('/view'), false)
})

test('the field is on the entrance document, so each dashboard has its own', () => {
  const branding = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'branding.js'), 'utf8')
  assert.match(branding, /faviconUrl: ''/)
})

test('the admin sets it next to the logo, and is shown the tab at real size', () => {
  // An icon is chosen by looking at a 400px image and drawn at sixteen. A
  // preview scaled to fit a panel answers the wrong question.
  assert.ok(panel.includes('onChange={(v) => set({ faviconUrl: v })}'))
  assert.ok(panel.includes('<TabPreview entrance={draft} />'))
  assert.ok(panel.includes('size={16}'))
  assert.ok(panel.includes('{BASE_TITLE}'))
  // ...and told which image is in play.
  assert.ok(panel.includes('const source = faviconSource(entrance)'))
  assert.ok(panel.includes('Tab shows {said}'))
})

test('the tab follows either field changing', () => {
  // Watching only one leaves an admin who clears the icon looking at the
  // one they just removed.
  assert.ok(app.includes('}, [entrance?.faviconUrl, entrance?.mainLogoUrl, entrance?.logoUrl])'))
})
