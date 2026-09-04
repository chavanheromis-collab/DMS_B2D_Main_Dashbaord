import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { CHROME_TOGGLES, chromeClass, chromeIsTrimmed } from './widgetChrome.js'
import { previewHeight } from './editLayout.js'

const SRC = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const widgetFiles = fs
  .readdirSync(path.join(SRC, 'components/widgets'))
  .filter((f) => f.endsWith('.jsx'))

// --- what a card shows ---------------------------------------------------

test('a widget nobody has touched shows everything, as it always has', () => {
  assert.equal(chromeClass(undefined), '')
  assert.equal(chromeClass({}), '')
  assert.equal(chromeClass({ title: 'Sales' }), '')
  assert.equal(chromeIsTrimmed({}), false)
})

test('each of the three is its own switch', () => {
  assert.equal(chromeClass({ hideTitle: true }), 'chrome-no-title')
  assert.equal(chromeClass({ hideIcon: true }), 'chrome-no-icon')
  assert.equal(chromeClass({ hideCaption: true }), 'chrome-no-caption')
  assert.equal(
    chromeClass({ hideTitle: true, hideIcon: true, hideCaption: true }),
    'chrome-no-title chrome-no-icon chrome-no-caption'
  )
  assert.equal(chromeIsTrimmed({ hideCaption: true }), true)
})

test('every switch the editor offers is one the card can act on', () => {
  const css = read('index.css')
  for (const toggle of CHROME_TOGGLES) {
    assert.ok(toggle.label && toggle.hint, `${toggle.field} has no label or hint`)
    const cls = chromeClass({ [toggle.field]: true })
    assert.ok(cls, `${toggle.field} switches nothing on`)
    assert.ok(css.includes(`.${cls} `), `${cls} is emitted and no rule reads it`)
  }
})

// --- and the parts it hides exist to be hidden ---------------------------

