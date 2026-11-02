/**
 * dsh-compact-arsenal — configurable context compaction for DeepSeek Harness.
 *
 * Three independent sections, each with its own master switch:
 *   total      whole-context summary (delegated to the shipped backend; see README)
 *   reasoning  rewrite older assistant reasoning blocks
 *   tools      prune older oversized tool results
 *
 * The reasoning and tool sections are pure local rewrites: they append surface
 * replacements to the session log, cost no model tokens, and default to OFF.
 *
 * No runtime dependencies: the config object is normalized here so the package
 * can be installed from a checkout, a link, or npm without a schema engine.
 *
 * @module dsh-compact-arsenal
 */

import {
  clearReasoning,
  describeChange,
  pruneToolContent,
  trimReasoning,
} from './lib/policy.js'

export const name = 'compact-arsenal'

/** The Host services this plugin reads; both ship with dsh-base. */
export const inject = ['sessions', 'tokenMeter']

/** Defaults mirror the README table. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  trigger: { pressureRatio: 0.75, runWithoutWindow: false },
  reasoning: {
    enabled: false,
    mode: 'truncate',
    keepLast: 3,
    minChars: 2000,
    headChars: 600,
    tailChars: 300,
  },
  tools: {
    enabled: false,
    thresholdChars: 8192,
    headChars: 4096,
    tailChars: 1024,
    keepLast: 2,
    onlyTools: [],
  },
})

/**
 * Merge one raw config object over the defaults, ignoring unknown keys.
 * @param {unknown} raw - the row's `config` value, possibly absent.
 * @returns {any} a complete, plain config object.
 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const section = (base, given) => {
    const next = { ...base }
    if (given !== null && typeof given === 'object') {
      for (const [key, value] of Object.entries(given)) {
        if (!(key in base)) continue
        if (base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key])) continue
        if (value === undefined) continue
        next[key] = value
      }
    }
    return next
  }
  return {
    ...DEFAULTS,
    enabled: input.enabled ?? DEFAULTS.enabled,
    trigger: section(DEFAULTS.trigger, input.trigger),
    reasoning: section(DEFAULTS.reasoning, input.reasoning),
    tools: {
      ...section(DEFAULTS.tools, input.tools),
      onlyTools: Array.isArray(input.tools?.onlyTools) ? input.tools.onlyTools.filter((v) => typeof v === 'string') : [],
    },
  }
}

/**
 * Register the rewrite pass on the per-step hook.
 * @param {any} ctx - plugin context.
 * @param {any} rawConfig - the row's config value.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  if (!config.enabled) return

  /** Last turn already processed, per session, so one turn is rewritten at most once. */
  const lastProcessedTurn = new Map()

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    try {
      rewrite(ctx, config, payload, lastProcessedTurn)
    } catch (error) {
      // A rewrite failure must never break the step.
      ctx.logger?.warn?.(`[compact-arsenal] rewrite skipped: ${error?.message ?? error}`)
    }
    return decision
  })
}

/**
 * Measure pressure, pick nodes, and append replacements.
 * @param {any} ctx - plugin context.
 * @param {any} config - normalized plugin config.
 * @param {{ agent: { id: string }, turn: number }} payload - pre-step payload.
 * @param {Map<string, number>} lastProcessedTurn - per-session guard.
 */
function rewrite(ctx, config, payload, lastProcessedTurn) {
  if (!config.reasoning.enabled && !config.tools.enabled) return

  const session = ctx.sessions.get(payload.agent.id)
  if (session === undefined) return

  if (lastProcessedTurn.get(session.id) === payload.turn) return

  if (!underPressure(ctx, session, config.trigger)) return

  lastProcessedTurn.set(session.id, payload.turn)

  const nodes = [...session.surface.nodes]
  const assistantSeqs = []
  const toolSeqs = []
  for (const seq of nodes) {
    const event = session.eventAt(seq)
    if (event?.type === 'assistant/message') assistantSeqs.push(seq)
    else if (event?.type === 'tool/result') toolSeqs.push(seq)
  }

  if (config.reasoning.enabled) {
    for (const seq of dropRecent(assistantSeqs, config.reasoning.keepLast)) {
      rewriteAssistant(ctx, session, seq, config.reasoning)
    }
  }

  if (config.tools.enabled) {
    for (const seq of dropRecent(toolSeqs, config.tools.keepLast)) {
      rewriteToolResult(ctx, session, seq, config.tools)
    }
  }
}

