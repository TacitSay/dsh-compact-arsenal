# 压缩器故障复盘：注入块被当成用户指令

> 读者对象：接手这个仓库、或者要审查某个压缩实现的人。
> 时间：2026-11-23。涉及版本：0.17.0 → 0.17.2。
> 这份文件只陈述发生了什么、证据在哪、怎么验的。不含推测。

---

## 一句话

`isUserInstruction` 用 `source.kind === 'user'` 判断「这是人说的话」。但在 DSH 里，
**注入的内容也用这个 kind**。于是压缩区间可以从注入块开始，把真实历史卷进摘要。

同时，解析模型回复的正则用了贪婪匹配，尾部只要出现方括号，整批结果就被丢弃。

**两条都修了。真实用户指令被遮蔽的数量实测为 0；本次是「压错了注入块」，不是「压掉了用户原话」。**
本文件后面的第 5 节专门澄清这个区别——不要让复盘比事故本身更严重。

---

## 症状

用户报告两条：

1. 面板显示 `失败 1 次（未落盘，不计入节省）：turns 批次（1 轮）: turn-batch-parse-failed`
2. 上下文占用从约 60% 掉到 15%

第 2 条本身不是故障（压缩就是在降占用），但降幅远超预期，值得核对。

---

## 证据链

### 1. 日志

`logs/compact-arsenal.log`：

```
2026-11-23T10:39:15.229Z INFO turns pass start intervals=84 eligible=82 batches=5 provider=trae model=deepseek-v4.1-flash
2026-11-23T10:40:13.554Z ERROR turns batch failed turns=12 error=turn-batch-parse-failed
2026-11-23T10:40:31.924Z ERROR turns batch failed turns=12 error=turn-batch-parse-failed
2026-11-23T10:40:47.638Z INFO turns pass end items=30 chars=934230 failed=24 archived=30 keptReplies=53 elapsedMs=92420
2026-11-23T10:51:40.795Z ERROR turns batch failed turns=1 error=turn-batch-parse-failed
2026-11-23T10:51:40.795Z INFO turns pass end items=24 chars=634458 failed=1 archived=24 keptReplies=54 elapsedMs=57443
```

注意：`failed=24` 而 `items=30`。**失败的两个批次各 12 轮，一次 pass 丢掉 24 轮。**
用户看到的「失败 1 次」只是最后一次 pass。

### 2. 会话日志里的两种 user/message

扫 `session-cae5555c-….v4.jsonl.zstd`，按 `data.source` 的字段分组：

| source 字段 | 条数 | 是什么 |
|---|---|---|
| `{kind:'user', rpcId, clientTimeZone}` | 109 | 人通过客户端 RPC 发的 |
| `{kind:'user'}` | 197 | 注入的 |

那 197 条包含：

```
"This is an automatically generated checkpoint condensing an earlier span of the conversation…"
"The user wants a real plugin project with three sections: 1. 总压缩…"
"Now README, then install & verify. README should be honest:…"
```

来源：DSH 自己的压缩检查点、hindsight 记忆召回、以及本插件更早版本写的检查点。

**它们全都 `kind: 'user'`，但都不是人在打字。**

### 3. 旧的判定

```js
// lib/turns.js（0.17.1）
export function isUserInstruction(event) {
  if (event?.type !== 'user/message') return false
  if (event.data?.source?.kind !== 'user') return false   // ← 只到这里
  ...
}
```

### 4. 后果：需要说准确

按 surface 顺序重放，把每个被遮蔽的节点归属到移除它的人。下面是**修复当刻**的快照：

| 来源 | 节点 | 字符 |
|---|---|---|
| 我们的轮次压缩 | 3,258 | 1,135,595 |
| DSH 自己的压缩检查点 | 234 | 246,682 |
| 用户回退（rewind） | 19 | 9,792 |
| 其他 | 711 | 1,960,927 |

其中**我们遮蔽的节点里有 71 条 `source.kind === 'user'` 的注入块**。
**真实用户指令被我们遮蔽的数量是 0。**

### 5. 但这不是「一次区间错位吞掉 100 条」

这里必须收敛，否则复盘会变成夸大。

把旧规则套在**当前 surface** 上对比：

