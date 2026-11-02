window.__ModuleLoader__.load({
  id: 'dsh-compact-arsenal',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const MUTED = 'rgba(127,127,127,0.75)'
    const LINE = 'rgba(127,127,127,0.28)'
    const CARD = 'rgba(127,127,127,0.06)'
    const ACCENT = '#4b6fff'
    const OK = '#2f9e62'

    function PanelIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        style: { display: 'block' },
      }, [
        h('path', { key: 'a', d: 'M4 5h16M7 10h10M9 15h6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', fill: 'none' }),
        h('path', { key: 'b', d: 'M12 17.5v4.5M9.6 19.7L12 22.1l2.4-2.4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }),
      ])
    }

    function TrimBar(props) {
      const total = Math.max(1, props.head + props.cut + props.tail)
      const seg = (key, value, color) => h('div', {
        key, title: `${value}`,
        style: { width: `${(value / total) * 100}%`, background: color, height: '100%' },
      })
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
        h('div', {
          key: 'bar',
          style: { display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', border: `1px solid ${LINE}` },
        }, [
          seg('head', props.head, ACCENT),
          seg('cut', props.cut, 'rgba(127,127,127,0.30)'),
          seg('tail', props.tail, '#7aa2ff'),
        ]),
        h('div', { key: 'legend', style: { display: 'flex', gap: 12, fontSize: 11, color: MUTED } }, [
          h('span', { key: 'h' }, `保留开头 ${props.head}`),
          h('span', { key: 'c' }, `剪掉 ${props.cut}`),
          h('span', { key: 't' }, `保留结尾 ${props.tail}`),
        ]),
      ])
    }

    function Pill(props) {
      const color = props.on ? OK : MUTED
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px',
          borderRadius: 999, fontSize: 11, color,
          border: `1px solid ${props.on ? 'rgba(47,158,98,0.45)' : LINE}`,
          background: props.on ? 'rgba(47,158,98,0.10)' : 'transparent',
        },
      }, [
        h('span', { key: 'dot', style: { width: 6, height: 6, borderRadius: 3, background: color } }),
        h('span', { key: 'txt' }, props.children),
      ])
    }

    function Card(props) {
      return h('section', {
        style: {
          border: `1px solid ${LINE}`, borderRadius: 12, background: CARD,
          padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        },
      }, [
        h('header', {
          key: 'head',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
        }, [
          h('div', { key: 'titles', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
            h('strong', { key: 'title', style: { fontSize: 14 } }, props.title),
            h('span', { key: 'sub', style: { fontSize: 11, color: MUTED } }, props.subtitle),
          ]),
          props.badge,
        ]),
        ...props.children,
      ])
    }

    function Row(props) {
      return h('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12, padding: '1px 0' },
      }, [
        h('span', { key: 'l', style: { color: MUTED } }, props.label),
        h('span', { key: 'v', style: { fontVariantNumeric: 'tabular-nums' } }, props.value),
      ])
    }

    const REASONING = { enabled: false, mode: 'truncate', keepLast: 3, minChars: 2000, headChars: 600, tailChars: 300 }
    const TOOLS = { enabled: false, thresholdChars: 8192, headChars: 4096, tailChars: 1024, keepLast: 2 }

    function Panel() {
      const title = h('header', { key: 'hdr', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
        h('h1', { key: 'h1', style: { margin: 0, fontSize: 18, fontWeight: 600 } }, '上下文压缩'),
        h('p', { key: 'p', style: { margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.6 } },
          '三个独立板块，每个都能单独开关。机械方式不调用模型、不花钱；只在上下文接近上限时才动手。'),
      ])

      const total = h(Card, {
        key: 'total',
        title: '总压缩',
        subtitle: '把旧对话整段换成一份摘要',
        badge: h(Pill, { on: false }, 'v0.2 计划'),
      }, [
        h('p', { key: 'p', style: { margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.6 } },
          '当前由 DSH 自带的摘要后端负责；自定义提示词与摘要模型排在 v0.2，本插件暂不接管。'),
      ])

      const reasoningCut = Math.max(1, REASONING.minChars - REASONING.headChars - REASONING.tailChars)
      const reasoning = h(Card, {
        key: 'reasoning',
        title: '思考压缩',
        subtitle: '改写旧轮次助手消息里的推理笔记',
        badge: h(Pill, { on: REASONING.enabled }, REASONING.enabled ? '已开启' : '默认关闭'),
      }, [
        h(TrimBar, { key: 'bar', head: REASONING.headChars, cut: reasoningCut, tail: REASONING.tailChars }),
        h(Row, { key: 'r1', label: '方式', value: REASONING.mode === 'clear' ? '整块清除' : '保留头尾' }),
        h(Row, { key: 'r2', label: '触发下限', value: `${REASONING.minChars} 字符` }),
        h(Row, { key: 'r3', label: '不改动最近', value: `${REASONING.keepLast} 条助手消息` }),
        h(Row, { key: 'r4', label: '模型调用', value: '无' }),
      ])

      const toolsCut = Math.max(1, TOOLS.thresholdChars - TOOLS.headChars - TOOLS.tailChars)
      const tools = h(Card, {
        key: 'tools',
        title: '工具输出压缩',
        subtitle: '剪掉旧轮次里超长命令结果的中段',
        badge: h(Pill, { on: TOOLS.enabled }, TOOLS.enabled ? '已开启' : '默认关闭'),
      }, [
        h(TrimBar, { key: 'bar', head: TOOLS.headChars, cut: toolsCut, tail: TOOLS.tailChars }),
        h(Row, { key: 'r1', label: '触发下限', value: `${TOOLS.thresholdChars} 字符` }),
        h(Row, { key: 'r2', label: '不改动最近', value: `${TOOLS.keepLast} 条工具结果` }),
        h(Row, { key: 'r3', label: '模型调用', value: '无' }),
      ])

      const snippet = '- id: compact-arsenal\n  config:\n    reasoning:\n      enabled: true\n    tools:\n      enabled: true'
      const howto = h('section', {
        key: 'howto',
        style: {
          border: `1px dashed ${LINE}`, borderRadius: 12, padding: '12px 16px',
          display: 'flex', flexDirection: 'column', gap: 6,
        },
      }, [
        h('strong', { key: 't', style: { fontSize: 12 } }, '怎么开启'),
        h('p', { key: 'p', style: { margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.7 } },
          '在 profile 的 cordis.patch.yml 里给 compact-arsenal 这一行加 config：'),
        h('pre', {
          key: 'pre',
          style: {
            margin: 0, padding: 10, borderRadius: 8, overflowX: 'auto',
            background: 'rgba(127,127,127,0.10)', fontSize: 11, lineHeight: 1.6,
          },
        }, snippet),
        h('p', { key: 'p2', style: { margin: 0, fontSize: 11, color: MUTED } }, '改完重启 DSH 生效。'),
      ])

      const safety = h('p', {
        key: 'safety',
        style: { margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.7 },
      }, '安全边界：不动系统提示词、工具说明、你的消息和工具调用参数；原始内容仍完整保留在会话日志里。')

      return h('div', {
        style: {
          height: '100%', overflow: 'auto', padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: 16, color: 'inherit',
        },
      }, [title, total, reasoning, tools, howto, safety])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'compact-arsenal',
          order: 20,
          label: () => '上下文压缩',
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'compact-arsenal',
        }, Panel))
      },
    }
  },
})
