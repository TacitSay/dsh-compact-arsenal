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
  REASONING_MARKER,
  TOOL_MARKER,
  clearReasoning,
  describeChange,
  pruneToolContent,
  trimReasoning,
} from './lib/policy.js'
import { summarizeMiddle } from './lib/summarize.js'

export const name = 'compact-arsenal'

/** Host services this plugin reads; all ship with dsh-base or dsh-web-app. */
export const inject = ['sessions', 'tokenMeter', 'webServer', 'configEditor']

/** Prompt used when a model mode is enabled but the user wrote none. */
const DEFAULT_MODEL_PROMPT = '把下面这段内容压缩成不超过 200 字的要点，保留文件名、命令、报错原文和结论，不要评论。只输出要点。'

/** Prompt used by the total pass when the user wrote none. */
const DEFAULT_TOTAL_PROMPT = '你是压缩引擎。把下面这段对话压缩成一份结构化的中文检查点：保留用户目标与偏好、涉及的文件与命令、报错与修法、已完成与待办、下一步。用简短条目，按 ## 标题分节，不要评论，不要提及压缩本身。'

/** Defaults mirror the README table. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  total: {
    enabled: false,
    pressureRatio: 0.8,
    thresholdRatio: 0.8,
    retainRatio: 0.16,
    maxTokens: 65536,
    retainTurns: 2,
    maxInputChars: 60000,
    provider: '',
    model: '',
    prompt: DEFAULT_TOTAL_PROMPT,
  },
  reasoning: {
    enabled: false,
    pressureRatio: 0.75,
    mode: 'truncate',
    keepLast: 3,
    minChars: 2000,
    headChars: 600,
    tailChars: 300,
    maxPerPass: 3,
    model: { provider: '', model: '', prompt: DEFAULT_MODEL_PROMPT, maxTokens: 512 },
  },
  tools: {
    enabled: false,
    pressureRatio: 0.75,
    mode: 'truncate',
    thresholdChars: 8192,
    headChars: 4096,
    tailChars: 1024,
    keepLast: 2,
    maxPerPass: 3,
    onlyTools: [],
    model: { provider: '', model: '', prompt: DEFAULT_MODEL_PROMPT, maxTokens: 512 },
  },
})

/**
 * Merge one raw config object over the defaults, ignoring unknown keys.
 * @param {unknown} raw - the row's `config` value, possibly absent.
 * @returns {any} a complete, plain config object.
 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const pick = (base, given) => {
    const next = { ...base }
    if (given === null || typeof given !== 'object') return next
    for (const [key, value] of Object.entries(given)) {
      if (!(key in base) || value === undefined) continue
      if (base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key])) continue
      next[key] = value
    }
    return next
  }
  const model = (given) => pick(pick(DEFAULTS.reasoning.model, given), given)
  const reasoningModel = model(input.reasoning?.model)
  const toolsModel = model(input.tools?.model)
  const total = pick(DEFAULTS.total, input.total)
  // An empty prompt means "use the built-in one", never "send nothing".
  if (!total.prompt) total.prompt = DEFAULT_TOTAL_PROMPT
  if (!reasoningModel.prompt) reasoningModel.prompt = DEFAULT_MODEL_PROMPT
  if (!toolsModel.prompt) toolsModel.prompt = DEFAULT_MODEL_PROMPT
  return {
    enabled: input.enabled ?? DEFAULTS.enabled,
    total,
    reasoning: {
      ...pick(DEFAULTS.reasoning, input.reasoning),
      model: reasoningModel,
    },
    tools: {
      ...pick(DEFAULTS.tools, input.tools),
      model: toolsModel,
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
    const totalApplied = await applyTotal(configEditor, next.total)
    send(res, 200, { config: next, stats, editable: true, totalApplied })
  })
}

/**
 * Push the total section onto the shipped compaction backend's row.
 *
 * The shipped backend owns the summary prompt, so only its trigger, output
 * budget and summary model are settable here. When the row is not addressable
 * (for example when an agent preset owns it) this reports `false` instead of
 * pretending the values were applied.
 * @param {any} configEditor - the config editor service.
 * @param {any} total - the total section config.
 * @returns {Promise<boolean>} whether the backend row accepted the values.
 */
