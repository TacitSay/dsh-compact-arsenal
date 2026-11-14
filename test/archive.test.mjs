import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { archiveFallbackRoot, archiveRoot, archiveRewrite } from '../lib/archive.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

test('archiveRoot lives inside the plugin directory, whatever the machine', () => {
  const root = archiveRoot('')
  assert.equal(root, join(PLUGIN_ROOT, 'archive'))
  // The point is that it follows THIS module, not that the path avoids any
  // particular string: the plugin may legitimately live under ~/.dsh.
  assert.ok(root.startsWith(PLUGIN_ROOT), root)
})

test('archiveRoot ignores DSH_HOME, so the archive travels with the plugin', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home-test'
  try {
    assert.equal(archiveRoot(''), join(PLUGIN_ROOT, 'archive'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('the fallback root stays under the Harness home', () => {
  const previous = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    const root = archiveFallbackRoot()
    assert.ok(root.startsWith(homedir()), `expected a path under ${homedir()}, got ${root}`)
    assert.ok(root.endsWith('compact-arsenal'))
  } finally {
    if (previous !== undefined) process.env.DSH_HOME = previous
  }
})

test('an explicit archiveDir wins over both defaults', () => {
  assert.equal(archiveRoot('D:/custom/archive'), 'D:/custom/archive')
})

test('identity is the directory; the file name carries only what varies', async () => {
  const root = join(homedir(), '.dsh-compact-arsenal-test')
  const at = new Date('2026-11-11T21:45:30').getTime()
  const path = await archiveRewrite({
    root,
    sessionId: 'session-test/../escape',
    sessionTitle: 'WordCut 词剪',
    kind: 'tools',
    method: 'model',
    seq: 42,
    original: 'ORIGINAL BODY',
    replacement: 'REPLACED BODY',
    summary: 'summary text',
    time: at,
  })
  assert.ok(path !== undefined)
  assert.ok(path.startsWith(root))
  const relative = path.slice(root.length + 1)
  const segments = relative.split(/[\\/]/)
  // One sanitised session directory plus the record file: never an extra level.
  assert.equal(segments.length, 2, `expected session dir + file, got ${relative}`)

  const [dir, file] = segments

  // The directory is the identity: title first (what a reader scans for), then
  // the session id (what is unambiguous).
  assert.ok(dir.startsWith('WordCut-'), `directory leads with the title: ${dir}`)
  assert.ok(dir.includes('session-test'), `directory carries the session id: ${dir}`)

  // The file name repeats neither: only content, method, time and node.
  assert.ok(!file.includes('WordCut'), `file must not repeat the title: ${file}`)
  assert.ok(!file.includes('session'), `file must not repeat the id: ${file}`)
  assert.ok(file.startsWith('tools--model--'), `content and method lead the file name: ${file}`)
  assert.match(file, /--\d{8}-\d{6}--/, `timestamp segment: ${file}`)
  assert.ok(file.endsWith('--seq42.md'), `node suffix: ${file}`)
})

test('archiveRewrite never prefixes the session id when no title exists', async () => {
  const root = join(homedir(), '.dsh-compact-arsenal-test')
  const path = await archiveRewrite({
    root,
    sessionId: 'session-abc',
    kind: 'reasoning',
    method: 'mechanical',
    seq: 7,
    original: 'a',
    replacement: 'b',
  })
  assert.ok(path !== undefined)
  const relative = path.slice(root.length + 1)
  const [dir, file] = relative.split(/[\\/]/)
  // A record without a title still gets a neutral placeholder in the directory,
  // so the layout stays predictable; the file name never carries identity.
  assert.ok(dir.startsWith('未命名对话--'), dir)
  assert.ok(dir.endsWith('session-abc'), dir)
  assert.ok(!file.includes('session'), file)
})

