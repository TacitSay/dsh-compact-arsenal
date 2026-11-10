# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
