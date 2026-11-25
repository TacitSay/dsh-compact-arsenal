/**
 * Durable archive of every rewrite the plugin performs.
 *
 * **Where records go, and why it is not the plugin directory by default.**
 *
 * The obvious location is `<plugin>/archive`, resolved from this module's URL. That
 * works for a development checkout but silently destroys data for a normal install:
 * a plugin installed from npm lives under `node_modules/`, which pnpm owns and wipes
 * on every reinstall or update. A user would find their records gone with no error
 * and no explanation.
 *
 * So the default is `$DSH_HOME/compact-arsenal`, which survives reinstalls. The
 * plugin directory is used only when it is demonstrably NOT inside `node_modules`
 * — i.e. a development checkout, where keeping records next to the source is what
 * the author wants.
 *
 * An explicit `archiveDir` always wins.
 *
 * File names are built for finding a record later: the conversation comes first (so
 * one session sorts together), then what was compressed, how, and when.
 *
 *   WordCut-词剪--turn--model--20261111-214530--seq1234.md
 *
 * Files are written lazily and failures are swallowed: an archive problem must
 * never block a rewrite or a step.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Marker used when the original text is unavailable (should not happen). */
const UNKNOWN = '(原始内容不可用)'

/** The plugin's own root directory, derived from this module's location. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Whether this copy lives inside a package manager's tree.
 *
 * `node_modules` is owned by pnpm/npm: an install, update or prune deletes and
 * recreates its contents. Anything written there is temporary by definition, so it
 * must never hold the only copy of a user's records.
 *
 * @returns {boolean} true when the plugin is inside `node_modules`.
 */
export function isManagedInstall() {
  return PLUGIN_ROOT.split(/[\\/]/).includes('node_modules')
}

/**
 * Root directory of the plugin archive.
 *
 * Explicit configuration wins; otherwise a development checkout keeps records
 * beside the source, and a managed install uses the durable home location.
 *
 * @param {string | undefined} configured - user-configured override, if any.
 * @returns {string} absolute directory path.
 */
export function archiveRoot(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  if (isManagedInstall()) return join(dshHome(), 'compact-arsenal', 'archive')
  return join(PLUGIN_ROOT, 'archive')
}

/**
 * The Harness home directory.
 *
 * `DSH_HOME` when set, otherwise `~/.dsh` — the same convention the Host uses, so a
 * portable or relocated install keeps its data together.
 *
 * @returns {string} absolute path.
 */
export function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  return join(homedir(), '.dsh')
}

/**
 * Root used when the preferred location refuses a write.
 *
 * Always under the Harness home, never the plugin directory: a read-only install
 * directory is exactly the case where the plugin tree cannot be trusted to keep
 * anything.
 *
 * @returns {string} absolute directory path.
 */
export function archiveFallbackRoot() {
  return join(dshHome(), 'compact-arsenal')
}

/** Make a string safe for a file name on every platform. */
function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'item'
}

/**
 * A short, readable label for the conversation, used as the directory suffix.
 *
 * Uses the session title — the string the sidebar shows — and never the session
 * id, which already leads the directory name. A session without a title yet
 * gets a neutral placeholder.
 *
 * @param {{ title?: string }} input - conversation identity.
 * @returns {string} a file-name-safe label.
 */
function conversationLabel(input) {
  const raw = typeof input.title === 'string' && input.title.trim() !== ''
    ? input.title.trim()
    : '未命名对话'
  // Keep CJK characters: they are far more recognisable than a transliteration.
  const cleaned = raw.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned.slice(0, 48) || '未命名对话'
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
  // Identity lives on the DIRECTORY: the conversation title first (what a
  // reader scans for), then the session id (what is unambiguous). Records
  // inside then need only what varies within the session.
  const conversation = conversationLabel({ title: input.sessionTitle })
  const dir = join(input.root, `${conversation}--${safeSegment(input.sessionId)}`)
  const when = Number.isFinite(input.time) ? input.time : Date.now()
  // File names carry only what varies within the session: content, method,
  // time, node. No title and no id, so a listing stays short and scannable.
  const name = `${input.kind}--${input.method}--${stamp(when)}--seq${input.seq}.md`
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
