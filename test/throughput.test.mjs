import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// The incident this guards against: a session with 760 tool fragments (1.09M
// chars) never compressed. `tools.mode: model` queued all of it for
// summarization, which needs ~91 calls, while a 90s budget allows ~28. The
// pass hit its budget with items=0 and reported 95 failures.

test('model mode is bounded by time, not by a fixed item count', () => {
  // A fixed cap of 12 covers 1.6% of a 760-fragment backlog, so each turn
  // started over and the session never shrank.
  assert.match(
    src,
    /const itemCap = policy\.mode === 'model' \? Number\.POSITIVE_INFINITY : maxItems/,
    'model mode must not be capped by maxItems',
  )
  assert.match(src, /while \(index < candidates\.length && items < itemCap/, 'the loop uses the cap')
})

test('mechanical mode keeps a hard item cap', () => {
  // Mechanical passes cost nothing per item, so an unbounded loop is the risk
  // there — the opposite of the model case.
  assert.match(src, /: maxItems/, 'mechanical mode still bounds by maxItems')
})

test('batches fill by characters so a large backlog needs fewer calls', () => {
  // 8-per-batch made 760 fragments take 95 calls; the real limit is the prompt
  // char cap, so filling to it is what keeps the call count sane.
  assert.match(src, /batch\.length < 24 && batchSize < batchChars/, 'batch fills to the char cap')
  assert.ok(!/batch\.length < 8 && batchSize < batchChars/.test(src), 'the 8-item cap is gone')
})

test('a budget stop is reported as progress, not as failure', () => {
  // Previously this set lastFailure and incremented nothing, so the panel said
  // "failed 95 times, 0 compressed" after a pass that may have compressed plenty.
  assert.match(src, /pass budget reached/, 'the budget stop is logged distinctly')
  assert.ok(
    /本轮处理了 \$\{items\} 条后到达/.test(src),
    'the message reports how many items did land',
  )
  assert.ok(
    !/pass stopped after \$\{budgetMs\}ms budget`/.test(src),
    'the old failure-shaped message is gone',
  )
})

test('the budget stop does not increment the failed counter', () => {
  // Grab the budget branch and confirm nothing increments `failed` there.
  const idx = src.indexOf('pass budget reached')
  assert.ok(idx > 0, 'budget branch exists')
  const branch = src.slice(Math.max(0, idx - 400), idx + 200)
  assert.ok(!/failed \+= 1/.test(branch), 'a budget stop is not a failure')
})
