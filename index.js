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

/** Host services this plugin reads; all ship with dsh-base or dsh-web-app. */
export const inject = ['sessions', 'tokenMeter', 'webServer', 'configEditor']

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

  /** Last turn already processed, per session, so one turn is rewritten at most once. */
  const lastProcessedTurn = new Map()
  const stats = { reasoning: 0, tools: 0, chars: 0 }

  if (config.enabled) {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision?.kind !== 'enter') return decision
      try {
        rewrite(ctx, config, payload, lastProcessedTurn, stats)
      } catch (error) {
        // A rewrite failure must never break the step.
        ctx.logger?.warn?.(`[compact-arsenal] rewrite skipped: ${error?.message ?? error}`)
      }
      return decision
    })
  }

  // The panel needs a read/write channel, so these routes exist even while the
  // plugin is switched off: that is how it gets switched back on.
  registerPanelRoutes(ctx, config, stats)
}

/** Route prefix owned by this plugin. */
const API_PREFIX = '/compact-arsenal/api'

/**
 * Serve the panel's state and accept its edits.
 * @param {any} ctx - plugin context.
 * @param {any} config - the config this instance mounted with.
 * @param {{ reasoning: number, tools: number, chars: number }} stats - live counters.
 */
function registerPanelRoutes(ctx, config, stats) {
  const webServer = ctx.get('webServer')
  const configEditor = ctx.get('configEditor')
  if (webServer === undefined) return

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const route = (path, handler) => ctx.effect(() => webServer.register({ kind: 'exact', path, handler }))

  route(`${API_PREFIX}/state`, (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
    send(res, 200, {
      config,
      stats,
      editable: configEditor !== undefined,
    })
  })

  route(`${API_PREFIX}/config`, async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
    if (configEditor === undefined) return send(res, 503, { error: 'config-editor-unavailable' })
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > 64 * 1024) return send(res, 413, { error: 'payload-too-large' })
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return send(res, 400, { error: 'invalid-json' })
    }
    const next = normalizeConfig(parsed)
    const entry = findOwnEntry(configEditor)
    if (entry === undefined) return send(res, 409, { error: 'entry-not-addressable' })
    try {
      await configEditor.edit(entry, () => next)
    } catch (error) {
      return send(res, 500, { error: 'write-failed', message: String(error?.message ?? error) })
    }
    send(res, 200, { config: next, stats, editable: true })
  })
}

/**
 * The addressable Loader entry this package owns.
 * @param {any} configEditor - the config editor service.
 * @returns {any} matching entry, or `undefined` when the row is not addressable.
 */
function findOwnEntry(configEditor) {
  try {
    const entries = configEditor.entries()
    return entries.find((entry) => {
      const options = entry?.options ?? entry
      return options?.name === 'dsh-compact-arsenal' || options?.id === 'compact-arsenal'
    })
  } catch {
    return undefined
  }
}

/**
 * Measure pressure, pick nodes, and append replacements.
 * @param {any} ctx - plugin context.
 * @param {any} config - normalized plugin config.
 * @param {{ agent: { id: string }, turn: number }} payload - pre-step payload.
 * @param {Map<string, number>} lastProcessedTurn - per-session guard.
 */
function rewrite(ctx, config, payload, lastProcessedTurn, stats) {
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
      const saved = rewriteAssistant(ctx, session, seq, config.reasoning)
      if (saved > 0) {
        stats.reasoning += 1
        stats.chars += saved
      }
    }
  }

  if (config.tools.enabled) {
    for (const seq of dropRecent(toolSeqs, config.tools.keepLast)) {
      const saved = rewriteToolResult(ctx, session, seq, config.tools)
      if (saved > 0) {
        stats.tools += 1
        stats.chars += saved
      }
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
 * @returns {number} characters removed, or 0 when nothing was rewritten.
 */
function rewriteAssistant(ctx, session, seq, policy) {
  const event = session.eventAt(seq)
  if (event === undefined) return 0
  const message = event.data?.message
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return 0

  const next = policy.mode === 'clear'
    ? clearReasoning(message.content)
    : trimReasoning(message.content, policy)
  if (next === null) return 0

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
  const before = measureBlocks(message.content)
  const after = measureBlocks(next)
  ctx.logger?.debug?.(describeChange('reasoning', before, after))
  return Math.max(0, before - after)
}

/**
 * Replace one oversized tool result with its head and tail.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {number} seq - surface seq of the tool result.
 * @param {any} policy - tools section config.
 * @returns {number} characters removed, or 0 when nothing was rewritten.
 */
function rewriteToolResult(ctx, session, seq, policy) {
  const event = session.eventAt(seq)
  if (event === undefined) return 0
  const message = event.data?.message
  if (message?.role !== 'tool' || !Array.isArray(message.content)) return 0
  if (Array.isArray(policy.onlyTools) && policy.onlyTools.length > 0) {
    const toolName = resolveToolName(session, event)
    if (toolName === undefined || !policy.onlyTools.includes(toolName)) return 0
  }

  const next = pruneToolContent(message.content, policy)
  if (next === null) return 0

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
  const before = measureBlocks(message.content)
  const after = measureBlocks(next)
  ctx.logger?.debug?.(describeChange('tools', before, after))
  return Math.max(0, before - after)
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
