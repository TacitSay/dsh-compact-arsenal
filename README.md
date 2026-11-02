# dsh-compact-arsenal · 压缩工坊

给 DeepSeek Harness（`dsh`）用的**可配置上下文压缩**插件。按「板块 + 总开关 + 方式 + 参数」组织，每个板块都能单独开关。

> 设计原则：**免费的先做，花钱的你来开。** 机械截断零模型调用、零费用；模型相关的能力默认关闭。

## 三个板块

| 板块 | 状态 | 方式 | 是否调用模型 |
|---|---|---|---|
| **思考压缩** `reasoning` | ✅ v0.1 可用 | 机械截断（保留头尾）/ 整块清除 | 否 |
| **工具输出压缩** `tools` | ✅ v0.1 可用 | 按字符预算保留头尾 | 否 |
| **总压缩** `total` | 🚧 v0.2 计划 | 官方摘要后端 + 自定义提示词/模型 | 是 |

总压缩那一板块需要实现完整的压缩后端（选区、事务、摘要、替换），v0.1 不冒充已支持，规格已在下方路线图里锁定。

## 安装

```sh
# 从本地目录（开发）
dsh plugin --profile <profile> add E:\path\to\dsh-compact-arsenal

# 发布到 npm 之后
dsh plugin --profile <profile> add dsh-compact-arsenal
```

重启 DSH 后生效。**默认全部板块关闭**，装上去不会改变任何行为。

## 配置

写在 profile 的 `cordis.patch.yml`：

```yaml
- id: compact-arsenal
  name: dsh-compact-arsenal
  config:
    enabled: true
    trigger:
      pressureRatio: 0.75      # 上下文用到 75% 才动手；平时完全不动
      runWithoutWindow: false  # 拿不到窗口大小时不执行
    reasoning:
      enabled: true            # ← 思考压缩总开关
      mode: truncate           # truncate | clear
      keepLast: 3              # 最近 3 条助手消息的思考原样保留
      minChars: 2000           # 单条思考超过 2000 字符才处理
      headChars: 600
      tailChars: 300
    tools:
      enabled: true            # ← 工具输出压缩总开关
      thresholdChars: 8192
      headChars: 4096
      tailChars: 1024
      keepLast: 2              # 最近 2 条工具结果原样保留
      onlyTools: []            # 只处理这些工具名；空 = 全部
```

### 字段说明

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 插件总开关 |
| `trigger.pressureRatio` | `0.75` | 上下文压力达到窗口的这个比例才执行改写 |
| `trigger.runWithoutWindow` | `false` | 路由未声明上下文窗口时是否仍执行 |
| `reasoning.enabled` | `false` | 思考压缩总开关 |
| `reasoning.mode` | `truncate` | `truncate` 保留头尾；`clear` 整块删除 |
| `reasoning.keepLast` | `3` | 最近 N 条助手消息的思考不改写 |
| `reasoning.minChars` | `2000` | 单条思考超过此字符数才处理 |
| `reasoning.headChars` / `tailChars` | `600` / `300` | 截断后保留的开头 / 结尾字符数 |
| `tools.enabled` | `false` | 工具输出压缩总开关 |
| `tools.thresholdChars` | `8192` | 工具结果文本超过此字符数才剪 |
| `tools.headChars` / `tailChars` | `4096` / `1024` | 剪后保留的开头 / 结尾字符数 |
| `tools.keepLast` | `2` | 最近 N 条工具结果原样保留 |
| `tools.onlyTools` | `[]` | 白名单工具名；空表示全部 |

## 它到底改了什么

- **思考压缩**：把旧轮次 `assistant` 消息里的 `reasoning` 块截成「开头 + 标记 + 结尾」，`clear` 模式则整块移除。
- **工具输出压缩**：把旧轮次 `tool/result` 的文本剪成「头 4096 + `[... tool result middle pruned ...]` + 尾 1024」，图片等非文本块顺序不变。
- 两者都通过**表层替换事件**写入会话日志：原文仍完整保留在日志里，随时可回查；模型后续看到的是替换后的版本。
- **不动**：系统提示词、工具 schema、用户消息、`tool-call` 参数（删了工具结果就无主，会话会坏）。

## 安全边界

- 只在**上下文压力超过阈值**时触发，平时零开销、零改写，不会打乱前缀缓存。
- 每轮最多执行一次。
- 每个板块默认关闭；出错只记日志，绝不会让当前步骤失败。
- 截断按 Unicode 码点切片，不会切断 emoji / 代理对。

## 路线图

### v0.2 — 总压缩板块

按「触发参数 / 压缩提示词 / 压缩模型」三段设计，计划字段：

```yaml
total:
  enabled: false
  trigger:
    thresholdRatio: 0.8        # 与官方口径一致
    retainRatio: 0.16
    headroomTokens: 65536
    maxOverflowRetries: 1
  prompt: ./prompts/checkpoint.md   # 自定义摘要提示词
  provider: ark-plan                # 摘要模型
  model: deepseek-v4.1-flash
  maxTokens: 65536
```

实现要点：自建 `ctx.compaction` 后端，复用官方的「选区 + 事务 + 检查点替换」约定，但摘要指令与模型由本插件配置。

### v0.3 — 模型判断压缩

- 工具输出：一次批量调用（只喂缩略证据，不喂全文）让模型判定 `keep` / `trim` / `drop`，把成本压到单次几千 tokens。
- 思考过程：模型摘要替代机械截断（优先级低，机械版通常够用）。

## 开发

```sh
node --test test/*.test.mjs
```

纯策略函数在 `lib/policy.js`，不含任何 I/O，可直接单测。

## License

MIT
