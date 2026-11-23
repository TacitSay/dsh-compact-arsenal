import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// The incident this guards against: usage fell from 667,886 to 570,210 between two
// turns, the log showed only `cascade skip`, and it was impossible to tell whether
// this plugin or DSH's own compaction caused it. The answer — "not us" — took a
// manual dig through the whole log to establish.

/** Mirror of the host's attribution decision. */
function attribute(prev, used, threshold = 5000) {
  if (prev === undefined) return undefined
  const delta = used - prev.used
  if (Math.abs(delta) < threshold) return undefined
  if (delta < 0) return prev.didCompress === true ? 'compact-arsenal' : 'external'
  return 'conversation'
}

test('a shrink after our own pass is attributed to us', () => {
  assert.equal(attribute({ used: 667886, didCompress: true }, 570210), 'compact-arsenal')
})

test('a shrink we did not cause is attributed to something else', () => {
  // This is the case that cost a debugging session: without the label, "it shrank"
  // looks like our work and sends the reader hunting in the wrong place.
  assert.equal(attribute({ used: 667886, didCompress: false }, 570210), 'external')
})

test('growth is attributed to the conversation', () => {
  assert.equal(attribute({ used: 570210, didCompress: false }, 582012), 'conversation')
})

test('ordinary drift is not reported', () => {
  // Logging every few-thousand-token wobble would bury the meaningful lines.
  assert.equal(attribute({ used: 570210, didCompress: false }, 573000), undefined)
  assert.equal(attribute({ used: 570210, didCompress: false }, 568000), undefined)
})

test('the first observation of a session has nothing to compare against', () => {
  assert.equal(attribute(undefined, 25441), undefined)
})

test('the host keeps per-session state and flips it on a landing pass', () => {
  assert.match(src, /const lastSeen = new Map\(\)/, 'state is per session')
  assert.match(src, /lastSeen\.set\(session\.id, \{ used, didCompress: false \}\)/, 'reset each turn')
  assert.match(src, /didCompress: true/, 'flipped when a pass lands')
})

test('the gate line only grows fields when a change is worth naming', () => {
  assert.match(src, /const CHANGE_THRESHOLD = 5000/)
  assert.match(src, /prev: prev\.used, delta, by: attribution/, 'names the previous size and cause')
})
