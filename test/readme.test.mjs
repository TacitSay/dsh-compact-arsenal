import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PACKAGE_NAME, PACKAGE_VERSION } from '../index.js'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

// The README describes what the code does. It deliberately does NOT claim the
// plugin saves money: compression costs a model call and the saving only
// materialises if the conversation continues. Tests here pin the honest shape.

test('the README opens with the package name and a one-line definition', () => {
  assert.ok(readme.startsWith('# dsh-compact-arsenal'), 'title first')
  const paragraphs = readme.split('\n\n')
  const definition = paragraphs[1] ?? ''
  assert.ok(definition.length > 30, 'a definition follows the title')
  assert.ok(
    /压缩/.test(definition),
    'the definition says what it does',
  )
})

test('the README warns that it does not promise savings', () => {
  // The claim that did not survive scrutiny. Leaving it out is the point; saying
  // so explicitly stops the next reader from assuming it.
  assert.ok(readme.includes('不保证省钱') || readme.includes('不宣称'), 'no savings claim')
  assert.ok(readme.includes('压缩本身有成本') || readme.includes('压缩本身也有成本') || readme.includes('一次压缩 = 一次模型调用'),
    'states that compression costs a call')
})

test('the README separates what the model sees from what gets replaced', () => {
  // The distinction that took several rounds to get right.
  assert.ok(readme.includes('[最终回复]'), 'the closing reply is named')
  assert.ok(/不会参与压缩|不参与压缩/.test(readme), 'and marked as excluded')
  assert.ok(/原文保留/.test(readme), 'kept replies stay verbatim')
})

test('the README explains the replacement shape and why it must be user/message', () => {
  assert.ok(readme.includes('检查点'), 'the checkpoint is described')
  assert.ok(readme.includes('sourceEventSeqs'), 'the citation rule is named')
  assert.ok(
    readme.includes('assistant/message') && readme.includes('禁止'),
    'why assistant/message cannot carry the span',
  )
})

test('the README documents the defaults it actually ships', () => {
  for (const value of ['0.7', '2000', '600000']) {
    assert.ok(readme.includes(value), `default ${value} should appear`)
  }
  assert.ok(readme.includes('留空'), 'the "leave blank = auto" convention is explained')
})

test('the README lists real limitations, not only features', () => {
  for (const topic of ['首尾假设', '摘要质量', '无法还原', '几分钟']) {
    assert.ok(readme.includes(topic), `missing limitation: ${topic}`)
  }
})

test('the measured numbers are internally consistent and dated, not pinned', () => {
  // Archives grow with use, so hard-coding a total would rot. What must hold: the
  // block quotes a record count, an original total, a replacement total, and a
  // ratio that actually follows from them.
  const block = readme.match(/## 实测结果[\s\S]{0,600}?```([\s\S]*?)```/)
  assert.ok(block, 'the measurement block exists')

  const original = block[1].match(/原文合计\s+([\d,]+)/)
  const replacement = block[1].match(/改写后合计\s+([\d,]+)/)
  const ratio = block[1].match(/比例\s+([\d.]+)%/)
  assert.ok(original && replacement && ratio, 'all three figures present')

  const o = Number(original[1].replace(/,/g, ''))
  const r = Number(replacement[1].replace(/,/g, ''))
  const quoted = Number(ratio[1])
  const actual = Number((r / o * 100).toFixed(1))
  assert.ok(
    Math.abs(quoted - actual) <= 0.2,
    `quoted ${quoted}% should follow from ${r}/${o} = ${actual}%`,
  )

  // The count in the prose must match its own label.
  assert.match(readme, /\d+ 次轮次压缩的归档统计/, 'the count is stated')
})

test('the install command matches the published package', () => {
  assert.ok(readme.includes(`add ${PACKAGE_NAME}`), 'install names the package')
})

test('no stale version number is pinned in the install line', () => {
  assert.ok(!/add dsh-compact-arsenal@\d/.test(readme), 'install should not pin a version')
  assert.match(PACKAGE_VERSION, /^\d+\.\d+\.\d+$/)
})

test('the README does not link to a file that does not exist', () => {
  // An English/Chinese pair was referenced before the second file existed.
  const links = [...readme.matchAll(/\]\((?!http)([^)]+)\)/g)].map((m) => m[1])
  assert.ok(!links.includes('README.zh.md'), 'no dangling language link')
})
