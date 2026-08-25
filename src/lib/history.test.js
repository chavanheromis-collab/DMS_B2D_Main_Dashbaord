import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  commitHistory,
  emptyHistory,
  historyKeyAction,
  redoHistory,
  resetHistory,
  undoHistory,
} from './history.js'

test('a fresh history has nothing to undo or redo', () => {
  const h = emptyHistory({ sort: 'natural' })
  assert.equal(canUndo(h), false)
  assert.equal(canRedo(h), false)
  assert.equal(undoHistory(h), h, 'and undoing it is a no-op, not a crash')
  assert.equal(redoHistory(h), h)
})

test('undo walks back and redo walks forward', () => {
  let h = emptyHistory('a')
  h = commitHistory(h, 'b')
  h = commitHistory(h, 'c')
  assert.equal(h.present, 'c')

  h = undoHistory(h)
  assert.equal(h.present, 'b')
  h = undoHistory(h)
  assert.equal(h.present, 'a')
  assert.equal(canUndo(h), false, 'and stops at the beginning')

  h = redoHistory(h)
  assert.equal(h.present, 'b')
  h = redoHistory(h)
  assert.equal(h.present, 'c')
  assert.equal(canRedo(h), false)
})

test('a change that changes nothing is not remembered', () => {
  // Otherwise re-picking the sort you already had costs an undo, and Ctrl+Z
  // appears to do nothing.
  let h = emptyHistory('a')
  h = commitHistory(h, 'a')
  assert.equal(canUndo(h), false)
})

test('doing something new discards the future', () => {
  // You cannot redo a branch you have stepped off, which is what undo does
  // everywhere else.
  let h = emptyHistory('a')
  h = commitHistory(h, 'b')
  h = undoHistory(h)
  assert.equal(canRedo(h), true)

  h = commitHistory(h, 'c')
  assert.equal(canRedo(h), false)
  assert.equal(h.present, 'c')
})

test('the past does not grow without limit', () => {
  let h = emptyHistory(0)
  for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) h = commitHistory(h, i)
  assert.equal(h.past.length, HISTORY_LIMIT)
  assert.equal(h.present, HISTORY_LIMIT + 20)
  assert.equal(h.past[0], 20, 'the oldest are dropped, not the newest')
})

test('reset is itself undoable', () => {
  // Pressing Escape by accident should not be the one action you cannot
  // take back.
  let h = emptyHistory('start')
  h = commitHistory(h, 'explored')
  h = resetHistory(h, 'start')
  assert.equal(h.present, 'start')
  assert.equal(undoHistory(h).present, 'explored')
})

test('resetting what is already reset is not a step', () => {
  const h = commitHistory(emptyHistory('start'), 'start')
  assert.equal(canUndo(h), false)
})

test('an object present is compared by identity, so a fresh copy counts', () => {
  // The widget replaces its exploration wholesale on every change, so two
  // equal-looking objects are genuinely two different states.
  let h = emptyHistory({ open: [] })
  h = commitHistory(h, { open: [] })
  assert.equal(canUndo(h), true)
})

test('both redo shortcuts work, because Windows and the Mac learnt different ones', () => {
  assert.equal(historyKeyAction({ ctrlKey: true, key: 'z' }), 'undo')
  assert.equal(historyKeyAction({ metaKey: true, key: 'Z' }), 'undo')
  assert.equal(historyKeyAction({ ctrlKey: true, shiftKey: true, key: 'z' }), 'redo')
  assert.equal(historyKeyAction({ ctrlKey: true, key: 'y' }), 'redo')
})

test('a plain keystroke is left alone', () => {
  assert.equal(historyKeyAction({ key: 'z' }), null)
  assert.equal(historyKeyAction({ ctrlKey: true, key: 'a' }), null)
})
