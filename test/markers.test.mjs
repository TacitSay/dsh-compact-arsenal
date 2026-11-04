import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MODEL_REASONING_MARKER,
  MODEL_TOOL_MARKER,
  REASONING_MARKER,
  TOOL_MARKER,
  alreadyRewritten,
} from '../lib/policy.js'

test('alreadyRewritten detects the mechanical tool marker', () => {
  assert.equal(alreadyRewritten(`head${TOOL_MARKER}tail`), true)
})

test('alreadyRewritten detects the mechanical reasoning marker', () => {
  assert.equal(alreadyRewritten(`head${REASONING_MARKER}tail`), true)
})

test('alreadyRewritten detects the model markers', () => {
  assert.equal(alreadyRewritten(`head${MODEL_TOOL_MARKER}tail`), true)
  assert.equal(alreadyRewritten(`head${MODEL_REASONING_MARKER}tail`), true)
})

test('alreadyRewritten ignores untouched text', () => {
  assert.equal(alreadyRewritten('plain tool output, nothing rewritten yet'), false)
  assert.equal(alreadyRewritten(''), false)
})

test('model and mechanical markers are distinct strings', () => {
  assert.notEqual(MODEL_TOOL_MARKER, TOOL_MARKER)
  assert.notEqual(MODEL_REASONING_MARKER, REASONING_MARKER)
  assert.ok(!TOOL_MARKER.includes('model'))
  assert.ok(MODEL_TOOL_MARKER.includes('model'))
})
