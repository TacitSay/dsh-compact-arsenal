/**
 * Persisted counters, so the panel survives a restart.
 *
 * The in-memory `stats` object reset to zero every time DSH restarted, which made
 * the panel's "本次进程已执行" line meaningless: it described one process, not how
 * much compression the plugin had actually done. A user reading "0 次" had no way
 * to know whether anything had ever run.
 *
 * Stored as one small JSON file next to the archive. Writes are debounced by the
 * caller (once per pass, not per item) and every failure is swallowed — a counter
 * that cannot be written must never break a compression that otherwise succeeded.
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The plugin's own root, derived from this module's location. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Where the counters live: `<plugin>/stats.json`. */
export function statsFile() {
  return join(PLUGIN_ROOT, 'stats.json')
}

/** A zeroed counter set. Every field the panel reads must exist here. */
export function emptyTotals() {
  return {
    /** Turns whose middle was condensed. */
    turns: 0,
    /** Legacy tool-output trims. Retired but kept so old totals still read. */
    tools: 0,
    /** Legacy reasoning trims. Retired likewise. */
    reasoning: 0,
    /** Characters removed across all passes. */
    chars: 0,
    /** Archive records written. */
    archived: 0,
    /** Passes that failed (batch or append). */
    failed: 0,
    /** Turns observed by any pass, for a success ratio. */
    passes: 0,
    /** ISO timestamp of the first recorded activity. */
    since: null,
    /** ISO timestamp of the most recent update. */
    updatedAt: null,
  }
}

/**
 * Read the persisted totals.
 *
 * A missing or corrupt file yields zeroed counters rather than throwing: the file
 * is a convenience, not the source of truth (the archive is).
 *
 * @returns {Promise<ReturnType<typeof emptyTotals>>} the stored totals.
 */
export async function readTotals() {
  const base = emptyTotals()
  try {
    const raw = await readFile(statsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return base
    const out = { ...base }
    for (const key of Object.keys(base)) {
      if (key === 'since' || key === 'updatedAt') {
        if (typeof parsed[key] === 'string') out[key] = parsed[key]
      } else if (Number.isFinite(parsed[key])) {
        out[key] = parsed[key]
      }
    }
    return out
  } catch {
    return base
  }
}

/**
 * Add one delta to the persisted totals and write them back.
 *
 * Written via a temp file and rename, so a crash mid-write cannot leave a
 * half-parsed JSON behind — the previous file stays intact until the new one is
 * complete.
 *
 * @param {Partial<ReturnType<typeof emptyTotals>>} delta - increments to apply.
 * @returns {Promise<ReturnType<typeof emptyTotals> | null>} the new totals, or null when unwritable.
 */
export async function addTotals(delta) {
  try {
    const current = await readTotals()
    const now = new Date().toISOString()
    const next = { ...current }
    for (const [key, value] of Object.entries(delta)) {
      if (key === 'since' || key === 'updatedAt') continue
      if (!Number.isFinite(value)) continue
      next[key] = (Number.isFinite(current[key]) ? current[key] : 0) + value
    }
    next.since = current.since ?? now
    next.updatedAt = now

    const dir = dirname(statsFile())
    await mkdir(dir, { recursive: true })
    const tmp = `${statsFile()}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
    await rename(tmp, statsFile())
    return next
  } catch {
    // A counter is diagnostic; never let it break a pass that already landed.
    return null
  }
}