test('every widget that draws an icon marks it, or the switch misses that one', () => {
  // The bug this shape of test exists for: a rule that works on eighteen
  // cards and silently does nothing on the nineteenth.
  const missing = []
  for (const file of widgetFiles) {
    const text = read(`components/widgets/${file}`)
    // From the `<h2`, not from the class: slicing at the attribute leaves
    // a string with no opening tag in it, and every pattern below then
    // matches nothing -- which is how this test passed while six shells
    // drew an icon no rule could reach.
    let at = text.indexOf('<h2 className="widget-title')
    while (at >= 0) {
      // The icon, where there is one, is the first thing inside the heading.
      const heading = text.slice(at, text.indexOf('</h2>', at))
      const bare = heading.includes('widget-icon')
      // A heading with no icon at all is fine -- the filter panel has none.
      // Three ways one gets there: a literal emoji, the shell's `{icon}`
      // prop, and the note widget's `{widget.icon}`. Missing the second is
      // how this test passed while six shells drew an unreachable icon.
      const hasEmoji = /<h2[^>]*>\s*(\{icon\}|\{widget\.icon|[^\s<{A-Za-z])/.test(heading)
      if (!bare && hasEmoji) missing.push(`${file}: ${heading.slice(0, 60)}`)
      at = text.indexOf('<h2 className="widget-title', at + 1)
    }
  }
  assert.deepEqual(missing, [], 'an icon no rule can reach')
})

test('every header caption is marked, or the switch misses that one', () => {
  // Counted rather than spot-checked: the captions live in fourteen files
  // and the one that gets missed is the one nobody looks at.
  const tagged = widgetFiles.reduce(
    (n, file) => n + (read(`components/widgets/${file}`).match(/widget-caption/g) || []).length,
    0
  )
  assert.ok(tagged >= 14, `only ${tagged} captions are reachable`)
})

test('the rule hides the space as well as the words', () => {
  // `visibility: hidden` would leave the gap, and the point of turning a
  // title off is to get the room back.
  const css = read('index.css')
  const at = css.indexOf('.chrome-no-title .widget-title')
  const rule = css.slice(at, css.indexOf('}', at))
  assert.match(rule, /display: none/)
})

test('an emptied heading loses its band, not just its words', () => {
  // The heading row is STICKY, with the card's surface behind it, a blur,
  // and a padded strip pulled out to the card's edges so content scrolls
  // under it. Hiding the words left all of that: a blurred strip across the
  // top of a card with nothing written on it.
  const css = read('index.css')
  const at = css.indexOf('.widget-sized.chrome-no-title.chrome-no-caption')
  assert.ok(at >= 0, 'the band survives an emptied heading')
  const rule = css.slice(at, css.indexOf('}', at))

  // Every property the band is made of has to come off, or it comes back
  // as a stripe, a shadow line or an unexplained gap.
  for (const off of [/position: static/, /margin: 0/, /padding: 0/, /background-color: transparent/, /backdrop-filter: none/]) {
    assert.match(rule, off, `the band keeps part of itself: ${off}`)
  }
})

test('...but a heading holding a button keeps it, and so does the button', () => {
  // A heading row very often holds the export button, a live count or a
  // search box. A card that swallowed its own download button would be a
  // worse bug than the one this fixes.
  const css = read('index.css')
  const at = css.indexOf('.widget-sized.chrome-no-title.chrome-no-caption')
  const selector = css.slice(at, css.indexOf('{', at))
  assert.match(selector, /:not\(:has\(button, input, select, a\)\)/, 'a heading with a button loses its band')

  // And a heading with a caption still showing is not empty either.
  assert.match(selector, /:not\(:has\(\.widget-caption\)\)/, 'a card with only its title hidden loses the band')

  // Neutralised rather than removed, so anything else in there keeps its
  // place and an empty row collapses on its own.
  const rule = css.slice(at, css.indexOf('}', at))
  assert.ok(!/display:\s*none/.test(rule), 'the row is removed, taking whatever is left with it')
})

test('the trim reaches the page and the preview from one place', () => {
  const dashboard = read('pages/Dashboard.jsx')
  assert.ok(dashboard.includes('${chromeClass(\n                        widget\n                      )}'), 'the class is never applied')
  // On the wrapper inside `content`, so the edit preview shows the same
  // trim the page will -- rather than on the canvas, which the preview
  // does not go through.
  assert.ok(dashboard.includes('rise-in group/widget relative widget-sized'))
})

test('the admin can find it where they change how a widget looks', () => {
  const editor = read('pages/admin/StyleEditor.jsx')
  // The RENDERED list, not merely the name: the hint line below the
  // switches maps the same constant, so looking for `CHROME_TOGGLES.map`
  // finds that one and proves nothing about the switches themselves.
  // Inside the map over the real list. The hint line below the switches
  // maps the same constant and the switch markup survives an emptied list,
  // so either half checked alone proves nothing.
  const at = editor.indexOf('{CHROME_TOGGLES.map((t) => (')
  assert.ok(at >= 0, 'the switches are not driven by the list')
  const rendered = editor.slice(at, editor.indexOf('))}', at))
  assert.ok(rendered.includes('checked={Boolean(widget[t.field])}'), 'the switches are not offered')
  assert.ok(rendered.includes('set({ [t.field]: v })'), 'the switches write nothing')
  // And the section says it holds something, or a setting turned off is a
  // setting nobody remembers making.
  const panel = read('pages/admin/WidgetsPanel.jsx')
  assert.ok(panel.includes('chromeIsTrimmed(widget)'), 'the Look tab does not mark a trimmed card')
})

// --- the widget fills the box it was dragged to --------------------------

test('a widget on the canvas fills the height it was given', () => {
  // The bug: `fillHeight` was true only when an admin had TYPED a height.
  // Since the layout became drag-to-resize it is the box that says how big
  // a widget is, so a chart stayed 260px tall inside a card the reader had
  // just dragged to twice that.
  const dashboard = read('pages/Dashboard.jsx')
  assert.ok(
    dashboard.includes('const fillHeight = Number(widget.heightPx) > 0 || isPlaced(widget)'),
    'a dragged widget no longer fills its box'
  )
})

test('the preview has a definite height, or a chart in it has none at all', () => {
  // `height: 100%` of an auto-height box is zero. On the canvas every
  // widget is drawn at a definite height -- a phone stacks them at their
  // own proportions rather than letting them go auto -- but the preview has
  // no canvas to give it one.
  const dashboard = read('pages/Dashboard.jsx')
  assert.ok(dashboard.includes('height: previewHeight(editTarget, view.widgets)'), 'the preview can collapse')

  // Its own drawn height where it has one, so the form is changing
  // something that looks like what the page will draw.
  assert.equal(previewHeight({ kind: 'widget', id: 'w1' }, [{ id: 'w1', boxH: 520 }]), 520)
  assert.equal(previewHeight({ kind: 'widget', id: 'w1' }, [{ id: 'w1', heightPx: 300 }]), 300)
  assert.equal(previewHeight({ kind: 'widget', id: 'w1' }, [{ id: 'w1' }]), 420, 'a never-placed widget collapses')
  // A page preview is the page, and sizing that would be wrong.
  assert.equal(previewHeight({ kind: 'page' }, []), undefined)
  assert.equal(previewHeight(null, null), undefined)
})

test('a hand-edited box cannot make the preview a strip or a mile', () => {
  assert.equal(previewHeight({ kind: 'widget', id: 'w' }, [{ id: 'w', boxH: 4 }]), 160)
  assert.equal(previewHeight({ kind: 'widget', id: 'w' }, [{ id: 'w', boxH: 99999 }]), 1200)
  assert.equal(previewHeight({ kind: 'widget', id: 'w' }, [{ id: 'w', boxH: 'tall' }]), 420)
})
