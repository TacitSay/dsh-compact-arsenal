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
// The rewrite must NOT be awaited: awaiting made every model-backed pass a
// synchronous cost on the reply, which showed up as a turn with no thinking and
// no tool calls. Safety now comes from the turn-boundary guard instead.
check(
  'pre-step does not block on the rewrite',
  !/await rewrite\(/.test(handlerBlock) && /void rewrite\(/.test(handlerBlock),
  'rewrite runs detached and cannot stall the step',
)
check(
  'detached rewrite still reports failures',
  /\.catch\(\(error\) =>/.test(handlerBlock),
  'a rejection is logged, not swallowed',
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
// A tool/result replacement may change ONLY content, so it MUST keep the
// node's own turn/step. (The first incident's fix wrote the current turn here,
// which the log rejects; that is what the shape test now pins.)
check(
  'tool/result keeps the node turn',
  /session\.append\('tool\/result', \{\s*turn: event\.data\.turn,\s*step: event\.data\.step,/.test(src),
  'the replacement reuses the original turn/step',
)
check(
  'user/message takes the writing turn',
  /buildUserCheckpoint\(text, kind, seq, currentTurn\)/.test(src),
  'a new checkpoint carries the current turn',
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

// 7. Pressure is measured before any gate short-circuits.
const rewriteBlock = src.slice(src.indexOf('async function rewriteAsync'), src.indexOf('function currentPosition'))
const measureIdx = rewriteBlock.indexOf('pressureSnapshot(ctx, session)')
const earlyReturnIdx = rewriteBlock.indexOf('if (!config.total.enabled && !config.reasoning.enabled && !config.tools.enabled) return')
check(
  'pressure measured before the disabled short-circuit',
  measureIdx !== -1 && earlyReturnIdx !== -1 && measureIdx < earlyReturnIdx,
  `measure@${measureIdx} < earlyReturn@${earlyReturnIdx}`,
)
check(
  'panel state carries a version',
  /version: PACKAGE_VERSION/.test(src),
  'GET /state returns version',
)

// 8. Reasoning replacements use the user/message checkpoint shape.
check(
  'reasoning replaces via user/message',
  /session\.append\('user\/message', checkpoint, \{/.test(src) && !/session\.append\('assistant\/message'/.test(src),
  'assistant/message in-place rewrite is not used for reasoning',
)
check(
  'reasoning cite the shadowed node',
  /surfaceOp: \{ op: 'replace', startSeq: seq, endSeq: seq \},\s*sourceEventSeqs: \[seq\],/.test(src),
  'user/message checkpoint carries sourceEventSeqs',
)
check(
  'totalPass cites the whole span',
  /sourceEventSeqs: shadowed/.test(src),
  'every surface node in [startSeq, endSeq] is cited',
)
check(
  'impossible writes are rejected before the model call',
  /canReplace\(session, kind, candidates\[0\]\.seq\)/.test(src),
  'pre-flight shape check present',
)

// 9. Every user/message checkpoint is built with an id (incident #2).
check(
  'user checkpoints are built by one function',
  /function buildUserCheckpoint\(/.test(src),
  'single construction path',
)
check(
  'the checkpoint carries an id',
  /id: `compact-arsenal-\$\{kind\}-\$\{seq\}-\$\{Date\.now\(\)\}`/.test(src),
  'traceable non-empty id',
)
check(
  'no hand-rolled user/message append remains',
  !/session\.append\(\s*'user\/message',\s*\{\s*role: 'user',/.test(src),
  'totalPass and reasoning both use buildUserCheckpoint',
)
check(
  'shape is validated before the append',
  /assertUserCheckpointShape\(checkpoint\)/.test(src),
  'malformed checkpoints never reach the log',
)
check(
  'the shape check mirrors the log',
  /needs a non-empty id/.test(src) && /needs role "user"/.test(src) && /needs a source kind/.test(src) && /needs array content/.test(src),
  'id / role / source.kind / content',
)

// 10. Dead single-item rewriters are gone.
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
