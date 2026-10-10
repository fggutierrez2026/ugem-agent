# μgem agent — Development Plan

**Scope:** v0.1 `/Q&A` MVP ONLY. v0.2 `/plan`, v0.3 `/debug`, and future `/build` are documented in `docs/` but **not actionable in this checklist**. Progress will be extended incrementally in later revisions. Every box starts unchecked because this bundle contains documentation, not code.

## Definition of Done (each task)
- [ ] Implementation matches its documented acceptance criteria.
- [ ] Relevant automated tests executed and passing, or limitations explicitly recorded.
- [ ] Windows/Linux compatibility considered and verified where environments are available.
- [ ] `MEMORY.md` updated with concise state, caveats and next step.

## Foundation

### T001 — Bootstrap CLI and test harness
- [x] Initialize npm project, Node.js >=20 engine, entry-point and `ugem` command.
- [x] Create minimal modular `src/` layout with CLI, provider, session, renderer, metrics, settings.
- [x] Implement terminal-safe input loop, help, exit, interrupt handling (Ctrl+C).
- [x] Add native `node:test` (or justify alternative), formatting/lint baseline, mockable stdout/stdin.
- **Accept:** CLI starts without a model server, `/help` and `/exit` work, clear error on inaccessible endpoint, tests run on supported Node.

### T002 — Compatible model client
- [x] Configurable base URL, model ID, request timeout and optional credential via environment (never print secrets).
- [x] Implement `POST /v1/chat/completions` and parse standard response/errors.
- [x] Support `/v1/models` discovery when exposed; gracefully handle server with only one model.
- [x] Add mock-server tests for success, HTTP error, disconnect, malformed response.
- **Accept:** can get a reply from a compatible server; mock tests confirm failure paths.

### T003 — Streaming and Q&A conversation
- [x] Parse SSE streaming incrementally, including `[DONE]`, partial UTF-8 and split event boundaries.
- [x] Implement `/Q&A` (and Q&A default startup), conversation history, `/clear`, cancellation/interrupt and follow-up questions.
- [x] Distinguish one-shot `/Q&A <question>` from entered mode; do not inject project docs/skills/tools.
- [x] Handle interrupted streams without corrupting history.
- **Accept:** response streams without duplicated/missing text; `/clear` removes conversational history; no tool calls or file edits.

### T004 — Rich terminal renderer
- [x] Style headings, emphasis, quotes, lists, links, tables and inline code as rendered terminal content, not raw Markdown delimiters.
- [x] Render fenced code in a responsive titled box without fences; preserve indentation/raw history, selectable text color and safe ANSI handling.
- [x] Render common inline/display math as legible Unicode; define truthful fallback for unsupported LaTeX.
- [x] Support streaming Markdown with buffering for incomplete blocks, wrapping and terminal resize.
- [x] Add snapshot/golden tests with split streams, nested lists, tables, LaTeX and narrow terminals.
- **Accept:** `# Heading` displays as styled heading; no raw fences for valid blocks; no lost/duplicated text; math never silently changes meaning.

### T005 — Metrics and context telemetry
- [x] Capture latency, TTFT, completion count and speed; prefer provider token timings when available.
- [x] Distinguish prompt/output tokens, wall-clock throughput vs generation-only throughput, and source (reported/estimated/unavailable).
- [x] Display current used/budget/server limit if known; avoid claiming exact tokenizer counts from estimates.
- [x] Add `/stats` and optional concise per-answer footer.
- **Accept:** metric calculations tested with synthetic streams; unknown measurements show N/A, never invented values.

### T006 — Themes and visual identity
- [x] Add framed startup/status/metrics panels, bold identity, semantic parameter colors, visual block bars, distinct user/model accents and `NO_COLOR` fallback.
- [x] Dark, light and auto modes with coordinated accents and terminal-capability-aware colors.
- [x] Add `/theme classic|ocean|forest|violet|mono` with `mono` and `NO_COLOR` fallbacks; selection is session-local pending T010 persistence.
- [x] Validate dark/light color choices and 40/80-column wrapping on Linux; cover monochrome and Windows Terminal ANSI capability paths in automated tests (real Windows remains T011).
- **Accept:** all themes readable; no permanent modification of host-terminal theme.

### T007 — Model selection
- [x] Auto-start/stop the managed local llama.cpp launcher and add `/models` selection for its presets.
- [x] Extend listing/selection to provider-advertised request models; offer `UGEM_BASE_URL`/`UGEM_MODEL` configuration for an external single-model server without claiming dynamic loading.
- [x] On model switch, require clear vs keep when history exists; use a new conversation when none exists.
- **Accept:** unsupported model switch cannot silently succeed; model ID is truthful.

### T008 — Reasoning control
- [x] Add `/reasoning auto|on|off` for the managed local llama.cpp server; restart the owned process and clear history when it changes.
- [x] Extend capability-aware reasoning interpretation to external llama.cpp-compatible model templates using non-inference `/props` and `/apply-template` probes.
- [x] Keep reasoning-generation control distinct from final-answer-only display; never append `reasoning_content` to rendered output or history.
- [x] Report supported, unsupported and unknown control honestly; treat `auto` as the backend default rather than claiming OFF.
- **Accept:** tests cover supported, unsupported, unknown capability and no-leak final-answer formatting.

### T009 — Context budget management
- [x] Render a proportional context bar when the server limit is known, with explicit `N/A` fallback.
- [x] Warn once when estimated retained context reaches 90%; reset the warning with `/clear` or a model/reasoning change.
- [x] Add `/context` viewer and set session budget within confirmed server limits.
- [x] Reserve output tokens; prevent silent truncation; warn on overflow and offer `/clear`.
- [x] Explain server `--ctx-size` may require restart/reload; no claim of dynamically changing server context.
- **Accept:** limits validated, overflow is explicit, estimated usage labeled.

### T010 — Settings persistence and UI
- [ ] Add `/settings` compact menu, `/help`, default Q&A mode and documented shortcuts.
- [ ] Store preferences in OS-appropriate config location; separate from conversation/project data.
- [ ] Validate schema, defaults, backward-compatible versioning and secure handling of secrets.
- **Accept:** preferences survive restart; corrupt config recovers safely and reports issue.

### T011 — End-to-end validation and v0.1 release
- [ ] Run integration tests against mocked OpenAI-compatible SSE provider.
- [ ] Manually test against a real `llama.cpp` server and document actual model/build used.
- [ ] Verify theme, Markdown, math, token/context metrics, model selection and reasoning degradation.
- [ ] Test Linux and Windows (or clearly document unverified platform); publish README/getting-started and release notes.
- [ ] Verify Q&A is tool-free and cannot edit repository files.
- **Accept:** runnable v0.1 release with evidence and disclosed limitations; no `/plan`, `/build`, `/debug` implementation implied.

## Deferred roadmap (not executable yet)
- **v0.2 `/plan`:** planning, research, compact design/spec/tasks; review/approval, hierarchical context, optional subtasks, revisions.
- **v0.3 `/debug`:** accept pasted tracebacks/descriptions, inspect/diagnose, issue tracking and propose Task Revisions without editing code.
- **Future `/build` (version TBD):** scoped implementation, testing, bounded correction, verification; no-argument status/menu; `next`, `T###`, `T###.n`, `R###`, `all` commands.

After v0.1 is verified, append detailed v0.2 tasks to this plan rather than pre-marking future functionality completed.
