# μgem agent — Agent Instructions

## Mission
Build a minimalist, extensible terminal coding assistant, inspired by Pi Agent and OpenCode, optimized for small local LLMs (e.g., Qwen 3.5 9B and Gemma 4). **Current development target: v0.1 `/Q&A` only.**

## Runtime and constraints
- Node.js 20+ only for μgem itself; Windows and Linux terminals. No Python requirement for μgem (user projects may use Python).
- OpenAI-compatible `POST /v1/chat/completions`, default `llama.cpp`; streaming supported. Do not assume every backend supports multi-model routing, reasoning toggles, or exact usage metrics.
- Minimal dependencies, small modules, explicit interfaces, no heavy orchestration framework by default.
- Ask before installing software/dependencies, executing destructive operations, touching OS files, or actions likely to fill disk. Keep workspace modifications scoped and authorized.
- Never claim tests, rendering, API checks, or benchmarks succeeded unless actually executed.

## Development workflow
1. Read this file and `MEMORY.md`; inspect the relevant section of `PLAN.md`.
2. Implement **one checkbox-sized task** at a time unless specifically asked otherwise.
3. Follow Implement → Test → Fix → Verify with a bounded number of corrections.
4. Update only relevant checkbox(es) in `PLAN.md` after verified completion; update `MEMORY.md` with concise state and decisions.
5. Make coherent, focused commits using Conventional Commits where appropriate; do not commit without instruction.
6. For uncertain or changing APIs, inspect installed package versions and consult documentation rather than inventing methods.

## Modes — product roadmap, not all implemented
- **v0.1 `/Q&A`:** chat-only, no tools, skills, repo context, planning, coding, file writes or project-memory updates during Q&A conversation. Terminal streaming, rich rendering, stats and configuration.
- **v0.2 `/plan`:** Planning → Research → Design & Tasks; produces reviewable plan and requirements; no application-code edits.
- **v0.3 `/debug`:** Capture → Diagnose → Classify → Resolve/propose revision; no unsolicited code writes. May create an issue/revision after approval.
- **`/build`: future release TBD** (do not infer v0.3 or implement in v0.1): Implement → Test → Fix → Verify for approved tasks and revisions. `/build` without arguments only shows plan/status and asks what to do.

## Canonical documentation
- `docs/README.md`: document map and current scope.
- `docs/specifications.md`: requirements by release.
- `docs/architecture.md`: components, phase contracts and boundaries.
- `docs/data-model.md`: hierarchical context, task, revision and issue schemas (future).
- `docs/commands.md`: CLI behavior.
- `docs/ui-design.md`: TUI rendering and experience.
- `docs/adr.md`: decisions and reasons.
- `docs/verification.md`: acceptance and test strategy.
- `PLAN.md`: only actionable **v0.1** development tasks, with checkboxes.
- `MEMORY.md`: short operational snapshot, not a full changelog.

## Context discipline
For future coding workflows use compact hierarchical JSON with stable IDs and references; compile per-task context on demand. Treat tests/logs/Git as evidence outside of the LLM context. Do not silently truncate conversation. `AGENTS.md` is for development agents; `/Q&A` must **not** inject it into model prompts.
