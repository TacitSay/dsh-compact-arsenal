import test from 'node:test'
import assert from 'node:assert/strict'

import { findTurnIntervals, isUserInstruction } from '../lib/turns.js'

// The discriminating field is `rpcId`, measured on a real session:
//
//   {kind:'user', rpcId, clientTimeZone}   109  ← the human
//   {kind:'user'}                          197  ← injected by machinery
//
// The injected ones include DSH's own compaction checkpoint, hindsight recall, and
// this plugin's older checkpoints. All claim kind 'user'; none is a person typing.

function msg(text, source, id = 'm1') {
  return { type: 'user/message', data: { id, role: 'user', source, content: [{ type: 'text', text }] } }
}

const HUMAN = { kind: 'user', rpcId: 'r-1', clientTimeZone: 'Asia/Shanghai' }
const INJECTED = { kind: 'user' }

test('a real client message counts as an instruction', () => {
  assert.equal(isUserInstruction(msg('把 X 改成 Y', HUMAN)), true)
})

test('an injected block does NOT count, even though kind is "user"', () => {
  assert.equal(isUserInstruction(msg('This is an automatically generated checkpoint', INJECTED)), false)
})

test('hindsight-style memory recall does not count', () => {
  const recall = { kind: 'user' }
  assert.equal(isUserInstruction(msg('The user wants a real plugin project with three sections', recall)), false)
})

test('our own checkpoint never counts, whatever its source says', () => {
  const cp = msg('[compact-arsenal turn summary]\n- did a thing', HUMAN, 'compact-arsenal-turn-1-2')
  assert.equal(isUserInstruction(cp), false)
})

test('a non-user source kind still does not count', () => {
  assert.equal(isUserInstruction(msg('time', { kind: 'time-context' })), false)
})

test('an empty instruction does not start a turn', () => {
  assert.equal(isUserInstruction(msg('   ', HUMAN)), false)
})

// --- interval arithmetic -------------------------------------------------------

function sessionOf(events) {
  const surfaceNodes = events.map((_, i) => i)
  return {
    surface: { nodes: surfaceNodes },
    eventAt: (seq) => events[seq],
  }
}

test('an injected block between two instructions does not split the turn', () => {
  const events = [
    msg('第一个要求', HUMAN, 'a'),
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'ok' }] } } },
    msg('checkpoint injected here', INJECTED, 'inj'),
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } },
    msg('第二个要求', HUMAN, 'b'),
  ]
  const intervals = findTurnIntervals(sessionOf(events))
  assert.equal(intervals.length, 1, 'only the human starts turns')
  assert.equal(intervals[0].userSeq, 0)
})

test('the turn ends at the NEXT real instruction, not at the injected one', () => {
  const events = [
    msg('要求一', HUMAN, 'a'),          // 0
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'x' }] } } },  // 1
    msg('injected', INJECTED, 'inj'),   // 2
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'y' }] } } },  // 3
    msg('要求二', HUMAN, 'b'),          // 4
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'z' }] } } },  // 5
  ]
  const intervals = findTurnIntervals(sessionOf(events))

  // Only the FIRST turn has a compressible middle: the second is instruction +
  // reply with nothing in between, so it is (correctly) skipped rather than
  // summarized into nothing.
  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].userSeq, 0)
  // The injected block stays inside turn one's middle — it is content to compress,
  // not a boundary.
  assert.deepEqual(intervals[0].middleSeqs, [1, 2])
  assert.deepEqual(intervals[0].keepSeqs, [3])
})

test('a turn of nothing but answers has no process to condense', () => {
  const events = [
    msg('要求一', HUMAN, 'a'),
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'x' }] } } },
    msg('要求二', HUMAN, 'b'),
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'y' }] } } },
  ]
  const intervals = findTurnIntervals(sessionOf(events))
  // Turn one is instruction → reply. The reply is trailing, so the middle is empty
  // and the turn is skipped; condensing it would replace an answer with a summary
  // of that answer.
  assert.equal(intervals.length, 0)
})
