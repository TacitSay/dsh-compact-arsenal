# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] — 2026-11-13

### Fixed

- **A model-backed pass could stall the whole reply.** The `agent/pre-step` hook
  awaited the rewrite, so one turn waited on every summarization call in
  sequence — up to 12 items per section across two sections — before the model
  was even asked to answer. With a provider that stops responding, the stream
  never finished and the turn showed no thinking, no tool calls and no reply.
  The rewrite now runs detached: the step proceeds immediately and the pass
  lands when it lands. Safety is unchanged because `compressSection` already
  refuses to append once the turn has closed.
- **A summarization call had no time bound.** `summarize()` now races the call
  against a 45-second timeout chained to the step signal, so a silent provider
  becomes an ordinary failure the caller can fall back from instead of an
  indefinite await.
- **A pass could chain model calls without yielding.** Each pass now carries a
  wall-clock budget (`maxPassMs`, default 90 s); when it is spent the pass stops
  and records why.

### Added

- `test/summarize-timeout.test.mjs`: reproduces the stall with a stream that
  yields one delta and then never finishes, and asserts the call returns.
- `maxPassMs` for both sections in the defaults.

## [0.8.0] — 2026-11-13

### Added

- **Model pickers backed by the live catalog.** 思考压缩 / 工具输出压缩 / 总压缩
  now choose a provider and model from dropdowns fed by
  `llm.listProviders()` + `llm.listModels()` — the same routes a chat model
  selection offers. Picking a model also selects its provider, so the pair can
  never drift apart, and the empty choice keeps "follow the current session".
  A new `GET /compact-arsenal/api/models` route serves that catalog.

### Changed

- **Panel layout reworked to stop fields colliding.** Every control now sits in
  one shared `Field` frame (label / control / hint on their own lines), and all
  inputs, selects and text areas share a single `controlStyle`. Grids use
  `minmax(150px, 1fr)` with `box-sizing`, so a narrow window wraps instead of
  overlapping.
- The compression prompt and its output budget moved into their own
  `PromptFields` block under the picker, instead of sharing a row with the
  provider/model inputs.

### Added (tests)

- `test/render-panel.mjs`: renders the panel with a stub React and asserts the
  three sections, the retention card, and that the removed copy stays removed.

## [0.7.1] — 2026-11-12

### Fixed

- **A checkpoint without an `id` made the session unloadable.** Reported as
  incident #2: `user/message` events carry the message *as* their payload, so a
  strict reload demands a non-empty `id`, `role: 'user'`, a `source.kind` and
  array `content`. The reasoning branch hand-built that payload and omitted the
  `id`, so 16 checkpoints caused
  `seed user/message at index 6292 lacks an identified message` and the session
  would not open. `totalPass` had the same omission in its own checkpoint.
- Both call sites now build their payload through one `buildUserCheckpoint()`
  that supplies a traceable id (`compact-arsenal-<kind>-<seq>-<time>`), the
  current turn, and validates the result against the log's own four rules before
  the append — a malformed checkpoint is refused rather than stored.

### Added

- `test/checkpoint-shape.test.mjs`: an integration test against the packaged
  `dsh-session` that writes a checkpoint into a real log and re-checks it. It
  also records the mechanism behind the incident: a live `append` **accepts** an
  id-less checkpoint, so the defect only surfaces on reload — which is why the
  plugin's own guard, not the log, has to catch it.
- Source assertions now cover the single construction path, the id, the
  pre-append shape validation, and the absence of any hand-rolled
  `user/message` append (22 checks).

## [0.7.0] — 2026-11-12

### Changed

- **The archive lives inside the plugin directory** (`<plugin>/archive`), resolved
  from the module's own URL instead of `DSH_HOME`. The archive therefore travels
  with the plugin, no host path is baked in, and a read-only install falls back
  to `$DSH_HOME/compact-arsenal` without losing the record.
- The archive location and its record count moved into the **压缩留存** card,
  next to the switch that controls them, instead of sitting at the page bottom.

### Added

- **打开目录** button in the 压缩留存 card: asks the Host to reveal the archive
  folder in the platform file manager. The path is resolved server-side, so the
  browser never supplies or learns a host path.

### Removed

- Three lines of standing copy from the panel: the "parameters save
  automatically" subtitle, the pressure readout row, and the safety-boundary
  footer.

## [0.6.0] — 2026-11-11

### Added

- **压缩留存 switch.** Archiving can be turned off without touching the
  compression itself, so a machine that only needs the token savings stops
  writing files. Off means nothing touches disk.
- **File names built for comparison.** A record is now named
  `<对话名>--<内容>--<方式>--<时间>--seq<编号>.md`, e.g.
  `WordCut-词剪--tools--model--20261111-214530--seq1234.md`. The conversation
  comes first so one session sorts together; the timestamp sorts chronologically
  in a plain directory listing; the node id makes a record traceable back to the
  log. The record body now also states the conversation title, the local time,
  and the saved ratio.

### Changed

- Archiving reads the conversation title from the session when the Host exposes
  one, falling back to the session id.

## [0.5.1] — 2026-11-11

Patch release: `0.5.0` was stranded in npm's staging queue (a publish returned
`409 Cannot publish over previously staged version` while the staging list
showed nothing), so the same code shipped under a fresh number.

## [0.5.0] — 2026-11-11

### Fixed