```
OLD rule（只查 kind）    intervals: 88   起点是注入块的: 1（seq=6292，宽度仅 1）
NEW rule（要求 rpcId）   intervals: 87   起点是注入块的: 0
```

**单次 pass 里，注入起点只多出 1 个，而且它的中间宽度是 1。**

那 71 条是怎么来的？是**历史多次 pass 累积**的：

```
每一次 pass 都有自己的区间划分。
早期版本（0.9～0.16）的区间逻辑还经历过多次修改：
  - 一度没有 keepLast 保护
  - 一度把最后一个 assistant 回复也算进中间
  - 一度在 model 模式下按批装填，区间边界来自当时的 surface
```

也就是说：**71 是长期累积的统计量，不是一次事故的规模。** 把它说成「一次压掉了 100 条历史」
是不准确的。

**准确的说法**：
- 旧判据确实会让注入块成为轮次起点（当前 surface 上实测 1 处）；
- 在注入块密集的历史阶段（多个检查点连续出现时），区间会被切得很碎，
  这些碎片各自被压成摘要——这解释了 71 条注入块的来源；
- **真实用户指令从未被遮蔽（0 条）**，因为真实指令之前总是紧跟着自己的中间过程，
  不会被跨越。

这个区别重要：**「把用户原话压掉了」和「把注入块压掉了」严重程度完全不同。**
本次是后者。修复仍然必要（它消除了一个会随注入密度恶化的隐患），但它不是
「用户数据被破坏」级别的事故。

复现两个结论：

```sh
# 谁移除了什么、真实指令是否被吞（退出码 0 表示安全）
node scripts/audit-session.mjs <session.v4.jsonl.zstd>
```

---

## 一个中间踩过的坑（值得记）

第一次审计我按**数字 seq 区间**扫 `[startSeq..endSeq]`，得出「198 条真实用户指令被吞」。
**这个结论是错的。**

`surfaceOp` 的 `startSeq`/`endSeq` 是**事件序号**，但 `state.nodes` 是按 **surface 顺序**
排列的数组：

```js
// dsh-session/lib/types/surface.js
const startIdx = state.nodes.indexOf(op.startSeq);
const endIdx = state.nodes.indexOf(op.endSeq);
state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq);
```

替换会把新节点插在被替换的**位置**上，所以日志里晚写入的检查点可以排在数组里更早的地方。
证据：存在 `span=[8788..2166]` 这种起始序号大于结束序号的区间（按数字扫会算出负宽度）。

**唯一可信的做法是照 DSH 那样重放 `indexOf` + `splice`。** 重放后的结论：
被我们遮蔽的**真实用户指令是 0 条**，那 71 条全是注入块。

这个区别很重要：**「把用户原话压掉了」和「把注入块压掉了」是两个严重程度完全不同的事。**

---

## 修复

### 判据改为 `rpcId`

```js
if (source?.kind !== 'user') return false
// Injected blocks share kind 'user' but never arrive over the client RPC.
if (typeof source?.rpcId !== 'string') return false
```

**为什么用 `rpcId` 而不是文本黑名单**：黑名单要枚举所有注入源的措辞，注入源一变就失效。
`rpcId` 是结构性的——只有客户端 RPC 送达的消息才有。

**保守方向是故意的**：万一某条真实消息没有 `rpcId`，代价是跳过那一轮不压，
而不是把真实指令卷进摘要。**少压一次可以补，压错一次不可逆。**

### 验证：功能没被削弱

同一会话、修复当刻的快照，新旧规则对比：

```
旧规则（只查 kind）    would-be turn starts: 87
新规则（要求 rpcId）   intervals:            86
```

**87 → 86，只少一个**（正是那个 DSH 注入检查点）。压缩功能完好，且：

```
每个区间起点都是真正的用户指令: true
```

> 这些数字是修复当刻的快照。会话继续增长后会各加一（复核时为 88/87），
> 差值恒定为一，即被排除的注入检查点。**差值才是结论，绝对值不是。**

---

## 第二个缺陷：贪婪正则

### 旧代码

```js
const match = String(raw).match(/\[[\s\S]*\]/)
if (match === null) return null
list = JSON.parse(match[0])
```

从**第一个 `[` 匹配到最后一个 `]`**。

### 触发条件

模型回复里，数组之后出现任何方括号：

