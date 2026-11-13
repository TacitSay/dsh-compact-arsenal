/**
 * Render the panel with a stub React and assert its content.
 *
 * Component titles live in `props.title`, and function components are invoked
 * directly, so the walk collects both text children and component titles.
 */

import { readFileSync } from 'node:fs'

const React = {
  createElement: (type, props, ...children) => ({
    type,
    props,
    children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
  }),
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

new Function(readFileSync('E:/DSH/DSH/dsh-compact-arsenal/client.js', 'utf8'))()

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
const panelElement = outer.children
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
const checks = {
  'panel rendered with content': nodeCount > 20,
  'title present': all.includes('上下文压缩'),
  'retention card present': all.includes('压缩留存'),
  'three sections present': all.includes('总压缩') && all.includes('思考压缩') && all.includes('工具输出压缩'),
  'no leftover subtitle': !all.includes('开关即生效'),
  'no pressure row': !all.includes('上下文压力：真实'),
  'no safety footer': !all.includes('安全边界'),
}
console.log('')
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
const failed = Object.values(checks).filter((v) => !v).length
process.exit(failed === 0 ? 0 : 1)
