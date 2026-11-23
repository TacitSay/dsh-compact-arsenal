/**
 * Model-backed summarization helpers.
 *
 * Each helper takes the exact text that a mechanical pass would have thrown
 * away and asks one model call to condense it. Callers fall back to the
 * mechanical rewrite whenever this path fails, so a broken route never blocks
 * a step.
 */

/** Upper bound on the text one summarization call will look at when the caller sets none. */
export const MAX_INPUT_CHARS = 12000

/**
 * Per-call generation timeout.
 *
 * A single summary finishes in a few seconds, but a batch of ten summaries emits
 * ~14,000 output tokens, which takes minutes at the ~105 tokens/sec this route
 * measures. The old 45-second ceiling made every large batch time out, so the
 * limit has to scale with the output the caller asked for.
 */
export const SUMMARIZE_TIMEOUT_MS = 45000

/** Extra time allowed on top of the pure generation estimate, for latency and retries. */
const TIMEOUT_SLACK_MS = 60000

/** Conservative generation rate used to size the timeout; measured ~105 tok/s. */
const ASSUMED_TOKENS_PER_SEC = 40

/**
 * The timeout a call actually uses.
 *
 * Two inputs decide it: an explicit override (environment, so a test can shrink
 * it) and the output the caller requested. A call allowed to emit 60,000 tokens
 * cannot be held to 45 seconds, and holding it there is what silently killed
 * batch passes before.
 *
 * @param {number} maxTokens - output budget the caller requested.
 * @returns {number} milliseconds.
 */
function timeoutMs(maxTokens) {
  const raw = Number(process.env.COMPACT_ARSENAL_SUMMARIZE_TIMEOUT_MS)
  if (Number.isFinite(raw) && raw > 0) return raw
  const requested = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 512
  const generationMs = Math.ceil((requested / ASSUMED_TOKENS_PER_SEC) * 1000)
  return Math.max(SUMMARIZE_TIMEOUT_MS, generationMs + TIMEOUT_SLACK_MS)
}

/**
 * Condense one elided fragment with a single model call.
 * @param {any} ctx - plugin context carrying the `llm` service.
 * @param {{ provider: string, model: string, prompt: string, maxTokens: number, maxInputChars?: number }} cfg - model section config.
 * @param {string} text - fragment that would otherwise be dropped.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @returns {Promise<string>} the summary text; throws when unavailable.
 */