async function applyTotal(configEditor, total) {
  if (!total || total.enabled !== true) return false
  try {
    const entries = configEditor.entries()
    const entry = entries.find((candidate) => {
      const options = candidate?.options ?? candidate
      return options?.name === '@deepseek-ai/dsh-compaction-basic' || options?.id === 'compaction-basic'
    })
    if (entry === undefined) return false
    await configEditor.edit(entry, (current) => ({
      ...current,
      thresholdRatio: total.thresholdRatio,
      retainRatio: total.retainRatio,
      maxTokens: total.maxTokens,
      ...(typeof total.provider === 'string' && total.provider !== ''
        ? { summarizationProvider: total.provider, summarizationModel: total.model }
        : {}),
    }))
    return true
  } catch {
    return false
  }
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
 * Summarize the oldest closed turns into one checkpoint message.
 *
 * This is a surface replacement of whole turns, so tool calls and their
 * results always leave together and message pairing stays valid. The shipped
 * backend keeps owning its own trigger; this pass is independent and only
 * writes when a model actually returns a usable summary.
 *
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {any} total - total section config.
 * @param {number} turn - the turn that is about to run.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @param {{ reasoning: number, tools: number, chars: number }} stats - live counters.
 * @returns {Promise<void>} resolves after the optional replacement landed.
 */
async function totalPass(ctx, session, total, turn, signal, stats) {
  const retain = Number.isFinite(total.retainTurns) ? Math.max(0, Math.trunc(total.retainTurns)) : 2
  const cutoff = turn - retain
  if (cutoff <= 0) return

  const nodes = []
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type === 'system/message' || event.type === 'developer/message') continue
    const nodeTurn = Number(event.data?.turn)
    if (!Number.isFinite(nodeTurn) || nodeTurn >= cutoff) continue
    nodes.push({ seq, event, turn: nodeTurn })
  }
  if (nodes.length < 4) return

  const budget = Number.isFinite(total.maxInputChars) ? total.maxInputChars : 60000
  const picked = []
  let used = 0
  for (const node of nodes) {
    const line = transcriptLine(node.event)
    if (used + line.length > budget) break
    used += line.length
    picked.push(node)
  }
  if (picked.length < 4) return

  const transcript = picked.map((node) => transcriptLine(node.event)).join('\n')
  const routed = session.requestContext?.() ?? {}
  const summaryCfg = {
    ...total,
    provider: total.provider || routed.provider || '',
    model: total.model || routed.model || '',
    prompt: total.prompt || DEFAULT_TOTAL_PROMPT,
  }
  let summary = ''
  try {
    summary = await summarize(ctx, summaryCfg, transcript, signal)
  } catch (error) {
    ctx.logger?.warn?.(`[compact-arsenal] total summary skipped: ${error?.message ?? error}`)
    return
  }
  if (summary === '') return

  const startSeq = picked[0].seq
  const endSeq = picked[picked.length - 1].seq
  try {
    session.append(
      'user/message',
      {
        role: 'user',
        source: { kind: 'user' },
        content: [{
          type: 'text',
          text: `This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it.\n\n<compacted-summary>\n${summary}\n</compacted-summary>`,
        }],
      },
      { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs: picked.map((node) => node.seq) },
    )
    stats.total = (stats.total ?? 0) + 1
    stats.chars += used
    ctx.logger?.debug?.(`[compact-arsenal] total: replaced ${picked.length} nodes (-${used} chars)`)
  } catch (error) {
    ctx.logger?.warn?.(`[compact-arsenal] total replacement rejected: ${error?.message ?? error}`)
  }
}

/**
 * One readable line for a surface event inside a summary transcript.
 * @param {any} event - a session event.
 * @returns {string} role-prefixed text, truncated for tool output.
 */
