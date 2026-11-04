import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { archiveRoot, archiveRewrite } from '../lib/archive.js'

test('archiveRoot follows DSH_HOME when set', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home-test'
  try {
    assert.equal(archiveRoot(''), join('/tmp/dsh-home-test', 'compact-arsenal'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('archiveRoot falls back to the user home, never a fixed absolute path', () => {
  const previous = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    const root = archiveRoot('')
    assert.ok(root.startsWith(homedir()), `expected a path under ${homedir()}, got ${root}`)
    assert.ok(root.endsWith('compact-arsenal'))
  } finally {
    if (previous !== undefined) process.env.DSH_HOME = previous
  }
})

test('an explicit archiveDir wins over both defaults', () => {
  assert.equal(archiveRoot('D:/custom/archive'), 'D:/custom/archive')
})

test('archiveRewrite writes a record and returns its path', async () => {
  const root = join(homedir(), '.dsh-compact-arsenal-test')
  const path = await archiveRewrite({
    root,
    sessionId: 'session-test/../escape',
    kind: 'tools',
    method: 'model',
    seq: 42,
    original: 'ORIGINAL BODY',
    replacement: 'REPLACED BODY',
    summary: 'summary text',
  })
  assert.ok(path !== undefined)
  assert.ok(path.startsWith(root))
  // The session id is sanitised into ONE path segment: slashes and dots cannot
  // introduce an extra level, and the record stays under the archive root.
  const relative = path.slice(root.length + 1)
  const segments = relative.split(/[\\/]/)
  // One sanitised session directory plus the record file: never an extra level.
  assert.equal(segments.length, 2, `expected session dir + file, got ${relative}`)
  assert.ok(path.endsWith('tools-model-42.md'))
})
