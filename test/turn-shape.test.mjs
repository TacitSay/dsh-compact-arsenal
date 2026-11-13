/**
 * The two surface replacement shapes, tested against the real log.
 *
 * Both incidents so far came from getting these shapes wrong while every
 * offline check passed, because the checks did not run inside an open turn:
 *
 *   #1 writing the current turn into a tool/result replacement
 *   #2 a user/message checkpoint without an id
 *
 * This test runs each shape with a turn open, which is the only condition that
 * exposes the first bug.
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
for (const spec of CANDIDATES) {
  try {
    Session = require(spec).Session
    if (typeof Session === 'function') break
  } catch {
    // try the next candidate
  }
}

const skip = typeof Session === 'function' ? false : 'packaged dsh-session is not resolvable'

/** A session with a system prompt, a user turn, and one tool result. */
function seed() {
  const session = Session.create('shape-test', [], {
    version: 4, id: 'shape-test', createdAt: Date.now(), isSeeded: false,
  })
  session.append('system/message', {
    turn: 1, step: 1,
    message: {
      id: 'sys', role: 'system', source: { kind: 'system-prompt' },
      content: [{ type: 'text', text: 'sys' }],
    },
  }, { surfaceOp: 'append' })
  session.append('user/message', {
    id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }],
  }, { surfaceOp: 'append' })
  // The tool result was produced in turn 1; the replacement will be written
  // while turn 2 is open, which is what the live pass looks like.
  session.append('tool/result', {
    turn: 1, step: 3,
    message: {
      id: 't1', role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1',
      content: [{ type: 'text', text: 'x'.repeat(500) }],
    },
  }, { surfaceOp: 'append' })
  session.append('turn/start', { turn: 2 })
  return session
}

test('a tool/result replacement must keep its own turn and step', { skip }, () => {
  const session = seed()
  const nodes = [...session.surface.nodes]
  const seq = nodes.filter((s) => session.eventAt(s)?.type === 'tool/result').at(-1)
  const event = session.eventAt(seq)

  const message = { ...event.data.message, content: [{ type: 'text', text: 'trimmed' }] }

  // Writing the CURRENT turn (2) is exactly the bug: the log compares every
  // non-content field and rejects the difference.
  assert.throws(() => {
    session.append('tool/result', {
      turn: 2, step: 1, message,
    }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  }, /may change only content/)

  // Keeping the node's own turn/step is accepted.
  session.append('tool/result', {
    turn: event.data.turn, step: event.data.step, message,
  }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })

  const after = session.eventAt(session.surface.nodes.at(-1))
  assert.equal(after.data.turn, 1, 'the replacement keeps the original turn')
})

test('a user/message checkpoint may carry the current turn and needs an id', { skip }, () => {
  const session = seed()
  const nodes = [...session.surface.nodes]
  const seq = nodes.filter((s) => session.eventAt(s)?.type === 'tool/result').at(-1)

  const checkpoint = {
    id: 'compact-arsenal-tools-1-t',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'condensed' }],
    turn: 2,
    step: 1,
  }
  session.append('user/message', checkpoint, {
    surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq],
  })

  const written = session.eventAt(session.surface.nodes.at(-1))
  assert.equal(written.data.id, checkpoint.id)
  assert.equal(written.data.turn, 2, 'a new message takes the writing turn')
})
