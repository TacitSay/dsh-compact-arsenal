import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

/**
 * A pass reported `eligible=100` and `items=67`, and nothing anywhere said what
 * happened to the other 33. They had been dropped by two `continue` statements that
 * logged nothing, so the only way to tell "skipped by design" from "silently broken"
 * was to replay the session by hand.
 *
 * These tests pin the counters that close that gap.
 */

test('the condensed skip is counted', () => {
  assert.ok(
    /if \(isCondensedMiddle\(session, interval\)\) \{ skippedCondensed \+= 1; continue \}/.test(src),
    'an already-compressed turn must increment skippedCondensed, not vanish',
  )
})

test('the too-small skip is counted', () => {
  assert.ok(
    /if \(middle < minChars\) \{ skippedTooSmall \+= 1; continue \}/.test(src),
    'a turn below minChars must increment skippedTooSmall, not vanish',
  )
})

test('the pass-end line reports both counters', () => {
  const line = src.match(/'turns pass end'[\s\S]{0,600}?\}\)/)
  assert.ok(line, 'the log call exists')
  assert.ok(line[0].includes('skippedCondensed'), 'skippedCondensed is logged')
  assert.ok(line[0].includes('skippedTooSmall'), 'skippedTooSmall is logged')
})

test('the counters reconcile eligible against items', () => {
  // eligible = items + skippedCondensed + skippedTooSmall + (whatever the budget
  // cut). The first three must therefore all be reported together, or the arithmetic
  // cannot be closed by a reader.
  const line = src.match(/'turns pass end'[\s\S]{0,600}?\}\)/)
  for (const field of ['items', 'skippedCondensed', 'skippedTooSmall']) {
    assert.ok(line[0].includes(field), `${field} must be in the same log line as items`)
  }
})

test('the counters start at zero for every pass', () => {
  // Declared inside turnsPass, not at module scope: a leaked counter would accumulate
  // across passes and report a growing number that means nothing.
  assert.ok(/let skippedCondensed = 0/.test(src), 'skippedCondensed is initialised')
  assert.ok(/let skippedTooSmall = 0/.test(src), 'skippedTooSmall is initialised')
  assert.ok(
    !/^(?:let|var|const) skippedCondensed/m.test(src),
    'it must not be module-scoped',
  )
})
