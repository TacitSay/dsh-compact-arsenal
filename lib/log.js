/**
 * A small append-only log kept inside the plugin directory.
 *
 * Purpose is diagnosis, not telemetry: when a pass misbehaves the log says what
 * the plugin decided and why, next to the code that made the decision. The file
 * is size-capped and rotated once, so it can never grow without bound.
 *
 * Nothing here may throw: a logging problem must never affect a rewrite.
 */

import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The plugin's own root, derived from this module's location. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Where the log lives: `<plugin>/logs/compact-arsenal.log`. */
export function logRoot() {
  return join(PLUGIN_ROOT, 'logs')
}

/** Rotate once the file passes this size, keeping one previous copy. */
const MAX_BYTES = 2 * 1024 * 1024

/** Serialise writes so concurrent passes cannot interleave mid-line. */
let queue = Promise.resolve()

/**
 * Append one line to the plugin log.
 *
 * @param {string} level - `info`, `warn` or `error`.
 * @param {string} message - what happened.
 * @param {Record<string, unknown>} [fields] - extra values, appended as key=value.
 * @returns {Promise<void>} resolves when the write finished or was abandoned.
 */
export function logLine(level, message, fields) {
  const suffix = fields === undefined
    ? ''
    : ' ' + Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ')
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}\n`

  queue = queue.then(async () => {
    try {
      const dir = logRoot()
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'compact-arsenal.log')
      try {
        const info = await stat(file)
        if (info.size > MAX_BYTES) {
          // Keep exactly one previous file; older history is not worth the disk.
          await rename(file, join(dir, 'compact-arsenal.log.1'))
        }
      } catch {
        // No file yet: nothing to rotate.
      }
      await appendFile(file, line, 'utf8')
    } catch {
      // A read-only install cannot log; that must not surface anywhere else.
    }
  }).catch(() => {})

  return queue
}
