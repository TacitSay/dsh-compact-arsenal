import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  TURN_MARKER,
  findTurnIntervals,
  frameSummary,
  isCondensedMiddle,
  isUserInstruction,
  middleChars,
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
  } catch {}
}
const skip = typeof Session === 'function' ? false : 'packaged dsh-session is not resolvable'

/** system + [user, assistant(tool-call), tool, assistant] */
function seed() {
  const s = Session.create('turns-test', [], {
    version: 4, id: 'turns-test', createdAt: Date.now(), isSeeded: false,
  })
  s.append('system/message', {
    turn: 1, step: 1,
    message: { id: 'sys', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'sys' }] },
  }, { surfaceOp: 'append' })
  s.append('user/message', {
    id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把 X 改成 Y' }],
  }, { surfaceOp: 'append' })
  s.append('assistant/message', {
    turn: 1, step: 1,
    message: {
      id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' },
      content: [{ type: 'reasoning', text: '想想怎么改' }, { type: 'tool-call', id: 'c1', name: 'edit', arguments: '{"path":"X"}' }],
    },
    stream: [],
  }, { surfaceOp: 'append' })
  s.append('tool/result', {
    turn: 1, step: 2,
    message: {
      id: 't1', role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1',
      content: [{ type: 'text', text: 'done' }],
    },
  }, { surfaceOp: 'append' })
  s.append('assistant/message', {
    turn: 1, step: 3,
    message: { id: 'a2', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '改好了' }] },
    stream: [],
  }, { surfaceOp: 'append' })
  s.append('user/message', {
    id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '再改 Z' }],
  }, { surfaceOp: 'append' })
  return s
}

test('an injected user/message is not treated as an instruction', () => {
  // Time snapshots and plugin recall also arrive as user/message; starting a
  // turn at one of those would put a timestamp where the ask belongs.
  assert.equal(isUserInstruction({ type: 'user/message', data: { source: { kind: 'time-context' }, content: [{ type: 'text', text: 't' }] } }), false)
  assert.equal(isUserInstruction({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '真的要求' }] } }), true)
})

test('an interval spans instruction → next instruction', { skip }, () => {
  const s = seed()
  const intervals = findTurnIntervals(s)
  assert.equal(intervals.length, 1, 'the trailing instruction has no middle')
  assert.equal(intervals[0].middleSeqs.length, 3, 'assistant + tool + assistant')
})

test('the transcript carries tool calls and their arguments', { skip }, () => {
  const s = seed()
  const [iv] = findTurnIntervals(s)
  const text = middleTranscript(s, iv.middleSeqs)
  assert.ok(text.includes('edit'), 'the tool name survives')
  assert.ok(text.includes('X'), 'the call arguments survive')
  assert.ok(text.includes('改好了'), 'the conclusion survives')
  assert.ok(middleChars(s, iv.middleSeqs) > 0)
})

test('assistant/message cannot replace a multi-node span', { skip }, () => {
  // The two rules are mutually exclusive: a replacement must cite every shadowed
  // node, and assistant/message may not cite anything. This is why the checkpoint
  // has to be a user/message — pinned so nobody "fixes" it back to assistant.
  const s = seed()
  const [iv] = findTurnIntervals(s)
  assert.throws(() => {
    s.append('assistant/message', {
      turn: 1, step: 1,
      message: { id: 'a9', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'x' }] },
      stream: [],
    }, {
      surfaceOp: { op: 'replace', startSeq: iv.middleSeqs[0], endSeq: iv.middleSeqs.at(-1) },
      sourceEventSeqs: iv.middleSeqs,
    })
  }, /assistant\/message embeds its source stream/)
})

test('a condensed middle is recognised, so the turn is not compressed twice', { skip }, () => {
  const s = seed()
  const [iv] = findTurnIntervals(s)
  s.append('user/message', {
    id: `compact-arsenal-turn-${iv.userSeq}-1`,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: frameSummary('执行了 edit，改好了。') }],
  }, {
    surfaceOp: { op: 'replace', startSeq: iv.middleSeqs[0], endSeq: iv.middleSeqs.at(-1) },
    sourceEventSeqs: iv.middleSeqs,
  })

  const after = findTurnIntervals(s)
  assert.equal(after.length, 1)
  assert.equal(isCondensedMiddle(s, after[0]), true, 'the checkpoint is recognised')
})

test('the marker is stable and identifiable', () => {
  assert.ok(frameSummary('abc').startsWith(TURN_MARKER))
  assert.ok(frameSummary('abc').includes('abc'))
})
