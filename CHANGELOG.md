# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
