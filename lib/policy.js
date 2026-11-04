/**
 * Pure content transforms used by dsh-compact-arsenal.
 *
 * Nothing here touches a session, a model, or the filesystem: every function
 * takes content blocks and returns either new blocks or `null` when nothing
 * should change. Keeping the policy pure is what makes it testable without a
 * running Harness.
 */

/** Marker the tool-output pruner leaves where the middle was removed. */
export const TOOL_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

/** Marker the reasoning trimmer leaves where the middle was removed. */
export const REASONING_MARKER = '\n\n[... reasoning middle trimmed by compact-arsenal ...]\n\n'

/** Marker a model-written condensation leaves, distinguishable from the mechanical one. */
export const MODEL_TOOL_MARKER = '\n\n[... tool result condensed by model ...]\n\n'

/** Marker a model-written reasoning condensation leaves. */
export const MODEL_REASONING_MARKER = '\n\n[... reasoning condensed by model ...]\n\n'

/**
 * Every marker any pass may leave behind.
 *
 * Used as the idempotence guard: text that already carries one of these was
 * already rewritten and must not be summarized again.
 */
export const ALL_MARKERS = [
  TOOL_MARKER,
  REASONING_MARKER,
  MODEL_TOOL_MARKER,
  MODEL_REASONING_MARKER,
]

/**
 * Whether a text was already rewritten by any pass.
 * @param {string} text - candidate text.
 * @returns {boolean} true when a marker is present.
 */
export function alreadyRewritten(text) {
  return ALL_MARKERS.some((marker) => text.includes(marker.trim()))
}

/**
 * Total text length of the text blocks, in Unicode code points.
 * Non-text blocks cost zero, mirroring the shipped pruner.
 * @param {readonly any[]} blocks - content blocks.
 * @returns {number} code-point count across text blocks.
 */
export function measureText(blocks) {
  let total = 0
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') total += [...block.text].length
  }
  return total
}

/** Slice by code point so a retained boundary cannot split a surrogate pair. */
function slicePoints(text, start, end) {
  const points = [...text]
  return points.slice(start, end).join('')
}

/**
 * Drop `reasoning` blocks outright.
 * @param {readonly any[]} blocks - assistant message content.
 * @returns {any[] | null} new content, or `null` when no reasoning block existed.
 */
export function clearReasoning(blocks) {
  const kept = blocks.filter((block) => block?.type !== 'reasoning')
  return kept.length === blocks.length ? null : kept
}

/**
 * Keep the head and tail of each over-long reasoning block.
 * @param {readonly any[]} blocks - assistant message content.
 * @param {{headChars: number, tailChars: number, minChars: number}} policy - budgets.
 * @returns {any[] | null} new content, or `null` when nothing exceeded the budget.
 */
export function trimReasoning(blocks, policy) {
  const { headChars, tailChars, minChars } = policy
  let changed = false
  const next = blocks.map((block) => {
    if (block?.type !== 'reasoning') return block
    const text = typeof block.text === 'string' ? block.text : ''
    const points = [...text].length
    if (points <= minChars) return block
    if (points <= headChars + tailChars + REASONING_MARKER.length) return block
    changed = true
    return { ...block, text: slicePoints(text, 0, headChars) + REASONING_MARKER + slicePoints(text, points - tailChars, points) }
  })
  return changed ? next : null
}

/**
 * Replace the middle of an over-budget tool result with a marker.
 * Text blocks are measured together; non-text blocks keep their relative order.
 * @param {readonly any[]} blocks - tool result content.
 * @param {{thresholdChars: number, headChars: number, tailChars: number}} policy - budgets.
 * @returns {any[] | null} new content, or `null` when the result is within budget.
 */
export function pruneToolContent(blocks, policy) {
  const { thresholdChars, headChars, tailChars } = policy
  if (measureText(blocks) <= thresholdChars) return null
  const combined = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
  const points = [...combined].length
  const head = slicePoints(combined, 0, headChars)
  const tail = points > tailChars ? slicePoints(combined, points - tailChars, points) : ''
  const replacement = [{ type: 'text', text: head + TOOL_MARKER + tail }]
  const rich = blocks.filter((block) => block?.type !== 'text')
  return [...replacement, ...rich]
}

/**
 * Human-readable summary of one planned rewrite, for logging.
 * @param {'reasoning' | 'tools'} kind - which section planned it.
 * @param {number} before - measured code points before.
 * @param {number} after - measured code points after.
 * @returns {string} one log line.
 */
export function describeChange(kind, before, after) {
  return `[compact-arsenal] ${kind}: ${before} -> ${after} code points (-${Math.max(0, before - after)})`
}
