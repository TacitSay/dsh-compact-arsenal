import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  TURN_MARKER,
  findTurnIntervals,
  frameSummary,
  isCondensedMiddle,
  isUserInstruction,
  middleTranscript,
} from '../lib/turns.js'

const require = createRequire(import.meta.url)
const CANDIDATES = [
  'E:/DSH/DSH NEXT/resources/app/node_modules/@deepseek-ai/dsh-session',
  'E:/DSH/resources/app/node_modules/@deepseek-ai/dsh-session',
]
let Session
for (const c of CANDIDATES) {
  try {
    Session = require(c).Session
    if (typeof Session === 'function') break
  } catch { /* next */ }
}
const skip = typeof Session === 'function' ? false : 'packaged dsh-session not resolvable'

/** A turn with a real middle: user → assistant(tool) → tool → assistant(final). */
function seed() {
  const s = Session.create('turns-basic', [], {
    version: 4, id: 'turns-basic', createdAt: Date.now(), isSeeded: false,
  })
  s.append('user/message', {
    id: 'u1', role: 'user', source: { kind: 'user', rpcId: 'r1' },
    content: [{ type: 'text', text: '把 X 改成 Y' }],
  }, { surfaceOp: 'append' })
  s.append('assistant/message', {
    turn: 1, step: 1,
    message: {
      id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' },
      content: [{ type: 'reasoning', text: '想想' }, { type: 'tool-call', id: 'c1', name: 'edit', arguments: '{"path":"X"}' }],
    },
    stream: [],
  }, { surfaceOp: 'append' })
  s.append('tool/result', {
    turn: 1, step: 2,
    message: { id: 't1', role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'done' }] },
  }, { surfaceOp: 'append' })
  s.append('assistant/message', {
    turn: 1, step: 3,
    message: { id: 'a2', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '改好了' }] },
    stream: [],
  }, { surfaceOp: 'append' })
  s.append('user/message', {
    id: 'u2', role: 'user', source: { kind: 'user', rpcId: 'r2' },
    content: [{ type: 'text', text: '再改 Z' }],
  }, { surfaceOp: 'append' })
  return s
}

test('an injected user/message is not an instruction', () => {
  // Injected blocks share source.kind 'user' but never carry an rpcId.
  assert.equal(isUserInstruction({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 't' }] } }), false)
  assert.equal(isUserInstruction({ type: 'user/message', data: { source: { kind: 'user', rpcId: 'r' }, content: [{ type: 'text', text: 't' }] } }), true)
})

test('an interval spans the instruction to before the closing reply', { skip }, () => {
  const iv = findTurnIntervals(seed())
  assert.equal(iv.length, 1, 'the trailing instruction has no body')
  assert.equal(iv[0].middleSeqs.length, 2, 'assistant + tool')
  assert.equal(iv[0].keepSeqs.length, 1, 'the answer is kept verbatim')
})

test('the closing reply is never inside the middle', { skip }, () => {
  const s = seed()
  const [iv] = findTurnIntervals(s)
  const last = s.eventAt(iv.middleSeqs.at(-1))
  assert.notEqual(last.type, 'assistant/message')
})

test('the transcript carries the tool call but not the answer', { skip }, () => {
  const s = seed()
  const [iv] = findTurnIntervals(s)
  const text = middleTranscript(s, iv.middleSeqs)
  assert.ok(text.includes('edit'), 'tool name survives')
  assert.ok(!text.includes('改好了'), 'the answer is not in the transcript')
})

test('a condensed middle is recognised, so it is not compressed twice', { skip }, () => {
  const s = seed()
  const [iv] = findTurnIntervals(s)
  s.append('user/message', {
    id: `compact-arsenal-turn-${iv.userSeq}-1`,
    role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: frameSummary('执行了 edit') }],
  }, {
    surfaceOp: { op: 'replace', startSeq: iv.middleSeqs[0], endSeq: iv.middleSeqs.at(-1) },
    sourceEventSeqs: iv.middleSeqs,
  })
  const after = findTurnIntervals(s)
  assert.equal(isCondensedMiddle(s, after[0]), true)
})

test('the marker is stable', () => {
  assert.ok(frameSummary('x').startsWith(TURN_MARKER))
})
