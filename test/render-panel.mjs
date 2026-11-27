/**
 * Render the panel with a stub React and assert its content.
 *
 * Component titles live in `props.title`, and function components are invoked
 * directly, so the walk collects both text children and component titles.
 */

import { readFileSync } from 'node:fs'

const React = {
  /**
   * Children go into `props.children`, exactly as React does it.
   *
   * The earlier version kept them on the element, so any component that reads
   * `props.children` — every section and every field — rendered an empty body. The
   * panel still looked populated because the titles come from `props.title`, which
   * hid the problem: tooltips and body text were never in the collected output.
   */
  createElement: (type, props, ...children) => {
    const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { type, props: { ...(props ?? {}), ...(kids === undefined ? {} : { children: kids }) } }
  },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useCallback: (f) => f,
  Component: class {},
}

let plugin
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      plugin = spec.factory((name) => (name === 'react' ? React : {}))
    },
  },
}

// Resolve the client bundle relative to THIS file, so the test keeps working
// wherever the plugin is installed.
const CLIENT = new URL('../client.js', import.meta.url)
new Function(readFileSync(CLIENT, 'utf8'))()

let Registered
plugin.apply({
  slots: {
    inject: (name, cb) => cb(),
    register: (opts, component) => {
      if (opts.key) Registered = component
      return () => {}
    },
  },
  effect: (fn) => fn(),
})

const outer = Registered()
// Children live in `props.children` (React's convention), so read them from there.
const panelElement = outer.props?.children ?? outer.children
const tree = panelElement.type(panelElement.props)

const collected = []
let nodeCount = 0

/**
 * Walk one element tree, invoking function components and recording both their
 * titles and their rendered text.
 */
function walk(node, depth = 0) {
  if (node === null || node === undefined || depth > 40) return
  if (typeof node === 'string' || typeof node === 'number') {
    collected.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  nodeCount += 1

  if (node.props?.title !== undefined) collected.push(String(node.props.title))

  if (typeof node.type === 'function') {
    try {
      walk(node.type(node.props ?? {}), depth + 1)
    } catch {
      // A component that cannot stand alone contributes no text.
    }
    return
  }

  walk(node.children, depth + 1)
  if (node.props?.children !== undefined) walk(node.props.children, depth + 1)
}

walk(tree)

console.log('rendered nodes:', nodeCount)
console.log('text samples:')
for (const t of collected.filter((x) => x.trim() !== '').slice(0, 16)) {
  console.log('  -', t.slice(0, 64))
}

const all = collected.join(' ')
// Text inside a `title` attribute is a hover tooltip: it must be *present* but must
// not count as visible prose. Separating the two lets a check assert that an
// explanation was moved rather than deleted.
const HINTS = ['重新测量', '压缩只在触发时调用一次']
const isHint = (t) => HINTS.some((h) => t.includes(h))
const tooltips = collected.filter(isHint).join(' ')
const visible = collected.filter((t) => !isHint(t)).join(' ')
const checks = {
  'panel rendered with content': nodeCount > 20,
  'title present': all.includes('上下文压缩'),
  'retention card present': all.includes('压缩留存'),
  // Thinking compression is retired: turn compression condenses the reasoning
  // together with the tool calls around it, so a separate section would be a
  // control that changes nothing.
  'three sections present': all.includes('总压缩') && all.includes('轮次压缩') && all.includes('工具输出压缩'),
  'no retired reasoning section': !all.includes('思考压缩'),
  // Moved, not lost: the cascade explanation is still reachable as a tooltip.
  'cascade hint kept as tooltip': tooltips.includes('工具输出') && tooltips.includes('重新测量'),
  'cascade hint not visible prose': !visible.includes('重新测量'),
  // Same treatment for the model picker's hint.
  'model hint kept as tooltip': all.includes('留空表示跟随当前会话'),
  'model hint not visible prose': !visible.includes('压缩只在触发时调用一次'),
  'no leftover subtitle': !all.includes('开关即生效'),
  'no pressure row': !all.includes('上下文压力：真实'),
  'no safety footer': !all.includes('安全边界'),
  'no per-run counters': !all.includes('本次进程已执行'),
  // The turn section explains itself through its controls; the two paragraphs
  // that used to sit above them repeated what the labels already say.
  'no turn section prose': !visible.includes('把每一轮模型做了什么') && !visible.includes('交给模型压成一段'),
}
console.log('')
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
const failed = Object.values(checks).filter((v) => !v).length
process.exit(failed === 0 ? 0 : 1)
