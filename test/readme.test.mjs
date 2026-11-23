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

test('the README offers the three install paths', () => {
  // A reader arrives with one of three things: a DSH session, the plugin panel, or
  // a shell. Each path is named so nobody has to guess which one applies.
  assert.match(readme, /方法一/, 'method 1 named')
  assert.match(readme, /方法二/, 'method 2 named')
  assert.match(readme, /方法三/, 'method 3 named')
  assert.ok(readme.includes('github:TacitSay/dsh-compact-arsenal'), 'the GitHub target appears')
  assert.ok(readme.includes('--profile'), 'the profile flag appears')
})

test('the README documents the defaults it actually ships', () => {
  for (const value of ['0.7', '2000']) {
    assert.ok(readme.includes(value), `default ${value} should appear`)
  }
})

test('the README separates what the model sees from what gets replaced', () => {
  // The distinction that took several rounds to get right.
  assert.ok(readme.includes('[最终回复]'), 'the closing reply is named')
  assert.ok(/不会参与压缩|不参与压缩/.test(readme), 'and marked as excluded')
  assert.ok(/原文保留/.test(readme), 'kept replies stay verbatim')
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
