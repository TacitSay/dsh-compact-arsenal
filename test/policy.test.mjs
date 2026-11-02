import test from 'node:test'
import assert from 'node:assert/strict'

import {
  REASONING_MARKER,
  TOOL_MARKER,
  clearReasoning,
  measureText,
  pruneToolContent,
  trimReasoning,
} from '../lib/policy.js'

test('measureText counts only text blocks, by code point', () => {
  const blocks = [
    { type: 'text', text: 'abc' },
    { type: 'image', attachment: {} },
    { type: 'text', text: '汉字' },
  ]
  assert.equal(measureText(blocks), 5)
})

test('clearReasoning removes every reasoning block and keeps order', () => {
  const blocks = [
    { type: 'reasoning', text: 'think' },
    { type: 'text', text: 'answer' },
    { type: 'tool-call', name: 'pwsh', arguments: '{}' },
  ]
  assert.deepEqual(clearReasoning(blocks), [
    { type: 'text', text: 'answer' },
    { type: 'tool-call', name: 'pwsh', arguments: '{}' },
  ])
})

test('clearReasoning returns null when there is no reasoning block', () => {
  assert.equal(clearReasoning([{ type: 'text', text: 'answer' }]), null)
})

test('trimReasoning leaves short reasoning untouched', () => {
  const blocks = [{ type: 'reasoning', text: 'x'.repeat(500) }]
  assert.equal(trimReasoning(blocks, { headChars: 600, tailChars: 300, minChars: 2000 }), null)
})

test('trimReasoning keeps the head and tail of a long block', () => {
  const text = 'A'.repeat(3000) + 'B'.repeat(3000)
  const out = trimReasoning([{ type: 'reasoning', text }], { headChars: 100, tailChars: 50, minChars: 2000 })
  assert.equal(out.length, 1)
  assert.equal(out[0].type, 'reasoning')
  assert.ok(out[0].text.startsWith('A'.repeat(100)))
  assert.ok(out[0].text.includes(REASONING_MARKER))
  assert.ok(out[0].text.endsWith('B'.repeat(50)))
})

test('trimReasoning never splits a surrogate pair', () => {
  const text = '🐳'.repeat(4000)
  const out = trimReasoning([{ type: 'reasoning', text }], { headChars: 3, tailChars: 2, minChars: 100 })
  const kept = out[0].text.split(REASONING_MARKER)
  assert.equal([...kept[0]].length, 3)
  assert.equal([...kept[1]].length, 2)
  assert.ok(!kept[0].includes('\uFFFD'))
})

test('pruneToolContent leaves results within budget alone', () => {
  assert.equal(pruneToolContent([{ type: 'text', text: 'short' }], { thresholdChars: 100, headChars: 40, tailChars: 10 }), null)
})

test('pruneToolContent keeps head, marker and tail and preserves rich blocks', () => {
  const body = 'L'.repeat(5000)
  const blocks = [
    { type: 'text', text: body },
    { type: 'image', attachment: { id: 'a' } },
  ]
  const out = pruneToolContent(blocks, { thresholdChars: 1000, headChars: 100, tailChars: 50 })
  assert.equal(out[0].type, 'text')
  assert.ok(out[0].text.startsWith('L'.repeat(100)))
  assert.ok(out[0].text.includes(TOOL_MARKER))
  assert.ok(out[0].text.endsWith('L'.repeat(50)))
  assert.equal([...out[0].text].length, 100 + TOOL_MARKER.length + 50)
  assert.deepEqual(out.at(-1), { type: 'image', attachment: { id: 'a' } })
})
