# μgem agent — Development Plan

**Scope:** v0.1 `/Q&A` MVP ONLY. v0.2 `/plan`, v0.3 `/debug`, and future `/build` are documented in `docs/` but **not actionable in this checklist**. Progress will be extended incrementally in later revisions. Every box starts unchecked because this bundle contains documentation, not code.

## Definition of Done (each task)
- [ ] Implementation matches its documented acceptance criteria.
- [ ] Relevant automated tests executed and passing, or limitations explicitly recorded.
- [ ] Windows/Linux compatibility considered and verified where environments are available.
- [ ] `MEMORY.md` updated with concise state, caveats and next step.

## Foundation

### T001 — Bootstrap CLI and test harness
- [ ] Initialize npm project, Node.js >=20 engine, entry-point and `ugem` command.
- [ ] Create minimal modular `src/` layout with CLI, provider, session, renderer, metrics, settings.
- [ ] Implement terminal-safe input loop, help, exit, interrupt handling (Ctrl+C).
- [ ] Add native `node:test` (or justify alternative), formatting/lint baseline, mockable stdout/stdin.
- **Accept:** CLI starts without a model server, `/help` and `/exit` work, clear error on inaccessible endpoint, tests run on supported Node.

### T002 — Compatible model client
- [ ] Configurable base URL, model ID, request timeout and optional credential via environment (never print secrets).
- [ ] Implement `POST /v1/chat/completions` and parse standard response/errors.
- [ ] Support `/v1/models` discovery when exposed; gracefully handle server with only one model.
- [ ] Add mock-server tests for success, HTTP error, disconnect, malformed response.
- **Accept:** can get a reply from a compatible server; mock tests confirm failure paths.

### T003 — Streaming and Q&A conversation
- [ ] Parse SSE streaming incrementally, including `[DONE]`, partial UTF-8 and split event boundaries.
- [ ] Implement `/Q&A` (and Q&A default startup), conversation history, `/clear`, cancellation/interrupt and follow-up questions.
- [ ] Distinguish one-shot `/Q&A <question>` from entered mode; do not inject project docs/skills/tools.
- [ ] Handle interrupted streams without corrupting history.
- **Accept:** response streams without duplicated/missing text; `/clear` removes conversational history; no tool calls or file edits.

### T004 — Rich terminal renderer
- [ ] Style headings, emphasis, quotes, lists, links, tables and inline code as rendered terminal content, not raw Markdown delimiters.
- [ ] Render fenced code without fences; preserve indentation, optional syntax highlighting and safe ANSI handling.
- [ ] Render common inline/display math as legible Unicode; define truthful fallback for unsupported LaTeX.
- [ ] Support streaming Markdown with buffering for incomplete blocks, wrapping and terminal resize.
- [ ] Add snapshot/golden tests with split streams, nested lists, tables, LaTeX and narrow terminals.
- **Accept:** `# Heading` displays as styled heading; no raw fences for valid blocks; no lost/duplicated text; math never silently changes meaning.

### T005 — Metrics and context telemetry
- [ ] Capture latency, TTFT, completion count and speed; prefer provider token timings when available.
- [ ] Distinguish prompt/output tokens, wall-clock throughput vs generation-only throughput, and source (reported/estimated/unavailable).
- [ ] Display current used/budget/server limit if known; avoid claiming exact tokenizer counts from estimates.
- [ ] Add `/stats` and optional concise per-answer footer.
- **Accept:** metric calculations tested with synthetic streams; unknown measurements show N/A, never invented values.

### T006 — Themes and visual identity
- [ ] Dark, light and auto modes with one discreet accent, terminal-capability-aware colors.
- [ ] Add `/theme` and graceful fallback for monochrome/no-color terminals.
- [ ] Validate contrast, text wrapping and Windows/Linux ANSI behavior where available.
- **Accept:** all themes readable; no permanent modification of host-terminal theme.

### T007 — Model selection
- [ ] Add `/model` listing from provider discovery and active-model display.
- [ ] Support selection only when advertised/supported; offer endpoint configuration if single-model server.
- [ ] On model switch, offer clear vs keep history; default new conversation for unbiased comparison.
- **Accept:** unsupported model switch cannot silently succeed; model ID is truthful.

### T008 — Reasoning control
- [ ] Add `/reasoning auto|on|off` and capability-aware interpretation for backend/model.
- [ ] Keep reasoning-generation control distinct from hiding/displaying reasoning content.
- [ ] Report unsupported/unknown control honestly rather than claiming OFF.
- **Accept:** tests cover supported, unsupported, unknown capability and no-leak final-answer formatting.

### T009 — Context budget management
- [ ] Add `/context` viewer and set session budget within confirmed server limits.
- [ ] Reserve output tokens; prevent silent truncation; warn on overflow and offer `/clear`.
- [ ] Explain server `--ctx-size` may require restart/reload; no claim of dynamically changing server context.
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