function transcriptLine(event) {
  const role = event.type === 'user/message' ? 'USER'
    : event.type === 'assistant/message' ? 'ASSISTANT'
      : event.type === 'tool/result' ? 'TOOL' : 'CONTEXT'
  const blocks = event.data?.message?.content
  const text = Array.isArray(blocks)
    ? blocks.map((block) => {
      if (typeof block?.text === 'string') return block.text
      if (block?.type === 'tool-call') return `→ ${block.name}(${String(block.arguments ?? '').slice(0, 300)})`
      return ''
    }).join(' ').trim()
    : ''
  const capped = text.length > 800 ? `${text.slice(0, 800)}…` : text
  return `[${role}] ${capped}`
}

/**
 * Measure pressure, pick nodes, and append replacements.
 * @param {any} ctx - plugin context.
 * @param {any} config - normalized plugin config.
 * @param {{ agent: { id: string }, turn: number }} payload - pre-step payload.
 * @param {Map<string, number>} lastProcessedTurn - per-session guard.
 */
function rewrite(ctx, config, payload, lastProcessedTurn, stats) {
  return rewriteAsync(ctx, config, payload, lastProcessedTurn, stats)
}

/**
 * Async body of {@link rewrite}: model modes may await one summarization call.
 * @param {any} ctx - plugin context.
 * @param {any} config - normalized plugin config.
 * @param {{ agent: { id: string }, turn: number, signal?: AbortSignal }} payload - pre-step payload.
 * @param {Map<string, number>} lastProcessedTurn - per-session guard.
 * @param {{ reasoning: number, tools: number, chars: number }} stats - live counters.
 * @returns {Promise<void>} resolves when every rewrite of this turn landed.
 */
async function rewriteAsync(ctx, config, payload, lastProcessedTurn, stats) {
  if (!config.total.enabled && !config.reasoning.enabled && !config.tools.enabled) return

  const session = ctx.sessions.get(payload.agent.id)
  if (session === undefined) return

  if (lastProcessedTurn.get(session.id) === payload.turn) return

  lastProcessedTurn.set(session.id, payload.turn)

  if (config.total.enabled && underPressure(ctx, session, config.total.pressureRatio)) {
    await totalPass(ctx, session, config.total, payload.turn, payload.signal, stats)
  }

  const nodes = [...session.surface.nodes]
  const assistantSeqs = []
  const toolSeqs = []
  for (const seq of nodes) {
    const event = session.eventAt(seq)
    if (event?.type === 'assistant/message') assistantSeqs.push(seq)
    else if (event?.type === 'tool/result') toolSeqs.push(seq)
  }

  if (config.reasoning.enabled && underPressure(ctx, session, config.reasoning.pressureRatio)) {
    let done = 0
    for (const seq of dropRecent(assistantSeqs, config.reasoning.keepLast)) {
      if (done >= (config.reasoning.maxPerPass ?? 3)) break
      const saved = await rewriteAssistant(ctx, session, seq, config.reasoning, payload.signal)
      if (saved > 0) {
        done += 1
        stats.reasoning += 1
        stats.chars += saved
      }
    }
  }

  if (config.tools.enabled && underPressure(ctx, session, config.tools.pressureRatio)) {
    let done = 0
    for (const seq of dropRecent(toolSeqs, config.tools.keepLast)) {
      if (done >= (config.tools.maxPerPass ?? 3)) break
      const saved = await rewriteToolResult(ctx, session, seq, config.tools, payload.signal)
      if (saved > 0) {
        done += 1
        stats.tools += 1
        stats.chars += saved
      }
    }
  }
}

/**
 * Whether one section may act at the current pressure.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {number} ratio - the section's own pressure ratio (0 disables the gate).
 * @returns {boolean} true when the section may run.
 */
