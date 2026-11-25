import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { archiveRoot, archiveFallbackRoot, dshHome, isManagedInstall } from '../lib/archive.js'
import { logRoot } from '../lib/log.js'
import { statsFile } from '../lib/stats.js'

// The defect this guards: data was written next to the plugin, which for an npm
// install means inside `node_modules` — a directory pnpm deletes and recreates on
// every reinstall. A user's records would vanish with no error at all.

test('an explicit archiveDir always wins', () => {
  assert.equal(archiveRoot('D:/records'), 'D:/records')
  assert.equal(archiveRoot('  D:/records  '), 'D:/records', 'trimmed')
  assert.equal(archiveRoot(''), archiveRoot(undefined), 'empty falls through to the default')
})

test('the fallback is always under DSH_HOME, never the plugin tree', () => {
  // A read-only install directory is exactly the case where the plugin tree cannot
  // be trusted to keep anything.
  const fallback = archiveFallbackRoot()
  assert.ok(fallback.startsWith(dshHome()), `fallback ${fallback} should sit under ${dshHome()}`)
  assert.ok(!fallback.includes('node_modules'), 'fallback must not point into node_modules')
})

test('DSH_HOME is honoured when set', () => {
  const previous = process.env.DSH_HOME
  try {
    // Use a platform-native path so the comparison is not a separator mismatch.
    const portable = join(tmpdir(), 'portable-dsh')
    process.env.DSH_HOME = portable
    assert.equal(dshHome(), portable)
    assert.ok(archiveFallbackRoot().startsWith(portable), 'fallback follows DSH_HOME')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('a development checkout keeps data beside the source', () => {
  // This test runs from the checkout, so the managed branch must not be active.
  assert.equal(isManagedInstall(), false, 'checkout path has no node_modules segment')
  assert.ok(!archiveRoot('').includes('node_modules'))
  assert.ok(!logRoot().includes('node_modules'))
  assert.ok(!statsFile().includes('node_modules'))
})

test('a copy under node_modules writes to DSH_HOME instead', async () => {
  // The only honest way to test this: place the modules at a real node_modules path
  // and import them, because the decision reads the module's own URL.
  const base = join(tmpdir(), 'arsenal-managed-test')
  const pluginDir = join(base, 'profile', 'node_modules', 'dsh-compact-arsenal')
  const libDir = join(pluginDir, 'lib')

  rmSync(base, { recursive: true, force: true })
  mkdirSync(libDir, { recursive: true })
  for (const f of ['archive.js', 'log.js', 'stats.js']) {
    copyFileSync(new URL(`../lib/${f}`, import.meta.url), join(libDir, f))
  }

  try {
    const url = (f) => `file:///${join(libDir, f).replace(/\\/g, '/')}`
    const archive = await import(url('archive.js'))
    const log = await import(url('log.js'))
    const stats = await import(url('stats.js'))

    assert.equal(archive.isManagedInstall(), true, 'node_modules detected')
    for (const [label, value] of [
      ['archive', archive.archiveRoot('')],
      ['logs', log.logRoot()],
      ['stats', stats.statsFile()],
    ]) {
      assert.ok(!value.includes('node_modules'), `${label} must not live in node_modules: ${value}`)
      assert.ok(value.startsWith(archive.dshHome()), `${label} should be under DSH_HOME: ${value}`)
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
    assert.equal(existsSync(base), false, 'temp tree removed')
  }
})

test('all three stores agree on the same base', () => {
  // They must not disagree: a split would put the archive somewhere the panel does
  // not look.
  const root = archiveRoot('')
  const logs = logRoot()
  const stats = statsFile()
  if (isManagedInstall()) {
    for (const p of [root, logs, stats]) assert.ok(p.startsWith(join(dshHome(), 'compact-arsenal')))
  } else {
    const pluginRoot = root.replace(/[\\/]archive$/, '')
    assert.ok(logs.startsWith(pluginRoot), 'logs beside the archive')
    assert.ok(stats.startsWith(pluginRoot), 'stats beside the archive')
  }
})
