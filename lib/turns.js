/**
 * Turn-interval compression.
 *
 * A turn looks like this on the surface:
 *
 *   user:      "把 X 改成 Y"                    ← the instruction, never touched
 *   assistant: [reasoning, tool-call]           ┐
 *   tool:      <command output>                 ├ the middle: what the model did
 *   assistant: [reasoning, tool-call]           │
 *   tool:      <command output>                 │
 *   assistant: "改好了"                          ┘
 *
 * The instruction is what a later reader needs — it states the constraint.
 * Everything between it and the next instruction is process, so it is condensed
 * into ONE block and the instruction is left untouched. The user's words are
 * never summarized, so no requirement can be paraphrased away.
 *
 * The condensed block is written as an `assistant/message`. That is the
 * semantically correct role: the summary describes what the model did, and a
 * `user/message` would read as if the person said it. The cost is that
 * `assistant/message` may not carry `sourceEventSeqs` (the log forbids it, since
 * an assistant message embeds its own stream), so the link back to the original
 * nodes comes from the archive file instead, which stores the full text.
 */

/** Prefix identifying a condensed turn middle. */
export const TURN_MARKER = '[compact-arsenal turn summary]'

/**
 * Whether a user message is the human speaking.
 *
 * `user/message` also carries injected context — time snapshots, plugin recall,
 * model-selection notices — whose `source.kind` is not `user`. Treating those as
 * instructions would make a "turn" begin at a timestamp instead of at the thing
 * the person asked for.
 *
 * @param {any} event - a surface event.
 * @returns {boolean} true only for a real user instruction.
 */
export function isUserInstruction(event) {
  if (event?.type !== 'user/message') return false
  if (event.data?.source?.kind !== 'user') return false
  if (isOwnCheckpoint(event)) return false
  const blocks = event.data?.content
  if (!Array.isArray(blocks)) return false
  return blocks.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
}

/**
 * Whether a user message is one this plugin wrote.
 * @param {any} event - a surface event.
 * @returns {boolean} true for our own checkpoints.
 */
export function isOwnCheckpoint(event) {
  const id = event?.data?.id
  if (typeof id === 'string' && id.startsWith('compact-arsenal')) return true
  const blocks = event?.data?.content
  if (!Array.isArray(blocks)) return false
  return blocks.some((b) => typeof b?.text === 'string' && b.text.includes(TURN_MARKER))
}

/**
 * Split the surface into turn intervals.
 *
 * A turn starts at a real user instruction and runs until the next one. A
 * condensed middle carries our marker, so a turn that was already compressed
 * produces an interval whose middle is the checkpoint itself — the caller skips
 * those by checking for the marker.
 *
 * @param {any} session - live session.
 * @returns {Array<{ startSeq: number, endSeq: number, userSeq: number, middleSeqs: number[] }>} intervals.
 */
export function findTurnIntervals(session) {
  const surface = [...session.surface.nodes]
  const starts = []

  for (let i = 0; i < surface.length; i += 1) {
    if (isUserInstruction(session.eventAt(surface[i]))) starts.push(i)
  }

  const intervals = []
  for (const [n, i] of starts.entries()) {
    const nextStart = starts[n + 1] ?? surface.length
    const userSeq = surface[i]
    const middleSeqs = []
    let endSeq = userSeq
    for (let j = i + 1; j < nextStart; j += 1) {
      middleSeqs.push(surface[j])
      endSeq = surface[j]
    }
    if (middleSeqs.length === 0) continue
    intervals.push({ startSeq: userSeq, endSeq, userSeq, middleSeqs })
  }

  return intervals
}

/**
 * Whether an interval's middle was already condensed.
 * @param {any} session - live session.
 * @param {{ middleSeqs: readonly number[] }} interval - a turn interval.
 * @returns {boolean} true when the middle is a single checkpoint we wrote.
 */
export function isCondensedMiddle(session, interval) {
  if (interval.middleSeqs.length !== 1) return false
  const event = session.eventAt(interval.middleSeqs[0])
  // The checkpoint is a `user/message` (the only type that may cite a shadowed
  // span), so detection must look there — checking assistant/message would
  // never match and every pass would re-condense the same turn.
  if (event?.type !== 'user/message') return false
  const id = event.data?.id
  if (typeof id === 'string' && id.startsWith('compact-arsenal')) return true
  const blocks = event.data?.content
  if (!Array.isArray(blocks)) return false
  return blocks.some((b) => typeof b?.text === 'string' && b.text.includes(TURN_MARKER))
}

/**
 * Everything the model wrote inside one interval, for the summarizer.
 *
 * Tool calls are rendered with their arguments and results with their text, so
 * the summary can name the command that ran and what came back.
 *
 * @param {any} session - live session.
 * @param {readonly number[]} middleSeqs - seqs between the instruction and the next one.
 * @returns {string} a readable transcript.
 */
export function middleTranscript(session, middleSeqs) {
  const lines = []
  for (const seq of middleSeqs) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    const line = renderEvent(event)
    if (line !== '') lines.push(line)
  }
  return lines.join('\n')
}

/**
 * One readable line for a surface event.
 * @param {any} event - surface event.
 * @returns {string} role-prefixed text.
 */
function renderEvent(event) {
  const blocks = event.data?.message?.content ?? (Array.isArray(event.data?.content) ? event.data.content : [])
  const parts = []
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') parts.push(block.text)
    else if (block?.type === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '') parts.push(`[thinking] ${block.text}`)
    else if (block?.type === 'tool-call') parts.push(`[call ${block.name}] ${String(block.arguments ?? '').slice(0, 400)}`)
  }
  const body = parts.join(' ').trim()
  if (body === '') return ''
  const role = event.type === 'tool/result' ? 'RESULT' : event.type.replace('/message', '').toUpperCase()
  return `[${role}] ${body}`
}

/**
 * The replacement text for a condensed middle.
 * @param {string} summary - model-written condensation.
 * @returns {string} the block text.
 */
export function frameSummary(summary) {
  return `${TURN_MARKER}\n${summary}`
}

/**
 * Total character count the middle occupies, for the size gate.
 * @param {any} session - live session.
 * @param {readonly number[]} middleSeqs - seqs to measure.
 * @returns {number} code-point total.
 */
export function middleChars(session, middleSeqs) {
  let total = 0
  for (const seq of middleSeqs) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    const blocks = event.data?.message?.content ?? (Array.isArray(event.data?.content) ? event.data.content : [])
    for (const block of blocks) {
      if (typeof block?.text === 'string') total += [...block.text].length
      else if (block?.type === 'tool-call') total += [...String(block.arguments ?? '')].length
    }
  }
  return total
}
