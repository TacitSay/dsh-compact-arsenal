/**
 * Model-backed summarization helpers.
 *
 * Each helper takes the exact text that a mechanical pass would have thrown
 * away and asks one model call to condense it. Callers fall back to the
 * mechanical rewrite whenever this path fails, so a broken route never blocks
 * a step.
 */

/** Upper bound on the text one summarization call will look at. */
export const MAX_INPUT_CHARS = 12000

/** Upper bound on one summarization call, so a silent provider cannot stall a turn. */
export const SUMMARIZE_TIMEOUT_MS = 45000

/**
 * The timeout a call actually uses.
 *
 * Read from the environment so a test can shrink it; production keeps the
 * documented constant.
 * @returns {number} milliseconds.
 */
function timeoutMs() {
  const raw = Number(process.env.COMPACT_ARSENAL_SUMMARIZE_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : SUMMARIZE_TIMEOUT_MS
}

/**
 * Condense one elided fragment with a single model call.
 * @param {any} ctx - plugin context carrying the `llm` service.
 * @param {{ provider: string, model: string, prompt: string, maxTokens: number }} cfg - model section config.
 * @param {string} text - fragment that would otherwise be dropped.
 * @param {AbortSignal | undefined} signal - step cancellation.
 * @returns {Promise<string>} the summary text; throws when unavailable.
 */
export async function summarize(ctx, cfg, text, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('llm-unavailable')
  if (typeof cfg.provider !== 'string' || cfg.provider === '') throw new Error('provider-missing')
  if (typeof cfg.model !== 'string' || cfg.model === '') throw new Error('model-missing')

  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text
  if (input.trim() === '') return ''

  const messages = [
    { role: 'system', content: [{ type: 'text', text: cfg.prompt }] },
    { role: 'user', content: [{ type: 'text', text: input }] },
  ]

  // The step signal does not bound a stuck provider: a stream that never
  // finishes would await forever and the turn would show no reply at all. A
  // local timeout turns that into an ordinary failure the caller can fall back
  // from, and the two signals are chained so either one cancels the call.
  const timeout = new AbortController()
  const budget = timeoutMs()
  const timer = setTimeout(() => timeout.abort(new Error('summarize-timeout')), budget)
  const onAbort = () => timeout.abort(signal?.reason)
  signal?.addEventListener?.('abort', onAbort, { once: true })

  let out = ''
  try {
    const stream = llm.stream({
      provider: cfg.provider,
      model: cfg.model,
      messages,
      maxTokens: Math.max(64, Number.isFinite(cfg.maxTokens) ? cfg.maxTokens : 512),
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
