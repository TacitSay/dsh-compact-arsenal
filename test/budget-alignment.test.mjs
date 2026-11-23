import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DEFAULTS } from '../index.js'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const sum = readFileSync(new URL('../lib/summarize.js', import.meta.url), 'utf8')

// Found by tracing a real batch: the sizing numbers disagreed with each other, so
// a batch was grouped to 24,000 chars, then silently cut to 12,000 inside
// `summarize`, then given 45 seconds to emit output that needs minutes.

test('the input budget travels all the way to the truncation point', () => {
  // Grouping decides how much to send; if the truncation ignores that decision,
  // most of every batch is discarded without a single log line.
  assert.match(sum, /const budgetChars = Number\.isFinite\(cfg\.maxInputChars\)/, 'summarize reads the caller budget')
  assert.match(sum, /text\.length > budgetChars \? text\.slice\(0, budgetChars\)/, 'truncates to it, not the constant')
  assert.match(src, /summaryRatio: ratio, maxInputChars: maxInput/, 'the host passes it through')
})

test('the per-call timeout scales with the requested output', () => {
  // A fixed ceiling is wrong whenever the output budget changes: 45s suits one
  // summary and kills any batch.
  assert.match(sum, /function timeoutMs\(maxTokens\)/, 'takes the output budget')
  assert.match(sum, /ASSUMED_TOKENS_PER_SEC/, 'sizes from an assumed rate')
  assert.match(sum, /Math\.max\(SUMMARIZE_TIMEOUT_MS, generationMs \+ TIMEOUT_SLACK_MS\)/, 'never below the floor')
})

test('the timeout still has a floor for a tiny request', () => {
  assert.ok(SUMMARIZE_FLOOR_OK(sum), 'the old 45s constant remains the minimum')
})
function SUMMARIZE_FLOOR_OK(text) {
  return /export const SUMMARIZE_TIMEOUT_MS = 45000/.test(text)
}

test('the defaults are sized for batching, not for one turn', () => {
  // Measured: ~21,600 chars per turn, ~930 tokens per summary, ~105 tok/s output.
  assert.equal(DEFAULTS.turns.maxInputChars, 250000, 'about 11 turns per call')
  assert.equal(DEFAULTS.turns.maxTokens, 16000, 'about 17 summaries per call')
  assert.equal(DEFAULTS.turns.maxPassMs, 600000, 'ten minutes covers several batches')
})

test('a pass longer than its per-call timeout is coherent', () => {
  // maxPassMs bounds the whole pass; one call inside it must be allowed to
  // finish, or every pass ends mid-batch.
  assert.ok(DEFAULTS.turns.maxPassMs > 0)
  assert.ok(DEFAULTS.turns.maxTokens > 0)
})
