# TUI Design — Minimal Scientific Terminal

## Identity
Distinctive but restrained: terminal-native typography, a small coordinated palette, subtle dividers, generous but compact spacing; no emoji or persistent side panels. Respect the user's terminal font, width and background; no global terminal reconfiguration. Current session palettes are `classic`, `ocean`, `forest`, `violet` and `mono`, with `NO_COLOR` fallback. Background-aware light/dark/auto selection remains planned.

## Example (illustrative values)
```text
┌──────────────────────────────────────────────────────────────┐
│ μgem agent  /  Q&A                                          │
│ model      gemma4-e4b (provider, ready)                      │
│ reasoning  auto                                              │
│ context    1,284 used · 15,100 available · 16,384 total      │
│            [██░░░░░░░░░░░░░░░░░░░░░░] 7.8%                  │
└─────────────────────────────────────────────────────────────┘
you › Explain attention.
μgem ›

  Attention in Transformers

  The attention mechanism weights relevant tokens.

  Main components
  1. Query
  2. Key
  3. Value

┌─ stats ───────────────────────────────────────────────────────┐
│ mode       reasoning auto                                    │
│ response   187 output tok (reported)                         │
│ speed      28.6 tok/s (reported) · 6.5 s wall                │
│ context    [██░░░░░░░░░░░░░░░░░░░░░░░░░░] 7.8%              │
│            1,284 used · 15,100 available · 16,384 total      │
└──────────────────────────────────────────────────────────────┘
you ›
```
Labels and numbers are illustrative; real UI must not fabricate runtime metrics.

## Rendering
- Source model emits Markdown and common LaTeX; render presentation separately. `# Title` must appear as a styled heading; `**strong**` bold; lists and tables laid out responsively; triple backtick fences hidden while code preserved.
- Render fenced code in a responsive box with the language in its title and a session-selectable text color; preserve whitespace and the raw message separately. Escape untrusted ANSI/control sequences from model output.
- For math: Unicode layout for supported formulae and faithful readable fallback for complex TeX. Terminal cannot guarantee fully typeset arbitrary math.
- For streaming: accumulate partial SSE bytes, parse token stream, preserve incomplete Markdown/code/math blocks until stable. Avoid repainting whole terminal per token. No loss/duplication on arbitrary chunk splits.

## Metrics footer
Prefer a compact multiline block containing reasoning mode, output tokens, generation tok/s, wall time, context bar and explicit used/available/total values. Clearly distinguish backend reported, measured estimates and unavailable; context occupancy uses retained visible conversation content and remains labeled estimated, while the server limit may be unknown. Warn once at 90% usage and reset that warning when the session is cleared.

Status changes use compact framed panels, but model startup and generation do not show static pseudo-progress panels. Context bars use proportional `█`/`░` blocks and switch to warning/error colors as occupancy increases. The selected palette coordinates prompts, identity, borders, labels, values and metrics; all ANSI styling is removed under `NO_COLOR`.

## Settings
`/settings` lists Appearance, Model, Reasoning, Context budget, Metrics and Streaming. One level of menu. `/theme`, `/model`, `/reasoning`, `/context` and `/code-color` are shortcuts. Backend model routing and reasoning controls shown only when supported; never claim a hide/show toggle disables actual model computation.

## Behavior and accessibility
- Responsive wrap on terminal width changes, sensible 80-column design, text-only fallback on missing ANSI features.
- Graceful Ctrl+C and cancel (no broken input prompt or partial garbage).
- Redact credentials; commands/help available without LLM or server.
- Theme state global, session history separate, no project-state mutations in Q&A.