export async function summarize(ctx, cfg, text, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('llm-unavailable')
  if (typeof cfg.provider !== 'string' || cfg.provider === '') throw new Error('provider-missing')
  if (typeof cfg.model !== 'string' || cfg.model === '') throw new Error('model-missing')

  // The caller's budget wins. Batching groups turns to `maxInputChars` (up to a
  // few hundred thousand characters), so the old hard 12,000 cap here silently
  // truncated most of every batch — the grouping and the truncation disagreed,
  // and the truncation was invisible.
  const budgetChars = Number.isFinite(cfg.maxInputChars) && cfg.maxInputChars > 0
    ? cfg.maxInputChars
    : MAX_INPUT_CHARS
  const input = text.length > budgetChars ? text.slice(0, budgetChars) : text
  if (input.trim() === '') return ''

  const messages = [
    { role: 'system', content: [{ type: 'text', text: cfg.prompt }] },
    { role: 'user', content: [{ type: 'text', text: input }] },
  ]

  const maxTokens = Math.max(64, Number.isFinite(cfg.maxTokens) ? cfg.maxTokens : 512)

  // The step signal does not bound a stuck provider: a stream that never
  // finishes would await forever and the turn would show no reply at all. A
  // local timeout turns that into an ordinary failure the caller can fall back
  // from, and the two signals are chained so either one cancels the call.
  const timeout = new AbortController()
  const budget = timeoutMs(maxTokens)
  const timer = setTimeout(() => timeout.abort(new Error('summarize-timeout')), budget)
  const onAbort = () => timeout.abort(signal?.reason)
  signal?.addEventListener?.('abort', onAbort, { once: true })

  let out = ''
  try {
    const stream = llm.stream({
      provider: cfg.provider,
      model: cfg.model,
      messages,
      maxTokens,
      purpose: 'compaction',
      signal: timeout.signal,
    })
    for await (const chunk of stream) {
      if (timeout.signal.aborted) break
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      else if (chunk?.type === 'finish') break
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
  if (out.trim() === '' && timeout.signal.aborted) throw new Error('summarize-timeout')
  return out.trim()
}

/**
 * Build the replacement text for a fragment: head, a model summary of the
 * middle, then the tail.
 * @param {any} ctx - plugin context.
 * @param {any} cfg - model section config.
 * @param {string} text - full original text.
 * @param {{ headChars: number, tailChars: number, marker: string }} budgets - budgets.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @returns {Promise<string | null>} replacement text, or `null` when the model summary is unusable.
 */
/**
 * Condense several fragments in ONE model call.
 *
 * Small fragments (one reasoning note, one tool result) are rarely worth a
 * call on their own, so they are numbered into a single request and parsed back.
 * @param {any} ctx - plugin context carrying the `llm` service.
 * @param {{ provider: string, model: string, prompt: string, maxTokens: number }} cfg - model config.
 * @param {readonly string[]} texts - fragments, in order.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @returns {Promise<string[]>} one summary per input, in order; throws when unusable.
 */
export async function summarizeBatch(ctx, cfg, texts, signal) {
  if (texts.length === 0) return []
  const numbered = texts.map((text, index) => {
    const body = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text
    return `---#${index + 1}---\n${body}`
  }).join('\n\n')

  const instruction = `${cfg.prompt}\n\n下面有 ${texts.length} 段内容，用 ---#n--- 分隔。请为每一段各写一条不超过 120 字的要点，严格输出 JSON 数组，元素形如 {"i":1,"s":"要点"}，不要输出任何其他文字。`
  const raw = await summarize(ctx, { ...cfg, prompt: instruction }, numbered, signal)
  const parsed = parseSummaries(raw, texts.length)
  if (parsed === null) throw new Error('batch-parse-failed')
  return parsed
}

/**
 * Read `[{"i":1,"s":"..."}]` out of a model reply, tolerating prose around it.
 * @param {string} raw - model reply.
 * @param {number} count - expected item count.
 * @returns {string[] | null} summaries in input order, or `null` when unusable.
 */
export function parseSummaries(raw, count) {
  const match = String(raw).match(/\[[\s\S]*\]/)
  if (match === null) return null
  let list
  try {
    list = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  const out = new Array(count).fill('')
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const index = Number(entry.i ?? entry.index) - 1
    const text = entry.s ?? entry.summary ?? entry.text
    if (!Number.isInteger(index) || index < 0 || index >= count) continue
    if (typeof text === 'string') out[index] = text.trim()
  }
  return out.some((item) => item !== '') ? out : null
}

/**
 * Condense several turn transcripts in ONE model call.
 *
 * Each turn would otherwise cost its own request, and the固定 overhead dominates:
 * six turns measured 51.7s across six calls, most of it request setup and
 * round-trip latency rather than generation. Numbering the transcripts into one
 * request pays that overhead once.
 *
 * Two things make the batch safe:
 *
 * - The caller groups by total characters, so the prompt stays inside the input
 *   budget; a single oversized turn still gets a batch to itself.
 * - A missing or malformed entry does not fail the whole batch. `parseSummaries`
 *   returns per-item strings with blanks where the model skipped one, and a blank
 *   simply means "leave this turn alone" — the next pass will retry it.
 *
 * @param {any} ctx - plugin context carrying the `llm` service.
 * @param {{ provider: string, model: string, prompt: string, maxTokens: number }} cfg - model config.
 * @param {readonly string[]} transcripts - one transcript per turn, in order.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @returns {Promise<string[]>} one summary per transcript; blank when unusable.
 */
export async function summarizeTurns(ctx, cfg, transcripts, signal) {
  if (transcripts.length === 0) return []

  const numbered = transcripts
    .map((text, index) => `---#${index + 1}---\n${text}`)
    .join('\n\n')
  // The per-item length limit lives in the instruction, not in the text: cutting
  // a transcript at an arbitrary character would delete the tool output that the
  // summary is supposed to describe.
  const ratioNote = Number.isFinite(cfg.summaryRatio) && cfg.summaryRatio > 0
    ? `每条要点不超过对应原文的 ${Math.round(cfg.summaryRatio * 100)}%。`
    : '每条要点尽量简短，只保留后续仍需要的信息。'

  const instruction = `${cfg.prompt}

下面有 ${transcripts.length} 段相互独立的「一轮对话中模型做了什么」，用 ---#n--- 分隔。
请为每一段各输出一条压缩记录。${ratioNote}
严格输出 JSON 数组，元素形如 {"i":1,"s":"压缩后的记录"}，条数必须等于 ${transcripts.length}，不要输出任何其他文字。`

  const raw = await summarize(ctx, { ...cfg, prompt: instruction }, numbered, signal)
  const parsed = parseSummaries(raw, transcripts.length)
  if (parsed === null) throw new Error('turn-batch-parse-failed')
  return parsed
}

export async function summarizeMiddle(ctx, cfg, text, budgets, signal) {
  const points = [...text]
  const head = points.slice(0, budgets.headChars).join('')
  const tail = budgets.tailChars > 0 ? points.slice(Math.max(0, points.length - budgets.tailChars)).join('') : ''
  const middle = points.slice(budgets.headChars, Math.max(budgets.headChars, points.length - budgets.tailChars)).join('')
  if (middle.trim() === '') return null
  const summary = await summarize(ctx, cfg, middle, signal)
  if (summary === '') return null
  return `${head}\n\n${budgets.marker}\n${summary}\n${budgets.marker}\n\n${tail}`
}
