# μgem agent — Project Memory

## Status
- Target: **v0.1 MVP** (`/Q&A`).
- T001 is complete: npm metadata and the `ugem` entry point, modular `src/` skeleton, interactive input, `/help`, `/exit`, Ctrl+C handling, mockable I/O and native `node:test` coverage are present.
- T002 is complete: the compatible provider reads `UGEM_BASE_URL`, `UGEM_MODEL`, `UGEM_REQUEST_TIMEOUT_MS` and optional `UGEM_API_KEY`; handles non-streaming chat completions, typed network/timeout/HTTP/response errors, credential redaction, model discovery and single-model fallback.
- T003 is complete: incremental SSE streaming handles `[DONE]`, UTF-8 and arbitrary CR/LF boundaries; Q&A is the default with explicit `/Q&A`, one-shot questions, follow-up history, `/clear`, streamed terminal output and Ctrl+C cancellation with failed/partial turns rolled back.
- llama.cpp compatibility: streaming metadata chunks with `delta.content: null` are accepted and ignored; other non-string content values remain invalid.
- T004 is complete: the terminal renderer handles Markdown blocks/inlines, fenced code, responsive tables/lists, safe ANSI stripping, dynamic wrapping and conservative Unicode math with explicit `⟦LaTeX: …⟧` fallback. Streaming buffers incomplete lines/blocks and preserves the raw assistant message in session history.
- Math compatibility: delimiter modifiers `\left`/`\right` are matched only before delimiters, so commands such as `\rightarrow` render correctly as `→` rather than being altered.
- Renderer compatibility: display-math fallback bypasses inline Markdown parsing so LaTeX remains faithful; common nested roots/fractions, set intersection/union and horizontal rules are rendered. Wrapped single-character stream splits have regression coverage.
- Minkowski/Mahalanobis notation: variable and transpose superscripts render as `ᵖ`/`ᵀ`; compound powers such as `1/p` use the explicit faithful form `^(1/p)`.
- Extended math coverage includes logarithmic, limit, trigonometric/inverse-trigonometric, set and calculus commands. Math-delimited expressions inside inline-code markers are normalized, while ordinary inline code remains code.
- Inline Markdown is processed recursively for emphasis and link labels, fixing model output such as `**$u$**`; code spans are protected before the final math pass so ordinary values such as `$PATH` remain code.
- No web math dependency was added: KaTeX targets HTML/CSS/fonts and MathJax targets HTML/SVG/MathML, so neither directly solves Unicode terminal rendering; the conservative internal renderer remains smaller and retains explicit fallback.
- Verified on Linux with Node.js 24.21.0 and npm 11.19.0: `npm run check` passed with 47 tests, including golden output at 40/80/120 columns, arbitrary stream splits, nested inline Markdown and expanded math regressions. Tests that bind a local port require network permission in the current sandbox. Windows and manual verification of the latest renderer fixes against a real `llama.cpp` response remain unverified.
- Next step: `PLAN.md` task **T005**.

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
- 2026-10-09: fixed nested inline Markdown so emphasized/linked/code-wrapped LaTeX is rendered without exposing delimiters.
