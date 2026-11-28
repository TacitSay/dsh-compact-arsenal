import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

/**
 * `transcriptLine` builds the text the total summarizer reads. It used to read only
 * `data.message.content`, which is right for `assistant/message` and `tool/result`
 * but wrong for `user/message` — that carries its blocks directly on `data.content`.
 *
 * Every USER line therefore came out as "[USER] " and the summarizer was asked to
 * condense a conversation whose instructions it could not see. The first live
 * checkpoint stated "会话中未见用户显式指令" over a span holding seven of them.
 */

// Pull the shipped function out of the source so the test cannot pass against a copy
// that drifts from what actually runs.
const start = src.indexOf('function transcriptLine')
assert.ok(start > 0, 'transcriptLine is defined')
const bodyStart = src.indexOf('{', start) + 1
const bodyEnd = src.indexOf('\n}', start)
const transcriptLine = new Function('event', src.slice(bodyStart, bodyEnd))

const userEvent = (text) => ({
  type: 'user/message',
  data: { content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'r1' } },
})
const assistantEvent = (text) => ({
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})
const toolEvent = (text) => ({
  type: 'tool/result',
  data: { message: { content: [{ type: 'text', text }] } },
})

test('a user instruction keeps its text', () => {
  // The bug: this returned "[USER] ".
  assert.equal(transcriptLine(userEvent('帮我改一下配置')), '[USER] 帮我改一下配置')
})

test('an assistant message still reads its nested message', () => {
  assert.equal(transcriptLine(assistantEvent('改好了')), '[ASSISTANT] 改好了')
})

test('a tool result still reads its nested message', () => {
  assert.equal(transcriptLine(toolEvent('done')), '[TOOL] done')
})

test('both content levels are consulted', () => {
  // The fix has to try the nested path first for assistant/tool, and the flat path for
  // user — reading only one of them is what broke instructions.
  const fn = src.slice(start, bodyEnd)
  assert.ok(fn.includes('event.data?.content'), 'flat content is read')
  assert.ok(fn.includes('event.data?.message?.content'), 'nested content is read')
})

test('a tool call is still summarised by name and arguments', () => {
  const event = {
    type: 'assistant/message',
    data: {
      message: {
        content: [{ type: 'tool-call', name: 'edit', arguments: '{"path":"a.ts"}' }],
      },
    },
  }
  const line = transcriptLine(event)
  assert.ok(line.includes('→ edit'), 'tool name survives')
  assert.ok(line.includes('a.ts'), 'arguments survive')
})

test('a long body is capped', () => {
  const line = transcriptLine(userEvent('x'.repeat(2000)))
  assert.ok(line.length < 2000, 'capped so one turn cannot swamp the transcript')
  assert.ok(line.endsWith('…'), 'the truncation is marked')
})
