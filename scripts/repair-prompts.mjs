/**
 * Repair mojibake prompts already stored in the profile patch.
 *
 * A prompt written by a non-UTF-8 client became literal `?` characters. This
 * script reads the live config, replaces such prompts with the built-in
 * defaults, and posts the result back over the panel's own API.
 *
 * Usage: node scripts/repair-prompts.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:5115'

const MODEL_PROMPT = '把下面这段内容压缩成不超过 200 字的要点，保留文件名、命令、报错原文和结论，不要评论。只输出要点。'
const TOTAL_PROMPT = '你是压缩引擎。把下面这段对话压缩成一份结构化的中文检查点：保留用户目标与偏好、涉及的文件与命令、报错与修法、已完成与待办、下一步。用简短条目，按 ## 标题分节，不要评论，不要提及压缩本身。'

const isBroken = (text) => typeof text !== 'string'
  || text.trim() === ''
  || ((text.match(/\?/g) ?? []).length / Math.max(1, text.replace(/\s/g, '').length)) >= 0.3

const state = await fetch(`${BASE}/compact-arsenal/api/state`).then((res) => {
  if (!res.ok) throw new Error(`state ${res.status}`)
  return res.json()
})

const config = state.config
let repaired = 0

if (isBroken(config.total?.prompt)) {
  config.total.prompt = TOTAL_PROMPT
  repaired += 1
}
for (const section of ['reasoning', 'tools']) {
  if (isBroken(config[section]?.model?.prompt)) {
    config[section].model.prompt = MODEL_PROMPT
    repaired += 1
  }
}

if (repaired === 0) {
  console.log('config already clean in memory; rewriting the stored patch anyway')
}

const saved = await fetch(`${BASE}/compact-arsenal/api/config`, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(config),
}).then((res) => {
  if (!res.ok) throw new Error(`config ${res.status}`)
  return res.json()
})

console.log(`repaired ${repaired} prompt(s)`)
console.log('total.prompt:', saved.config.total.prompt.slice(0, 24), '…')
console.log('reasoning.prompt:', saved.config.reasoning.model.prompt.slice(0, 24), '…')
