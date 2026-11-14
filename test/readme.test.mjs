import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PACKAGE_NAME, PACKAGE_VERSION } from '../index.js'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

test('the README names the package and states a one-line definition first', () => {
  assert.ok(readme.startsWith('# dsh-compact-arsenal'), 'title first')
  // The second block is the definition: high-star DSH plugins open with one
  // sentence saying what the thing is, before any feature list.
  const paragraphs = readme.split('\n\n')
  const definition = paragraphs[1] ?? ''
  assert.ok(definition.startsWith('**'), `definition should be bolded: ${definition.slice(0, 40)}`)
  assert.ok(definition.length > 40, 'definition should actually say something')
})

test('the README has the sections a reader looks for', () => {
  for (const heading of ['快速开始', '压缩是怎么做的', '效果', '你可能担心的事']) {
    assert.ok(readme.includes(heading), `missing section: ${heading}`)
  }
})

test('the README documents the cascade order, not three independent switches', () => {
  assert.ok(readme.includes('级联'), 'the cascade is the core design and must be stated')
  assert.ok(/工具输出（机械/.test(readme) || readme.includes('工具输出（机械'), 'cheap pass first')
})

test('the README states the caveats rather than only the upside', () => {
  // These are the questions the author actually hit; leaving them out would
  // make the document marketing instead of documentation.
  for (const topic of ['重要内容删掉', '烧钱', '缓存', '会话搞坏']) {
    assert.ok(readme.includes(topic), `missing caveat: ${topic}`)
  }
})

test('the install command matches the published package', () => {
  assert.ok(readme.includes(`add ${PACKAGE_NAME}`), 'install command names the package')
})

test('no stale version number is promised in the install line', () => {
  // Pinning a version in the README rots on the next release; the plain name
  // always installs the latest.
  assert.ok(!/add dsh-compact-arsenal@\d/.test(readme), 'install should not pin a version')
  assert.match(PACKAGE_VERSION, /^\d+\.\d+\.\d+$/)
})
