/**
 * Reproduce the audit that found the injected-block bug.
 *
 * This is the script version of docs/postmortem-injected-blocks.md. It exists
 * because the first version of this audit was WRONG, and the wrong version looked
 * convincing: it scanned the numeric range [startSeq..endSeq] and concluded that
 * 198 genuine user instructions had been shadowed.
 *
 * That scan is invalid. `state.nodes` is kept in SURFACE ORDER, not seq order —
 * a replacement splices the new node into the position it replaced, so a checkpoint
 * written late in the log can sit earlier in the array. You can see this directly
 * in spans whose startSeq is numerically greater than their endSeq.
 *
 * The only trustworthy method is to replay indexOf + splice, exactly as
 * dsh-session does. That is what this file does.
 *
 * Usage:
 *   node scripts/audit-session.mjs <session.v4.jsonl.zstd>
 *
 * Output: who removed how much, and whether any GENUINE instruction was lost.
 */

import { readFileSync, existsSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const LOG = process.argv[2]

if (!LOG || !existsSync(LOG)) {
  console.error('usage: node scripts/audit-session.mjs <session.v4.jsonl.zstd>')
  process.exit(2)
}

/** Decode multi-frame zstd, then parse one JSON event per line. */
function decode(file) {
  const buf = readFileSync(file)
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i += 1) if (buf.readUInt32LE(i) === 0xFD2FB528) starts.push(i)
  starts.push(buf.length)
  const parts = []
  for (let k = 0; k + 1 < starts.length; k += 1) {
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], starts[k + 1]))) } catch { /* trailing frame */ }
  }
  const out = []
  for (const line of Buffer.concat(parts).toString('utf8').split('\n')) {
    if (line === '') continue
    try { out.push(JSON.parse(line)) } catch { /* torn line */ }
  }
  return out
}

function textOf(event) {
  const blocks = event?.data?.message?.content ?? event?.data?.content
  if (Array.isArray(blocks)) {
    return blocks.filter((b) => typeof b?.text === 'string').map((b) => b.text).join('')
  }
  if (typeof event?.data?.text === 'string') return event.data.text
  return ''
}

/**
 * A genuine instruction came from the client, so it carries `rpcId`.
 *
 * Measured on a long session: 109 messages had it, 197 did not. The 197 were
 * injected — DSH's own compaction checkpoint, hindsight recall, and this plugin's
 * older checkpoints — and every one of them still claims source.kind === 'user'.
 */
function isGenuineInstruction(event) {
  return event?.type === 'user/message'
    && event.data?.source?.kind === 'user'
    && typeof event.data?.source?.rpcId === 'string'
    && textOf(event).trim() !== ''
}

const events = decode(LOG)
const bySeq = new Map()
for (const event of events) if (typeof event.seq === 'number') bySeq.set(event.seq, event)

// --- Replay the surface in order, attributing every removal --------------------
const nodes = []
const removed = { arsenal: [], dsh: [], rewind: [], other: [] }
const removedChars = { arsenal: 0, dsh: 0, rewind: 0, other: 0 }
let rejected = 0

for (const event of events) {
  if (event.surfaceOp === undefined) continue
  if (event.surfaceOp === 'append') { nodes.push(event.seq); continue }

  const op = event.surfaceOp
  if (op?.op !== 'replace') continue

  const startIdx = nodes.indexOf(op.startSeq)
  const endIdx = nodes.indexOf(op.endSeq)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) { rejected += 1; continue }

  const id = String(event.data?.id ?? '')
  const who = id.startsWith('compact-arsenal-turn-') ? 'arsenal'
    : id.startsWith('rewind-') ? 'rewind'
    : event.type === 'user/message' ? 'dsh'
    : 'other'

  for (let k = startIdx; k <= endIdx; k += 1) {
    removed[who].push(nodes[k])
    removedChars[who] += textOf(bySeq.get(nodes[k])).length
  }
  nodes.splice(startIdx, endIdx - startIdx + 1, event.seq)
}

console.log(`events: ${events.length}`)
console.log(`surface nodes: ${nodes.length}`)
console.log(`replaces rejected during replay: ${rejected}`)
console.log('')

console.log('=== who removed what ===')
for (const who of ['arsenal', 'dsh', 'rewind', 'other']) {
  console.log(`  ${who.padEnd(8)} ${String(removed[who].length).padStart(6)} nodes  ${removedChars[who].toLocaleString().padStart(12)} chars`)
}

// --- The question that matters ------------------------------------------------
const lostGenuine = removed.arsenal
  .map((seq) => bySeq.get(seq))
  .filter((event) => isGenuineInstruction(event))

const lostInjected = removed.arsenal
  .map((seq) => bySeq.get(seq))
  .filter((event) => event?.type === 'user/message'
    && event.data?.source?.kind === 'user'
    && typeof event.data?.source?.rpcId !== 'string'
    && textOf(event).trim() !== '')

console.log('')
console.log('=== safety ===')
console.log(`genuine user instructions shadowed by our passes: ${lostGenuine.length}`)
for (const event of lostGenuine.slice(0, 10)) {
  console.log(`  seq=${event.seq}  ${JSON.stringify(textOf(event).trim().slice(0, 70))}`)
}
console.log(`injected blocks shadowed by our passes: ${lostInjected.length}  (expected: not the human)`)
console.log('')

let genuineKept = 0
let chars = 0
const byType = {}
for (const seq of nodes) {
  const event = bySeq.get(seq)
  if (!event) continue
  byType[event.type] = (byType[event.type] ?? 0) + 1
  chars += textOf(event).length
  if (isGenuineInstruction(event)) genuineKept += 1
}

console.log('=== surface now ===')
console.log(`chars: ${chars.toLocaleString()}  (~${Math.round(chars / 1.5).toLocaleString()} tokens)`)
console.log(`genuine instructions still present: ${genuineKept}`)
console.log(`by type: ${JSON.stringify(byType)}`)
console.log('')

process.exit(lostGenuine.length === 0 ? 0 : 1)
