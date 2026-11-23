import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeConfig } from '../index.js'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// Two sections are retired: `reasoning` is subsumed by turn compression, and
// `tools` carries the pre-batching 12,000-char truncation. Both were removed from
// the panel, so a value left on by an older config cannot be switched off through
// the UI — it has to be coerced off in code.

test('a retired section cannot be switched back on through the config', () => {
  const cfg = normalizeConfig({
    reasoning: { enabled: true },
    tools: { enabled: true },
  })
  assert.equal(cfg.reasoning.enabled, false, 'reasoning is coerced off')
  assert.equal(cfg.tools.enabled, false, 'tools is coerced off')
})

test('the coercion happens in normalizeConfig, not at use time', () => {
  // Until this is in `normalizeConfig`, a saved config keeps the section alive.
  assert.match(src, /reasoning\.enabled = false/)
  assert.match(src, /tools\.enabled = false/)
})

test('the active section is unaffected', () => {
  const cfg = normalizeConfig({ turns: { enabled: true } })
  assert.equal(cfg.turns.enabled, true)
})
