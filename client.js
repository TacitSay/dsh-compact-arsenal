window.__ModuleLoader__.load({
  id: 'dsh-compact-arsenal',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const MUTED = 'rgba(127,127,127,0.75)'
    const LINE = 'rgba(127,127,127,0.26)'
    const CARD = 'rgba(127,127,127,0.06)'
    const ACCENT = '#4b6fff'
    const OK = '#2f9e62'
    const WARN = '#d9822b'
    const API = '/compact-arsenal/api'

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

    function Switch(props) {
      const on = props.checked === true
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        'aria-label': props.label,
        disabled: props.disabled === true,
        onClick: () => props.onChange(!on),
        style: {
          position: 'relative', width: 38, height: 22, borderRadius: 999, padding: 0,
          border: `1px solid ${on ? 'rgba(47,158,98,0.55)' : LINE}`,
          background: on ? 'rgba(47,158,98,0.30)' : 'rgba(127,127,127,0.14)',
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          opacity: props.disabled ? 0.5 : 1,
          transition: 'background 120ms ease, border-color 120ms ease',
        },
      }, h('span', {
        style: {
          position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16,
          borderRadius: 999, background: on ? OK : 'rgba(127,127,127,0.75)',
          transition: 'left 120ms ease, background 120ms ease',
        },
      }))
    }

    function MethodCard(props) {
      const active = props.selected === true
      const disabled = props.unavailable === true
      return h('button', {
        type: 'button',
        disabled,
        onClick: () => { if (!disabled) props.onSelect() },
        style: {
          display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left',
          padding: '10px 12px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
          border: `1px solid ${active ? 'rgba(75,111,255,0.55)' : LINE}`,
          background: active ? 'rgba(75,111,255,0.10)' : 'transparent',
          color: 'inherit', opacity: disabled ? 0.55 : 1, flex: '1 1 180px',
        },
      }, [
        h('span', {
          key: 'check',
          style: {
            flex: '0 0 auto', width: 16, height: 16, marginTop: 1, borderRadius: 4,
            border: `1.5px solid ${active ? ACCENT : 'rgba(127,127,127,0.55)'}`,
            background: active ? ACCENT : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 11, lineHeight: 1,
          },
        }, active ? '✓' : ''),
        h('span', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: 3 } }, [
          h('strong', { key: 't', style: { fontSize: 12.5, fontWeight: 600 } }, props.title),
          h('span', { key: 'd', style: { fontSize: 11, color: MUTED, lineHeight: 1.5 } }, props.description),
        ]),
      ])
    }

    function NumberField(props) {
      return h('label', {
        style: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px', minWidth: 110 },
      }, [
        h('span', { key: 'l', style: { fontSize: 11, color: MUTED } }, props.label),
        h('span', { key: 'w', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          h('input', {
            key: 'i',
            type: 'number',
            value: String(props.value),
            min: props.min === undefined ? 0 : props.min,
            step: props.step === undefined ? 1 : props.step,
            onChange: (event) => {
              const next = Number(event.target.value)
              props.onChange(Number.isFinite(next) ? next : 0)
            },
            style: {
              width: '100%', padding: '5px 8px', borderRadius: 8, fontSize: 12,
              border: `1px solid ${LINE}`, background: 'rgba(127,127,127,0.08)',
              color: 'inherit', fontVariantNumeric: 'tabular-nums',
            },
          }),
          props.suffix ? h('span', { key: 's', style: { fontSize: 11, color: MUTED } }, props.suffix) : null,
        ]),
      ])
    }

    function Section(props) {
      return h('section', {
        style: {
          border: `1px solid ${LINE}`, borderRadius: 12, background: CARD,
          padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12,
        },
      }, [
        h('header', {
          key: 'h',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
        }, [
          h('div', { key: 't', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
            h('strong', { key: 'a', style: { fontSize: 14 } }, props.title),
            h('span', { key: 'b', style: { fontSize: 11, color: MUTED } }, props.subtitle),
          ]),
          props.onToggle
            ? h(Switch, { key: 'sw', checked: props.enabled, onChange: props.onToggle, label: props.title })
            : h('span', { key: 'badge', style: { fontSize: 11, color: MUTED } }, props.badge || ''),
        ]),
        ...props.children,
      ])
    }

    const emptyConfig = {
      enabled: true,
      trigger: { pressureRatio: 0.75, runWithoutWindow: false },
      reasoning: { enabled: false, mode: 'truncate', keepLast: 3, minChars: 2000, headChars: 600, tailChars: 300 },
      tools: { enabled: false, thresholdChars: 8192, headChars: 4096, tailChars: 1024, keepLast: 2, onlyTools: [] },
    }

    function Panel() {
      const [config, setConfig] = useState(emptyConfig)
      const [stats, setStats] = useState({ reasoning: 0, tools: 0, chars: 0 })
      const [status, setStatus] = useState('loading')
      const [message, setMessage] = useState('')
      const timer = useRef(null)
      const latest = useRef(emptyConfig)

      useEffect(() => {
        let alive = true
        fetch(`${API}/state`, { credentials: 'same-origin' })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then((body) => {
            if (!alive) return
            setConfig(body.config)
            latest.current = body.config
            setStats(body.stats || { reasoning: 0, tools: 0, chars: 0 })
            setStatus(body.editable === false ? 'readonly' : 'ready')
          })
          .catch((error) => {
            if (!alive) return
            setStatus('error')
            setMessage(String((error && error.message) || error))
          })
        return () => { alive = false }
      }, [])

      const save = useCallback((next) => {
        if (timer.current) clearTimeout(timer.current)
        setStatus('saving')
        timer.current = setTimeout(() => {
          fetch(`${API}/config`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          })
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((body) => {
              setConfig(body.config)
              latest.current = body.config
              if (body.stats) setStats(body.stats)
              setStatus('ready')
              setMessage('已保存')
            })
            .catch((error) => {
              setStatus('error')
              setMessage(String((error && error.message) || error))
            })
        }, 500)
      }, [])

      const patch = useCallback((updater) => {
        const next = updater(latest.current)
        latest.current = next
        setConfig(next)
        save(next)
      }, [save])

      const setSection = (name, key, value) => patch((cfg) => ({
        ...cfg,
        [name]: { ...cfg[name], [key]: value },
      }))

      const total = h(Section, {
        key: 'total',
        title: '总压缩',
        subtitle: '把旧对话整段换成一份摘要',
        badge: 'v0.2 计划',
      }, [
        h('p', { key: 'p', style: { margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.6 } },
          '当前由 DSH 自带的摘要后端负责；自定义提示词与摘要模型排在下个版本，本插件暂不接管。'),
      ])

      const reasoning = h(Section, {
        key: 'reasoning',
        title: '思考压缩',
        subtitle: '改写旧轮次助手消息里的推理笔记',
        enabled: config.reasoning.enabled,
        onToggle: (value) => setSection('reasoning', 'enabled', value),
      }, [
        h('div', { key: 'methods', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(MethodCard, {
            key: 'truncate',
            title: '机械截断',
            description: '保留开头与结尾，剪掉中段。不调用模型。',
            selected: config.reasoning.mode === 'truncate',
            onSelect: () => setSection('reasoning', 'mode', 'truncate'),
          }),
          h(MethodCard, {
            key: 'clear',
            title: '整块清除',
            description: '直接删掉旧思考。最省空间，丢失最多。',
            selected: config.reasoning.mode === 'clear',
            onSelect: () => setSection('reasoning', 'mode', 'clear'),
          }),
          h(MethodCard, {
            key: 'model',
            title: '模型压缩',
            description: '用模型改写思考。会调用模型，排在下个版本。',
            unavailable: true,
            selected: false,
            onSelect: () => {},
          }),
        ]),
        h('div', { key: 'params', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(NumberField, { key: 'k', label: '不改动最近', value: config.reasoning.keepLast, min: 0, suffix: '条', onChange: (v) => setSection('reasoning', 'keepLast', v) }),
          h(NumberField, { key: 'm', label: '触发下限', value: config.reasoning.minChars, min: 0, step: 100, suffix: '字符', onChange: (v) => setSection('reasoning', 'minChars', v) }),
          h(NumberField, { key: 'h', label: '保留开头', value: config.reasoning.headChars, min: 0, step: 50, suffix: '字符', onChange: (v) => setSection('reasoning', 'headChars', v) }),
          h(NumberField, { key: 't', label: '保留结尾', value: config.reasoning.tailChars, min: 0, step: 50, suffix: '字符', onChange: (v) => setSection('reasoning', 'tailChars', v) }),
        ]),
      ])

      const tools = h(Section, {
        key: 'tools',
        title: '工具输出压缩',
        subtitle: '剪掉旧轮次里超长命令结果的中段',
        enabled: config.tools.enabled,
        onToggle: (value) => setSection('tools', 'enabled', value),
      }, [
        h('div', { key: 'methods', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(MethodCard, {
            key: 'truncate',
            title: '按字符预算',
            description: '超过阈值就保留头尾。不调用模型。',
            selected: true,
            onSelect: () => {},
          }),
          h(MethodCard, {
            key: 'model',
            title: '模型判断',
            description: '由模型判断哪段该留。会调用模型，排在下个版本。',
            unavailable: true,
            selected: false,
            onSelect: () => {},
          }),
        ]),
        h('div', { key: 'params', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(NumberField, { key: 'k', label: '不改动最近', value: config.tools.keepLast, min: 0, suffix: '条', onChange: (v) => setSection('tools', 'keepLast', v) }),
          h(NumberField, { key: 'm', label: '触发下限', value: config.tools.thresholdChars, min: 1, step: 256, suffix: '字符', onChange: (v) => setSection('tools', 'thresholdChars', v) }),
          h(NumberField, { key: 'h', label: '保留开头', value: config.tools.headChars, min: 0, step: 128, suffix: '字符', onChange: (v) => setSection('tools', 'headChars', v) }),
          h(NumberField, { key: 't', label: '保留结尾', value: config.tools.tailChars, min: 0, step: 128, suffix: '字符', onChange: (v) => setSection('tools', 'tailChars', v) }),
        ]),
      ])

      const trigger = h(Section, {
        key: 'trigger',
        title: '触发条件',
        subtitle: '上下文用到多少才动手；平时完全不动',
        badge: '',
      }, [
        h('div', { key: 'params', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(NumberField, {
            key: 'r', label: '压力阈值', value: config.trigger.pressureRatio,
            min: 0, step: 0.05,
            onChange: (v) => setSection('trigger', 'pressureRatio', Math.min(1, Math.max(0, v))),
          }),
        ]),
        h('p', { key: 'p', style: { margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.6 } },
          `0.75 表示用到窗口的 75% 才开始压缩。本次进程已执行：思考 ${stats.reasoning} 次、工具 ${stats.tools} 次，共省下约 ${stats.chars} 字符。`),
      ])

      const statusText = status === 'loading' ? '正在读取配置…'
        : status === 'saving' ? '正在保存…'
          : status === 'error' ? `保存失败：${message}`
            : status === 'readonly' ? '配置写入不可用（只读）'
              : (message || '已连接')

      const header = h('header', {
        key: 'hdr',
        style: { display: 'flex', flexDirection: 'column', gap: 8 },
      }, [
        h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } }, [
          h('div', { key: 't', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
            h('h1', { key: 'h1', style: { margin: 0, fontSize: 18, fontWeight: 600 } }, '上下文压缩'),
            h('p', { key: 'p', style: { margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.6 } },
              '开关即生效，参数改完自动保存。机械方式不调用模型、不花钱。'),
          ]),
          h('div', { key: 'master', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('span', { key: 'l', style: { fontSize: 12, color: MUTED } }, '总开关'),
            h(Switch, {
              key: 'sw',
              checked: config.enabled,
              label: '插件总开关',
              onChange: (value) => patch((cfg) => ({ ...cfg, enabled: value })),
            }),
          ]),
        ]),
        h('span', {
          key: 'status',
          style: { fontSize: 11, color: status === 'error' ? WARN : MUTED },
        }, statusText),
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
      }, [header, total, reasoning, tools, trigger, safety])
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
