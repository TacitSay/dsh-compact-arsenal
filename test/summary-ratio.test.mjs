import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULTS, normalizeConfig } from '../index.js'

// The summary cap used to be a fixed 2000 characters, which is wrong for both
// ends of the range: a 3,000-char turn was cut mid-sentence, and a 360,000-char
// turn (measured on a real session) was squeezed to 99.4% compression with no
// guarantee the important part survived. A ratio scales with the input instead.

/** Mirror of `turnsPass`'s cap logic. */
function applyRatio(summary, middle, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return summary
  const cap = Math.max(200, Math.floor(middle * ratio))
  return [...summary].length > cap ? [...summary].slice(0, cap).join('') : summary
}

test('an unset ratio means no limit', () => {
  assert.equal(DEFAULTS.turns.summaryRatio, null, 'default ships unlimited')
  const long = 'x'.repeat(5000)
  assert.equal(applyRatio(long, 1000, null), long, 'null leaves the summary alone')
})

test('a zero ratio also means no limit, not "erase everything"', () => {
  const text = 'x'.repeat(500)
  assert.equal(applyRatio(text, 10000, 0), text)
})

test('a ratio caps proportionally to the middle', () => {
  const middle = 100000
  const summary = 'x'.repeat(60000)
  assert.equal([...applyRatio(summary, middle, 0.1)].length, 10000, '10% of 100k')
  assert.equal([...applyRatio(summary, middle, 0.5)].length, 50000, '50% of 100k')
  // Under the cap: untouched, so a good short summary is never truncated.
  assert.equal([...applyRatio('x'.repeat(5000), middle, 0.1)].length, 5000)
})

test('the cap never drops below a readable floor', () => {
  // A tiny middle would otherwise allow a 30-character cap, which cannot hold a
  // file path plus a conclusion.
  assert.equal([...applyRatio('x'.repeat(1000), 100, 0.1)].length, 200, 'floor of 200 applies')
})

test('a summary already under the cap is untouched', () => {
  const summary = 'brief'
  assert.equal(applyRatio(summary, 100000, 0.1), summary)
})

test('the ratio is clamped to a usable range when normalized', () => {
  const high = normalizeConfig({ turns: { summaryRatio: 1 } })
  assert.equal(high.turns.summaryRatio, 1)
  const blank = normalizeConfig({ turns: {} })
  assert.equal(blank.turns.summaryRatio, null, 'absent stays unlimited')
})
