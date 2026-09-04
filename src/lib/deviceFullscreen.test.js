import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  FULLSCREEN_EVENTS,
  exitFullscreen,
  fullscreenElement,
  fullscreenHost,
  fullscreenSupported,
  requestFullscreen,
  stillFullscreen,
} from './deviceFullscreen.js'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/** A browser, as much of one as this needs. */
function fakeBrowser({ prefix = '', enabled = true, granted = true } = {}) {
  const calls = []
  const name = (base) => (prefix ? prefix + base[0].toUpperCase() + base.slice(1) : base)

  const doc = { body: { tag: 'body' }, documentElement: {} }
  if (enabled !== null) doc[name('fullscreenEnabled')] = enabled
  doc[name('fullscreenElement')] = null
  doc[name('exitFullscreen')] = () => {
    calls.push('exit')
    doc[name('fullscreenElement')] = null
    return Promise.resolve()
  }

  const element = { tag: 'div' }
  element[name('requestFullscreen')] = () => {
    calls.push('request')
    if (!granted) return Promise.reject(new Error('denied'))
    doc[name('fullscreenElement')] = element
    return Promise.resolve()
  }

  doc.documentElement[name('requestFullscreen')] = element[name('requestFullscreen')]
  return { doc, element, calls }
}

// --- where the overlay is mounted ---------------------------------------

test('the overlay is hung off the page, not off the widget', () => {
  // Out of the widget so nothing in it can become the containing block; no
  // further than the page, because that is where the design lives.
  const page = { tag: 'page-canvas' }
  const node = { closest: (sel) => (sel === '.page-canvas' ? page : null) }
  assert.equal(fullscreenHost(node, { body: { tag: 'body' } }), page)
})

test('...and off the body when there is no page above it', () => {
  const body = { tag: 'body' }
  assert.equal(fullscreenHost({ closest: () => null }, { body }), body)
  assert.equal(fullscreenHost(null, { body }), body)
  // No document at all -- a test, a server render -- is null, not a throw.
  assert.equal(fullscreenHost(null, null), null)
})

// --- asking for the screen ----------------------------------------------

test('the screen is asked for, and by its unprefixed name where there is one', async () => {
  const { doc, element, calls } = fakeBrowser()
  assert.equal(await requestFullscreen(element, doc), true)
  assert.deepEqual(calls, ['request'])
  assert.equal(fullscreenElement(doc), element)
})

test('Safari is asked in its own dialect', async () => {
  // Prefixed all four names for years, and still fires only its own event.
  const { doc, element, calls } = fakeBrowser({ prefix: 'webkit' })
  assert.equal(fullscreenSupported(doc, element), true)
  assert.equal(await requestFullscreen(element, doc), true)
  assert.deepEqual(calls, ['request'])
  assert.equal(fullscreenElement(doc), element)
  // And asked to give it back in the same dialect. Missing this one is the
  // worse half: the reader would be stuck on a screen with no way off it.
  assert.equal(await exitFullscreen(doc, element), true)
  assert.deepEqual(calls, ['request', 'exit'])
  assert.equal(fullscreenElement(doc), null)
  assert.ok(FULLSCREEN_EVENTS.includes('webkitfullscreenchange'))
  assert.ok(FULLSCREEN_EVENTS.includes('fullscreenchange'))
})

test('a browser that refuses is an answer, not an exception', async () => {
  // An iPhone has the method and rejects the promise. The overlay is drawn
  // either way, so the only wrong behaviour here is throwing.
  const { doc, element } = fakeBrowser({ granted: false })
  assert.equal(await requestFullscreen(element, doc), false)
})

test('an iframe with no permission is not even asked', async () => {
  // `fullscreenEnabled` is false there, and asking anyway throws.
  const { doc, element, calls } = fakeBrowser({ enabled: false })
  assert.equal(fullscreenSupported(doc, element), false)
  assert.equal(await requestFullscreen(element, doc), false)
  assert.deepEqual(calls, [])
})

test('a browser with no fullscreen at all is handled without a branch anywhere else', async () => {
  const doc = { body: {}, documentElement: {} }
  assert.equal(fullscreenSupported(doc, {}), false)
  assert.equal(await requestFullscreen({}, doc), false)
  assert.equal(await exitFullscreen(doc), false)
  assert.equal(fullscreenElement(doc), null)
  assert.equal(await requestFullscreen(null, doc), false)
})

test('a method that throws where it should reject is still just false', async () => {
  const doc = { body: {}, documentElement: {}, fullscreenEnabled: true }
  const element = {
    requestFullscreen: () => {
      throw new TypeError('not allowed')
    },
  }
  assert.equal(await requestFullscreen(element, doc), false)
})

