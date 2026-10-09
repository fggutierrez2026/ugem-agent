# μgem agent — Project Memory

## Status
- Target: **v0.1 MVP** (`/Q&A`); implementation not started in this documentation bundle.
- Current focus: establish Node.js CLI, llama.cpp-compatible streaming, rich terminal presentation, metrics and settings.
- Next step: `PLAN.md` task **T001**.

## Agreed architecture
- Minimalist Node.js 20+ runtime for Windows/Linux; default OpenAI-compatible local server (`llama.cpp`).
- Product modes: `/Q&A` v0.1, `/plan` v0.2, `/debug` v0.3; `/build` planned subsequently, version **not assigned**.
- `/plan`: Planning → Research → Design & Tasks; `/build`: Implement → Test → Fix → Verify.
- Tasks `T###`, optional subtasks `T###.n`, revisions `R###` with `revises`, issues `I###` and evidence-based verification.
- Future context: hierarchical JSON tree + Context Compiler + Memory Manager; avoid flooding small-model context.
- `/Q&A`: isolated, no project context/tools; native streaming, formatted Markdown, legible math, context and speed metrics, themes, model selector and capability-aware reasoning control.

## Guardrails
- Never state unsupported provider features are available; server context and local session budget differ.
- Require approval for installations and destructive actions; do not automatically change project code in `/debug` or `/plan`.
- Persist implementation evidence and report unverified behavior.

## Known unknowns
- Exact llama.cpp model-routing/reasoning feature availability varies by build, model and server configuration: capability-detect and degrade gracefully.
- Native terminal math rendering fidelity varies by terminal; implement legible fallback.
- Choose rendering libraries only after checking their current Node.js compatibility and maintenance.

## Last documentation change
- 2026-10-09: initial consolidated design and v0.1 checklist created. No source code or tests produced in this step.