```
[{"i":1,"s":"..."}]
注意：[重要] 已完成
```

匹配结果是 `[{...}]\n注意：[重要]` —— 两段数组加中文，`JSON.parse` 抛错，**整批丢弃**。

### 实测（修复前）

| 输入 | 结果 |
|---|---|
| `[{"i":1,"s":"ok"}]` | ✅ `["ok"]` |
| 字符串内含 `[1,2,3]` | ✅ |
| 前面有散文 | ✅ |
| **尾部有带方括号的散文** | ❌ **NULL** |
| **出现两个数组** | ❌ **NULL** |
| 真截断 | ❌ NULL（这个失败是正确的） |

两条本可恢复的情况被判为整批失败。

### 新实现

从第一个 `[` 起逐个尝试 `]`，取**第一个能解析成数组**的前缀：

```js
for (let k = open; k < text.length; k += 1) {
  if (text[k] !== ']') continue
  try {
    const candidate = JSON.parse(text.slice(open, k + 1))
    if (Array.isArray(candidate)) { list = candidate; break }
  } catch { /* 还不是数组结尾，继续 */ }
}
```

尾部方括号散文被忽略，真正截断的回复仍然失败（这个区别必须保住，否则会把半截结果当成完整结果）。

---

## 验证清单

```
unit tests        139 / 139
  其中新增：
    test/instruction-detection.test.mjs   9 条
    test/parse-robustness.test.mjs       10 条
source checks      24 / 24
render tests       11 / 11
部署               node scripts/deploy.mjs → loads OK, version 0.17.2
```

真实会话复核：

```
surface nodes: 511
intervals（新规则）: 86
intervals（旧规则）: 87
每个区间起点都是真正的用户指令: true
真实用户指令被我们遮蔽: 0 条
注入块被我们遮蔽: 71 条（符合预期）
```

---

## 教训

**1. 判断「谁说的话」不能只看消息类型。**
`user/message` 是传输通道，不是身份。注入内容、系统检查点、插件记忆都走这个通道。
需要的是「来源证明」（`rpcId`），不是「通道标签」。

**2. 审计 surface 必须按 surface 顺序重放。**
按数字序号扫区间会得到看似合理但完全错误的结论。我第一版审计就是这么错的，
差点把「0 条真实指令被吞」报成「198 条」。

**3. 读模型输出要用最保守的解析。**
贪婪匹配是最省事的写法，也是最容易把「本可恢复」变成「整批丢弃」的写法。
凡是「解析失败就丢掉全部工作」的路径，都值得逐个边界试一遍。

**4. 失败计数的措辞误导了判断。**
面板显示「失败 1 次」，实际那次 pass 失败了 24 轮。计数是「批次」还是「轮次」，
必须在用户看得见的地方说清楚。

---

## 相关文件

| 文件 | 变更 |
|---|---|
| `lib/turns.js` | `isUserInstruction` 增加 `rpcId` 判据 |
| `lib/summarize.js` | `parseSummaries` 改为逐个方括号尝试 |
| `test/instruction-detection.test.mjs` | 新增（9 条） |
| `test/parse-robustness.test.mjs` | 新增（10 条） |
| `test/*.test.mjs`（4 个文件） | 夹具补 `rpcId`——原来写的 `{kind:'user'}` 正是「注入块」的形状 |
| `scripts/audit-session.mjs` | 新增：谁移除了什么、真实指令是否被吞 |
| `scripts/compare-rules.mjs` | 新增：新旧判据在同一 surface 上的对比 |

提交：`fb085a6`（版本 0.17.2）

---

## 给审查者的三句话

如果只能记住三件事：

1. **`user/message` 是传输通道，不是身份。** 判断「谁说的话」需要来源证明（`rpcId`），
   不是通道标签（`source.kind`）。
2. **审计 surface 必须按 surface 顺序重放 `indexOf`/`splice`。** 按数字序号扫区间会
   得到看似合理但完全错误的结论——本文件「一个中间踩过的坑」一节记录了我第一次就是这么错的。
3. **不要把长期累积的统计量当成单次事故的规模。** 71 条注入块是多次 pass 叠加的结果，
   单次实测只多出 1 个注入起点。诊断的准确性比诊断的严重性更重要。
