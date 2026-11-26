import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// Three defects, all of the same shape: a name used inside a top-level function
// that is only defined in `apply()`'s scope. None of them throws at import; each
// fails silently the moment that code path runs, and the visible symptom is
// "compression did nothing" with an empty log.

test('the early-return gate counts every section, including turns', () => {
  // The bug: `if (!total && !reasoning && !tools) return` — `turns` was missing.
  // Since those three are retired and default to off, the normal configuration
  // returned on every turn and never wrote a single log line.
  const gate = src.match(/if \(!config\.\w+\.enabled[^\n]*\) return/)
  assert.ok(gate, 'the gate exists')
  for (const section of ['turns', 'total', 'reasoning', 'tools']) {
    assert.ok(gate[0].includes(`config.${section}.enabled`), `gate must consider ${section}`)
  }
})

test('rewrite receives lastSeen', () => {
  // Missing it made rewriteAsync throw `lastSeen is not defined` on the first
  // measurement, which the detached caller swallowed into a logger warning.
  const call = src.match(/void rewrite\([^)]*\)/)
  assert.ok(call, 'the detached call exists')
  assert.ok(call[0].includes('lastSeen'), 'lastSeen is passed')
})

test('rewrite receives totals', () => {
  // Same class: `totals` lives in apply(), and the counter update inside the turns
  // branch referenced it directly.
  const call = src.match(/void rewrite\([^)]*\)/)
  assert.ok(call[0].includes('totals'), 'totals is passed')
})

test('rewriteAsync declares every apply() local it reads', () => {
  // Scoped to the one function that broke twice (lastSeen, then totals), because a
  // whole-file scan cannot tell a function body from the code around it and produced
  // mostly false positives.
  const applyStart = src.indexOf('export function apply(')
  const applyEnd = src.indexOf('function registerPanelRoutes(')
  const applyLocals = new Set(
    [...src.slice(applyStart, applyEnd).matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
  )

  const fnStart = src.indexOf('async function rewriteAsync(')
  const fnEnd = src.indexOf('\n}\n', fnStart)
  assert.ok(fnStart > 0 && fnEnd > fnStart, 'rewriteAsync found')

  const decl = src.slice(fnStart, src.indexOf('{', fnStart))
  const params = new Set(
    decl.slice(decl.indexOf('(') + 1, decl.lastIndexOf(')')).split(',').map((s) => s.trim()),
  )
  const body = src.slice(src.indexOf('{', fnStart) + 1, fnEnd)
    // Strip comments: a prose word ("the per-record decision") must not look like an
    // identifier reference.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  const leaked = [...applyLocals].filter((name) => {
    if (params.has(name)) return false
    const declaredHere = new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(body)
    if (declaredHere) return false
    return new RegExp(`(^|[^\\w$.])${name}([^\\w$]|$)`, 'm').test(body)
  })

  assert.deepEqual(leaked, [], `rewriteAsync reads apply() locals it does not receive: ${leaked.join(', ')}`)
})
