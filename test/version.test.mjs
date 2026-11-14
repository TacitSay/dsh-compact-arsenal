import test from 'node:test'
import assert from 'node:assert/strict'

import { PACKAGE_NAME, PACKAGE_VERSION, compareVersions } from '../index.js'

// `index.js` is the plugin entry; importing it must not require a Host, so this
// also proves the module stays side-effect free at load time.

test('a higher version compares as newer', () => {
  assert.ok(compareVersions('0.10.1', '0.10.0') > 0)
  assert.ok(compareVersions('1.0.0', '0.99.9') > 0)
  assert.ok(compareVersions('0.11.0', '0.10.9') > 0)
})

test('an identical version compares as equal', () => {
  assert.equal(compareVersions('0.10.0', '0.10.0'), 0)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
})

test('numeric ordering beats string ordering across a minor bump', () => {
  // The classic trap: as strings "0.9.3" sorts AFTER "0.10.0" (because '9' >
  // '1' at the second character), so a naive string compare would tell every
  // 0.9.x user they are already current.
  assert.equal('0.9.3' > '0.10.0', true, 'string comparison really does get this wrong')
  assert.ok(compareVersions('0.9.3', '0.10.0') < 0, 'the comparator gets it right')
})

test('prerelease tags are ignored so a stable install is not offered a beta', () => {
  assert.equal(compareVersions('0.11.0-rc.1', '0.11.0'), 0)
  assert.ok(compareVersions('0.11.0-rc.1', '0.10.0') > 0)
})

test('the package identity is declared', () => {
  assert.equal(PACKAGE_NAME, 'dsh-compact-arsenal')
  assert.match(PACKAGE_VERSION, /^\d+\.\d+\.\d+$/)
})
