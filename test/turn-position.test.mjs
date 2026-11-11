import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Mirror of `currentPosition()` in index.js, kept here so the turn semantics
 * are pinned by a test without importing the plugin entry (which needs a Host).
 */
function currentPosition(event, currentTurn) {
  const turn = Number.isFinite(currentTurn) ? currentTurn : event.data.turn
  const step = turn === event.data.turn && Number.isFinite(event.data.step) ? event.data.step : 1
  return { turn, step }
}

test('a replacement carries the turn that owns the write, not the node turn', () => {
  const oldNode = { data: { turn: 4, step: 7 } }
  assert.deepEqual(currentPosition(oldNode, 42), { turn: 42, step: 1 })
})

test('a same-turn write keeps the node step', () => {
  const node = { data: { turn: 12, step: 3 } }
  assert.deepEqual(currentPosition(node, 12), { turn: 12, step: 3 })
})

test('a missing current turn falls back to the node turn', () => {
  const node = { data: { turn: 9, step: 2 } }
  assert.deepEqual(currentPosition(node, undefined), { turn: 9, step: 2 })
})

/** Mirror of the tail scan used to decide whether a turn is still open. */
function openTurnOf(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'turn/end') return undefined
    if (event.type === 'turn/start') return event.turn
  }
  return undefined
}

test('an open turn is reported', () => {
  const events = [
    { type: 'turn/start', turn: 41 },
    { type: 'turn/end', turn: 41 },
    { type: 'turn/start', turn: 42 },
    { type: 'user/message' },
  ]
  assert.equal(openTurnOf(events), 42)
})

test('a closed turn reports nothing, so a late write is skipped', () => {
  const events = [
    { type: 'turn/start', turn: 42 },
    { type: 'user/message' },
    { type: 'turn/end', turn: 42 },
  ]
  assert.equal(openTurnOf(events), undefined)
})

test('an empty log reports nothing', () => {
  assert.equal(openTurnOf([]), undefined)
})
