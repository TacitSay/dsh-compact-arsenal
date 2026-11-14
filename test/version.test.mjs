import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PACKAGE_NAME, PACKAGE_VERSION, compareVersions } from '../index.js'

// `index.js` is the plugin entry; importing it must not require a Host, so this
// also proves the module stays side-effect free at load time.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

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

test('the runtime version, package.json and CHANGELOG agree', () => {
  // Three places state the version and nothing links them at build time, so a
  // release that updates one and forgets another ships a lie. SemVer rule 3
  // ("published content must not change") only holds if the number is consistent.
  assert.equal(PACKAGE_VERSION, pkg.version, 'index.js must match package.json')
  assert.ok(changelog.includes(`## [${PACKAGE_VERSION}]`), `CHANGELOG must document ${PACKAGE_VERSION}`)
})

test('the newest CHANGELOG entry is the shipped version, not an Unreleased stub', () => {
  // An `[Unreleased]` section above a released number is normal, but the top
  // *numbered* heading must be the version this tree actually is.
  const numbered = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1])
  assert.ok(numbered.length > 0, 'at least one release must be documented')
  assert.equal(numbered[0], PACKAGE_VERSION, 'the newest numbered entry is the current version')
})

