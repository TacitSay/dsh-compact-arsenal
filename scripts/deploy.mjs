/**
 * Deploy the source tree to the installed copy, then verify it actually loads.
 *
 * Written after a real outage: `lib/policy.js` was never copied, so the installed
 * `index.js` imported `SHORT_MARKER` from a file that did not export it. The whole
 * plugin failed to load and the sidebar icon disappeared — with nothing in the log,
 * because logging lives inside the plugin that failed to start.
 *
 * Usage: node scripts/deploy.mjs [--check]
 *   --check  report differences and exit non-zero, copy nothing
 */

import { readdirSync, readFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, dirname } from 'node:path'

const SRC = 'C:/Users/YWW/.dsh/plugins-data/dsh-compact-arsenal'
const DST = 'C:/Users/YWW/.dsh/profiles/desktop/node_modules/dsh-compact-arsenal'
const CHECK_ONLY = process.argv.includes('--check')

/** Never copied: runtime output, credentials, repo metadata. */
const IGNORE = [
  /^archive(\/|$)/, /^logs(\/|$)/, /^node_modules(\/|$)/, /^\.git(\/|$)/,
  /^test(\/|$)/, /^\.npmrc/, /^docs(\/|$)/, /^scripts(\/|$)/,
  /^\.gitignore$/, /^\.gitattributes$/, /^\.github(\/|$)/,
]

/** Walk the tree, skipping ignored paths. */
function walk(root, base = root, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name)
    const rel = relative(base, p).replace(/\\/g, '/')
    if (IGNORE.some((re) => re.test(rel))) continue
    if (entry.isDirectory()) { walk(p, base, out); continue }
    out.push(rel)
  }
  return out
}

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

const srcFiles = new Set(walk(SRC))
const dstFiles = new Set(walk(DST))

const missing = [...srcFiles].filter((f) => !dstFiles.has(f))
const stale = [...dstFiles].filter((f) => !srcFiles.has(f))
const differ = [...srcFiles].filter((f) => dstFiles.has(f) && hash(join(SRC, f)) !== hash(join(DST, f)))

console.log(`source ${srcFiles.size} files, install ${dstFiles.size} files`)
if (missing.length) console.log('missing from install:', missing.join(', '))
if (stale.length) console.log('stale in install:', stale.join(', '))
if (differ.length) console.log('differs:', differ.join(', '))

if (missing.length === 0 && stale.length === 0 && differ.length === 0) {
  console.log('in sync')
} else if (CHECK_ONLY) {
  console.log('out of sync (--check, nothing copied)')
  process.exit(1)
} else {
  for (const f of [...missing, ...differ]) {
    const from = join(SRC, f)
    const to = join(DST, f)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    console.log('copied', f)
  }
}

// Always load it, even when the trees already match: "in sync" and "loads" are
// different questions, and only the second one decides whether the panel appears.
const entry = join(DST, 'index.js')
if (existsSync(entry)) {
  try {
    const mod = await import(`file:///${entry.replace(/\\/g, '/')}?t=${Date.now()}`)
    console.log('loads OK, version', mod.PACKAGE_VERSION)
  } catch (error) {
    console.error('FAILED TO LOAD:', error.message)
    console.error('The plugin will not appear in the sidebar. Fix before restarting.')
    process.exit(1)
  }
}
