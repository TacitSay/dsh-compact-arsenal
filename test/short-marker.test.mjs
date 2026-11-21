import test from 'node:test'
import assert from 'node:assert/strict'

import { ALL_MARKERS, SHORT_MARKER, alreadyRewritten } from '../lib/policy.js'

// The reported problem: a 213-char tool result was replaced with
// "[已省略 213 字，原文见会话日志]" — 19 chars of new text to save 194. Across
// hundreds of fragments that placeholder is itself a meaningful share of what
// the model has to read, and it says nothing a reader needs.

test('a collapsed fragment is a single character, not a sentence', () => {
  assert.equal([...SHORT_MARKER].length, 1, 'one code point')
  assert.ok(SHORT_MARKER.trim() !== '', 'must not be blank: an empty block is dropped by the adapter')
})

test('the collapse marker is not blank, so the provider still gets a part', () => {
  // The DeepSeek adapter does `block.text ? [...] : []`, so empty text yields a
  // tool_result with no parts and is rejected provider-side. That rejection is
  // the class of failure that corrupted sessions twice here.
  assert.notEqual(SHORT_MARKER, '')
  assert.notEqual(SHORT_MARKER.trim(), '')
})

test('a collapsed fragment counts as already rewritten', () => {
  // Without this the same fragment would be re-collapsed every pass.
  assert.equal(alreadyRewritten(SHORT_MARKER), true)
})

test('the collapse marker does not match ordinary text containing the same glyph', () => {
  // It is matched by equality, not substring, so prose using "·" as a separator
  // is not mistaken for a compressed record.
  assert.equal(alreadyRewritten('a · b 这是正常内容'), false)
  assert.equal(alreadyRewritten('中·文'), false)
})

test('every wrapper marker still round-trips', () => {
  for (const marker of ALL_MARKERS) {
    assert.equal(alreadyRewritten(`head${marker}tail`), true, marker)
  }
})

test('ordinary content is never treated as rewritten', () => {
  assert.equal(alreadyRewritten(''), false)
  assert.equal(alreadyRewritten('plain tool output'), false)
})
