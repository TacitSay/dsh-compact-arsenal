# dsh-compact-arsenal

按轮次压缩 DSH 会话历史，保留用户原话与每轮结尾的答复，把中间的执行过程压成一段记录。

[![npm](https://img.shields.io/npm/v/dsh-compact-arsenal)](https://www.npmjs.com/package/dsh-compact-arsenal)
[![license](https://img.shields.io/npm/l/dsh-compact-arsenal)](LICENSE)

---

## 它做什么

把用户消息和最后模型输出的中间内容称为轮次进行压缩

一轮对话在会话里长这样：

```
用户：      "把 X 改成 Y"                      ← 不动
助手：      [思考] [工具调用]                   ┐
工具：      <命令输出>                          │ 压成一段(轮次)
助手：      [思考] [工具调用]                   │
工具：      <命令输出>                          ┘
助手：      "改好了，改了 3 行"                  ← 不动
```

---

## 快速开始

### 方法一 让 DSH 自己装

在对话里发这段：

```
帮我安装这个插件：https://github.com/TacitSay/dsh-compact-arsenal
装完告诉我需要重启。
```

DSH 会读取仓库的 `package.json`，把它加到当前 profile 的依赖里并安装。

### 方法二 在插件面板添加

1. 打开侧栏的 **插件**
2. 切到 **添加插件**
3. 输入框里填 `dsh-compact-arsenal`
4. 确认添加，然后重启 DSH

### 方法三 命令行

```sh
# 从 npm
dsh plugin --profile <profile> add dsh-compact-arsenal

# 从 GitHub 源码
dsh plugin --profile <profile> add github:TacitSay/dsh-compact-arsenal

# 本地目录（改完代码重启即生效）
dsh plugin --profile <profile> add C:/path/to/dsh-compact-arsenal
```

`<profile>` 换成实际名字：桌面版一般 `desktop`，`dsh web` 一般 `web`。不确定就看 `~/.dsh/profiles/` 下有哪些目录。

### 装完

重启 DSH，左栏出现 **上下文压缩**。

打开面板，开启 **轮次压缩**，选一个压缩模型。

---

## 压缩时发生了什么

### 触发

```
每轮对话开始前（agent/pre-step）
  → 读取当前上下文占用 / 窗口大小
  → 达到轮次压缩的触发阈值（默认 0.7）才启动
```

### 挑选轮次

```
把所有「用户指令 → 下一条用户指令」切成区间
  ↓
排除：最近 keepLast 轮（默认 2 轮）——那是当前工作区
排除：中间内容小于 minChars 的轮次（默认 2000 字符）
排除：已经压缩过的（检查点带标记，跳过）
  ↓
剩下的按原顺序，从最旧的开始
```

### 送给模型的内容

每一轮的过程记录，加上它末尾的答复作为参考：

```
---#1---
[ASSISTANT] [thinking] 需要先确认文件在哪
[ASSISTANT] [call read] {"path":"lib/policy.js"}
[RESULT] 文件内容……
[ASSISTANT] [thinking] 明白了，需要加一个常量
[ASSISTANT] [call edit] {"path":"…","old":"…","new":"…"}
[RESULT] done

[最终回复] 以下是这一轮结束时我给出的答复，它不会参与压缩，仅用于让你理解结果：
加好了，在 lib/policy.js 里新增了 SHORT_MARKER。
---#2---
……
```

### 模型返回什么

```json
[
  {"i":1,"s":"read lib/policy.js，新增 SHORT_MARKER 常量"},
  {"i":2,"s":"……"}
]
```

### 替换

```
替换前： user → a1 → tool1 → a2 → tool2 → a3
替换后： user → [检查点] → a3
```

- `a3`（结尾答复）位置不变，原文保留；
- `a1/tool1/a2/tool2` 从表面移除，但**日志里仍完整保留**，可回查；
- 检查点是一个 `user/message`，带 `[compact-arsenal turn summary]` 前缀。

---

## 参数

| 参数 | 含义 | 默认 |
|---|---|---|
| 触发阈值 | 上下文占用比例达到多少才启动 | `0.7` |
| 不动最近 | 最近 N 轮不压缩 | `2` |
| 最小体积 | 单轮中间小于此值不压（字符） | `2000` |
| 占原文 | 摘要占原文的比例上限，**留空 = 不限** | 空 |
| 时间预算 | 一次触发最多跑多久（毫秒） | `600000`（10 分钟） |
| 单次输入上限 | 一批装多少字符，**留空 = 按窗口推导** | 空 |
| 输出上限 | 一批最多返回多少 token，**留空 = 按窗口推导** | 空 |

**留空的两项会自动推导**：

```
输入预算 = 窗口 token × 55%        （按 1 token ≈ 1.5 字符估算）
输出预算 = 窗口 token × 25%        （上限 200,000）
```

---


## 留存与日志

每一轮压缩都会写一份归档：

```
archive/<对话名>--<会话id>/turn--model--<时间>--seq<编号>.md
```

运行日志在 `logs/compact-arsenal.log`，记录每次触发、每批结果、每次失败的原因。

---

## 实测结果

54 次轮次压缩的归档统计：

```
原文合计     1,180,938 字符
改写后合计      19,898 字符
比例               1.7%
```

---

## Q&A

Q:有省token的效果吗
A:如果参考我的案例,压缩后再进行两次对话可以回压缩的成本,我在没有足够数据支持省token前暂时不打包票

---

## 许可

MIT
