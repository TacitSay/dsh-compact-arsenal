/**
 * Durable archive of every rewrite the plugin performs.
 *
 * Records land inside the plugin's own directory (`<plugin>/archive`), resolved
 * from this module's URL rather than any hard-coded host path — so the archive
 * travels with the plugin and a different machine gets a different folder for
 * free. When that location is not writable (a read-only install), the writer
 * falls back to `$DSH_HOME/compact-arsenal`.
 *
 * File names are built for finding a record later: the conversation comes
 * first (so one session sorts together), then what was compressed, how, and
 * when. A typical name:
 *
 *   WordCut-词剪--reasoning--model--20261111-214530--seq1234.md
 *
 * Files are written lazily and failures are swallowed: an archive problem must
 * never block a rewrite or a step.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Marker used when the original text is unavailable (should not happen). */
const UNKNOWN = '(原始内容不可用)'

/** The plugin's own root directory, derived from this module's location. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Root directory of the plugin archive.
 * @param {string | undefined} configured - user-configured override, if any.
 * @returns {string} absolute directory path.
 */
export function archiveRoot(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  return join(PLUGIN_ROOT, 'archive')
}

/**
 * Fallback root used only when the plugin directory refuses a write.
 * @returns {string} absolute directory path.
 */
export function archiveFallbackRoot() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'compact-arsenal')
}

/** Make a string safe for a file name on every platform. */
function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'item'
}

/**
 * A short, readable label for the conversation.
 *
 * Uses the session title when the Host exposes one (that is what the user
 * recognises), otherwise the session id. Kept short so the name stays scannable.
 *
 * @param {{ title?: string, sessionId: string }} input - conversation identity.
 * @returns {string} a file-name-safe label.
 */
function conversationLabel(input) {
  const raw = typeof input.title === 'string' && input.title.trim() !== ''
    ? input.title.trim()
    : input.sessionId
  // Keep CJK characters: they are far more recognisable than a transliteration.
  const cleaned = raw.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned.slice(0, 48) || 'session'
}

/**
 * `YYYYMMDD-HHMMSS` in local time, so a directory listing sorts chronologically.
 * @param {number} time - epoch milliseconds.
 * @returns {string} a compact local timestamp.
 */
function stamp(time) {
  const d = new Date(time)
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('')
}

/**
 * Write one archive record.
 * @param {object} input - record input.
 * @param {string} input.root - archive root directory.
 * @param {string} input.sessionId - owning session.
 * @param {string} [input.sessionTitle] - conversation title, when known.
 * @param {string} input.kind - `reasoning`, `tools` or `total`.
 * @param {string} input.method - `mechanical` or `model`.
 * @param {number} input.seq - surface seq of the rewritten node.
 * @param {string} input.original - text before the rewrite.
 * @param {string} input.replacement - text after the rewrite.
 * @param {string} [input.summary] - model summary, when the model path produced one.
 * @param {number} [input.time] - when the rewrite happened; defaults to now.
 * @returns {Promise<string | undefined>} the written path, or undefined on failure.
 */
export async function archiveRewrite(input) {
  const dir = join(input.root, safeSegment(input.sessionId))
  const conversation = conversationLabel({ title: input.sessionTitle, sessionId: input.sessionId })
  const when = Number.isFinite(input.time) ? input.time : Date.now()
  // Conversation first, then content / method / time / node: two records of the
  // same conversation sort together, and time breaks ties in reading order.
  const name = `${conversation}--${input.kind}--${input.method}--${stamp(when)}--seq${input.seq}.md`
  const path = join(dir, name)
  const original = input.original === '' ? UNKNOWN : input.original
  const savedChars = Math.max(0, original.length - input.replacement.length)
  const ratio = original.length === 0
    ? '—'
    : `${((savedChars / original.length) * 100).toFixed(1)}%`
  const body = [
    `# ${input.kind} / ${input.method} / seq ${input.seq}`,
    '',
    `- 对话: ${input.sessionTitle?.trim() || '(无标题)'}`,
    `- 会话: ${input.sessionId}`,
    `- 时间: ${new Date(when).toISOString()}`,
    `- 方式: ${input.method}`,
    `- 内容: ${input.kind}`,
    `- 原文字符: ${original.length}`,
    `- 改写后字符: ${input.replacement.length}`,
    `- 省下字符: ${savedChars}（${ratio}）`,
    '',
    ...(typeof input.summary === 'string' && input.summary !== ''
      ? ['## 模型要点', '', input.summary, '']
      : []),
    '## 改写后（模型实际看到的内容）',
    '',
    '```text',
    input.replacement,
    '```',
    '',
    '## 原文',
    '',
    '```text',
    original,
    '```',
    '',
  ].join('\n')

  // Preferred location: inside the plugin directory.
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path, body, 'utf8')
    return path
  } catch {
    // A read-only install (npm package, sandboxed mount) cannot take the write.
  }

  // Fallback: the Harness home, so the record is not lost outright.
  const fallbackDir = join(archiveFallbackRoot(), safeSegment(input.sessionId))
  const fallbackPath = join(fallbackDir, name)
  try {
    await mkdir(fallbackDir, { recursive: true })
    await writeFile(fallbackPath, body, 'utf8')
    return fallbackPath
  } catch {
    return undefined
  }
}
