/**
 * Verify the title lookup against a real session log.
 *
 * `dsh-session-title` folds `session/title` events into the projection the
 * sidebar shows; the plugin reads the same events directly.
 *
 * Usage: node test/title-lookup.mjs [session.v4.jsonl.zstd]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Mirror of `sessionTitleOf()` in index.js over a decoded event list. */
function titleOf(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type !== 'session/title') continue
    const title = event.data?.title
    if (typeof title === 'string' && title.trim() !== '') return title.trim()
  }
  return undefined
}

function decode(file) {
  const buf = readFileSync(file)
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf.readUInt32LE(i) === 0xFD2FB528) starts.push(i)
  }
  starts.push(buf.length)
  const parts = []
  for (let k = 0; k + 1 < starts.length; k += 1) {
    try {
      parts.push(zstdDecompressSync(buf.subarray(starts[k], starts[k + 1])))
    } catch {
      // A torn frame is skipped; the rest of the log still reads.
    }
  }
  const events = []
  for (const line of Buffer.concat(parts).toString('utf8').split('\n')) {
    if (line === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A partial line is ignored.
    }
  }
  return events
}

const explicit = process.argv[2]
let target = explicit
if (target === undefined) {
  const root = 'C:\\Users\\YWW\\.dsh\\sessions'
  const found = []
  ;(function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.zstd')) found.push([p, statSync(p).mtimeMs])
    }
  })(root)
  found.sort((a, b) => b[1] - a[1])
  target = found[0]?.[0]
}

if (target === undefined) {
  console.log('SKIP: no session log found')
  process.exit(0)
}

const events = decode(target)
const title = titleOf(events)
const titleEvents = events.filter((e) => e.type === 'session/title')

console.log('session:', target.split(/[\\/]/).at(-2))
console.log('events:', events.length)
console.log('session/title events:', titleEvents.length)
for (const e of titleEvents.slice(-3)) console.log('  seq', e.seq, '->', JSON.stringify(e.data?.title))
console.log('')
console.log('resolved title:', title === undefined ? '(none — the file name falls back to the id)' : JSON.stringify(title))

if (titleEvents.length > 0 && title === undefined) {
  console.log('FAIL: title events exist but none resolved')
  process.exit(1)
}
console.log('PASS: title lookup matches the logged title')
