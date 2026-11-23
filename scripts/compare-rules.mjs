/**
 * Prove the postmortem's central claim by contrast: run the OLD rule against the
 * same session and show what it would have done.
 *
 * Without this, the postmortem asks the reader to trust that "injected blocks were
 * treated as turn starts" mattered. With it, the difference is visible:
 *
 *   old rule → intervals start at injected checkpoints
 *   new rule → intervals start only at client messages
 */

import { readFileSync, existsSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const LOG = process.argv[2] ?? 'C:/Users/YWW/.dsh/sessions/--E-DSH-DSH--/session-cae5555c-a502-4d5b-95f3-629966c1d721/session.v4.jsonl.zstd'
if (!existsSync(LOG)) { console.log('SKIP: no session log'); process.exit(0) }

function decode(file) {
  const buf = readFileSync(file)
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i += 1) if (buf.readUInt32LE(i) === 0xFD2FB528) starts.push(i)
  starts.push(buf.length)
  const parts = []
  for (let k = 0; k + 1 < starts.length; k += 1) {
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], starts[k + 1]))) } catch {}
  }
  const out = []
  for (const line of Buffer.concat(parts).toString('utf8').split('\n')) {
    if (line === '') continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

const events = decode(LOG)
const bySeq = new Map()
for (const e of events) if (typeof e.seq === 'number') bySeq.set(e.seq, e)

function textOf(ev) {
  const blocks = ev?.data?.message?.content ?? ev?.data?.content
  if (Array.isArray(blocks)) return blocks.filter((b) => typeof b?.text === 'string').map((b) => b.text).join('')
  return ''
}

// Rebuild the surface in order.
const nodes = []
for (const e of events) {
  if (e.surfaceOp === undefined) continue
  if (e.surfaceOp === 'append') { nodes.push(e.seq); continue }
  const op = e.surfaceOp
  if (op?.op !== 'replace') continue
  const a = nodes.indexOf(op.startSeq)
  const b = nodes.indexOf(op.endSeq)
  if (a === -1 || b === -1 || a > b) continue
  nodes.splice(a, b - a + 1, e.seq)
}

/** OLD rule: kind only. This is what shipped in 0.17.1. */
function oldRule(ev) {
  if (ev?.type !== 'user/message') return false
  if (ev.data?.source?.kind !== 'user') return false
  const id = String(ev.data?.id ?? '')
  if (id.startsWith('compact-arsenal')) return false
  const blocks = ev.data?.content
  return Array.isArray(blocks) && blocks.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
}

/** NEW rule: requires rpcId. */
function newRule(ev) {
  return oldRule(ev) && typeof ev.data?.source?.rpcId === 'string'
}

function intervalsFor(rule) {
  const starts = []
  for (let i = 0; i < nodes.length; i += 1) {
    if (rule(bySeq.get(nodes[i]))) starts.push(i)
  }
  return starts.map((i, n) => {
    const next = starts[n + 1] ?? nodes.length
    return { startIdx: i, startSeq: nodes[i], width: next - i - 1 }
  })
}

const oldIv = intervalsFor(oldRule)
const newIv = intervalsFor(newRule)

console.log(`surface nodes: ${nodes.length}`)
console.log('')
console.log('=== OLD rule (kind only) ===')
console.log(`  intervals: ${oldIv.length}`)
const ow = oldIv.map((x) => x.width).sort((a, b) => a - b)
console.log(`  middle width min/median/max: ${ow[0]} / ${ow[Math.floor(ow.length / 2)]} / ${ow[ow.length - 1]}`)
console.log(`  intervals whose start is INJECTED: ${oldIv.filter((x) => !newRule(bySeq.get(x.startSeq))).length}`)
for (const x of oldIv.filter((y) => !newRule(bySeq.get(y.startSeq))).slice(0, 5)) {
  const ev = bySeq.get(x.startSeq)
  console.log(`    seq=${x.startSeq} width=${x.width}`)
  console.log(`      ${JSON.stringify(textOf(ev).trim().slice(0, 70))}`)
}

console.log('')
console.log('=== NEW rule (requires rpcId) ===')
console.log(`  intervals: ${newIv.length}`)
const nw = newIv.map((x) => x.width).sort((a, b) => a - b)
console.log(`  middle width min/median/max: ${nw[0]} / ${nw[Math.floor(nw.length / 2)]} / ${nw[nw.length - 1]}`)
console.log(`  intervals whose start is INJECTED: ${newIv.filter((x) => !newRule(bySeq.get(x.startSeq))).length}`)

console.log('')
console.log('=== verdict ===')
console.log(`  turns lost to the tightening: ${oldIv.length - newIv.length}`)
console.log(`  injected turn starts removed:  ${oldIv.filter((x) => !newRule(bySeq.get(x.startSeq))).length}`)
console.log('')
console.log(oldIv.filter((x) => !newRule(bySeq.get(x.startSeq))).length === 0
  ? '  old rule never started at an injected block in THIS session'
  : '  old rule DID start at injected blocks — the bug was live')
