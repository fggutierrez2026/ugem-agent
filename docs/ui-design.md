# TUI Design — Minimal Scientific Terminal

## Identity
Distinctive but restrained: terminal-native typography, one accent color, subtle dividers, generous but compact spacing; no emoji or persistent side panels. Respect user's terminal font, widths, theme; no global terminal reconfiguration. Clear/light/dark/auto palettes, high contrast and no-color fallback.

## Example (illustrative values)
```text
μgem  /  Q&A
qwen3.5-9b · llama.cpp                         dark · reasoning auto
────────────────────────────────────────────────────
› Explain attention.

  Attention in Transformers

  The attention mechanism weights relevant tokens.

  Main components
  1. Query
  2. Key
  3. Value

────────────────────────────────────────────────────
187 tokens · 28.6 tok/s · 6.5 s · ctx 1284/16384
›
```
Labels and numbers are illustrative; real UI must not fabricate runtime metrics.

## Rendering
- Source model emits Markdown and common LaTeX; render presentation separately. `# Title` must appear as a styled heading; `**strong**` bold; lists and tables laid out responsively; triple backtick fences hidden while code preserved.
- Highlight code safely; preserve whitespace and copyable raw message separately. Escape untrusted ANSI/control sequences from model output.
- For math: Unicode layout for supported formulae and faithful readable fallback for complex TeX. Terminal cannot guarantee fully typeset arbitrary math.
- For streaming: accumulate partial SSE bytes, parse token stream, preserve incomplete Markdown/code/math blocks until stable. Avoid repainting whole terminal per token. No loss/duplication on arbitrary chunk splits.

## Metrics footer
Prefer `output tokens · generation tok/s · wall time · context used/budget` plus optional diagnostics (TTFT, input tokens, metric source). Clearly distinguish backend reported, measured estimates and unavailable; context occupancy may be estimated and server context limit may be unknown.

## Settings
`/settings` lists Appearance, Model, Reasoning, Context budget, Metrics and Streaming. One level of menu. `/theme`, `/model`, `/reasoning`, `/context` are shortcuts. Backend model routing and reasoning controls shown only when supported; never claim a hide/show toggle disables actual model computation.

## Behavior and accessibility
- Responsive wrap on terminal width changes, sensible 80-column design, text-only fallback on missing ANSI features.
- Graceful Ctrl+C and cancel (no broken input prompt or partial garbage).
- Redact credentials; commands/help available without LLM or server.
- Theme state global, session history separate, no project-state mutations in Q&A.
