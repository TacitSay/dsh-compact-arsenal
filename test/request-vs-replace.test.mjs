import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { findTurnIntervals, middleTranscript } from '../lib/turns.js'

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// The distinction that matters: what the MODEL SEES vs what gets REPLACED.
//   - the request includes the closing reply, so the summary can agree with it
//   - the replacement covers only the middle, so the reply stays verbatim
// Conflating the two means either the reply is summarized away, or the model
// writes a summary without knowing where the work landed.

test('the request carries a closing reply the model is told not to summarize', () => {
  assert.match(src, /function withClosingReply\(/, 'a dedicated helper')
  assert.match(src, /\[最终回复\]/, 'the tail is labelled')
  assert.match(src, /它不会参与压缩/, 'the label says it is excluded')
  assert.match(src, /不要把 \[最终回复\] 原文照抄进摘要/, 'the prompt forbids copying it')
})

test('the closing reply is appended after the middle, not merged into it', () => {
  // Order matters: the model reads the process, then the conclusion.
  const idx = src.indexOf('return `${transcript}\\n\\n[最终回复]')
  assert.ok(idx > 0, 'appended after the transcript')
})

test('the transcript sent to the model is built with the tail', () => {
  assert.match(src, /const transcript = withClosingReply\(/, 'the batch uses it')
  assert.ok(
    !/const transcript = middleTranscript\(session, interval\.middleSeqs\)\n\s*if \(transcript === ''\) continue/.test(src),
    'the middle-only version is not what gets sent',
  )
})

test('the replacement still targets only the middle', () => {
  // The span is middleSeqs; keepSeqs is never part of startSeq/endSeq.
  assert.match(src, /startSeq: entry\.interval\.middleSeqs\[0\], endSeq: entry\.interval\.middleSeqs\.at\(-1\)/)
  assert.ok(!/sourceEventSeqs: entry\.interval\.keepSeqs/.test(src), 'the kept replies are not shadowed')
  assert.ok(!/startSeq: .*keepSeqs/.test(src), 'the span never starts at a kept reply')
})

test('a turn without a closing reply is unaffected', () => {
  assert.match(src, /if \(keepSeqs\.length === 0\) return transcript/)
})

test('the archive records the version with the tail, so the conclusion is recoverable', () => {
  // `entry.transcript` is the with-tail string, which is what the model saw — the
  // faithful thing to store.
  assert.match(src, /original: entry\.transcript/)
})
