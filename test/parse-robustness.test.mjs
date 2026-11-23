import test from 'node:test'
import assert from 'node:assert/strict'

import { parseSummaries } from '../lib/summarize.js'

// Regression: a greedy /\[[\s\S]*\]/ matched from the first `[` to the LAST `]`,
// so any bracket after the array swallowed the JSON and the batch was lost. Real
// production cost: two 12-turn batches in one pass.

test('an array followed by bracketed prose still parses', () => {
  const raw = '[{"i":1,"s":"ok"}]\n\n注意：[重要] 已完成'
  assert.deepEqual(parseSummaries(raw, 1), ['ok'])
})

test('two arrays: the first one wins', () => {
  const raw = '[{"i":1,"s":"a"}]\n[{"i":2,"s":"b"}]'
  assert.deepEqual(parseSummaries(raw, 1), ['a'])
})

test('prose before the array is ignored', () => {
  const raw = '好的，结果如下：\n[{"i":1,"s":"ok"}]\n以上。'
  assert.deepEqual(parseSummaries(raw, 1), ['ok'])
})

test('brackets inside a string do not confuse the scan', () => {
  const raw = '[{"i":1,"s":"数组 [1,2,3] 处理"}]'
  assert.deepEqual(parseSummaries(raw, 1), ['数组 [1,2,3] 处理'])
})

test('a fenced block still parses', () => {
  assert.deepEqual(parseSummaries('```json\n[{"i":1,"s":"ok"}]\n```', 1), ['ok'])
})

test('truncated JSON is still a failure — that is a real loss, not a bracket problem', () => {
  assert.equal(parseSummaries('[{"i":1,"s":"ok"},{"i":2,"s":"half', 2), null)
})

test('an empty array is unusable, not an empty success', () => {
  assert.equal(parseSummaries('[]', 1), null)
})

test('a model that skips an item leaves a blank, keeping the rest', () => {
  const raw = '[{"i":1,"s":"a"},{"i":3,"s":"c"}]'
  assert.deepEqual(parseSummaries(raw, 3), ['a', '', 'c'])
})

test('out-of-range indices are dropped', () => {
  assert.deepEqual(parseSummaries('[{"i":9,"s":"x"},{"i":1,"s":"a"}]', 1), ['a'])
})

test('no brackets at all is a failure', () => {
  assert.equal(parseSummaries('抱歉，我无法完成。', 1), null)
})
