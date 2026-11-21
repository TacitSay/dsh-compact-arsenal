import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DEFAULTS, normalizeConfig } from '../index.js'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const summarizeSrc = readFileSync(new URL('../lib/summarize.js', import.meta.url), 'utf8')

// Measured on a real session: six turns took 51.7s across SIX calls, one per
// turn. Most of that is per-request overhead (system prompt, headers, round
// trip), so batching turns into one call is where the saving is.

test('the turn-count cap is gone; the time budget is the only brake', () => {
  assert.equal(DEFAULTS.turns.maxTurnsPerPass, undefined, 'no fixed turn cap')
  assert.ok(!/maxTurnsPerPass/.test(src), 'no stale reference in the host')
  assert.ok(!/items >= maxTurns/.test(src), 'the loop no longer breaks on a count')
})

test('the time budget cannot be set below a minute', () => {
  // Under a minute a slow route cannot finish even one batch, so the pass would
  // never make progress no matter how often it ran.
  assert.match(src, /Math\.max\(60000, Number\.isFinite\(policy\.maxPassMs\)/, 'clamped at 60s')
  assert.equal(DEFAULTS.turns.maxPassMs, 180000, 'default is three minutes')
})

test('turns are grouped into batches by total characters', () => {
  assert.match(src, /const batches = \[\]/, 'batches are built')
  assert.match(src, /currentSize \+ clipped\.length > maxInput/, 'grouping respects the input budget')
  assert.match(src, /summarizeTurns\(/, 'one call per batch')
  assert.ok(!/summary = await summarize\(ctx, modelCfg, input, signal\)/.test(src), 'the per-turn call is gone')
})

test('a batch call asks for one record per turn and nothing else', () => {
  assert.match(summarizeSrc, /条数必须等于 \$\{transcripts\.length\}/, 'count is pinned in the prompt')
  assert.match(summarizeSrc, /\{"i":1,"s":"压缩后的记录"\}/, 'reply shape is shown')
})

test('a blank slot means "leave this turn alone", not "fail the batch"', () => {
  // The model may skip an item; failing the whole batch would discard the other
  // summaries that came back fine.
  assert.match(src, /if \(summary === ''\) continue/, 'blank slots are skipped')
  const idx = src.indexOf("if (summary === '') continue")
  const before = src.slice(Math.max(0, idx - 500), idx)
  assert.ok(!/failed \+= 1/.test(before), 'a skipped slot is not counted as a failure')
})

test('one bad batch does not stop the rest', () => {
  assert.match(src, /turns batch failed/, 'a failed batch is logged')
  const idx = src.indexOf('turns batch failed')
  const after = src.slice(idx, idx + 400)
  assert.match(after, /continue/, 'the loop moves to the next batch')
})

test('the ratio is passed to the batch, so per-item length still applies', () => {
  assert.match(src, /summaryRatio: ratio/, 'ratio travels with the batch config')
  assert.match(summarizeSrc, /summaryRatio \* 100/, 'the prompt states the ratio')
})

test('an absent ratio stays unlimited through normalization', () => {
  assert.equal(DEFAULTS.turns.summaryRatio, null)
  assert.equal(normalizeConfig({ turns: {} }).turns.summaryRatio, null)
})
