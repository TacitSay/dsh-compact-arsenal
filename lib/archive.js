/**
 * Durable archive of every rewrite the plugin performs.
 *
 * Records land under the Harness home, never in a hard-coded absolute path:
 * the directory is resolved at runtime from `DSH_HOME` (falling back to
 * `~/.dsh`), then `compact-arsenal/<session>/<kind>-<seq>.md`.
 *
 * Files are written lazily and failures are swallowed: an archive problem must
 * never block a rewrite or a step.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Marker used when the original text is unavailable (should not happen). */
const UNKNOWN = '(原始内容不可用)'

/**
 * Root directory of the plugin archive.
 * @param {string | undefined} configured - user-configured override, if any.
 * @returns {string} absolute directory path.
 */
export function archiveRoot(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
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
 * Write one archive record.
 * @param {object} input - record input.
 * @param {string} input.root - archive root directory.
 * @param {string} input.sessionId - owning session.
 * @param {string} input.kind - `reasoning` or `tools`.
 * @param {string} input.method - `mechanical` or `model`.
 * @param {number} input.seq - surface seq of the rewritten node.
 * @param {string} input.original - text before the rewrite.
 * @param {string} input.replacement - text after the rewrite.
 * @param {string} [input.summary] - model summary, when the model path produced one.
 * @returns {Promise<string | undefined>} the written path, or undefined on failure.
 */
export async function archiveRewrite(input) {
  const dir = join(input.root, safeSegment(input.sessionId))
  const name = `${input.kind}-${input.method}-${input.seq}.md`
  const path = join(dir, name)
  const original = input.original === '' ? UNKNOWN : input.original
  const body = [
    `# ${input.kind} / ${input.method} / seq ${input.seq}`,
    '',
    `- session: ${input.sessionId}`,
    `- original chars: ${original.length}`,
    `- rewritten chars: ${input.replacement.length}`,
    `- saved chars: ${Math.max(0, original.length - input.replacement.length)}`,
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
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path, body, 'utf8')
    return path
  } catch {
    return undefined
  }
}