- **Reasoning compression could never land on any published DSH release.**
  Reported in [#1](https://github.com/TacitSay/dsh-compact-arsenal/issues/1):
  the log enforces two mutually exclusive rules on a surface replacement — every
  shadowed node must be cited, and `assistant/message` may not cite anything.
  Rewriting an assistant node in place is therefore impossible, and every
  reasoning attempt failed with `missing <seq>` while its model call had already
  been paid for. Reasoning now collapses into a `user/message` checkpoint citing
  the node it replaces, the same shape the shipped compaction backends use.
- **`totalPass` cited only the nodes it fed the model.** Nodes filtered out
  before summarization (system, developer, and turn-less nodes, including this
  plugin's own earlier checkpoints) still fall inside `[startSeq, endSeq]` and
  were reported as missing. The whole surface span is cited now.

### Added

- Pre-flight shape check: an impossible replacement is detected before the model
  call, so a deterministic rejection no longer spends a request.
- `test/surface-shape.test.mjs` runs against the packaged `dsh-session` and pins
  the accepted replacement shape for both node types.
- Source assertions now cover the reasoning shape, the whole-span citation, and
  the pre-flight check (17 checks).

## [0.4.0] — 2026-11-11

### Fixed

- **The pressure readout never appeared while all sections were disabled.**
  `rewriteAsync()` short-circuited before measuring, so a plugin with every
  switch off reported nothing. Measurement now happens first, and the panel
  endpoint re-reads it from the live agent on every request instead of relying
  on the once-per-turn hook value.

### Added

- **Version badge in the panel header** (`v0.4.0`), sourced from the running
  plugin rather than `package.json`, so a stale install is visible at a glance.
- A disabled **检查更新** button beside it, reserving the seat for a future
  update check; the market owns package updates, so this stays inert until one
  exists.

## [0.3.0] — 2026-11-11

### Fixed

- **Surface replacements could land outside an open turn and make the session
  unloadable.** The `agent/pre-step` handler called `rewrite()` without
  `await`, so a slow model batch kept appending after the handler returned and
  after its turn had closed. Of 100 affected rows in one session, 5 sat in the
  gap between turns and were rejected by the log loader on resume; the other 95
  slipped through while claiming a turn they did not belong to.
- **Replacements carried the replaced node's turn.** `applyRewrittenText()` wrote
  `turn: event.data.turn`, i.e. the turn the old node was created in — often
  dozens of turns earlier. The row now carries the turn that owns the write, and
  keeps the node's step only when both turns match.
- **A cancelled step still wrote to the log.** `compressSection()` now checks
  `signal.throwIfAborted()` before each batch and each append.
- **Two turns of one session could rewrite concurrently.** `lastProcessedTurn`
  is marked when a rewrite starts but appends land seconds later; a per-session
  in-flight set now keeps a second pass from starting.
- **A turn closing mid-pass is detected.** Every append is preceded by a
  turn-boundary check read from the log tail, so a write that would land after
  `turn/end` is skipped instead of corrupting the log.

### Removed

- The unused single-item rewrite path (`rewriteAssistant*`, `rewriteToolResult*`,
  `rebuildWithModel`) — dead code that carried the same stale-turn bug and could
  have been reintroduced by accident.

### Added

- `test/turn-position.test.mjs`: pins the turn/step semantics of a replacement
  and the "is the turn still open" decision.
- `test/verify-fix.cjs`: asserts all of the above against the shipped source, so
  a regression fails a test rather than a user's session.

## [0.2.1] — 2026-11-10

### Fixed

- The pressure gate now reads the provider-reported prompt size
  (`ctx.tokenMeter.contextPressure()`), falling back to the heuristic estimate
  only when no provider figure exists. The heuristic prices text at ~4
  characters per token, which undercounts CJK and JSON by about 12%: a session
  measured at 51.9% of its window was read as 45.4% and never tripped a 0.5
  threshold.
- The panel shows both numbers (真实 / 估算) so a gate decision can be explained.

### Added

- `docs/threshold-notes.md`: a field record of one session, the exact crossing
  sample, every rewrite it produced, and the two measurement bases side by side.

## [0.2.0] — 2026-11-03

### Added

- **Left-sidebar panel** (`上下文压缩`): per-section switches, method cards with
  check marks, editable parameters, debounced auto-save, live rewrite counters.
- **Total compression** that runs on its own: replaces the oldest closed turns
  with a model-written checkpoint, keeping tool calls and results paired.
- **Model-backed modes** for reasoning and tool-output sections, with
  configurable provider, model, output budget and prompt; empty values follow
  the current session route.
- **Batch summarization**: up to eight fragments per model call, answered as JSON
  and applied item by item.
- Panel HTTP routes `/compact-arsenal/api/state` and `/compact-arsenal/api/config`,
  backing the panel with `ctx.configEditor` so edits land in the profile patch.

### Changed

- Reasoning and tool sections now gate on **section-wide size** (`minTotalChars`)
  instead of a per-fragment threshold, because reasoning arrives as many small
  fragments that a per-fragment threshold would never reach.
- Each section carries its own **pressure threshold**; the former single global
  threshold was removed.
- Default prompts ship with the plugin and are used whenever a prompt is empty.

### Fixed

- Panel render crash when the served config lacked the `total` section.
- Model fields overlapping in the panel; they now use a grid layout.
- Legacy `minChars: 2000` configs are migrated to the new per-fragment floor.

## [0.1.0] — 2026-11-02

### Added

- Bundle plugin skeleton: Cordis patch, locale resources, icon, MIT license.
- Pure, dependency-free rewrite policy with unit tests.
- Mechanical reasoning trimming (`truncate` / `clear`) and tool-output pruning,
  applied through surface replacement at a pressure threshold.
