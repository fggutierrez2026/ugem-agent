# μgem agent — Project Memory

## Status
- Target: **v0.1 MVP** (`/Q&A`).
- T001 is complete: npm metadata and the `ugem` entry point, modular `src/` skeleton, interactive input, `/help`, `/exit`, Ctrl+C handling, mockable I/O and native `node:test` coverage are present.
- T002 is complete: the compatible provider reads `UGEM_BASE_URL`, `UGEM_MODEL`, `UGEM_REQUEST_TIMEOUT_MS` and optional `UGEM_API_KEY`; handles non-streaming chat completions, typed network/timeout/HTTP/response errors, credential redaction, model discovery and single-model fallback.
- T003 is complete: incremental SSE streaming handles `[DONE]`, UTF-8 and arbitrary CR/LF boundaries; Q&A is the default with explicit `/Q&A`, one-shot questions, follow-up history, `/clear`, streamed terminal output and Ctrl+C cancellation with failed/partial turns rolled back.
- llama.cpp compatibility: streaming metadata chunks with `delta.content: null` are accepted and ignored; other non-string content values remain invalid.
- T004 is complete: the terminal renderer handles Markdown blocks/inlines, fenced code in responsive language-titled boxes, responsive tables/lists, safe ANSI stripping, dynamic wrapping and conservative Unicode math with explicit `⟦LaTeX: …⟧` fallback. `/code-color` selects the fenced-code text color for the current session; rendering preserves the raw assistant message in history.
- T005 is complete: per-answer telemetry captures measured latency/TTFT, input/output tokens, generation and wall-clock throughput, and context occupancy. Provider-reported OpenAI usage and llama.cpp timing/context fields take precedence; character-based fallback counts remain explicitly labeled `estimated`, while unavailable measurements render as `N/A`.
- `/stats` reports the latest completed answer and controls an optional multiline footer with `/stats on|off`. It shows reasoning mode, response tokens, generation speed, wall time, and used/available/total context. Context occupancy uses the retained visible answer rather than potentially hidden reasoning tokens and renders a proportional bar against a discovered server limit. Failed or cancelled turns do not replace the latest successful metrics.
- Incremental T006/T007/T008/T009 UI is present: bold/color-coded startup panel, framed status and metrics messages, Unicode context bars, local llama.cpp lifecycle, `/models` preset listing/selection, `/reasoning` for the managed server, and a one-time 90% context warning. Static model-loading and first-token panels were removed. `/theme` offers session-local `classic` (default blue/green), `ocean`, `forest`, `violet` and `mono` palettes with `NO_COLOR` fallback. Background-aware light/dark/auto modes, persistence, external-provider model switching/capability negotiation and preventive context budgeting remain pending.
- On Linux, μgem reuses `/media/fernando/AI_MODELS/apps/llama-server.bash`: it defaults to `gemma4-e4b`, honors `UGEM_LLAMA_PRESET`, reuses an existing healthy server, refuses to replace an external server, and stops only its owned child. `UGEM_AUTO_START=0` disables this behavior.
- Math compatibility: delimiter modifiers `\left`/`\right` are matched only before delimiters, so commands such as `\rightarrow` render correctly as `→` rather than being altered.
- Renderer compatibility: display-math fallback bypasses inline Markdown parsing so LaTeX remains faithful; common nested roots/fractions, set intersection/union and horizontal rules are rendered. Wrapped single-character stream splits have regression coverage.
- Minkowski/Mahalanobis notation: variable and transpose superscripts render as `ᵖ`/`ᵀ`; compound powers such as `1/p` use the explicit faithful form `^(1/p)`.
- Extended math coverage includes logarithmic, limit, trigonometric/inverse-trigonometric, set and calculus commands. Math-delimited expressions inside inline-code markers are normalized, while ordinary inline code remains code.
- Inline Markdown is processed recursively for emphasis and link labels, fixing model output such as `**$u$**`; code spans are protected before the final math pass so ordinary values such as `$PATH` remain code.
- No web math dependency was added: KaTeX targets HTML/CSS/fonts and MathJax targets HTML/SVG/MathML, so neither directly solves Unicode terminal rendering; the conservative internal renderer remains smaller and retains explicit fallback.
- Prior T004 verification ran on Linux with Node.js 24.21.0 and npm 11.19.0. Current verification passed lint, formatting and 75 tests (73 top-level) on Linux Node.js 18.19.1/npm 9.2.0; provider tests required local-port permission. Real llama.cpp verification covered silent startup followed by the ready panel, live `classic`/`forest`/`violet` palette switching, a yellow Python code box, stats separation, and Gemma → Qwen switching on an RTX 3060 with llama.cpp 0.6.0-dev build 1 (`d812350`). `/models qwen3.5-4b off` exposed its 65536-token context and returned the first short answer in 175 ms at a provider-reported 40.1 tok/s. A fresh run of these changes on supported Node.js 20+ and Windows remains unverified.
- Next step: complete `PLAN.md` task **T006** themes or T009 preventive budgeting.

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
- 2026-10-09: removed static model/generation loading panels and added session-selectable UI palettes with blue/green `classic` as the default.
