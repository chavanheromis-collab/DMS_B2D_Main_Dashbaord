import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_ENTRANCE,
  GAP_DEFAULT,
  LOGO,
  LOGO_DEFAULT,
  LOGO_MAX,
  LOGO_MIN,
  LOGO_SLOTS,
  MAIN_LOGO,
  hasLogo,
  logoBox,
  logoSlot,
  logoUrlOf,
} from './branding.js'
import { backdropOf } from './entranceThemes.js'

// ---------------------------------------------------------------------
// Two logos on the entrance
// ---------------------------------------------------------------------
// A business often has two marks: the group's, and the one for the thing
// this dashboard is about. What is worth testing is not that a second
// image renders -- it is that the second one is not a lesser copy of the
// first. Every setting the old logo had, the new one has, because both
// are the same code reading different keys; and a workspace that never
// asked for a second mark must not grow one.

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const read = (p) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

const splash = read('src/components/SplashScreen.jsx')
const panel = read('src/pages/admin/EntrancePanel.jsx')

// --- the slots -----------------------------------------------------------

test('the slot that always existed is still the same fields', () => {
  // Nothing moves. A workspace that set a logo before this went in has
  // exactly that logo, in exactly that place.
  assert.deepEqual(
    { url: LOGO.url, backdrop: LOGO.backdrop, size: LOGO.size, gap: LOGO.gap },
    { url: 'logoUrl', backdrop: 'logoBackdrop', size: 'logoSize', gap: 'logoGap' }
  )
})

test('the main logo has every setting the other one has, and no others', () => {
  // The whole requirement. Compared as a SET of setting names rather than
  // asserted one by one, so a setting added to either slot and not the
  // other fails here rather than being noticed a fortnight later.
  const shape = (slot) => Object.keys(slot).filter((k) => !['key', 'label', 'note'].includes(k)).sort()
  assert.deepEqual(shape(MAIN_LOGO), shape(LOGO))
  assert.deepEqual(
    { url: MAIN_LOGO.url, backdrop: MAIN_LOGO.backdrop, size: MAIN_LOGO.size, gap: MAIN_LOGO.gap },
    { url: 'mainLogoUrl', backdrop: 'mainLogoBackdrop', size: 'mainLogoSize', gap: 'mainLogoGap' }
  )
})

test('...and no two slots write to the same field', () => {
  // One key shared between them is one slider moving both logos.
  const fields = LOGO_SLOTS.flatMap((s) => [s.url, s.backdrop, s.size, s.gap])
  assert.equal(new Set(fields).size, fields.length)
})

test('the main one is drawn above, because that is the order they are in', () => {
  assert.equal(LOGO_SLOTS[0], MAIN_LOGO)
  assert.equal(LOGO_SLOTS[1], LOGO)
  assert.equal(logoSlot('main'), MAIN_LOGO)
  assert.equal(logoSlot('logo'), LOGO)
  // An unknown key is the old logo, which is what every call meant before
  // slots existed.
  assert.equal(logoSlot('nonsense'), LOGO)
  assert.equal(logoSlot(), LOGO)
})

test('a document written before this exists is unchanged by it', () => {
  // No stock mark stands in for the main slot: the entrance has always
  // shown one logo, and a second appearing on every workspace that never
  // asked for one would be the app redesigning itself.
  assert.equal(DEFAULT_ENTRANCE.mainLogoUrl, '')
  assert.equal(hasLogo({}, MAIN_LOGO), false)
  assert.equal(hasLogo({ logoUrl: 'x' }, MAIN_LOGO), false)
  assert.equal(hasLogo({ mainLogoUrl: 'x' }, MAIN_LOGO), true)
  assert.equal(logoUrlOf({ mainLogoUrl: 'x' }, MAIN_LOGO), 'x')
  assert.equal(logoUrlOf({ logoUrl: 'y' }), 'y')
})

// --- the box, per slot ---------------------------------------------------

test('each logo is sized and spaced on its own', () => {
  // A wide group lockup over a small division mark is the normal case,
  // and one setting fighting the other would make it impossible.
  const entrance = { logoSize: 60, logoGap: 10, mainLogoSize: 200, mainLogoGap: -30 }
  assert.equal(logoBox(entrance).height, 60)
  assert.equal(logoBox(entrance).gap, 10)
  assert.equal(logoBox(entrance, MAIN_LOGO).height, 200)
  assert.equal(logoBox(entrance, MAIN_LOGO).gap, -30)
})

