import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DEFAULTS } from '../index.js'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// Four problems found by auditing a real install rather than the source:
//   1. saved config overrode the new defaults, so batching never took effect
//   2. a small session hit `keepLast` and did nothing, silently
//   3. the panel showed failures but never successes
//   4. a missing route failed every batch with a stack-trace-shaped message

test('the code default for the batch budget matches what makes batching worthwhile', () => {
  // Measured: turn transcripts average ~21,600 chars, so 24,000 fits one turn and
  // batching saves nothing. 96,000 fits about three.
  assert.equal(DEFAULTS.turns.maxInputChars, null)
  assert.equal(DEFAULTS.turns.maxTokens, null, 'derived from the window')
})

test('the runtime fallback matches the default, not the old value', () => {
  // A mismatch here is invisible: the saved config wins, and every fallback path
  // silently uses the stale number.
  assert.match(src, /deriveInputBudget\(window, policy\.maxInputChars\)/, 'input budget is derived')
  assert.match(src, /deriveOutputBudget\(window, policy\.maxTokens\)/, 'output budget is derived')
})

test('keepLast doing nothing is reported, not silent', () => {
  // The switch is on and pressure is over the threshold, yet nothing runs; a log
  // line is the only way to tell that from a bug.
  assert.match(src, /turns idle/, 'an idle pass is logged')
  assert.match(src, /keepLast=\$\{keepLast\} 全部保留/, 'the reason names keepLast')
})

test('no user turns yet is also reported', () => {
  assert.match(src, /reason: 'no user turns found yet'/)
})

test('a missing route is caught before any batch is attempted', () => {
  assert.match(src, /turns misconfigured/, 'a distinct message')
  assert.match(src, /压缩模型未配置/, 'says what to fix')
  const idx = src.indexOf('turns misconfigured')
  const before = src.slice(Math.max(0, idx - 700), idx)
  assert.ok(before.includes("modelCfg.provider === '' || modelCfg.model === ''"), 'checked up front')
})

test('the stats object declares turns rather than adding it lazily', () => {
  assert.match(src, /const stats = \{ reasoning: 0, tools: 0, turns: 0, chars: 0, failed: 0, archived: 0 \}/)
  assert.ok(!/stats\.turns = \(stats\.turns \?\? 0\)/.test(src), 'no lazy initialisation left')
})

test('the panel reports successes, not only failures', () => {
  assert.match(client, /已压缩 \$\{stats\.turns\} 轮/, 'turn count is shown')
  assert.match(client, /共省下 \$\{stats\.chars\.toLocaleString\(\)\} 字符/, 'saved characters are shown')
})
