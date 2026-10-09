# μgem agent — Project Memory

## Status
- Target: **v0.1 MVP** (`/Q&A`).
- T001 is complete: npm metadata and the `ugem` entry point, modular `src/` skeleton, interactive input, `/help`, `/exit`, Ctrl+C handling, mockable I/O and native `node:test` coverage are present.
- T002 is complete: the compatible provider reads `UGEM_BASE_URL`, `UGEM_MODEL`, `UGEM_REQUEST_TIMEOUT_MS` and optional `UGEM_API_KEY`; handles non-streaming chat completions, typed network/timeout/HTTP/response errors, credential redaction, model discovery and single-model fallback.
- T003 is complete: incremental SSE streaming handles `[DONE]`, UTF-8 and arbitrary CR/LF boundaries; Q&A is the default with explicit `/Q&A`, one-shot questions, follow-up history, `/clear`, streamed terminal output and Ctrl+C cancellation with failed/partial turns rolled back.
- llama.cpp compatibility: streaming metadata chunks with `delta.content: null` are accepted and ignored; other non-string content values remain invalid.
- Verified on Linux with Node.js 24.21.0 and npm 11.19.0: `npm run check` passed with 27 tests, including local mock HTTP/SSE success, interruption and malformed-stream paths. Tests that bind a local port require network permission in the current sandbox. Windows and a real `llama.cpp` server remain unverified.
- Next step: `PLAN.md` task **T004**.

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
- 2026-10-09: verified the T003 regression fix for llama.cpp streaming chunks whose `delta.content` is `null`.