test('and clamped by the same numbers, because it is the same function', () => {
  assert.equal(logoBox({ mainLogoSize: 5000 }, MAIN_LOGO).height, LOGO_MAX)
  assert.equal(logoBox({ mainLogoSize: 1 }, MAIN_LOGO).height, LOGO_MIN)
  assert.equal(logoBox({ mainLogoSize: null }, MAIN_LOGO).height, LOGO_DEFAULT)
  assert.equal(logoBox({ mainLogoGap: null }, MAIN_LOGO).gap, GAP_DEFAULT)
  // The width follows the height for both, so a wordmark keeps its shape.
  assert.equal(logoBox({ mainLogoSize: 100 }, MAIN_LOGO).maxWidth, logoBox({ logoSize: 100 }).maxWidth)
})

test('defaulting to the old slot keeps every existing caller honest', () => {
  const entrance = { logoSize: 120, logoGap: 8 }
  assert.deepEqual(logoBox(entrance), logoBox(entrance, LOGO))
})

test('each logo has its own backdrop', () => {
  const entrance = { logoBackdrop: 'light', mainLogoBackdrop: 'none' }
  assert.equal(backdropOf(entrance).value, 'light')
  assert.equal(backdropOf(entrance, MAIN_LOGO.backdrop).value, 'none')
  // Unset is the same fallback it always was.
  assert.equal(backdropOf({}, MAIN_LOGO.backdrop).value, 'glow')
})

// --- on the entrance -----------------------------------------------------

test('the entrance draws it above, at its own size', () => {
  assert.ok(splash.includes('const mainBox = logoBox(entrance, MAIN_LOGO)'))
  assert.ok(splash.includes('useImageFallback(entrance?.[MAIN_LOGO.url], mainBox.request)'))
  assert.ok(splash.includes('style={{ maxHeight: mainBox.height, maxWidth: mainBox.maxWidth }}'))
  assert.ok(splash.includes('marginBottom: mainBox.gap'))
  assert.ok(splash.includes('backdropClass(mainBackdrop)'))
  // Above: the main mark's block comes before the one that has always
  // been there.
  assert.ok(
    splash.indexOf('mainLogo.url && !mainLogo.exhausted') < splash.indexOf('{logo.url && !logo.exhausted ? (')
  )
})

test('a broken link in one slot cannot take the other one down', () => {
  // Separate images, separate fallback walks. The old logo keeps its
  // stock mark; the new one simply is not there.
  assert.ok(splash.includes('{mainLogo.url && !mainLogo.exhausted && ('))
  assert.ok(splash.includes('onError={mainLogo.onError}'))
  assert.ok(splash.includes('onError={logo.onError}'))
})

test('it goes through the same Drive-walking fallback as everything else', () => {
  // A single best URL that HIDES the image on failure is how a logo comes
  // to "not load": Drive serves some files from one endpoint and some
  // from another.
  assert.equal((splash.match(/useImageFallback\(/g) || []).length, 2)
  assert.equal((splash.match(/referrerPolicy="no-referrer"/g) || []).length, 2)
})

// --- and in the admin panel ---------------------------------------------

test('both logos get the same controls, from one component', () => {
  assert.ok(panel.includes('{LOGO_SLOTS.map((slot) => ('))
  assert.ok(panel.includes('<LogoControls key={slot.key} slot={slot} draft={draft} set={set}'))
  assert.ok(panel.includes('function LogoControls({ slot, draft, set, advice = false })'))
  // Every control writes to the slot's own field.
  for (const wire of [
    'set({ [slot.url]: v })',
    'set({ [slot.backdrop]: b.value })',
    'set({ [slot.size]: Number(e.target.value) })',
    'set({ [slot.gap]: Number(e.target.value) })',
  ]) {
    assert.ok(panel.includes(wire), wire)
  }
})

test('the two cards are told apart by name', () => {
  // Two identical stacks of sliders with nothing to distinguish them is
  // worse than one.
  assert.ok(panel.includes('{slot.label}'))
  assert.equal(MAIN_LOGO.label, 'Main logo')
  assert.equal(LOGO.label, 'Logo image')
})

test('the advice under them is said once, not twice', () => {
  // It is about logo files in general rather than about either slot, and
  // repeated it becomes furniture nobody reads.
  assert.equal((panel.match(/transparent PNG or SVG is the right thing/g) || []).length, 1)
  assert.equal((panel.match(/negative on purpose/g) || []).length, 1)
  assert.ok(panel.includes("advice={slot.key === 'logo'}"))
})
