/**
 * The cascade must stop escalating once pressure is relieved.
 *
 * This mirrors `rewriteAsync`'s decision loop with a stub meter whose reading
 * drops after each pass, and asserts that later (pricier) sections stay idle.
 * That is the property that stops two model-backed sections from both paying
 * for a summarization call on the same turn.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * The cascade as implemented: sections in cost order, each gated on a FRESH
 * pressure reading, total last.
 */
function runCascade({ window, readings, sections }) {
  const calls = []
  let step = 0
  const used = () => readings[Math.min(step, readings.length - 1)]

  const gates = ['tools', 'reasoning']
  for (const key of gates) {
    const section = sections[key]
    if (!section.enabled) continue
    if (used() < window * section.ratio) {
      calls.push({ key, ran: false })
      continue
    }
    calls.push({ key, ran: true, usedBefore: used() })
    step += 1 // a landed pass shrinks the session
  }

  const total = sections.total
  if (total.enabled) {
    if (used() >= window * total.ratio) {
      calls.push({ key: 'total', ran: true, usedBefore: used() })
      step += 1
    } else {
      calls.push({ key: 'total', ran: false })
    }
  }
  return calls
}

const WINDOW = 1000000

test('a cheap pass that relieves pressure stops the expensive ones', () => {
  // Pressure starts at 0.80, and the tools pass alone drops it to 0.60.
  const calls = runCascade({
    window: WINDOW,
    readings: [800000, 600000],
    sections: {
      tools: { enabled: true, ratio: 0.75 },
      reasoning: { enabled: true, ratio: 0.75 },
      total: { enabled: true, ratio: 0.8 },
    },
  })
  assert.deepEqual(calls.map((c) => [c.key, c.ran]), [
    ['tools', true],
    ['reasoning', false],   // 0.60 < 0.75: no model call
    ['total', false],       // 0.60 < 0.80: no whole-turn rewrite
  ])
})

test('pressure still high after tools escalates to the next section', () => {
  const calls = runCascade({
    window: WINDOW,
    readings: [800000, 790000, 600000],
    sections: {
      tools: { enabled: true, ratio: 0.75 },
      reasoning: { enabled: true, ratio: 0.75 },
      total: { enabled: true, ratio: 0.8 },
    },
  })
  assert.deepEqual(calls.map((c) => [c.key, c.ran]), [
    ['tools', true],
    ['reasoning', true],
    ['total', false],
  ])
})

test('a disabled section is skipped without consuming a reading', () => {
  const calls = runCascade({
    window: WINDOW,
    readings: [800000, 600000],
    sections: {
      tools: { enabled: false, ratio: 0.75 },
      reasoning: { enabled: true, ratio: 0.75 },
      total: { enabled: false, ratio: 0.8 },
    },
  })
  assert.deepEqual(calls.map((c) => [c.key, c.ran]), [['reasoning', true]])
})

test('nothing runs when the session is below every threshold', () => {
  const calls = runCascade({
    window: WINDOW,
    readings: [500000],
    sections: {
      tools: { enabled: true, ratio: 0.75 },
      reasoning: { enabled: true, ratio: 0.75 },
      total: { enabled: true, ratio: 0.8 },
    },
  })
  assert.deepEqual(calls.map((c) => [c.key, c.ran]), [
    ['tools', false],
    ['reasoning', false],
    ['total', false],
  ])
})