function underPressure(ctx, session, ratio) {
  const window = session.requestContext?.()?.contextWindow
  if (typeof window !== 'number' || window <= 0) return false
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.75
  if (r <= 0) return true
  const measured = ctx.tokenMeter?.measure?.(session)
  const total = measured?.totalTokens ?? 0
  return total >= window * r
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
function rewriteAssistant(ctx, session, seq, policy, signal) {
  return rewriteAssistantAsync(ctx, session, seq, policy, signal)
}

/**
 * Async body of {@link rewriteAssistant}: `model` mode summarizes the elided middle.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {number} seq - surface seq of the assistant message.
 * @param {any} policy - reasoning section config.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @returns {Promise<number>} characters removed, or 0 when nothing was rewritten.
 */
async function rewriteAssistantAsync(ctx, session, seq, policy, signal) {
  const event = session.eventAt(seq)
  if (event === undefined) return 0
  const message = event.data?.message
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return 0

  let next = policy.mode === 'clear'
    ? clearReasoning(message.content)
    : trimReasoning(message.content, policy)

  if (policy.mode === 'model') {
    next = await rebuildWithModel(ctx, message.content, policy, signal, 'reasoning', session.requestContext?.() ?? {})
  }
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
function rewriteToolResult(ctx, session, seq, policy, signal) {
  return rewriteToolResultAsync(ctx, session, seq, policy, signal)
}

/**
 * Async body of {@link rewriteToolResult}: `model` mode summarizes the elided middle.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {number} seq - surface seq of the tool result.
 * @param {any} policy - tools section config.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @returns {Promise<number>} characters removed, or 0 when nothing was rewritten.
 */
async function rewriteToolResultAsync(ctx, session, seq, policy, signal) {
  const event = session.eventAt(seq)
  if (event === undefined) return 0
  const message = event.data?.message
  if (message?.role !== 'tool' || !Array.isArray(message.content)) return 0
  if (Array.isArray(policy.onlyTools) && policy.onlyTools.length > 0) {
    const toolName = resolveToolName(session, event)
    if (toolName === undefined || !policy.onlyTools.includes(toolName)) return 0
  }

  let next = pruneToolContent(message.content, policy)
  if (policy.mode === 'model') {
    next = await rebuildWithModel(ctx, message.content, policy, signal, 'tools', session.requestContext?.() ?? {})
  }
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
 * Rebuild one content array with a model-written summary in place of the elided middle.
 * Falls back to the mechanical rewrite whenever the model path is unavailable,
 * so an unconfigured or failing route never loses the saving entirely.
 * @param {any} ctx - plugin context.
 * @param {readonly any[]} blocks - original content blocks.
 * @param {any} policy - section config carrying `headChars`, `tailChars` and `model`.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @param {'reasoning' | 'tools'} kind - which section asked.
 * @returns {Promise<any[] | null>} replacement blocks, or `null` when within budget.
 */
async function rebuildWithModel(ctx, blocks, policy, signal, kind, routed) {
  const kindOfBlock = kind === 'tools' ? 'text' : 'reasoning'
  const text = blocks.filter((block) => block?.type === kindOfBlock)
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
  const limit = kind === 'tools' ? policy.thresholdChars : policy.minChars
  if ([...text].length <= limit) return null

  // Already summarized once: never summarize a summary (it would compound).
  const marker = kind === 'tools' ? TOOL_MARKER : REASONING_MARKER
  if (text.includes(marker.trim())) return null

  const mechanical = () => (kind === 'tools' ? pruneToolContent(blocks, policy) : trimReasoning(blocks, policy))
  const model = policy.model ?? {}
  const summaryCfg = {
    ...model,
    provider: model.provider || (routed && routed.provider) || '',
    model: model.model || (routed && routed.model) || '',
  }

  try {
    const replaced = await summarizeMiddle(
      ctx,
      summaryCfg,
      text,
      { headChars: policy.headChars, tailChars: policy.tailChars, marker },
      signal,
    )
    if (replaced === null) throw new Error('empty-summary')
    const rich = blocks.filter((block) => block?.type !== kindOfBlock)
    return [{ type: kindOfBlock, text: replaced }, ...rich]
  } catch (error) {
    ctx.logger?.warn?.(`[compact-arsenal] model ${kind} unavailable, using mechanical: ${error?.message ?? error}`)
    return mechanical()
  }
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
