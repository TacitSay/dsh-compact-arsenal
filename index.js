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
  MODEL_REASONING_MARKER,
  MODEL_TOOL_MARKER,
  REASONING_MARKER,
  SHORT_MARKER,
  TOOL_MARKER,
  alreadyRewritten,
} from './lib/policy.js'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { summarize, summarizeBatch, summarizeTurns } from './lib/summarize.js'
import { archiveRewrite, archiveRoot } from './lib/archive.js'
import { logLine, logRoot } from './lib/log.js'
import {
  findTurnIntervals,
  frameSummary,
  isCondensedMiddle,
  middleChars,
  middleTranscript,
} from './lib/turns.js'

export const name = 'compact-arsenal'

/**
 * Bumped in lockstep with `package.json` so the panel can show which build is
 * actually running — a stale install is otherwise invisible.
 */
export const PACKAGE_VERSION = '0.13.0'

/** The published package to compare against; empty disables the update check. */
export const PACKAGE_NAME = 'dsh-compact-arsenal'

/**
 * Compare two dotted versions by their numeric parts.
 *
 * Prerelease tags are ignored on purpose: this only decides "is there something
 * newer to offer", and offering a prerelease to a stable install would be
 * wrong more often than right.
 *
 * @param {string} a - candidate version.
 * @param {string} b - installed version.
 * @returns {number} positive when `a` is newer, negative when older, 0 when equal.
 */
