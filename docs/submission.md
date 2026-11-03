### Repository
<https://github.com/TacitSay/dsh-compact-arsenal>

### One-line value
在 DSH 左栏加一个「上下文压缩」面板，把总压缩 / 思考压缩 / 工具输出压缩做成三个独立开关、可调参、可按批走模型的板块，长会话不必靠删历史续命。

### Category
Memory & Context

### Install command
dsh plugin --profile web add "github:TacitSay/dsh-compact-arsenal#main"

（尚未发布 npm 包；如需进入 DSH 内置 Plugin Hub，我可以补一次 npm 发布，包名 `dsh-compact-arsenal` 目前未被占用。）

### Compatibility
- DSH: 0.2.1-rc.5（已在 Windows 桌面端实测）
- Node: >= 22.19.0
- profile: web
- 平台：Windows 实测；纯 JS 实现，无原生依赖

### License
MIT

### Screenshots / demo
暂无截图。面板结构（左栏「上下文压缩」）：

- 总开关：关闭时三个板块整体置灰不执行
- 总压缩：触发阈值 / 阈值比例 / 保留比例 / 摘要上限 / 不动最近 N 轮 / 摘要模型 / 提示词
- 思考压缩：开关 + 方式卡片（机械截断 / 整块清除 / 模型要点，带勾选）+ 各板块独立阈值 + 总量下限 / 单项下限 / 批量大小
- 工具输出压缩：同上（按字符预算 / 模型要点）

实测记录（本机）：把阈值调低后，11 条旧工具结果被真实改写，节省 50,248 字符，且配置保存后立即生效、无需重启。

### Notes
- 权限与副作用：只改写本机会话的表层内容（`surfaceOp: replace`），原始内容仍完整保留在会话日志；不读取工作区文件。
- 配置写入走官方 `ctx.configEditor`，等价于手改 `cordis.patch.yml`，可回滚。
- 网络：仅在「模型方式」下调用你在 DSH 里已配置的模型路由；机械方式完全不联网。
- 已知限制：子代理会话在拿不到 contextWindow 时不会触发；总压缩按整轮替换以保持工具调用/结果配对。

### Pre-submission checklist
- [x] Repository is public
- [x] GitHub topic `dsh-plugin` added
- [x] README includes the install command
- [x] Plugin exports an `apply(ctx)` module
- [x] Repository root includes a `package.json`
