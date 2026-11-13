/**
 * Reproduce the stall: a provider that never finishes its stream.
 *
 * The failure looked like "no thinking, no tool calls, no reply" because the
 * pre-step waited on a summarization call. This test drives `summarize()` with a
 * stream that yields one delta and then hangs forever, and asserts the call
 * returns instead of awaiting indefinitely.
 *
 * Usage: node --test test/summarize-timeout.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { SUMMARIZE_TIMEOUT_MS, summarize } from '../lib/summarize.js'

// The constant is the production budget; the tests override it per case.
assert.ok(SUMMARIZE_TIMEOUT_MS >= 10000)

/** A ctx whose llm streams the given chunks and then hangs unless aborted. */
function hangingCtx(chunks) {
  return {
    get(name) {
      if (name !== 'llm') return undefined
      return {
        stream(options) {
          return (async function* generate() {
            for (const chunk of chunks) yield chunk
            // Never resolves: models the "provider stops responding" case.
            await new Promise((resolve, reject) => {
              const signal = options.signal
              if (signal === undefined) return
              signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })
          })()
        },
      }
    },
  }
}

const CFG = { provider: 'p', model: 'm', prompt: 'compress', maxTokens: 128 }

test('a provider that never finishes cannot hang the call forever', { timeout: 30000 }, async () => {
  // Shrink the budget so the test is fast; production keeps 45s.
  process.env.COMPACT_ARSENAL_SUMMARIZE_TIMEOUT_MS = '1500'
  const budget = 1500
  const started = Date.now()
  const ctx = hangingCtx([{ type: 'text-delta', text: 'partial' }])
  let error
  try {
    await summarize(ctx, CFG, 'some text to condense', undefined)
  } catch (caught) {
    error = caught
  } finally {
    delete process.env.COMPACT_ARSENAL_SUMMARIZE_TIMEOUT_MS
  }
  const elapsed = Date.now() - started
  assert.ok(error !== undefined, 'a stuck provider must surface as a failure')
  assert.ok(elapsed >= budget - 300, `returned too early: ${elapsed}ms`)
  assert.ok(elapsed < budget + 8000, `returned too late: ${elapsed}ms`)
})

test('an aborted step ends the call immediately, without waiting for the timeout', { timeout: 30000 }, async () => {
  const controller = new AbortController()
  const ctx = hangingCtx([{ type: 'text-delta', text: 'partial' }])
  const started = Date.now()
  setTimeout(() => controller.abort(new Error('step cancelled')), 200)

  await assert.rejects(
    () => summarize(ctx, CFG, 'some text', controller.signal),
    /aborted|cancelled|summarize-timeout/,
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed < 10000, `should not wait for the full timeout: ${elapsed}ms`)
})

test('a stream that finishes normally still returns its text', async () => {
  const ctx = {
    get: () => ({
      stream(options) {
        return (async function* generate() {
          yield { type: 'text-delta', text: 'hello ' }
          yield { type: 'text-delta', text: 'world' }
          yield { type: 'finish', reason: { kind: 'stop' } }
          void options
        })()
      },
    }),
  }
  const out = await summarize(ctx, CFG, 'text', undefined)
  assert.equal(out, 'hello world')
})
