import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { apply } from '../index.js'

const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// The outage: `registerPanelRoutes` referenced `totals` without receiving it.
// `/state` threw `ReferenceError: totals is not defined` on every request, so the
// panel showed `v?` and `(解析中…)` — a missing-data symptom for a crash. Nothing
// caught it earlier because no test ever CALLED the handler.

/** Mount the plugin against a stub context and collect its routes. */
function mount() {
  const routes = new Map()
  let editCalls = 0

  const ctx = {
    get(name) {
      if (name === 'webServer') {
        return { register(route) { routes.set(route.path, route.handler); return () => {} } }
      }
      if (name === 'configEditor') {
        return {
          entries() { return [{ options: { id: 'compact-arsenal', name: 'dsh-compact-arsenal' }, config: {} }] },
          edit(entry, updater) { editCalls += 1; return Promise.resolve(updater(entry)) },
        }
      }
      if (name === 'agents') return { list: () => [] }
      return undefined
    },
    on() { return () => {} },
    effect(fn) { try { return fn() } catch { return () => {} } },
    logger: { warn() {}, info() {}, error() {} },
  }

  apply(ctx, {})
  return { routes, editCalls: () => editCalls }
}

function fakeRes() {
  const captured = { status: null, headers: null, body: null }
  return {
    captured,
    writeHead(status, headers) { captured.status = status; captured.headers = headers },
    end(body) { captured.body = body },
  }
}

function fakeReq(method, body) {
  return {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield body },
  }
}

test('GET /state answers 200 with every field the panel reads', () => {
  const { routes } = mount()
  const handler = routes.get('/compact-arsenal/api/state')
  assert.ok(handler, 'route registered')

  const res = fakeRes()
  handler(fakeReq('GET'), res)

  assert.equal(res.captured.status, 200, 'no exception reached the caller')
  const body = JSON.parse(res.captured.body)
  for (const key of ['version', 'config', 'stats', 'totals', 'totalsReady', 'editable', 'archiveRoot', 'logRoot', 'pressure']) {
    assert.ok(body[key] !== undefined, `/state must include ${key}`)
  }
  assert.match(body.version, /^\d+\.\d+\.\d+$/)
  assert.equal(typeof body.archiveRoot, 'string')
  assert.ok(body.archiveRoot.length > 0, 'archiveRoot is resolved, not empty')
})

test('POST /config answers 200 and echoes the saved config', async () => {
  const { routes } = mount()
  const handler = routes.get('/compact-arsenal/api/config')
  assert.ok(handler, 'route registered')

  const sent = JSON.stringify({ enabled: true, turns: { enabled: true, pressureRatio: 0.75 } })
  const res = fakeRes()
  await handler(fakeReq('POST', sent), res)

  assert.equal(res.captured.status, 200, 'save succeeded')
  const body = JSON.parse(res.captured.body)
  assert.equal(body.config.turns.pressureRatio, 0.75, 'the value round-trips')
  assert.ok(body.version !== undefined, 'version is echoed so the badge survives a save')
  assert.ok(body.totals !== undefined, 'totals are echoed')
})

test('the panel helper receives every value it reads', () => {
  // The specific defect: a name used inside registerPanelRoutes but absent from its
  // parameters is a runtime ReferenceError, invisible until a request arrives.
  const sig = host.match(/function registerPanelRoutes\(([^)]*)\)/)
  assert.ok(sig, 'function found')
  const params = sig[1].split(',').map((s) => s.trim())
  for (const required of ['ctx', 'config', 'stats', 'totals', 'totalsReady', 'archive', 'pressure']) {
    assert.ok(params.includes(required), `registerPanelRoutes must receive ${required}`)
  }
})

test('totalsReady is a getter, so the async load is reflected', () => {
  // Passing the boolean value would freeze it at `false`: the load finishes after
  // mount.
  assert.match(host, /totalsReady: totalsReady\(\)/, 'invoked at read time')
})
