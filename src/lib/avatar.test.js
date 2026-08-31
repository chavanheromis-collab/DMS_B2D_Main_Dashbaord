import test from 'node:test'
import assert from 'node:assert/strict'
import { AVATAR_TINTS, avatarSpec, hash32, initialsOf, tintFor } from './avatar.js'

test('initials, from whatever there is', () => {
  assert.equal(initialsOf('Ravi Kumar'), 'RK')
  assert.equal(initialsOf('Ravi Shankar Kumar'), 'RK', 'first and last, not first two')
  assert.equal(initialsOf('ravi'), 'R')
  assert.equal(initialsOf('  '), '?')
  assert.equal(initialsOf(undefined), '?')
})

test('the same person is the same colour, every time', () => {
  // It is what makes a list of names skimmable without reading one, and it
  // must not change because somebody else joined first.
  //
  // Over MANY people, not one: with eight tints, a random implementation
  // agrees with itself one time in eight, and a test that catches a bug
  // seven times in eight is a test that goes green on the run that matters.
  const people = Array.from({ length: 40 }, (_, i) => `u_${i}`)
  assert.deepEqual(people.map(tintFor), people.map(tintFor))
  assert.notDeepEqual(tintFor('u_a'), tintFor('u_zzzz'))
  assert.ok(tintFor('').bg)
  assert.ok(tintFor(undefined).fg)
})

test('the palette is spread over, not crowded into one corner', () => {
  // A hash that lands 40 people on two colours has stopped labelling them.
  const used = new Set(Array.from({ length: 60 }, (_, i) => tintFor(`u_${i}`).bg))
  assert.ok(used.size >= AVATAR_TINTS.length - 1, `only ${used.size} tints used`)
})

test('every tint is a light ground with dark ink', () => {
  // A tint that looks pretty and cannot be read has stopped being a label.
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  }
  for (const t of AVATAR_TINTS) {
    assert.ok(lum(t.bg) > 0.85, `${t.bg} is not a light ground`)
    assert.ok(lum(t.fg) < 0.55, `${t.fg} is not dark ink`)
  }
})

test('the hash is stable and spread', () => {
  // Stable, or every remark moves to a new note on the next deploy.
  assert.equal(hash32('D-1042'), hash32('D-1042'))
  const seen = new Set()
  for (let i = 0; i < 500; i += 1) seen.add(hash32(`D-${i}`))
  assert.equal(seen.size, 500)
})

test('one spec serves the panel and the desktop notification', () => {
  // Keeping the decision in one place is what stops a notification's avatar
  // drifting away from the one in the app.
  const spec = avatarSpec('Ravi Kumar', 'u_ravi')
  assert.equal(spec.initials, 'RK')
  assert.equal(spec.bg, tintFor('u_ravi').bg)
  assert.equal(spec.fg, tintFor('u_ravi').fg)
})

test('the colour follows the person, not the name they are shown under', () => {
  // Two people called "Ravi" are two colours; one person renamed keeps
  // theirs. The uid is the identity, the name is a label.
  assert.notDeepEqual(avatarSpec('Ravi', 'u_a').bg, avatarSpec('Ravi', 'u_zzzz').bg)
  assert.equal(avatarSpec('Ravi Kumar', 'u_a').bg, avatarSpec('R. Kumar', 'u_a').bg)
})

test('with no id to go on, the name will do', () => {
  assert.ok(avatarSpec('Ravi Kumar').bg)
  assert.equal(avatarSpec('Ravi Kumar').bg, tintFor('Ravi Kumar').bg)
})