// --- giving it back ------------------------------------------------------

test('the screen is given back on the way out', async () => {
  const { doc, element, calls } = fakeBrowser()
  await requestFullscreen(element, doc)
  assert.equal(await exitFullscreen(doc, element), true)
  assert.deepEqual(calls, ['request', 'exit'])
  assert.equal(fullscreenElement(doc), null)
})

test('somebody else’s fullscreen is left alone', async () => {
  // A video or a slide deck holding the screen is not ours to close, and
  // calling exit when nothing holds it throws.
  const { doc, element, calls } = fakeBrowser()
  doc.fullscreenElement = { tag: 'someone-elses-video' }
  assert.equal(await exitFullscreen(doc, element), false)
  assert.deepEqual(calls, [])

  // And exiting when NOTHING is fullscreen is not a no-op in the browser,
  // it throws -- so it must not be reached, with or without an element to
  // check against.
  const idle = fakeBrowser()
  assert.equal(await exitFullscreen(idle.doc, idle.element), false)
  assert.equal(await exitFullscreen(idle.doc), false)
  assert.deepEqual(idle.calls, [])
})

// --- leaving by a route we do not control -------------------------------

test('Esc and F11 are noticed, so the widget does not stay in a layout with no way out', async () => {
  const { doc, element } = fakeBrowser()
  await requestFullscreen(element, doc)
  assert.equal(stillFullscreen(doc, element), true)
  // The browser's own exit: nothing calls us, the element simply clears.
  doc.fullscreenElement = null
  assert.equal(stillFullscreen(doc, element), false)
})

test('a nested element still counts as ours', () => {
  const element = { tag: 'overlay' }
  const outer = { tag: 'outer', contains: (n) => n === element }
  assert.equal(stillFullscreen({ fullscreenElement: outer }, element), true)
  assert.equal(stillFullscreen({ fullscreenElement: { contains: () => false } }, element), false)
})

// --- the wiring ----------------------------------------------------------

test('the flow overlay is portalled out of the widget', () => {
  // `position: fixed` is viewport-relative only while no ancestor has a
  // transform, a filter or a backdrop-filter -- and the widget sits inside
  // a `.card`, which has `backdrop-filter: blur(10px)`. Inside that subtree
  // "fullscreen" means "as big as the card".
  const flow = read('components/widgets/FlowWidget.jsx')
  assert.ok(flow.includes('createPortal('), 'the overlay is still inside the widget')
  assert.ok(flow.includes('fullscreenHost(rootRef.current)'), 'the host is not worked out from the page')
  assert.ok(flow.includes('host || document.body'), 'no host and the portal has nowhere to go')

  const css = read('index.css')
  assert.match(css, /\.card \{[^}]*backdrop-filter/s, 'the containing-block hazard has moved; check this still holds')
})

test('the host is captured while the card is still in the page', () => {
  // A moment later it has moved into the portal, and `closest` answers
  // about the portal instead.
  const flow = read('components/widgets/FlowWidget.jsx')
  const at = flow.indexOf('const toggleFullscreen')
  assert.ok(at >= 0, 'the toggle no longer captures anything')
  const body = flow.slice(at, flow.indexOf('\n  }, [])', at))
  assert.match(body, /if \(!on\) setHost/, 'the host is captured on the way out as well as in')
})

test('the browser is asked for the device screen, not just the viewport', () => {
  const flow = read('components/widgets/FlowWidget.jsx')
  assert.ok(flow.includes('requestFullscreen(element)'), 'nothing asks for the screen')
  assert.ok(flow.includes('exitFullscreen(document, screenRef.current)'), 'the screen is never given back')
  assert.ok(flow.includes('stillFullscreen(document, element)'), 'leaving by Esc leaves the widget stuck')
  for (const name of ['fullscreenchange', 'webkitfullscreenchange']) {
    assert.ok(flow.includes('FULLSCREEN_EVENTS'), `${name} is not listened for`)
  }
})

test('full screen still means the whole of it', () => {
  // The guard from when this was an overlay: no padding, no max width, and
  // now no viewport-height unit that a phone's address bar can eat.
  const flow = read('components/widgets/FlowWidget.jsx')
  assert.ok(flow.includes('className="fixed inset-0 z-[60] flex flex-col bg-white"'))
  assert.ok(flow.includes("height: '100dvh'"), 'a phone would cut the bottom off')
  // The overlay's own markup only -- there are legitimate widths further
  // down the file, on the breadcrumb.
  const at = flow.indexOf('createPortal(')
  const overlay = flow.slice(at, flow.indexOf('document.body', at))
  assert.ok(!/max-w|maxWidth|padding|p-\d/.test(overlay), 'full screen stops short of the edges')
})