export function compareVersions(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => {
    const parsed = Number.parseInt(n, 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Host services this plugin reads; all ship with dsh-base or dsh-web-app. */
export const inject = ['sessions', 'tokenMeter', 'webServer', 'configEditor']

/**
 * Style instruction for the per-fragment modes.
 *
 * The output SHAPE (one point per fragment, JSON array, length limit) belongs to
 * the batching layer, not to this text, so the two can never contradict.
 */
const DEFAULT_MODEL_PROMPT = '保留文件名、命令、报错原文、关键数值与结论；语言简洁，不要评论，不要提及压缩本身。'

/** Prompt used by the total pass when the user wrote none. */
const DEFAULT_TOTAL_PROMPT = '把这段对话压缩成一份结构化的中文检查点，按 ## 标题分节：用户目标与偏好、涉及的文件与命令、报错与修法、已完成与待办、下一步。保留文件名、命令、报错原文与关键数值，用简短条目，不要评论，不要提及压缩本身。'

/**
 * Prompt for condensing one turn's middle.
 *
 * The middle is what the model did after the user asked something: the commands
 * it ran, the output it saw, the edits it made, the conclusion it reached. The
 * instruction is NOT part of the input — it is preserved separately — so this
 * prompt only has to describe the work.
 */
const DEFAULT_TURN_PROMPT = `下面是一轮对话中「模型做了什么」的完整记录，包含思考、工具调用和返回结果。
请把它压缩成一段简洁的中文记录，要求：
- 保留执行过的命令与关键参数、文件路径、报错原文、关键数值；
- 说明最终结果（成功/失败）与得出的结论；
- 若中途有被推翻的方案，只记最终采用的；
- 用紧凑的要点式叙述，不要评论，不要提及压缩本身。
只输出压缩后的内容本身，不要加标题或前缀。`

/** Defaults mirror the README table. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  /** Empty means "$DSH_HOME/compact-arsenal" resolved at runtime, never a fixed path. */
  archiveDir: '',
  /** Whether rewrite records are written at all; off means nothing touches disk. */
  archiveEnabled: true,
  /**
   * Turn-interval compression: the primary feature.
   *
   * Condenses everything the model wrote between one user instruction and the
   * next into a single block. The instruction itself is never touched, so no
   * requirement can be paraphrased away.
   */
  turns: {
    enabled: false,
    pressureRatio: 0.7,
    /** Minimum middle size before a turn is worth condensing. */
    minChars: 2000,
    /** Never condense a turn whose instruction is more recent than this. */
    keepLast: 2,
    /**
     * How much of the middle the summary may keep, as a ratio.
     *
     * Empty means unlimited — the prompt already asks for a condensed record, and
     * a fixed character cap would either truncate a good summary mid-sentence or
     * leave a huge turn barely compressed. A ratio scales with the input.
     */
    summaryRatio: null,
    /**
     * Total transcript characters per model call.
     *
     * Measured on a real session: turn transcripts average ~21,600 chars, so a
     * 24,000 budget fits roughly ONE turn per call — batching then saves almost
     * nothing. At 96,000 the same 26 turns take 8 calls instead of 26.
     *
     * The ceiling is the model's context window: on a 1M-token route (~400K chars
     * of usable input) 96,000 leaves ample room for the reply and the instruction.
     * A smaller-window model needs this lowered.
     */
    maxInputChars: 96000,
    /**
     * The only brake on a pass. A turn-count cap used to live here too, but it
     * stopped a 180-second budget after 51 seconds — the budget is what a user
     * actually feels, so a count on top of it only cuts work short.
     *
     * Enforced in minutes by the panel (60s minimum): a shorter budget cannot
     * finish even one batch, so the pass would never make progress.
     */
    maxPassMs: 180000,
    provider: '',
    model: '',
    prompt: DEFAULT_TURN_PROMPT,
    /**
     * Reply budget for ONE batch, not one turn.
     *
     * 1200 was sized for a single summary and would truncate a batch reply
     * mid-JSON, which `parseSummaries` then rejects wholesale. At three turns per
     * call and up to ~500 chars each, plus JSON punctuation, 4000 is comfortable;
     * a batch that needs more simply produces shorter records.
     */
    maxTokens: 4000,
  },
  total: {
    enabled: false,
    pressureRatio: 0.85,
    thresholdRatio: 0.8,
    retainRatio: 0.16,
    maxTokens: 65536,
    retainTurns: 2,
    maxInputChars: 60000,
    provider: '',
    model: '',
    prompt: DEFAULT_TOTAL_PROMPT,
  },
  /**
   * Thinking-fragment compression: retired.
   *
   * Turn compression subsumes it — the reasoning inside a turn is condensed with
   * the rest of the middle, where it is seen in context instead of in isolation.
   * Kept in the config so existing settings are not silently lost, but off and
   * no longer shown in the panel.
   */
  reasoning: {
    enabled: false,
    pressureRatio: 0.75,
    mode: 'truncate',
    keepLast: 3,
    minTotalChars: 15000,
    minChars: 200,
    headChars: 600,
    tailChars: 300,
    batchChars: 12000,
    maxItems: 12,
    maxCharsPerPass: 40000,
    maxPassMs: 90000,
    model: { provider: '', model: '', prompt: DEFAULT_MODEL_PROMPT, maxTokens: 512 },
  },
  /**
   * Tool-output pruning: the shipped pruner's algorithm, at its own defaults.
   *
   * 8192 / 4096 / 1024 are exactly `dsh-compaction-tool-result-pruner`'s
   * numbers. It exists as a zero-cost first pass — trimming repetitive output
   * before anything is sent to a model.
   */
  tools: {
    enabled: false,
    pressureRatio: 0.6,
    mode: 'truncate',
    thresholdChars: 8192,
    minTotalChars: 15000,
    minChars: 200,
    headChars: 4096,
    tailChars: 1024,
    keepLast: 2,
    batchChars: 12000,
    maxItems: 12,
    maxCharsPerPass: 40000,
    maxPassMs: 90000,
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
  const reasoning = pick(DEFAULTS.reasoning, input.reasoning)
  const tools = pick(DEFAULTS.tools, input.tools)
  const turns = pick(DEFAULTS.turns, input.turns)
  // Migration: before batching, `minChars` was a per-fragment trigger (2000).
  // It is now a per-fragment floor, so a legacy value would silently skip every
  // small fragment. A config without `batchChars` is legacy and is re-seeded.
  if (input.reasoning?.batchChars === undefined) reasoning.minChars = DEFAULTS.reasoning.minChars
  if (input.tools?.batchChars === undefined) tools.minChars = DEFAULTS.tools.minChars
  // An empty prompt means "use the built-in one", never "send nothing".
  // A prompt that is mostly `?` is what a non-UTF-8 writer leaves behind, so it
  // is treated the same way and can never reach the model.
  if (isUnusablePrompt(total.prompt)) total.prompt = DEFAULT_TOTAL_PROMPT
  if (isUnusablePrompt(turns.prompt)) turns.prompt = DEFAULT_TURN_PROMPT
  if (isUnusablePrompt(reasoningModel.prompt)) reasoningModel.prompt = DEFAULT_MODEL_PROMPT
  if (isUnusablePrompt(toolsModel.prompt)) toolsModel.prompt = DEFAULT_MODEL_PROMPT
  // Legacy defaults carried the output format ("只输出要点"), which used to fight
  // the batching layer's own instruction. Re-seed those exact old texts.
  if (isLegacyModelPrompt(reasoningModel.prompt)) reasoningModel.prompt = DEFAULT_MODEL_PROMPT
  if (isLegacyModelPrompt(toolsModel.prompt)) toolsModel.prompt = DEFAULT_MODEL_PROMPT
  // Turn compression supersedes thinking compression, so a config that still has
  // `reasoning` on is coerced off: leaving it on would run both passes over the
  // same content and pay twice.
  reasoning.enabled = false
  return {
    enabled: input.enabled ?? DEFAULTS.enabled,
    archiveDir: typeof input.archiveDir === 'string' ? input.archiveDir : DEFAULTS.archiveDir,
    archiveEnabled: input.archiveEnabled === undefined ? DEFAULTS.archiveEnabled : input.archiveEnabled === true,
    turns,
    total,
    reasoning: { ...reasoning, model: reasoningModel },
    tools: {
      ...tools,
      model: toolsModel,
      onlyTools: Array.isArray(input.tools?.onlyTools) ? input.tools.onlyTools.filter((v) => typeof v === 'string') : [],
    },
  }
}

/**
 * Whether a stored prompt should be replaced by the built-in default.
 *
 * Two cases: empty, and mojibake left by a writer that was not UTF-8 (every
 * non-ASCII character became `?`). A genuinely Chinese prompt keeps far fewer
 * question marks, so a ratio test isolates the corrupted ones.
 *
 * @param {unknown} prompt - stored prompt value.
 * @returns {boolean} true when the value must not be sent to a model.
 */
export function isUnusablePrompt(prompt) {
  if (typeof prompt !== 'string') return true
  const text = prompt.trim()
  if (text === '') return true
  const marks = (text.match(/\?/g) ?? []).length
  if (marks < 5) return false
  const meaningful = text.replace(/\s/g, '').length
  return marks / Math.max(1, meaningful) >= 0.3
}

/**
 * Whether a stored prompt is one of the retired built-in defaults.
 *
 * Those texts ended with "只输出要点", an output-format demand that fought the
 * batching layer's own JSON instruction; they are re-seeded to the style-only text.
 *
 * @param {unknown} prompt - stored prompt value.
 * @returns {boolean} true when the value is an obsolete default.
 */
function isLegacyModelPrompt(prompt) {
  return typeof prompt === 'string' && prompt.includes('只输出要点') && prompt.includes('不超过 200 字')
}

/**
 * Recompute the pressure snapshot from whichever agent is live.
 *
 * The step hook updates the same object at most once per turn; a panel read
 * should reflect the session as it stands now, including when every section is
 * disabled and the hook short-circuits.
 *
 * @param {any} ctx - plugin context.
 * @param {{ reported: number | null, estimated: number, window: number | null }} pressure - snapshot to update.
 * @returns {void}
 */
function refreshPressure(ctx, pressure) {
  try {
    const agents = ctx.get('agents')?.list?.() ?? []
    const agent = agents[agents.length - 1]
    if (agent === undefined) return
    const session = ctx.sessions.get(agent.id)
    if (session === undefined) return
    const snapshot = pressureSnapshot(ctx, session)
    pressure.reported = snapshot.reported ?? null
    pressure.estimated = snapshot.estimated
    pressure.window = session.requestContext?.()?.contextWindow ?? null
  } catch {
    // A missing agent registry only means "nothing live to measure".
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
  const stats = { reasoning: 0, tools: 0, chars: 0, failed: 0, archived: 0 }
  /**
   * Last observed pressure inputs, so the panel can show both the provider's
   * number and the heuristic estimate that the gate falls back to.
   */
  const pressure = { reported: null, estimated: 0, window: null }
  const archive = { root: archiveRoot(config.archiveDir), lastPath: null }

  if (config.enabled) {
    /**
     * Sessions with a rewrite in flight.
     *
     * `lastProcessedTurn` is marked synchronously when a rewrite starts, but the
     * append lands seconds later (a model batch can take a while). Without this
     * guard two turns of the same session can rewrite concurrently, which writes
     * a replacement whose `turn` belongs to a turn that has already ended.
     */
    const inFlight = new Set()
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision?.kind !== 'enter') return decision
      if (inFlight.has(payload.agent.id)) return decision
      inFlight.add(payload.agent.id)
      /**
       * Run the rewrite WITHOUT awaiting it.
       *
       * Awaiting made every model-backed pass a synchronous cost on the reply:
       * with up to 12 items per section and two sections, one turn could wait on
       * a dozen sequential summarization calls before the model was even asked
       * to answer. The user saw no thinking and no tool calls, which is exactly
       * what a stalled pre-step looks like. The step now proceeds immediately and
       * the rewrite lands when it lands; the turn-boundary guard inside
       * `compressSection` refuses any append once the turn has closed, so running
       * detached cannot write into a finished turn.
       */
      void rewrite(ctx, config, payload, lastProcessedTurn, stats, archive, pressure)
        .catch((error) => {
          ctx.logger?.warn?.(`[compact-arsenal] rewrite skipped: ${error?.message ?? error}`)
        })
        .finally(() => {
          inFlight.delete(payload.agent.id)
        })
      return decision
    })
  }

  // The panel needs a read/write channel, so these routes exist even while the
  // plugin is switched off: that is how it gets switched back on.
  registerPanelRoutes(ctx, config, stats, archive, pressure)
}

/** Route prefix owned by this plugin. */
const API_PREFIX = '/compact-arsenal/api'

/**
 * The file-manager command that reveals a directory on this platform.
 *
 * Windows needs the absolute path to `explorer.exe`: a bare name is resolved
 * against the child's `PATH`, which the subprocess service scrubs. The other
 * platforms take the launcher by bare name, which is conventional.
 *
 * @param {string} target - absolute directory path.
 * @returns {{ argv: string[] }} the command to spawn.
 */
function explorerCommand(target) {
  if (process.platform === 'win32') {
    // A bare directory path is the form Windows documents for opening a folder.
    // The earlier failure was not the argument: explorer was spawned through a
    // managed-subprocess service that reaped it. Now it is spawned detached, so
    // the plain path is both correct and the simplest thing that works.
    const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
    return { argv: [join(systemRoot, 'explorer.exe'), target] }
  }
  if (process.platform === 'darwin') return { argv: ['open', target] }
  return { argv: ['xdg-open', target] }
}

/**
 * Serve the panel's state and accept its edits.
 * @param {any} ctx - plugin context.
 * @param {any} config - the config this instance mounted with.
 * @param {{ reasoning: number, tools: number, chars: number }} stats - live counters.
 */
function registerPanelRoutes(ctx, config, stats, archive, pressure) {
  const webServer = ctx.get('webServer')
  const configEditor = ctx.get('configEditor')
  if (webServer === undefined) return

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const route = (path, handler) => ctx.effect(() => webServer.register({ kind: 'exact', path, handler }))

  /**
   * The provider/model catalog, so the panel can offer the same picker a chat
   * model selection uses instead of free-text fields.
   *
   * Read from the live `llm` registry rather than a stored copy: a route appears
   * here exactly when the Harness could actually route a request to it.
   */
  /**
   * TEMPORARY experiment route — removed after the comparison run.
   *
   * Runs the plugin's own `summarize()` against a caller-supplied prompt, so the
   * comparison measures the prompt rather than a hand-built HTTP client.
   */
  route(`${API_PREFIX}/experiment`, async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
    let body = ''
    for await (const chunk of req) body += chunk
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      return send(res, 400, { error: 'invalid-json' })
    }
    const llm = ctx.get('llm')
    if (llm === undefined) return send(res, 503, { error: 'llm-unavailable' })

    const provider = payload.provider || 'ark-plan'
    const model = payload.model || 'deepseek-v4-1-flash-economy-261017'
    const started = Date.now()
    try {
      // Import here so the experiment cannot affect normal load.
      const { summarize } = await import('./lib/summarize.js')
      const reply = await summarize(
        ctx,
        { provider, model, prompt: payload.system, maxTokens: payload.maxTokens ?? 900 },
        payload.user,
        undefined,
      )
      send(res, 200, { ok: true, reply, elapsedMs: Date.now() - started })
    } catch (error) {
      send(res, 500, { ok: false, error: String(error?.message ?? error), elapsedMs: Date.now() - started })
    }
  })

  route(`${API_PREFIX}/models`, async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
    const llm = ctx.get('llm')
    if (llm === undefined) return send(res, 503, { error: 'llm-unavailable', providers: [] })
    try {
      const providers = llm.listProviders().map((p) => ({ id: p.id, name: p.name }))
      const models = []
      for (const provider of providers) {
        let list = []
        try {
          list = await llm.listModels(provider.id)
        } catch {
          // A provider that cannot enumerate still routes; keep it selectable.
        }
        for (const model of list) {
          models.push({
            provider: provider.id,
            providerName: provider.name,
            id: model.id,
            name: model.name || model.id,
          })
        }
      }
      send(res, 200, { providers, models })
    } catch (error) {
      send(res, 500, { error: 'list-failed', message: String(error?.message ?? error), providers: [], models: [] })
    }
  })

  /**
   * Report whether a newer published version exists.
   *
   * The check reads the npm registry from the Host, not the browser: the panel
   * is served from localhost and a browser fetch to npmjs.org would be blocked
   * or leak the user's address to a third party. Only the version string and a
   * changelog pointer come back — nothing about the local install leaves this
   * process.
   *
   * A failure is reported as an ordinary state, not an error: being offline is
   * the normal case for a desktop plugin and must not look like a fault.
   */
  route(`${API_PREFIX}/update-check`, async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
    const current = PACKAGE_VERSION
    // Every branch of a check is logged, including the ones that never reach
    // the network: a click that produced no line would be indistinguishable
    // from a click the panel never sent.
    const started = Date.now()
    const reply = (body, level = 'info') => {
      void logLine(level, 'update-check', {
        status: body.status,
        current,
        latest: body.latest ?? undefined,
        elapsedMs: Date.now() - started,
        ...(body.message === undefined ? {} : { message: body.message }),
      })
      send(res, 200, body)
    }

    if (PACKAGE_NAME === '') {
      return reply({ current, latest: null, status: 'unknown-package' }, 'warn')
    }
    try {
      const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 404) {
        return reply({ current, latest: null, status: 'not-published' }, 'warn')
      }
      if (!response.ok) throw new Error(`registry ${response.status}`)
      const body = await response.json()
      const latest = typeof body?.version === 'string' ? body.version : null
      if (latest === null) return reply({ current, latest: null, status: 'no-version' }, 'warn')
      const order = compareVersions(latest, current)
      reply({
        current,
        latest,
        status: order > 0 ? 'outdated' : 'current',
        url: 'https://github.com/TacitSay/dsh-compact-arsenal/releases',
      })
    } catch (error) {
      reply({ current, latest: null, status: 'offline', message: String(error?.message ?? error) }, 'warn')
    }
  })

  /**
   * Open the archive directory in the desktop file manager.
   *
   * The path is resolved server-side from the plugin's own location, so the
   * browser never supplies or learns a host path it could misuse.
   */
  route(`${API_PREFIX}/open-archive`, async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) {
      void logLine('warn', 'open-archive: subprocess service missing')
      return send(res, 503, { error: 'subprocess-unavailable' })
    }
    const target = archive.root

    // The directory may not exist yet (nothing compressed since install, or the
    // archive was cleaned). Creating it first is what makes the button work at
    // all: a file manager launched on a missing path exits immediately.
    try {
      await mkdir(target, { recursive: true })
    } catch (error) {
      void logLine('error', 'open-archive: cannot create directory', { path: target, error: String(error?.message ?? error) })
      return send(res, 500, { error: 'archive-dir-unavailable', path: target })
    }

    const spec = explorerCommand(target)
    try {
      // On Windows the launch goes through `cmd /c start` rather than spawning
      // explorer directly. explorer.exe has two habits that make a direct spawn
      // look like it worked when it did not: it returns immediately whatever
      // happens (so a failure is invisible), and when an explorer process is
      // already running it hands the request to that instance and exits — a
      // child reaped with the request never delivers it. `start` goes through
      // the shell, the same path as double-clicking a folder.
      //
      // Elsewhere the launcher is a normal foreground program, so a detached
      // spawn of it is correct as-is.
      const launch = process.platform === 'win32'
        ? { command: 'cmd.exe', args: ['/c', 'start', '', spec.argv[0], ...spec.argv.slice(1)] }
        : { command: spec.argv[0], args: spec.argv.slice(1) }
      const child = spawn(launch.command, launch.args, {
        cwd: target,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32',
      })
      child.unref()
      void logLine('info', 'open-archive: launched', {
        argv: [launch.command, ...launch.args].join(' '),
        path: target,
        pid: child.pid,
      })
      send(res, 200, { opened: true, path: target, command: spec.argv.join(' '), pid: child.pid })
    } catch (error) {
      void logLine('error', 'open-archive: spawn failed', { argv: spec.argv.join(' '), error: String(error?.message ?? error) })
      send(res, 500, { error: 'spawn-failed', message: String(error?.message ?? error), path: target })
    }
  })

  route(`${API_PREFIX}/state`, (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
    // Fold any live agent into the snapshot at read time: the step hook only
    // updates it once per turn, and the panel should not show a stale number.
    refreshPressure(ctx, pressure)
    send(res, 200, {
      version: PACKAGE_VERSION,
      config,
      stats,
      editable: configEditor !== undefined,
      lastFailure,
      archiveRoot: archive.root,
      logRoot: logRoot(),
      lastArchivePath: archive.lastPath,
      pressure,
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
    send(res, 200, {
      config: next,
      stats,
      editable: true,
      totalApplied,
      lastFailure,
      archiveRoot: archive.root,
      logRoot: logRoot(),
      lastArchivePath: archive.lastPath,
      pressure,
    })
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
 * Condense the middle of old turns, leaving every user instruction untouched.
 *
 * For each turn older than `keepLast`, everything between the instruction and
 * the next instruction — reasoning, tool calls, tool results, assistant replies —
 * is sent to the model as one transcript, and the span is replaced by a single
 * `assistant/message` carrying the condensed result.
 *
 * `assistant/message` is the right role (the summary describes what the model
 * did) and it also determines one constraint: the log forbids that type from
 * carrying `sourceEventSeqs`, so the link back to the originals lives in the
 * archive file, which stores the full transcript.
 *
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {any} policy - turns section config.
 * @param {number} currentTurn - turn that owns these writes.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @param {any} stats - live counters.
 * @param {{ root: string, lastPath: string | null }} archive - archive target.
 * @param {(() => boolean) | undefined} stillOpen - checked before every append.
 * @returns {Promise<{ items: number, chars: number, failed: number, archived: number }>} what landed.
 */
async function turnsPass(ctx, session, policy, currentTurn, signal, stats, archive, stillOpen) {
  const intervals = findTurnIntervals(session)
  const keepLast = Number.isFinite(policy.keepLast) ? Math.max(0, Math.trunc(policy.keepLast)) : 2
  const minChars = Number.isFinite(policy.minChars) ? policy.minChars : 2000
  const maxInput = Number.isFinite(policy.maxInputChars) ? policy.maxInputChars : 24000
  // Ratio of the middle the summary may occupy. Empty / 0 means unlimited.
  const ratio = Number.isFinite(policy.summaryRatio) && policy.summaryRatio > 0
    ? Math.min(1, policy.summaryRatio)
    : null
  // A pass shorter than a minute cannot finish even one batch on a slow route,
  // so a tiny value would mean "never make progress". Clamped, not rejected: the
  // config editor writes whatever the panel sends.
  const budgetMs = Math.max(60000, Number.isFinite(policy.maxPassMs) ? policy.maxPassMs : 180000)

  // Oldest first, and never the most recent `keepLast` turns: those are the
  // live working set.
  const eligible = intervals.slice(0, Math.max(0, intervals.length - keepLast))

  const routed = session.requestContext?.() ?? {}
  const modelCfg = {
    provider: policy.provider || routed.provider || '',
    model: policy.model || routed.model || '',
    prompt: policy.prompt || DEFAULT_TURN_PROMPT,
    maxTokens: Number.isFinite(policy.maxTokens) ? policy.maxTokens : 1200,
  }

  let items = 0
  let chars = 0
  let failed = 0
  let archived = 0
  const startedAt = Date.now()

  /**
   * Group turns into batches by transcript size.
   *
   * Each batch becomes ONE model call. The grouping is what makes this cheaper
   * than per-turn calls: a turn's transcript is mostly tool output, but the fixed
   * cost per request (system prompt, headers, round-trip) is paid once per batch
   * instead of once per turn.
   *
   * A transcript larger than the whole budget gets a batch to itself and is
   * truncated — that is the only case where content is cut before the model sees
   * it, and it is why `maxInputChars` is worth raising for very large sessions.
   */
  const batches = []
  let current = []
  let currentSize = 0
  for (const interval of eligible) {
    if (isCondensedMiddle(session, interval)) continue
    const middle = middleChars(session, interval.middleSeqs)
    if (middle < minChars) continue
    const transcript = middleTranscript(session, interval.middleSeqs)
    if (transcript === '') continue

    const clipped = transcript.length > maxInput ? transcript.slice(0, maxInput) : transcript
    if (current.length > 0 && currentSize + clipped.length > maxInput) {
      batches.push(current)
      current = []
      currentSize = 0
    }
    current.push({ interval, transcript, input: clipped, middle })
    currentSize += clipped.length
  }
  if (current.length > 0) batches.push(current)

  void logLine('info', 'turns pass start', {
    intervals: intervals.length,
    eligible: eligible.length,
    batches: batches.length,
    provider: modelCfg.provider,
    model: modelCfg.model,
  })

  for (const batch of batches) {
    signal?.throwIfAborted?.()
    if (stillOpen !== undefined && !stillOpen()) {
      void logLine('warn', 'turns aborted: turn closed', { items })
      break
    }
    if (Date.now() - startedAt > budgetMs) {
      lastFailure = `turns: 本轮处理了 ${items} 轮后到达 ${budgetMs}ms 预算`
      void logLine('warn', 'turns budget reached', { items, remaining: batches.length })
      break
    }

    let summaries
    try {
      summaries = await summarizeTurns(
        ctx,
        { ...modelCfg, summaryRatio: ratio },
        batch.map((item) => item.input),
        signal,
      )
    } catch (error) {
      failed += batch.length
      lastFailure = `turns 批次（${batch.length} 轮）: ${String(error?.message ?? error)}`
      void logLine('error', 'turns batch failed', {
        turns: batch.length,
        error: String(error?.message ?? error),
      })
      continue
    }

    for (const [i, entry] of batch.entries()) {
      if (stillOpen !== undefined && !stillOpen()) break
      let summary = String(summaries[i] ?? '').trim()
      // A blank slot means the model skipped this turn. Leave it alone — the next
      // pass will offer it again, which is cheaper than failing the batch.
      if (summary === '') continue

      if (ratio !== null) {
        const cap = Math.max(200, Math.floor(entry.middle * ratio))
        if ([...summary].length > cap) summary = [...summary].slice(0, cap).join('')
      }

      try {
        // The replacement MUST cite every shadowed node, and `assistant/message`
        // is forbidden from citing anything — the two rules are mutually
        // exclusive, so a `user/message` is the only legal carrier for a
        // multi-node span. The marker prefix is what distinguishes it from the
        // user's own words in the log and on the panel.
        session.append('user/message', {
          id: `compact-arsenal-turn-${entry.interval.userSeq}-${Date.now()}`,
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: frameSummary(summary) }],
        }, {
          surfaceOp: { op: 'replace', startSeq: entry.interval.middleSeqs[0], endSeq: entry.interval.middleSeqs.at(-1) },
          sourceEventSeqs: entry.interval.middleSeqs,
        })
      } catch (error) {
        failed += 1
        lastFailure = `turn ${entry.interval.userSeq}: ${String(error?.message ?? error)}`
        void logLine('error', 'turns append rejected', {
          seq: entry.interval.userSeq,
          error: String(error?.message ?? error),
        })
        continue
      }

      items += 1
      chars += Math.max(0, entry.middle - summary.length)

      if (policy.archiveEnabled !== false) {
        const path = await archiveRewrite({
          root: archive.root,
          sessionId: session.id,
          sessionTitle: sessionTitleOf(session),
          kind: 'turn',
          method: 'model',
          seq: entry.interval.userSeq,
          original: entry.transcript,
          replacement: summary,
          summary,
        })
        if (path !== undefined) {
          archived += 1
          archive.lastPath = path
        }
      }
    }
  }

  void logLine('info', 'turns pass end', {
    items,
    chars,
    failed,
    archived,
    elapsedMs: Date.now() - startedAt,
  })

  return { items, chars, failed, archived }
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
async function totalPass(ctx, session, total, turn, signal, stats, archive) {
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

  // The replacement must cite EVERY surface node inside the replaced span, not
  // just the ones we fed the model: filters above skip system/developer nodes
  // and nodes without a turn, and those still sit inside [startSeq, endSeq].
  const startSeq = picked[0].seq
  const endSeq = picked[picked.length - 1].seq
  const surface = [...session.surface.nodes]
  const startIdx = surface.indexOf(startSeq)
  const endIdx = surface.indexOf(endSeq)
  if (startIdx < 0 || endIdx < startIdx) return
  if (startIdx === 0 && session.eventAt(surface[0])?.type === 'system/message') return
  const shadowed = surface.slice(startIdx, endIdx + 1)

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

  try {
    session.append(
      'user/message',
      buildUserCheckpoint(
        `This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it.\n\n<compacted-summary>\n${summary}\n</compacted-summary>`,
        'total',
        startSeq,
        turn,
      ),
      { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs: shadowed },
    )
    stats.total = (stats.total ?? 0) + 1
    stats.chars += used
    ctx.logger?.debug?.(`[compact-arsenal] total: replaced ${picked.length} nodes (-${used} chars)`)
    const archivedPath = total.archiveEnabled === false ? undefined : await archiveRewrite({
      root: archive.root,
      sessionId: session.id,
      sessionTitle: sessionTitleOf(session),
      kind: 'total',
      method: 'model',
      seq: startSeq,
      original: transcript,
      replacement: summary,
      summary,
    })
    if (archivedPath !== undefined) {
      stats.archived = (stats.archived ?? 0) + 1
      archive.lastPath = archivedPath
    }
  } catch (error) {
    ctx.logger?.warn?.(`[compact-arsenal] total replacement rejected: ${error?.message ?? error}`)
  }
}

/**
 * The conversation title the Host shows for a session, when it exposes one.
 *
 * The title is what a user recognizes in a file listing; the session id stays
 * in the record body for exact matching. Absent titles simply fall back to id.
 *
 * @param {any} session - live session.
 * @returns {string | undefined} the title, or undefined when unknown.
 */
function sessionTitleOf(session) {
  // The title is a logged event, not a session property: `dsh-session-title`
  // folds `session/title` (projection key `title`) to produce the very string
  // the sidebar shows.
  //
  // A backward scan cannot be bounded: the newest title can sit thousands of
  // events behind the tail (this session's is at seq 839 with 7575 events after
  // it), so any step limit silently falls back to the id. One forward pass over
  // the log is what actually finds it, and only the LAST title wins.
  try {
    const end = typeof session.seq === 'number' ? session.seq : 0
    let title
    for (let seq = 0; seq <= end; seq += 1) {
      const event = session.eventAt?.(seq)
      if (event?.type !== 'session/title') continue
      const value = event.data?.title
      if (typeof value === 'string' && value.trim() !== '') title = value.trim()
    }
    if (title !== undefined) return title
  } catch {
    // A log without titles only means "use the id".
  }
  // Fall back to a projection read when the Host exposes one.
  try {
    const projected = session?.title
    if (typeof projected === 'string' && projected.trim() !== '') return projected.trim()
  } catch {
    // ignore
  }
  return undefined
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
function rewrite(ctx, config, payload, lastProcessedTurn, stats, archive, pressure) {
  return rewriteAsync(ctx, config, payload, lastProcessedTurn, stats, archive, pressure)
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
async function rewriteAsync(ctx, config, payload, lastProcessedTurn, stats, archive, pressure) {
  const session = ctx.sessions.get(payload.agent.id)
  if (session === undefined) return

  // Measure before any gate: the panel must be able to explain why nothing ran,
  // so a fully disabled plugin still reports the current pressure.
  const snapshot = pressureSnapshot(ctx, session)
  pressure.reported = snapshot.reported ?? null
  pressure.estimated = snapshot.estimated
  pressure.window = session.requestContext?.()?.contextWindow ?? null

  if (!config.total.enabled && !config.reasoning.enabled && !config.tools.enabled) return

  if (lastProcessedTurn.get(session.id) === payload.turn) return

  lastProcessedTurn.set(session.id, payload.turn)

  // Record the gate arithmetic once per turn: when a pass does not run, this is
  // the only place that says which condition held it back.
  const gate = {
    turn: payload.turn,
    session: session.id,
    title: sessionTitleOf(session),
    used: snapshot.used ?? snapshot.estimated,
    window: pressure.window ?? undefined,
  }
  void logLine('info', 'gate', {
    ...gate,
    total: config.total.enabled ? rate(snapshot, pressure.window) >= config.total.pressureRatio : 'off',
    reasoning: config.reasoning.enabled ? rate(snapshot, pressure.window) >= config.reasoning.pressureRatio : 'off',
    tools: config.tools.enabled ? rate(snapshot, pressure.window) >= config.tools.pressureRatio : 'off',
  })

  // Total runs LAST (see the cascade below): it rewrites whole turns, so every
  // cheaper pass gets a chance to relieve the pressure first.
  const nodes = [...session.surface.nodes]
  const assistantSeqs = []
  const toolSeqs = []
  for (const seq of nodes) {
    const event = session.eventAt(seq)
    if (event?.type === 'assistant/message') assistantSeqs.push(seq)
    else if (event?.type === 'tool/result') toolSeqs.push(seq)
  }

  /**
   * Whether the turn that started this pass is still the session's open turn.
   *
   * A surface replacement is only valid while its turn is open: writing after
   * `turn/end` leaves a row in the gap between turns, which the log loader
   * rejects on the next resume. Re-checking before every append keeps a slow
   * model batch from writing into a turn that already closed.
   */
  const stillOpen = () => {
    if (payload.signal?.aborted) return false
    const open = openTurnOf(session)
    return open === undefined || open === payload.turn
  }

  // The archive switch is global; mirror it into each section policy so the
  // per-record decision stays a single field read.
  const withArchive = (section) => ({ ...section, archiveEnabled: config.archiveEnabled })

  /**
   * Cascade, cheapest first — the same discipline the shipped pruner follows:
   * relieve pressure with the pass that costs no model call, re-measure, and
   * only escalate while the pressure is still above the next section's
   * threshold.
   *
   * Without this, two model-backed sections sharing a threshold both fire on
   * the same turn: each pays for its own summarization call even though the
   * first one already brought the session back under pressure. The cheap pass
   * lands first, so most turns never reach the model at all.
   *
   * Order is fixed by cost and by reach:
   *   1. tools (mechanical when configured, narrowest blast radius)
   *   2. reasoning
   *   3. total (rewrites whole turns; the most destructive and most expensive)
   */
  const cascade = [
    { key: 'tools', section: config.tools, kind: 'tools', seqs: () => toolSeqs },
    { key: 'reasoning', section: config.reasoning, kind: 'reasoning', seqs: () => assistantSeqs },
  ]

  for (const step of cascade) {
    const section = step.section
    if (!section.enabled) continue
    // Re-read the session each time: a landed pass changed its size, and the
    // whole point of the cascade is to act on that new size.
    if (!underPressure(ctx, session, section.pressureRatio)) {
      void logLine('info', 'cascade skip', { section: step.key, reason: 'below threshold' })
      continue
    }
    const saved = await compressSection(
      ctx, session, withArchive(section), step.kind,
      dropRecent(step.seqs(), section.keepLast),
      payload.signal, archive, payload.turn, stillOpen,
    )
    stats[step.key] += saved.items
    stats.failed += saved.failed ?? 0
    stats.chars += saved.chars
    stats.archived += saved.archived ?? 0
    void logLine('info', 'cascade step', {
      section: step.key,
      items: saved.items,
      chars: saved.chars,
      failed: saved.failed ?? 0,
    })
  }

  // Turn compression sits between the zero-cost tool trim and the whole-history
  // checkpoint: it is the first pass that costs a model call, and it is scoped
  // to single turns so the user's own words are never rewritten.
  if (config.turns.enabled && underPressure(ctx, session, config.turns.pressureRatio)) {
    const saved = await turnsPass(ctx, session, config.turns, payload.turn, payload.signal, stats, archive, stillOpen)
    stats.turns = (stats.turns ?? 0) + saved.items
    stats.failed += saved.failed ?? 0
    stats.chars += saved.chars
    stats.archived += saved.archived ?? 0
    void logLine('info', 'turns pass', {
      items: saved.items,
      chars: saved.chars,
      failed: saved.failed ?? 0,
    })
  } else if (config.turns.enabled) {
    void logLine('info', 'cascade skip', { section: 'turns', reason: 'below threshold' })
  }

  // Total last: it rewrites whole turns, so everything cheaper ran first.
  if (config.total.enabled && underPressure(ctx, session, config.total.pressureRatio)) {
    await totalPass(ctx, session, config.total, payload.turn, payload.signal, stats, archive)
  }
}

/** Most recent rewrite rejection, surfaced on the panel for diagnosis. */
let lastFailure = null

/** Marker text per section, and per method: model-written text is distinguishable. */
function sectionMarker(kind, fromModel) {
  if (kind === 'tools') return fromModel ? MODEL_TOOL_MARKER : TOOL_MARKER
  return fromModel ? MODEL_REASONING_MARKER : REASONING_MARKER
}

/**
 * Text a section owns inside one event.
 * @param {any} event - surface event.
 * @param {'reasoning' | 'tools'} kind - section kind.
 * @returns {string} concatenated text, or '' when the event carries none.
 */
function sectionText(event, kind) {
  const blocks = event.data?.message?.content
  if (!Array.isArray(blocks)) return ''
  const wanted = kind === 'tools' ? 'text' : 'reasoning'
  return blocks.filter((block) => block?.type === wanted)
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
}

/**
 * Replace one event's text with a rewritten version, keeping message identity.
 * @param {any} session - live session.
 * @param {any} event - the surface event being replaced.
 * @param {number} seq - its surface seq.
 * @param {'reasoning' | 'tools'} kind - section kind.
 * @param {string} text - replacement text.
 * @returns {void}
 */
/**
 * Rewrite one node's text, using the only shape the log accepts for each type.
 *
 * `tool/result` may be replaced in place because it can cite the node it
 * shadows. `assistant/message` cannot: the log rejects any `sourceEventSeqs` on
 * it ("assistant/message embeds its source stream"), while every replacement
 * must cite all shadowed nodes — so an in-place assistant rewrite is impossible
 * on every published version. Reasoning therefore collapses into a
 * `user/message` checkpoint covering the whole replaced span, which is the same
 * shape the shipped compaction backends use.
 *
 * @param {any} session - live session.
 * @param {any} event - the surface event being replaced.
 * @param {number} seq - its surface seq.
 * @param {'reasoning' | 'tools'} kind - section kind.
 * @param {string} text - replacement text.
 * @param {number} currentTurn - turn that owns this write.
 * @returns {void}
 */
function applyRewrittenText(session, event, seq, kind, text, currentTurn) {
  if (kind === 'tools') {
    const blocks = event.data?.message?.content ?? []
    const rich = blocks.filter((block) => block?.type !== 'text')
    const message = { ...event.data.message, content: [{ type: 'text', text }, ...rich] }
    // A tool/result replacement may change ONLY content: the log compares every
    // other field verbatim after blanking content, so reusing the node's own
    // turn/step is mandatory. Writing the current turn here is rejected with
    // "tool/result surface replacement may change only content".
    session.append('tool/result', {
      turn: event.data.turn,
      step: event.data.step,
      message,
      ...(event.data.error === undefined ? {} : { error: event.data.error }),
      ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
    }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
    return
  }

  // Reasoning: replace the node with a user-role checkpoint that cites it.
  // This is a NEW message rather than a rewrite of an existing one, so it takes
  // the turn that owns the write.
  const checkpoint = buildUserCheckpoint(text, kind, seq, currentTurn)
  session.append('user/message', checkpoint, {
    surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
    sourceEventSeqs: [seq],
  })
}

/**
 * Build the `user/message` payload that stands in for a compressed node.
 *
 * For `user/message` the event `data` IS the message, so it must satisfy the
 * log's full message shape: a non-empty `id`, `role: 'user'`, a `source` with a
 * non-empty `kind`, and array `content`. The id is what a strict reload checks
 * first — a checkpoint without one makes the whole session unloadable
 * (`lacks an identified message`).
 *
 * @param {string} text - replacement text.
 * @param {'reasoning' | 'tools'} kind - section kind, recorded in the id.
 * @param {number} seq - the node being replaced, recorded in the id.
 * @param {number | undefined} currentTurn - turn that owns this write.
 * @returns {{ id: string, role: 'user', source: { kind: string }, content: any[], turn?: number, step?: number }} the message.
 */
function buildUserCheckpoint(text, kind, seq, currentTurn) {
  const checkpoint = {
    // Traceable rather than random: the id itself says which node it replaced.
    id: `compact-arsenal-${kind}-${seq}-${Date.now()}`,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  }
  if (Number.isFinite(currentTurn)) {
    checkpoint.turn = currentTurn
    checkpoint.step = 1
  }
  assertUserCheckpointShape(checkpoint)
  return checkpoint
}

/**
 * Fail fast when a checkpoint would be rejected by the log.
 *
 * Mirrors `assertMessageEventShape` for `user/message` in `dsh-session`: the
 * four checks that a strict reload performs. Catching a malformed checkpoint
 * here keeps it out of the log entirely instead of corrupting the session.
 *
 * @param {any} message - the candidate message.
 * @returns {void}
 * @throws {Error} when a required field is missing or malformed.
 */
function assertUserCheckpointShape(message) {
  if (typeof message?.id !== 'string' || message.id === '') {
    throw new Error('user checkpoint needs a non-empty id')
  }
  if (message.role !== 'user') throw new Error('user checkpoint needs role "user"')
  if (typeof message.source?.kind !== 'string' || message.source.kind === '') {
    throw new Error('user checkpoint needs a source kind')
  }
  if (!Array.isArray(message.content)) throw new Error('user checkpoint needs array content')
}

/**
 * Whether one section can legally replace a node in this session right now.
 *
 * The check is deliberately cheap and local: it mirrors the log's own rules
 * (a replacement must cite the node it shadows, and `assistant/message` may not
 * cite anything) so an impossible write is detected before a model call.
 *
 * @param {any} session - live session.
 * @param {'reasoning' | 'tools'} kind - section kind.
 * @param {number | undefined} seq - the node that would be replaced.
 * @returns {boolean} true when the replacement shape is allowed.
 */
function canReplace(session, kind, seq) {
  if (seq === undefined) return false
  const surface = session.surface?.nodes
  if (!Array.isArray(surface) || !surface.includes(seq)) return false
  if (kind === 'tools') return session.eventAt?.(seq)?.type === 'tool/result'
  // Reasoning collapses into a user/message checkpoint, which may cite the node.
  return kind === 'reasoning'
}

/**
 * Compress one section: gate on the section total, then work in batches.
 *
 * Reasoning arrives as many small fragments, so a per-fragment threshold never
 * fires. The gate is therefore the section total, and one model call covers a
 * whole batch of fragments.
 *
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @param {any} policy - section config.
 * @param {'reasoning' | 'tools'} kind - section kind.
 * @param {readonly number[]} seqs - candidate surface seqs, oldest first.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @param {{ root: string, lastPath: string | null }} archive - archive target.
 * @param {number} currentTurn - turn that owns these writes.
 * @param {(() => boolean) | undefined} stillOpen - re-checked before every append.
 * @returns {Promise<{ items: number, chars: number, failed: number, archived: number }>} what landed.
 */
async function compressSection(ctx, session, policy, kind, seqs, signal, archive, currentTurn, stillOpen) {
  const marker = sectionMarker(kind, policy.mode === 'model')
  const minTotal = Number.isFinite(policy.minTotalChars) ? policy.minTotalChars : 15000
  const perItemFloor = Number.isFinite(policy.minChars) ? policy.minChars : 0
  const maxItems = Number.isFinite(policy.maxItems) ? policy.maxItems : 12
  const maxChars = Number.isFinite(policy.maxCharsPerPass) ? policy.maxCharsPerPass : 40000
  const batchChars = Number.isFinite(policy.batchChars) ? policy.batchChars : 12000

  const candidates = []
  let totalChars = 0
  for (const seq of seqs) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    const text = sectionText(event, kind)
    if (text === '') continue
    if (alreadyRewritten(text)) continue
    if (perItemFloor > 0 && text.length < perItemFloor) continue
    candidates.push({ seq, event, text })
    totalChars += text.length
  }
  if (totalChars < minTotal) return { items: 0, chars: 0, failed: 0, archived: 0 }

  // A rejection here is deterministic: the log will refuse the same shape every
  // time. Probing with one throwaway append keeps a doomed batch from spending a
  // model call, so `mode: model` cannot burn requests on writes that cannot land.
  if (!canReplace(session, kind, candidates[0].seq)) {
    lastFailure = `${kind}: surface shape rejected before any model call`
    return { items: 0, chars: 0, failed: 1, archived: 0 }
  }

  const routed = session.requestContext?.() ?? {}
  const model = policy.model ?? {}
  const modelCfg = {
    ...model,
    provider: model.provider || routed.provider || '',
    model: model.model || routed.model || '',
    prompt: model.prompt || '保留文件名、命令、报错原文、关键数值与结论；语言简洁，不要评论，不要提及压缩本身。',
  }

  let items = 0
  let chars = 0
  let failed = 0
  let archived = 0
  let index = 0
  // A wall-clock budget per pass. Without it one pass can chain many model calls
  // back to back; any that hang add up, and the pass never yields.
  const startedAt = Date.now()
  const budgetMs = Number.isFinite(policy.maxPassMs) ? policy.maxPassMs : 90000
  void logLine('info', 'pass start', {
    kind,
    mode: policy.mode,
    candidates: candidates.length,
    totalChars,
    session: session.id,
    title: sessionTitleOf(session),
  })
  // The model path is bounded by TIME, not by a fixed item count.
  //
  // A long session can hold 700+ fragments, which needs ~120 model calls at
  // eight per batch. `maxItems` was 12, so a pass covered 1.6% of the backlog
  // and the next turn started over — the session never actually shrank. The
  // wall-clock budget is the honest limit (it is what the user feels), so the
  // item cap is lifted for model mode and left in place for mechanical mode,
  // where each item costs nothing and an unbounded loop would be the risk.
  const itemCap = policy.mode === 'model' ? Number.POSITIVE_INFINITY : maxItems
  while (index < candidates.length && items < itemCap && chars < maxChars) {
    // The step may have been cancelled while a model batch was in flight; never
    // write into a session whose turn has been torn down.
    signal?.throwIfAborted?.()
    if (stillOpen !== undefined && !stillOpen()) {
      void logLine('warn', 'pass aborted: turn closed', { kind, turn: currentTurn, items })
      return { items, chars, failed, archived }
    }
    if (Date.now() - startedAt > budgetMs) {
      // A budget stop is not a failure: the fragments processed so far are
      // already durable. Reporting it as `failed` would tell the user nothing
      // was compressed when in fact most of it was.
      lastFailure = `${kind}: 本轮处理了 ${items} 条后到达 ${budgetMs}ms 时间预算，剩余 ${candidates.length - index} 条留到下一轮`
      void logLine('warn', 'pass budget reached', {
        kind,
        items,
        chars,
        remaining: candidates.length - index,
        budgetMs,
      })
      break
    }
    const batch = []
    let batchSize = 0
    // Batch by CHARACTERS, not by a fixed count. The old limit of 8 made a
    // 760-fragment backlog take 95 calls; the real constraint is the 12000-char
    // prompt cap, so filling to that cap is what keeps the call count sane.
    // A small fragment count still bounds the JSON reply the model must emit.
    while (index < candidates.length && batch.length < 24 && batchSize < batchChars) {
      batch.push(candidates[index])
      batchSize += candidates[index].text.length
      index += 1
    }

    const summaries = policy.mode === 'model'
      ? await summarizeBatchSafe(ctx, modelCfg, batch.map((item) => item.text), signal)
      : null
    signal?.throwIfAborted?.()

    for (let i = 0; i < batch.length; i += 1) {
      signal?.throwIfAborted?.()
      if (stillOpen !== undefined && !stillOpen()) {
      void logLine('warn', 'pass aborted: turn closed', { kind, turn: currentTurn, items })
      return { items, chars, failed, archived }
    }
      const item = batch[i]
      const summary = summaries === null ? null : summaries[i]
      const replacement = buildReplacement(item.text, policy, marker, summary)
      if (replacement === null) continue
      try {
        // The append is the only proof that the rewrite landed, so the counters
        // move strictly after it returns.
        applyRewrittenText(session, item.event, item.seq, kind, replacement, currentTurn)
      } catch (error) {
        failed += 1
        lastFailure = `#${item.seq}: ${error?.message ?? error}`
        // The first rejection of a pass explains the whole pass, and the panel
        // only shows the latest one. Log the first three so the reason survives.
        if (failed <= 3) {
          void logLine('error', 'append rejected', {
            kind,
            seq: item.seq,
            turn: currentTurn,
            error: String(error?.message ?? error),
          })
        }
        ctx.logger?.warn?.(`[compact-arsenal] ${kind} replacement rejected: ${error?.message ?? error}`)
        continue
      }
      items += 1
      chars += Math.max(0, item.text.length - replacement.length)
      const archivedPath = policy.archiveEnabled === false ? undefined : await archiveRewrite({
        root: archive.root,
        sessionId: session.id,
        sessionTitle: sessionTitleOf(session),
        kind,
        method: policy.mode === 'model' ? 'model' : 'mechanical',
        seq: item.seq,
        original: item.text,
        replacement,
        summary: summary ?? undefined,
      })
      if (archivedPath !== undefined) {
        archived += 1
        archive.lastPath = archivedPath
      }
    }
  }
  void logLine(items > 0 || failed > 0 ? 'info' : 'warn', 'pass end', {
    kind,
    items,
    chars,
    failed,
    archived,
    elapsedMs: Date.now() - startedAt,
  })
  return { items, chars, failed, archived }
}

/**
 * Ask for a batch of summaries, downgrading to `null` on any failure.
 * @param {any} ctx - plugin context.
 * @param {any} cfg - model config.
 * @param {readonly string[]} texts - fragments.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @returns {Promise<string[] | null>} summaries, or `null` to use mechanical output.
 */
async function summarizeBatchSafe(ctx, cfg, texts, signal) {
  try {
    return await summarizeBatch(ctx, cfg, texts, signal)
  } catch (error) {
    ctx.logger?.warn?.(`[compact-arsenal] batch summary fell back to mechanical: ${error?.message ?? error}`)
    return null
  }
}

/**
 * Replacement text for one fragment.
 * @param {string} text - original text.
 * @param {any} policy - section config.
 * @param {string} marker - section marker.
 * @param {string | undefined} summary - model summary, when available.
 * @returns {string | null} replacement text, or `null` to leave the fragment alone.
 */
function buildReplacement(text, policy, marker, summary) {
  const head = Number.isFinite(policy.headChars) ? policy.headChars : 0
  const tail = Number.isFinite(policy.tailChars) ? policy.tailChars : 0
  const points = [...text]
  if (typeof summary === 'string' && summary !== '') {
    const keptHead = points.slice(0, head).join('')
    const keptTail = tail > 0 ? points.slice(Math.max(0, points.length - tail)).join('') : ''
    return `${keptHead}\n\n${marker}\n${summary}\n${marker}\n\n${keptTail}`
  }
  // Mechanical: short fragments collapse to a minimal marker, long ones keep
  // head/tail.
  //
  // Emphatically NOT an empty string or an empty content array. An empty
  // `tool/result` content is accepted by the log but reaches the provider as a
  // `tool_result` block with no parts, because the DeepSeek adapter drops empty
  // text blocks (`block.text ? [...] : []`) — and a provider-side rejection is
  // exactly the failure mode that has corrupted sessions twice before. One
  // character of marker text keeps the block well-formed at negligible cost.
  if (points.length <= head + tail + marker.length) return SHORT_MARKER
  return `${points.slice(0, head).join('')}\n\n${marker}\n\n${points.slice(points.length - tail).join('')}`
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
  const used = currentPressureTokens(ctx, session)
  return used >= window * r
}

/**
 * Tokens the next request is expected to cost, preferring the provider's own
 * count over the heuristic estimate.
 *
 * The heuristic prices text at ~4 characters per token, which undercounts CJK
 * and JSON by roughly 12%: a session measured at 0.519 of its window can look
 * like 0.454 and never trip the gate. `contextPressure()` carries the prompt
 * size the provider last reported, so that figure wins whenever it exists.
 *
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @returns {{ used: number, reported: number | undefined, estimated: number }} the pressure inputs.
 */
function pressureSnapshot(ctx, session) {
  let reported
  try {
    const pressure = ctx.tokenMeter?.contextPressure?.(session)
    if (pressure && typeof pressure === 'object') {
      const value = pressure.projectedTokens ?? pressure.pressureTokens
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) reported = value
    }
  } catch {
    // A missing projection only means "fall back to the estimate".
  }
  const measured = ctx.tokenMeter?.measure?.(session)
  const estimated = typeof measured?.totalTokens === 'number' ? measured.totalTokens : 0
  return { used: reported ?? estimated, reported, estimated }
}

/**
 * Just the token count the gate compares against the window.
 * @param {any} ctx - plugin context.
 * @param {any} session - live session.
 * @returns {number} pressure tokens.
 */
function currentPressureTokens(ctx, session) {
  return pressureSnapshot(ctx, session).used
}

/**
 * The current pressure as a ratio of the context window, for logging.
 * @param {{ used?: number, estimated: number }} snapshot - pressure inputs.
 * @param {number | null} window - context window, when known.
 * @returns {number} the ratio, or 0 when the window is unknown.
 */
function rate(snapshot, window) {
  if (typeof window !== 'number' || window <= 0) return 0
  const used = snapshot.used ?? snapshot.estimated ?? 0
  return used / window
}

/**
 * The turn that is currently open in a session, read from its own log.
 *
 * The last `turn/start` wins unless a matching `turn/end` closed it. Returned
 * as `undefined` when the log carries no turn markers yet, so callers can treat
 * "cannot tell" as "do not block".
 *
 * @param {any} session - live session.
 * @returns {number | undefined} the open turn number.
 */
function openTurnOf(session) {
  // Turn markers are log-only events, never surface nodes, so they are read from
  // the log tail. Scanning backwards keeps this O(recent), not O(session).
  const end = typeof session.seq === 'number' ? session.seq : 0
  let seen = 0
  let lastStart
  for (let seq = end; seq >= 0; seq -= 1) {
    const event = session.eventAt?.(seq)
    if (event === undefined) continue
    seen += 1
    if (event.type === 'turn/end' && lastStart === undefined && event.data?.turn !== undefined) {
      // The newest marker is an end: that turn is already closed.
      return undefined
    }
    if (event.type === 'turn/start') {
      lastStart = event.data?.turn
      return lastStart
    }
    if (seen >= 400) break
  }
  return undefined
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