import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DEFAULTS, deriveInputBudget, deriveOutputBudget } from '../index.js'

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

test('both budgets default to auto, derived from the window', () => {
  // A constant goes stale as models change; the window is what the route can
  // actually accept.
  assert.equal(DEFAULTS.turns.maxInputChars, null, 'input budget is derived')
  assert.equal(DEFAULTS.turns.maxTokens, null, 'output budget is derived')
  assert.equal(DEFAULTS.turns.maxPassMs, 600000, 'ten minutes covers several batches')
})

test('an explicit value still wins over the derived one', () => {
  assert.equal(deriveInputBudget(1000000, 500000), 500000)
  assert.equal(deriveOutputBudget(1000000, 60000), 60000)
})

test('a 1M window derives a budget that fits inside it', () => {
  const input = deriveInputBudget(1000000, null)
  const output = deriveOutputBudget(1000000, null)
  // input chars -> tokens, plus output, must leave headroom in the window.
  const inputTokens = input / 1.5
  assert.ok(inputTokens + output < 1000000, 'input + output must fit the window')
  assert.ok(inputTokens > 100000, 'and be large enough to batch several turns')
})

test('the derived output budget is clamped below the provider ceiling', () => {
  // A 1M route can advertise ~393,216 max output; asking beyond it is rejected.
  assert.ok(deriveOutputBudget(4000000, null) <= 200000)
  assert.equal(deriveOutputBudget(1000000, 393216), 200000, 'an explicit over-ceiling value is clamped')
})
