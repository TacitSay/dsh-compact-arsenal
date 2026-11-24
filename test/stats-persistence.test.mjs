import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { addTotals, emptyTotals, readTotals, statsFile } from '../lib/stats.js'

// The problem: `stats` was a plain in-memory object. Every restart showed "0 次",
// and there was no way to tell "nothing happened yet" from "nothing happened since
// I restarted". A lifetime counter answers the first question; the process counter
// answers the second.

const file = statsFile()

/** Remove the file so a test starts from a known state. */
function reset() {
  try {
    if (existsSync(file)) rmSync(file)
  } catch { /* ignore */ }
}

test('a missing file reads as zeroed counters, not an error', async () => {
  reset()
  const totals = await readTotals()
  assert.deepEqual(totals, emptyTotals())
  assert.equal(totals.since, null, 'no activity recorded yet')
})

test('an increment is written and readable again', async () => {
  reset()
  await addTotals({ turns: 3, chars: 9000, archived: 3, passes: 1 })
  const after = await readTotals()
  assert.equal(after.turns, 3)
  assert.equal(after.chars, 9000)
  assert.equal(after.archived, 3)
  assert.equal(after.passes, 1)
  assert.ok(typeof after.since === 'string', 'first write stamps `since`')
  assert.ok(typeof after.updatedAt === 'string')
})

test('increments accumulate across calls', async () => {
  reset()
  await addTotals({ turns: 2, chars: 1000 })
  await addTotals({ turns: 5, chars: 4000 })
  const after = await readTotals()
  assert.equal(after.turns, 7)
  assert.equal(after.chars, 5000)
})

test('`since` keeps the first timestamp while `updatedAt` moves', async () => {
  reset()
  await addTotals({ turns: 1 })
  const first = await readTotals()
  await new Promise((r) => setTimeout(r, 10))
  await addTotals({ turns: 1 })
  const second = await readTotals()
  assert.equal(second.since, first.since, 'since is stable')
  assert.notEqual(second.updatedAt, first.updatedAt, 'updatedAt advances')
})

test('a corrupt file degrades to zeros instead of throwing', async () => {
  // The counter is diagnostic; the archive is the source of truth. A broken file
  // must not stop a compression from running.
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'not json at all', 'utf8')

  const totals = await readTotals()
  assert.deepEqual(totals, emptyTotals())
})

test('unknown fields in the file are ignored, not copied through', async () => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ turns: 4, bogus: 'x', chars: 'not a number' }), 'utf8')

  const totals = await readTotals()
  assert.equal(totals.turns, 4)
  assert.equal(totals.chars, 0, 'a non-numeric value falls back to zero')
  assert.equal(totals.bogus, undefined, 'unknown keys are dropped')
})

test('the host persists per pass, not per item', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(src, /addTotals\(\{/, 'the host writes totals')
  // One call site inside the turns branch; a per-item write would live in a loop.
  const calls = [...src.matchAll(/addTotals\(/g)].length
  assert.equal(calls, 1, 'exactly one write site')
  assert.match(src, /turns: saved\.items/, 'the pass result is the delta')
})

test('the panel distinguishes process counters from lifetime totals', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(client, /本次：/, 'process line')
  assert.match(client, /累计：/, 'lifetime line')
  assert.match(client, /totals\.since\.slice\(0, 10\)/, 'shows the start date, not a raw timestamp')
})

// Clean up regardless of pass/fail: leaving a stats.json behind would make the
// next `node scripts/deploy.mjs` report a stray file.
after(() => { try { if (existsSync(file)) rmSync(file) } catch { /* ignore */ } })
