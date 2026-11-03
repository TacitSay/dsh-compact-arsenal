import test from 'node:test'
import assert from 'node:assert/strict'

import { parseSummaries } from '../lib/summarize.js'

test('parseSummaries reads a plain JSON array', () => {
  const raw = '[{"i":1,"s":"第一段要点"},{"i":2,"s":"第二段"}]'
  assert.deepEqual(parseSummaries(raw, 2), ['第一段要点', '第二段'])
})

test('parseSummaries tolerates prose and code fences around the array', () => {
  const raw = '好的，结果如下：\n```json\n[{"i":1,"s":"A"},{"i":2,"s":"B"}]\n```\n以上。'
  assert.deepEqual(parseSummaries(raw, 2), ['A', 'B'])
})

test('parseSummaries keeps input order and fills gaps with empty strings', () => {
  const raw = '[{"i":3,"s":"third"},{"i":1,"s":"first"}]'
  assert.deepEqual(parseSummaries(raw, 3), ['first', '', 'third'])
})

test('parseSummaries returns null when nothing usable came back', () => {
  assert.equal(parseSummaries('no json here', 2), null)
  assert.equal(parseSummaries('[{"i":9,"s":"out of range"}]', 2), null)
  assert.equal(parseSummaries('[not json]', 2), null)
})
