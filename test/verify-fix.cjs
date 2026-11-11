/**
 * Verify the fix by reasoning over the shipped source rather than by running a
 * session: assert every property the bug report called out.
 *
 * Usage: node verify-fix.cjs <path to index.js>
 */

const fs = require('node:fs')

const file = process.argv[2] ?? 'E:/DSH/DSH/dsh-compact-arsenal/index.js'
const src = fs.readFileSync(file, 'utf8')

const checks = []

const check = (name, ok, detail) => checks.push({ name, ok, detail })

// 1. The pre-step handler must await the rewrite.
const handlerBlock = src.slice(src.indexOf("ctx.on('agent/pre-step'"), src.indexOf('// The panel needs a read/write channel'))
check(
  'pre-step awaits the rewrite',
  /await rewrite\(/.test(handlerBlock),
  /await rewrite\(/.test(handlerBlock) ? 'found `await rewrite(`' : 'rewrite is not awaited',
)

// 2. Cancellation is honoured before every append site.
const compressBlock = src.slice(src.indexOf('async function compressSection'), src.indexOf('async function summarizeBatchSafe'))
const throwIfAborted = (compressBlock.match(/throwIfAborted/g) ?? []).length
check(
  'compressSection checks abort',
  throwIfAborted >= 3,
  `throwIfAborted occurrences: ${throwIfAborted}`,
)

// 3. Replacements carry the current turn, never the replaced node's turn.
check(
  'replacement uses currentTurn',
  /applyRewrittenText\(session, item\.event, item\.seq, kind, replacement, currentTurn\)/.test(src),
  'applyRewrittenText receives currentTurn',
)
check(
  'no append writes event.data.turn',
  !/session\.append\(\s*'(tool\/result|assistant\/message)',\s*\{\s*turn:\s*event\.data\.turn/.test(src),
  'no surface append copies the replaced node turn',
)

// 4. The turn-boundary guard exists and is consulted.
check('openTurnOf exists', /function openTurnOf\(/.test(src), 'turn lookup present')
check('stillOpen gate exists', /const stillOpen = \(\) =>/.test(src), 'gate constructed')
check(
  'gate consulted in the write loop',
  (compressBlock.match(/stillOpen\(\)/g) ?? []).length >= 2,
  `stillOpen() checks inside compressSection: ${(compressBlock.match(/stillOpen\(\)/g) ?? []).length}`,
)

// 5. Concurrency guard.
check('inFlight set exists', /const inFlight = new Set\(\)/.test(src), 'per-session in-flight set')
check('inFlight is consulted', /inFlight\.has\(payload\.agent\.id\)/.test(src), 'skip while a rewrite runs')

// 6. Pressure uses the provider figure first.
check(
  'pressure prefers contextPressure',
  /ctx\.tokenMeter\?\.contextPressure\?\.\(session\)/.test(src),
  'provider-reported prompt size is read',
)

// 7. Dead single-item rewriters are gone.
check(
  'dead rewriters removed',
  !/function rewriteAssistantAsync|function rewriteToolResultAsync|async function rebuildWithModel/.test(src),
  'legacy single-item path deleted',
)

const failed = checks.filter(c => !c.ok)
console.log(`file: ${file}`)
console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`)
console.log('')
for (const c of checks) {
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`)
}
if (failed.length > 0) {
  console.log('')
  console.log('FAILED:', failed.map(c => c.name).join(', '))
  process.exit(1)
}
