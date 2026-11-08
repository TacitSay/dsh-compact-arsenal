# dsh-compact-arsenal · 压缩工坊

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）用的**可配置上下文压缩**插件。

三个板块各自独立开关、各自阈值、各自方法，并在左栏提供「上下文压缩」面板：开关、方式卡片、参数都能直接点，改完自动保存，不需要命令行。

> 设计原则：**能机械解决的先机械解决；要花模型钱的部分由你显式打开。**

---

## 三个板块

| 板块 | 对象 | 方式 | 是否调用模型 |
|---|---|---|---|
| **总压缩** | 最旧的若干**整轮**对话 | 模型写检查点 → 整段替换 | 是 |
| **思考压缩** | 旧轮次助手消息里的 `reasoning` 块 | 机械截断 / 整块清除 / 模型要点 | 机械模式否 |
| **工具输出压缩** | 旧轮次里超长的 `tool/result` 正文 | 按字符预算 / 模型要点 | 机械模式否 |

### 为什么思考要按「总量」判定

模型的思考是**碎片化**的：一条 8,000 字的思考很少见，更多是几百到一两千字的短片段，散落在几百条消息里。因此按「单条超过 N 字」判定几乎永不触发。

本插件改为：

1. 汇总所有「旧轮次、未压过」的碎片字数，达到 **总量下限**（默认 15,000 字）才动手；
2. 把最多 8 条、合计不超过 12,000 字的碎片**打包成一次模型调用**，模型返回逐条要点（JSON）；
3. 每条碎片原位替换为「头 + 要点 + 尾」（短碎片直接省略）；
4. 一次触发最多处理 12 条 / 省下 40,000 字，避免失控花销。

---

## 安装

```sh
# npm 包（推荐，DSH 内置 Plugin Hub 可见）
dsh plugin --profile web add dsh-compact-arsenal

# GitHub 源（把 web 换成你的 profile 名）
dsh plugin --profile web add "github:TacitSay/dsh-compact-arsenal#main"

# 或本地目录（开发）
dsh plugin --profile web add E:\path\to\dsh-compact-arsenal
```

重启 DSH 后，左栏出现「上下文压缩」图标。**所有板块默认关闭**，装上不改变任何行为。

---

## 面板

- 总开关；每个板块一个开关；
- 方式以**卡片**呈现，选中的有勾选标记；未实现的方式显示为灰色；
- 参数是数字输入框，改完 500 ms 自动保存并热重载；
- 模型方式下，提供方/模型留空即**跟随当前会话的模型**；
- 底部显示本次进程已执行的次数与省下的字符数。

面板通过两条本机路由工作，写入走官方 `ctx.configEditor`，与手动改配置等价：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/compact-arsenal/api/state` | GET | 当前生效配置与运行统计 |
| `/compact-arsenal/api/config` | POST | 保存配置（落到 profile 的 `cordis.patch.yml`） |

---

## 配置

也可以直接写 profile 的 `cordis.patch.yml`：

```yaml
- id: compact-arsenal
  name: dsh-compact-arsenal
  config:
    enabled: true
    total:
      enabled: true
      pressureRatio: 0.8      # 本板块的触发阈值
      retainTurns: 2          # 最近的整轮不动
      maxInputChars: 60000    # 一次摘要读入的上限
      provider: ''            # 留空 = 当前会话模型
      model: ''
    reasoning:
      enabled: true
      pressureRatio: 0.75
      mode: truncate          # truncate | clear | model
      keepLast: 3             # 最近 3 条助手消息不动
      minTotalChars: 15000    # 总量门槛
      minChars: 200           # 单项下限
      headChars: 600
      tailChars: 300
      batchChars: 12000
      maxItems: 12
      model:
        provider: ''
        model: ''
        prompt: ''            # 留空 = 内置默认提示词
    tools:
      enabled: true
      mode: truncate
      thresholdChars: 8192
      keepLast: 2
```

### 触发顺序

1. 本板块开关打开；
2. 上下文压力 ≥ 本板块的 `pressureRatio`；
3. 目标内容总量 ≥ 本板块的 `minTotalChars`（工具板块用 `thresholdChars` 作单项预算）。

三者都满足才会改写。

---

## 模型压缩到底做了什么

以思考为例，一条碎片会被改写为：

```
[原开头 600 字]

[... reasoning middle trimmed ...]
<该条的要点>
[... reasoning middle trimmed ...]

[原结尾 300 字]
```

- **打包**：同一批最多 8 条碎片共用一次模型调用；
- **回填**：写回**原来那条消息**（表层替换），不新增消息、不打乱顺序；
- **可回查**：原始内容完整保留在会话日志中；
- **幂等**：已带压缩标记的内容不会再被压缩，避免摘要衰减；
- **降级**：模型不可用时自动退回机械头尾截断，不会让这一步失败。

---

## 安全边界

- 不动系统提示词、工具 schema、你的消息、`tool-call` 参数；
- 总压缩按**整轮**替换，工具调用与结果始终成对进出；
- 任何改写失败只记日志，不会中断当前步骤；
- 文本按 Unicode 码点切片，不会切断 emoji 或代理对。

---

## 开发

```sh
node --test test/*.test.mjs
```

- `lib/policy.js`：纯函数（测量、截断、剪枝）；
- `lib/summarize.js`：模型调用与批量 JSON 解析；
- `index.js`：Host 半边（触发、改写、面板路由）；
- `client.js`：面板（React，无构建步骤）。

## 路线图

- [ ] 面板内直接编辑提示词模板并预览效果；
- [ ] 工具白名单的图形化选择；
- [ ] 压缩前后的 token 差值图表；
- [ ] 英文界面（当前面板文案为中文）。

## License

MIT
