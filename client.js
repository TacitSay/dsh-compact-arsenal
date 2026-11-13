window.__ModuleLoader__.load({
  id: 'dsh-compact-arsenal',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // The module table may hand back the namespace itself or a default-wrapped
    // object; resolve hooks from whichever one actually carries them.
    const hooks = React.useState ? React : (React.default || {})
    const useState = hooks.useState
    const useEffect = hooks.useEffect
    const useRef = hooks.useRef
    const useCallback = hooks.useCallback

    /** Class boundary: a render failure shows its reason instead of nothing. */
    const ComponentBase = React.Component || hooks.Component
    class Boundary extends ComponentBase {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error: String((error && error.message) || error) }
      }

      render() {
        if (this.state.error !== null) {
          return h('div', {
            style: { padding: '18px 22px', fontSize: 12, lineHeight: 1.7, color: '#d9822b' },
          }, [
            h('strong', { key: 't', style: { display: 'block', marginBottom: 6 } }, '压缩面板渲染失败'),
            h('code', { key: 'm', style: { fontSize: 11 } }, this.state.error),
          ])
        }
        return this.props.children
      }
    }

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
        style: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 130px', minWidth: 0, boxSizing: 'border-box' },
      }, [
        h('span', { key: 'l', style: { fontSize: 11, color: MUTED } }, props.label),
        h('span', { key: 'w', style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
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
              width: '100%', minWidth: 0, boxSizing: 'border-box',
              padding: '5px 8px', borderRadius: 8, fontSize: 12,
              border: `1px solid ${LINE}`, background: 'rgba(127,127,127,0.08)',
              color: 'inherit', fontVariantNumeric: 'tabular-nums',
            },
          }),
          props.suffix ? h('span', { key: 's', style: { fontSize: 11, color: MUTED, whiteSpace: 'nowrap' } }, props.suffix) : null,
        ]),
      ])
    }

    function TextField(props) {
      const wide = props.wide === true
      return h('label', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 4,
          flex: wide ? '1 1 100%' : '1 1 150px', minWidth: 0, boxSizing: 'border-box',
          gridColumn: wide ? '1 / -1' : 'auto',
        },
      }, [
        h('span', { key: 'l', style: { fontSize: 11, color: MUTED } }, props.label),
        props.multiline
          ? h('textarea', {
            key: 'i',
            value: String(props.value),
            rows: 3,
            placeholder: props.placeholder || '',
            onChange: (event) => props.onChange(event.target.value),
            style: {
              width: '100%', padding: '6px 8px', borderRadius: 8, fontSize: 12, resize: 'vertical',
              border: `1px solid ${LINE}`, background: 'rgba(127,127,127,0.08)', color: 'inherit',
              lineHeight: 1.6, fontFamily: 'inherit',
            },
          })
          : h('input', {
            key: 'i',
            type: 'text',
            value: String(props.value),
            placeholder: props.placeholder || '',
            onChange: (event) => props.onChange(event.target.value),
            style: {
              width: '100%', padding: '5px 8px', borderRadius: 8, fontSize: 12,
              border: `1px solid ${LINE}`, background: 'rgba(127,127,127,0.08)', color: 'inherit',
            },
          }),
      ])
    }

    /** Provider / model / prompt / budget fields for one model-backed section. */
    /**
     * A labelled row that keeps label, control and hint on one baseline.
     *
     * The earlier layout mixed peers of different intrinsic heights, which made
     * neighbouring fields overlap; every control now shares this frame.
     */
    function Field(props) {
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 5,
          minWidth: 0, boxSizing: 'border-box',
          gridColumn: props.wide ? '1 / -1' : 'auto',
        },
      }, [
        h('span', { key: 'l', style: { fontSize: 11, color: MUTED, lineHeight: 1.4 } }, props.label),
        props.children,
        props.hint
          ? h('span', { key: 'h', style: { fontSize: 10.5, color: MUTED, lineHeight: 1.4, opacity: 0.85 } }, props.hint)
          : null,
      ])
    }

    /** Shared look for every text input, number input and select. */
    const controlStyle = {
      width: '100%', minWidth: 0, boxSizing: 'border-box',
      padding: '6px 9px', borderRadius: 8, fontSize: 12, lineHeight: 1.4,
      border: `1px solid ${LINE}`, background: 'rgba(127,127,127,0.08)',
      color: 'inherit', fontFamily: 'inherit', outline: 'none',
    }

    /**
     * Provider + model picker backed by the live `llm` catalog.
     *
     * Offers exactly the routes the Harness could actually dispatch to, so a
     * typo cannot silently produce a compression model that never answers. An
     * empty choice keeps the documented "follow the current session" behaviour.
     */
    function ModelPicker(props) {
      const model = props.model || {}
      const set = (key, value) => props.onChange({ ...model, [key]: value })
      const catalog = props.catalog || { providers: [], models: [] }
      const provider = model.provider || ''

      // Models are filtered by the chosen provider; with none chosen, every
      // route is listed so a model can be picked directly.
      const models = catalog.models.filter((m) => provider === '' || m.provider === provider)

      return h(Field, {
        wide: true,
        label: '压缩模型',
        hint: '留空表示跟随当前会话的模型；压缩只在触发时调用一次。',
      }, h('div', {
        style: {
          display: 'grid', gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        },
      }, [
        h('select', {
          key: 'p',
          value: provider,
          onChange: (event) => set('provider', event.target.value),
          style: { ...controlStyle, cursor: 'pointer' },
        }, [
          h('option', { key: '', value: '' }, '跟随当前会话'),
          ...catalog.providers.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
        ]),
        h('select', {
          key: 'm',
          value: model.model || '',
          onChange: (event) => {
            const picked = event.target.value
            const found = catalog.models.find((m) => m.id === picked && (provider === '' || m.provider === provider))
            // Selecting a model also selects its provider, so the pair stays valid.
            props.onChange({
              ...model,
              model: picked,
              ...(found === undefined ? {} : { provider: found.provider }),
            })
          },
          style: { ...controlStyle, cursor: 'pointer' },
        }, [
          h('option', { key: '', value: '' }, '跟随当前会话'),
          ...models.map((item) => h('option', {
            key: item.provider + '/' + item.id,
            value: item.id,
          }, provider === '' ? `${item.providerName || item.provider} · ${item.name}` : item.name)),
        ]),
      ]))
    }

    /** The prompt and its output budget, kept together under the picker. */
    function PromptFields(props) {
      const model = props.model || {}
      const set = (key, value) => props.onChange({ ...model, [key]: value })
      return h('div', {
        style: {
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          padding: '12px', boxSizing: 'border-box', width: '100%',
          border: `1px dashed ${LINE}`, borderRadius: 10,
        },
      }, [
        h(Field, { key: 't', label: '输出上限', hint: '单次摘要允许的最大 token 数' },
          h('input', {
            type: 'number', value: String(model.maxTokens ?? 512), min: 64, step: 64,
            onChange: (event) => {
              const next = Number(event.target.value)
              set('maxTokens', Number.isFinite(next) ? next : 512)
            },
            style: { ...controlStyle, fontVariantNumeric: 'tabular-nums' },
          })),
        h(Field, { key: 'q', label: '压缩提示词', wide: true, hint: '只描述内容风格；输出格式由批量层固定，无需在此声明。' },
          h('textarea', {
            value: model.prompt || '', rows: 3,
            onChange: (event) => set('prompt', event.target.value),
            style: { ...controlStyle, resize: 'vertical', lineHeight: 1.6 },
          })),
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

    const MODEL_DEFAULT = {
      provider: '', model: '',
      prompt: '保留文件名、命令、报错原文、关键数值与结论；语言简洁，不要评论，不要提及压缩本身。',
      maxTokens: 512,
    }

    const emptyConfig = {
      enabled: true,
      archiveEnabled: true,
      trigger: { pressureRatio: 0.75, runWithoutWindow: false },
      total: { enabled: false, pressureRatio: 0.8, thresholdRatio: 0.8, retainRatio: 0.16, maxTokens: 65536, retainTurns: 2, maxInputChars: 60000, provider: '', model: '', prompt: '' },
      reasoning: { enabled: false, pressureRatio: 0.75, mode: 'truncate', keepLast: 3, minTotalChars: 15000, minChars: 200, headChars: 600, tailChars: 300, batchChars: 12000, maxItems: 12, maxCharsPerPass: 40000, model: { ...MODEL_DEFAULT } },
      tools: { enabled: false, pressureRatio: 0.75, mode: 'truncate', thresholdChars: 8192, minTotalChars: 15000, minChars: 200, headChars: 4096, tailChars: 1024, keepLast: 2, batchChars: 12000, maxItems: 12, maxCharsPerPass: 40000, onlyTools: [], model: { ...MODEL_DEFAULT } },
    }

    /**
     * Merge any served config onto the complete local shape, so a partial or
     * older config can never make a section undefined while rendering.
     * @param {any} served - config from the Host, possibly partial.
     * @returns {any} a complete config object.
     */
    function mergeConfig(served) {
      const input = served !== null && typeof served === 'object' ? served : {}
      const section = (base, given) => ({ ...base, ...(given !== null && typeof given === 'object' ? given : {}) })
      return {
        ...emptyConfig,
        ...input,
        trigger: section(emptyConfig.trigger, input.trigger),
        total: section(emptyConfig.total, input.total),
        reasoning: {
          ...section(emptyConfig.reasoning, input.reasoning),
          model: section(emptyConfig.reasoning.model, (input.reasoning || {}).model),
        },
        tools: {
          ...section(emptyConfig.tools, input.tools),
          model: section(emptyConfig.tools.model, (input.tools || {}).model),
        },
      }
    }

    function Panel() {
      const [config, setConfig] = useState(emptyConfig)
      const [stats, setStats] = useState({ reasoning: 0, tools: 0, chars: 0, failed: 0, archived: 0 })
      const [status, setStatus] = useState('loading')
      const [message, setMessage] = useState('')
      const [totalApplied, setTotalApplied] = useState(null)
      const [lastFailure, setLastFailure] = useState(null)
      const [archiveRoot, setArchiveRoot] = useState(null)
      const [openState, setOpenState] = useState('idle')
      const [lastArchivePath, setLastArchivePath] = useState(null)
      const [pressure, setPressure] = useState(null)
      const [runtimeVersion, setRuntimeVersion] = useState(null)
      /** Provider/model catalog from the live `llm` registry; empty until loaded. */
      const [catalog, setCatalog] = useState({ providers: [], models: [] })
      const timer = useRef(null)
      const latest = useRef(emptyConfig)

      useEffect(() => {
        let alive = true
        fetch(`${API}/state`, { credentials: 'same-origin' })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then((body) => {
            if (!alive) return
            const next = mergeConfig(body.config)
            setConfig(next)
            latest.current = next
            setStats(body.stats || { reasoning: 0, tools: 0, chars: 0, failed: 0, archived: 0 })
            setLastFailure(body.lastFailure ?? null)
            setArchiveRoot(body.archiveRoot ?? null)
            setLastArchivePath(body.lastArchivePath ?? null)
            setPressure(body.pressure ?? null)
            setRuntimeVersion(body.version ?? null)
            setStatus(body.editable === false ? 'readonly' : 'ready')
          })
          .catch((error) => {
            if (!alive) return
            setStatus('error')
            setMessage(String((error && error.message) || error))
          })
        return () => { alive = false }
      }, [])

      /**
       * Load the model catalog once, separately from the config fetch.
       *
       * A failure here is not fatal: the picker simply keeps only the
       * "follow the current session" option, which is still a valid choice.
       */
      useEffect(() => {
        let alive = true
        fetch(`${API}/models`, { credentials: 'same-origin' })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then((body) => {
            if (!alive) return
            setCatalog({
              providers: Array.isArray(body.providers) ? body.providers : [],
              models: Array.isArray(body.models) ? body.models : [],
            })
          })
          .catch(() => {
            // Keep the fallback catalog; the empty choice still works.
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
              const next = mergeConfig(body.config)
              setConfig(next)
              latest.current = next
              if (body.stats) setStats(body.stats)
              setLastFailure(body.lastFailure ?? null)
              if (body.archiveRoot) setArchiveRoot(body.archiveRoot)
              if (body.lastArchivePath !== undefined) setLastArchivePath(body.lastArchivePath)
              if (body.pressure !== undefined) setPressure(body.pressure)
              if (body.version) setRuntimeVersion(body.version)
              setTotalApplied(body.totalApplied === undefined ? null : body.totalApplied)
              setStatus('ready')
              setMessage('已保存')
            })
            .catch((error) => {
              setStatus('error')
              setMessage(String((error && error.message) || error))
            })
        }, 500)
      }, [])

      /** Ask the Host to reveal the archive directory in the file manager. */
      const openArchive = useCallback(() => {
        setOpenState('opening')
        fetch(`${API}/open-archive`, { method: 'POST', credentials: 'same-origin' })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then(() => setOpenState('idle'))
          .catch(() => {
            setOpenState('failed')
            setTimeout(() => setOpenState('idle'), 3000)
          })
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

      const totalNotice = totalApplied === true
        ? '已同步到 DSH 自带的压缩后端。摘要提示词由官方后端固定，这里只能改阈值、保留比例、上限与摘要模型。'
        : totalApplied === false
          ? '当前压缩后端不在本 profile 的可写范围内（例如由 agent 预设挂载），这些值只保存进本插件配置，暂不生效。'
          : '打开上面的开关并保存后，会把这些参数写到 DSH 自带的压缩后端。摘要提示词由官方后端固定。'

      const total = h(Section, {
        key: 'total',
        title: '总压缩',
        subtitle: '把旧对话整段换成一份摘要',
        enabled: config.total.enabled,
        onToggle: (value) => setSection('total', 'enabled', value),
      }, [
        h('div', { key: 'params', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(NumberField, { key: 'pr', label: '触发阈值', value: config.total.pressureRatio, min: 0, step: 0.05, onChange: (v) => setSection('total', 'pressureRatio', Math.min(1, Math.max(0, v))) }),
          h(NumberField, { key: 'a', label: '阈值比例', value: config.total.thresholdRatio, min: 0, step: 0.05, onChange: (v) => setSection('total', 'thresholdRatio', Math.min(1, Math.max(0, v))) }),
          h(NumberField, { key: 'b', label: '保留比例', value: config.total.retainRatio, min: 0, step: 0.01, onChange: (v) => setSection('total', 'retainRatio', Math.min(1, Math.max(0, v))) }),
          h(NumberField, { key: 'c', label: '摘要上限', value: config.total.maxTokens, min: 256, step: 1024, suffix: 'token', onChange: (v) => setSection('total', 'maxTokens', v) }),
          h(NumberField, { key: 'd', label: '不动最近', value: config.total.retainTurns, min: 0, suffix: '轮', onChange: (v) => setSection('total', 'retainTurns', v) }),
        ]),
        h(ModelPicker, {
          key: 'mp',
          model: { provider: config.total.provider, model: config.total.model },
          catalog,
          onChange: (value) => patch((cfg) => ({
            ...cfg,
            total: { ...cfg.total, provider: value.provider || '', model: value.model || '' },
          })),
        }),
        h('p', { key: 'note', style: { margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.6 } },
          totalNotice),
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
            description: '用模型把剪掉的中段改写成要点。会调用模型。',
            selected: config.reasoning.mode === 'model',
            onSelect: () => setSection('reasoning', 'mode', 'model'),
          }),
        ]),
        config.reasoning.mode === 'model'
          ? h(ModelPicker, {
            key: 'mp',
            model: config.reasoning.model,
            catalog,
            onChange: (value) => setSection('reasoning', 'model', value),
          })
          : null,
        config.reasoning.mode === 'model'
          ? h(PromptFields, {
            key: 'pf',
            model: config.reasoning.model,
            onChange: (value) => setSection('reasoning', 'model', value),
          })
          : null,
        h('div', { key: 'params', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(NumberField, { key: 'pr', label: '触发阈值', value: config.reasoning.pressureRatio, min: 0, step: 0.05, onChange: (v) => setSection('reasoning', 'pressureRatio', Math.min(1, Math.max(0, v))) }),
          h(NumberField, { key: 'k', label: '不改动最近', value: config.reasoning.keepLast, min: 0, suffix: '条', onChange: (v) => setSection('reasoning', 'keepLast', v) }),
          h(NumberField, { key: 'm', label: '总量下限', value: config.reasoning.minTotalChars, min: 0, step: 1000, suffix: '字符', onChange: (v) => setSection('reasoning', 'minTotalChars', v) }),
          h(NumberField, { key: 'f', label: '单项下限', value: config.reasoning.minChars, min: 0, step: 50, suffix: '字符', onChange: (v) => setSection('reasoning', 'minChars', v) }),
          config.reasoning.mode === 'model'
            ? null
            : h(NumberField, { key: 'h', label: '保留开头', value: config.reasoning.headChars, min: 0, step: 50, suffix: '字符', onChange: (v) => setSection('reasoning', 'headChars', v) }),
          config.reasoning.mode === 'model'
            ? null
            : h(NumberField, { key: 't', label: '保留结尾', value: config.reasoning.tailChars, min: 0, step: 50, suffix: '字符', onChange: (v) => setSection('reasoning', 'tailChars', v) }),
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
            selected: config.tools.mode !== 'model',
            onSelect: () => setSection('tools', 'mode', 'truncate'),
          }),
          h(MethodCard, {
            key: 'model',
            title: '模型压缩',
            description: '用模型把剪掉的中段改写成要点。会调用模型。',
            selected: config.tools.mode === 'model',
            onSelect: () => setSection('tools', 'mode', 'model'),
          }),
        ]),
        config.tools.mode === 'model'
          ? h(ModelPicker, {
            key: 'mp',
            model: config.tools.model,
            catalog,
            onChange: (value) => setSection('tools', 'model', value),
          })
          : null,
        config.tools.mode === 'model'
          ? h(PromptFields, {
            key: 'pf',
            model: config.tools.model,
            onChange: (value) => setSection('tools', 'model', value),
          })
          : null,
        h('div', { key: 'params', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, [
          h(NumberField, { key: 'pr', label: '触发阈值', value: config.tools.pressureRatio, min: 0, step: 0.05, onChange: (v) => setSection('tools', 'pressureRatio', Math.min(1, Math.max(0, v))) }),
          h(NumberField, { key: 'k', label: '不改动最近', value: config.tools.keepLast, min: 0, suffix: '条', onChange: (v) => setSection('tools', 'keepLast', v) }),
          h(NumberField, { key: 'm', label: '总量下限', value: config.tools.minTotalChars, min: 0, step: 1000, suffix: '字符', onChange: (v) => setSection('tools', 'minTotalChars', v) }),
          h(NumberField, { key: 'f', label: '单项下限', value: config.tools.minChars, min: 0, step: 50, suffix: '字符', onChange: (v) => setSection('tools', 'minChars', v) }),
          config.tools.mode === 'model'
            ? null
            : h(NumberField, { key: 'h', label: '保留开头', value: config.tools.headChars, min: 0, step: 128, suffix: '字符', onChange: (v) => setSection('tools', 'headChars', v) }),
          config.tools.mode === 'model'
            ? null
            : h(NumberField, { key: 't', label: '保留结尾', value: config.tools.tailChars, min: 0, step: 128, suffix: '字符', onChange: (v) => setSection('tools', 'tailChars', v) }),
        ]),
      ])

      // The master switch owns every section: with it off nothing runs, so the
      // sections are dimmed and non-interactive rather than silently ignored.
      const sections = h('div', {
        key: 'sections',
        style: {
          display: 'flex', flexDirection: 'column', gap: 16,
          opacity: config.enabled ? 1 : 0.45,
          pointerEvents: config.enabled ? 'auto' : 'none',
          transition: 'opacity 120ms ease',
        },
      }, [total, reasoning, tools])

      const statsLine = h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 4 },
      }, [
        h('p', {
          key: 'run',
          style: { margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.6 },
        }, config.enabled
          ? `本次进程已执行：思考 ${stats.reasoning} 次、工具 ${stats.tools} 次、总压缩 ${stats.total ?? 0} 次，共省下约 ${stats.chars} 字符。`
          : '总开关已关闭：三个板块都不会执行。'),
        stats.failed > 0
          ? h('p', { key: 'fail', style: { margin: 0, fontSize: 11, color: WARN, lineHeight: 1.6 } },
            `失败 ${stats.failed} 次（未落盘，不计入节省）：${lastFailure || '原因未记录'}`)
          : null,
      ])

      const statusText = status === 'loading' ? '正在读取配置…'
        : status === 'saving' ? '正在保存…'
          : status === 'error' ? `保存失败：${message}`
            : status === 'readonly' ? '配置写入不可用（只读）'
              : (message || '已连接')

      /**
       * Version badge beside the title.
       *
       * The update affordance is deliberately inert for now: the market owns
       * package updates, so this only reserves the seat and the label. When an
       * update check exists, it flips `updateAvailable` and the same button
       * becomes actionable without moving anything.
       */
      const versionBadge = h('div', {
        key: 'version',
        style: { display: 'flex', alignItems: 'center', gap: 6 },
      }, [
        h('span', {
          key: 'v',
          title: runtimeVersion ? `运行中：${runtimeVersion}` : '运行中版本未知',
          style: {
            fontSize: 11, padding: '1px 7px', borderRadius: 999, color: MUTED,
            border: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums',
          },
        }, runtimeVersion ? `v${runtimeVersion}` : 'v?'),
        h('button', {
          key: 'check',
          type: 'button',
          disabled: true,
          title: '检查更新（预留：将由插件市场提供）',
          style: {
            fontSize: 11, padding: '1px 8px', borderRadius: 999,
            border: `1px solid ${LINE}`, background: 'transparent',
            color: MUTED, cursor: 'not-allowed', opacity: 0.55,
          },
        }, '检查更新'),
      ])

      const header = h('header', {
        key: 'hdr',
        style: { display: 'flex', flexDirection: 'column', gap: 8 },
      }, [
        h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } }, [
          h('div', { key: 't', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
            h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
              h('h1', { key: 'h1', style: { margin: 0, fontSize: 18, fontWeight: 600 } }, '上下文压缩'),
              versionBadge,
            ]),
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

      /**
       * Compression retention: whether each rewrite is written to disk.
       *
       * Kept out of the three sections on purpose — it is a diagnostics switch,
       * not a compression method, and turning it off must not change what the
       * model sees.
       */
      const archiveCard = h('section', {
        key: 'retention',
        style: {
          border: `1px solid ${LINE}`, borderRadius: 12, background: CARD,
          padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        },
      }, [
        h('header', {
          key: 'h',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
        }, [
          h('div', { key: 't', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
            h('strong', { key: 'a', style: { fontSize: 14 } }, '压缩留存'),
            h('span', { key: 'b', style: { fontSize: 11, color: MUTED } },
              '把每次改写的原文与结果写入文件，便于对比压缩程度、排查问题'),
          ]),
          h(Switch, {
            key: 'sw',
            checked: config.archiveEnabled !== false,
            label: '压缩留存',
            onChange: (value) => patch((cfg) => ({ ...cfg, archiveEnabled: value })),
          }),
        ]),
        h('p', { key: 'n', style: { margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.7 } },
          '文件名格式：对话名--内容--方式--时间--seq编号.md，例如 WordCut-词剪--tools--model--20261111-214530--seq1234.md'),
        h('div', {
          key: 'loc',
          style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        }, [
          h('span', {
            key: 'path',
            style: { fontSize: 11, color: MUTED, wordBreak: 'break-all', flex: '1 1 240px' },
          }, config.archiveEnabled === false
            ? '压缩留存已关闭，不再写入磁盘'
            : `归档目录：${archiveRoot || '(解析中…)'}（共 ${stats.archived ?? 0} 份）`),
          h('button', {
            key: 'open',
            type: 'button',
            disabled: config.archiveEnabled === false || openState === 'opening',
            title: '在文件管理器中打开归档目录',
            onClick: () => openArchive(),
            style: {
              fontSize: 11, padding: '2px 10px', borderRadius: 999, whiteSpace: 'nowrap',
              border: `1px solid ${LINE}`, background: 'transparent',
              color: config.archiveEnabled === false ? MUTED : 'inherit',
              cursor: config.archiveEnabled === false ? 'not-allowed' : 'pointer',
              opacity: config.archiveEnabled === false ? 0.5 : 1,
            },
          }, openState === 'opening' ? '打开中…' : openState === 'failed' ? '打开失败' : '打开目录'),
        ]),
        lastArchivePath
          ? h('p', { key: 'latest', style: { margin: 0, fontSize: 11, color: MUTED, wordBreak: 'break-all' } },
            `最新：${lastArchivePath.split(/[\\/]/).at(-1)}`)
          : null,
      ])

      return h('div', {
        style: {
          minHeight: '100%', boxSizing: 'border-box', overflow: 'auto', padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: 16, color: 'inherit',
        },
      }, [header, sections, archiveCard, statsLine])
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
        }, () => h(Boundary, null, h(Panel))))
      },
    }
  },
})