/**
 * Whether the session is close enough to its limit to justify a rewrite.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {{ pressureRatio: number, runWithoutWindow: boolean }} trigger - trigger config.
 * @returns {boolean} true when the rewrite may run.
 */
function underPressure(ctx, session, trigger) {
  const window = session.requestContext?.()?.contextWindow
  if (typeof window !== 'number' || window <= 0) return trigger.runWithoutWindow === true
  const measured = ctx.tokenMeter?.measure?.(session)
  const total = measured?.totalTokens ?? 0
  return total >= window * trigger.pressureRatio
}

/**
 * All but the most recent `keep` entries.
 * @param {readonly number[]} seqs - ordered surface seqs.
 * @param {number} keep - how many trailing entries to leave untouched.
 * @returns {number[]} seqs eligible for rewriting.
 */
function dropRecent(seqs, keep) {
  const n = Number.isFinite(keep) ? Math.max(0, Math.trunc(keep)) : 0
  return n <= 0 ? [...seqs] : seqs.slice(0, Math.max(0, seqs.length - n))
}

/**
 * Replace one assistant message with the same message minus (or with trimmed) reasoning.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {number} seq - surface seq of the assistant message.
 * @param {any} policy - reasoning section config.
 */
function rewriteAssistant(ctx, session, seq, policy) {
  const event = session.eventAt(seq)
  if (event === undefined) return
  const message = event.data?.message
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return

  const next = policy.mode === 'clear'
    ? clearReasoning(message.content)
    : trimReasoning(message.content, policy)
  if (next === null) return

  session.append(
    'assistant/message',
    {
      turn: event.data.turn,
      step: event.data.step,
      message: { ...message, content: next },
      ...(event.data.usage === undefined ? {} : { usage: event.data.usage }),
      stream: event.data.stream ?? [],
    },
    { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq } },
  )
  ctx.logger?.debug?.(describeChange('reasoning', measureBlocks(message.content), measureBlocks(next)))
}

/**
 * Replace one oversized tool result with its head and tail.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {number} seq - surface seq of the tool result.
 * @param {any} policy - tools section config.
 */
function rewriteToolResult(ctx, session, seq, policy) {
  const event = session.eventAt(seq)
  if (event === undefined) return
  const message = event.data?.message
  if (message?.role !== 'tool' || !Array.isArray(message.content)) return
  if (Array.isArray(policy.onlyTools) && policy.onlyTools.length > 0) {
    const toolName = resolveToolName(session, event)
    if (toolName === undefined || !policy.onlyTools.includes(toolName)) return
  }

  const next = pruneToolContent(message.content, policy)
  if (next === null) return

  session.append(
    'tool/result',
    {
      turn: event.data.turn,
      step: event.data.step,
      message: { ...message, content: next },
      ...(event.data.error === undefined ? {} : { error: event.data.error }),
      ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
    },
    { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] },
  )
  ctx.logger?.debug?.(describeChange('tools', measureBlocks(message.content), measureBlocks(next)))
}

/**
 * Name of the tool that produced one result, from the matching tool call.
 * @param {any} session - live session.
 * @param {any} event - tool/result event.
 * @returns {string | undefined} tool name when the call is still in the surface.
 */
function resolveToolName(session, event) {
  const callId = event.data?.message?.toolCallId ?? event.data?.message?.source?.callId
  if (callId === undefined) return undefined
  for (const seq of session.surface.nodes) {
    const candidate = session.eventAt(seq)
    if (candidate?.type === 'tool/call' && candidate.data?.callId === callId) return candidate.data.name
  }
  return undefined
}

/**
 * Rough size of a content array for logging.
 * @param {readonly any[]} blocks - content blocks.
 * @returns {number} total characters across text-like blocks.
 */
function measureBlocks(blocks) {
  let total = 0
  for (const block of blocks) {
    if (typeof block?.text === 'string') total += block.text.length
    if (typeof block?.arguments === 'string') total += block.arguments.length
  }
  return total
}
