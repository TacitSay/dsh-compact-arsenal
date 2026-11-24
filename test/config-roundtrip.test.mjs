import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// Two bugs, one visible symptom each:
//   "保存失败：400"     — the client posted a config it had merged incompletely
//   "v?"                — the save response omitted `version`, so the badge blanked

/** Mirror of the client's mergeConfig. */
function mergeConfig(emptyConfig, served) {
  const input = served !== null && typeof served === 'object' ? served : {}
  const section = (base, given) => ({ ...base, ...(given !== null && typeof given === 'object' ? given : {}) })
  return {
    ...emptyConfig,
    ...input,
    trigger: section(emptyConfig.trigger, input.trigger),
    turns: section(emptyConfig.turns, input.turns),
    total: section(emptyConfig.total, input.total),
    reasoning: { ...section(emptyConfig.reasoning, input.reasoning), model: section(emptyConfig.reasoning.model, (input.reasoning || {}).model) },
    tools: { ...section(emptyConfig.tools, input.tools), model: section(emptyConfig.tools.model, (input.tools || {}).model) },
  }
}

const empty = {
  enabled: true,
  trigger: { pressureRatio: 0.75 },
  turns: { enabled: false, pressureRatio: 0.7, keepLast: 2, maxTokens: null },
  total: { enabled: false, pressureRatio: 0.85 },
  reasoning: { enabled: false, model: { provider: '', model: '' } },
  tools: { enabled: false, model: { provider: '', model: '' } },
}

test('turns is deep-merged, not merely spread', () => {
  // The bug: `turns` was added to the config but not to mergeConfig, so a served
  // config missing a field left the client holding an incomplete section.
  assert.match(client, /turns:\s*section\(emptyConfig\.turns, input\.turns\)/, 'turns has its own merge')
})

test('a served turns with one field keeps the defaults for the rest', () => {
  const merged = mergeConfig(empty, { turns: { enabled: true } })
  assert.equal(merged.turns.enabled, true, 'the served value wins')
  assert.equal(merged.turns.pressureRatio, 0.7, 'defaults survive')
  assert.equal(merged.turns.keepLast, 2)
})

test('an absent turns section yields the full default', () => {
  const merged = mergeConfig(empty, {})
  assert.deepEqual(merged.turns, empty.turns)
})

test('the save response carries every field the panel displays', () => {
  // The badge read `v?` after a save because the response had no `version`, and
  // the handler overwrites state from it.
  const saveBlock = host.slice(host.indexOf("route(`${API_PREFIX}/config`"))
  const resp = saveBlock.slice(saveBlock.indexOf('send(res, 200, {'), saveBlock.indexOf('})', saveBlock.indexOf('send(res, 200, {')))
  for (const field of ['version', 'config', 'stats', 'totals', 'lastFailure', 'archiveRoot', 'logRoot', 'pressure']) {
    assert.ok(resp.includes(field), `save response must include ${field}`)
  }
})

test('both responses share the same field set', () => {
  // Two endpoints answer "what is the state"; a field present in one and absent in
  // the other makes the panel flicker between values.
  const stateBlock = host.slice(host.indexOf("route(`${API_PREFIX}/state`"))
  for (const field of ['version', 'config', 'stats', 'totals', 'archiveRoot', 'logRoot', 'pressure']) {
    assert.ok(stateBlock.includes(field), `state response must include ${field}`)
  }
})
