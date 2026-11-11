/**
 * Prove the shipped log accepts the replacement shapes this plugin writes.
 *
 * Runs against the packaged `dsh-session` so the assertion is about the real
 * validator, not a copy of its rules.
 *
 * Usage: node test/surface-shape.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const CANDIDATES = [
  'E:/DSH/DSH NEXT/resources/app/node_modules/@deepseek-ai/dsh-session',
  'E:/DSH/resources/app/node_modules/@deepseek-ai/dsh-session',
]

let Session
let available = false
for (const spec of CANDIDATES) {
  try {
    const mod = require(spec)
    Session = mod.Session
    available = typeof Session === 'function'
    if (available) break
  } catch {
    // try the next candidate
  }
}

const skip = available ? false : 'packaged dsh-session is not resolvable from this checkout'

/** Build a minimal session: system, user, assistant. */
function makeSession() {
  const session = Session.create('session-shape-test')
  session.append('system/message', {
    turn: 1, step: 1,
    message: { role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'sys' }] },
  }, { surfaceOp: 'append' })
  session.append('user/message', {
    role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }],
  }, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1, step: 1,
    message: { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }] },
    stream: [],
  }, { surfaceOp: 'append' })
  return session
}

test('assistant/message cannot carry sourceEventSeqs', { skip }, () => {
  const session = makeSession()
  const seq = session.surface.nodes.at(-1)
  assert.throws(() => {
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      stream: [],
    }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  }, /assistant\/message embeds its source stream/)
})

test('a replace without sourceEventSeqs is rejected as missing', { skip }, () => {
  const session = makeSession()
  const seq = session.surface.nodes.at(-1)
  assert.throws(() => {
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      stream: [],
    }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq } })
  }, /must include every shadowed surface node/)
})

test('a user/message checkpoint can replace an assistant node', { skip }, () => {
  const session = makeSession()
  const seq = session.surface.nodes.at(-1)
  const before = [...session.surface.nodes]
  session.append('user/message', {
    role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '<compacted-summary>要点</compacted-summary>' }],
  }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  const after = [...session.surface.nodes]
  assert.equal(after.length, before.length, 'node count is unchanged by an in-place replace')
  assert.notEqual(after.at(-1), seq, 'the replaced node is superseded')
})

test('a tool/result may be replaced in place when it cites itself', { skip }, () => {
  const session = Session.create('session-shape-test-2')
  session.append('user/message', {
    role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }],
  }, { surfaceOp: 'append' })
  session.append('tool/result', {
    turn: 1, step: 1,
    message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'long output' }] },
  }, { surfaceOp: 'append' })
  const seq = session.surface.nodes.at(-1)
  session.append('tool/result', {
    turn: 1, step: 1,
    message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'short' }] },
  }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  assert.equal(session.surface.nodes.length, 2)
})
