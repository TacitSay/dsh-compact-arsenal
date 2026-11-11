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

test('archiveRewrite names the file by conversation, content, method, time and node', async () => {
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

  const file = segments[1]
  // Conversation first so one session sorts together, then content / method /
  // timestamp / node — the order a reader scans when comparing compactions.
  assert.ok(file.startsWith('WordCut-'), `file should start with the title: ${file}`)
  assert.ok(file.includes('--tools--model--'), `content and method in the name: ${file}`)
  assert.match(file, /--\d{8}-\d{6}--/, `timestamp segment: ${file}`)
  assert.ok(file.endsWith('--seq42.md'), `node suffix: ${file}`)
})

test('archiveRewrite falls back to the session id when no title exists', async () => {
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
  const file = path.slice(root.length + 1).split(/[\\/]/).at(-1)
  assert.ok(file.startsWith('session-abc--'), file)
})

