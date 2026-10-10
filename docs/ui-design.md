# TUI Design — Minimal Scientific Terminal

## Identity
Distinctive but restrained: terminal-native typography, a small coordinated palette, subtle dividers, generous but compact spacing; no emoji or persistent side panels. Respect the user's terminal font, width and background; no global terminal reconfiguration. Session palettes are `classic`, `ocean`, `forest`, `violet` and `mono`, with `auto`, `dark` and `light` background modes plus `NO_COLOR` fallback. Auto detection uses environment hints and reports the resolved mode instead of pretending detection is certain.

## Example (illustrative values)
```text
┌──────────────────────────────────────────────────────────────┐
│ μgem agent  /  Q&A                                          │
│ model      gemma4-e4b (provider, ready)                      │
│ reasoning  auto/high (4,096 tok)                             │
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
│ peak       [███░░░░░░░░░░░░░░░░░░░░░░░░░] 10.2%             │
│            1,671 used · 14,713 available · 16,384 total      │
│ budget     4,096 reasoning + 4,096 final tok                 │
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
Prefer a compact multiline block containing reasoning mode/level, output tokens, generation tok/s, wall time, retained context, generation peak and the split reasoning/final completion budget. The per-answer block is enabled by default and `/stats off` hides it for the current session. Clearly distinguish backend reported, measured estimates and unavailable. Retained occupancy estimates the visible content kept for the next turn; generation peak uses reported prompt plus all completion tokens, including hidden reasoning, when the provider supplies usage. The server limit may be unknown. Warn once when retained usage reaches 90% and reset that warning when the session is cleared. `/context` additionally shows the validated session/server limits, both reserves and estimated input room. Overflow and provider-reported output truncation use framed warnings and offer `/clear`; history is never silently removed to make a request fit.

The reasoning row describes the generation request, not whether a hidden trace is displayed. `/reasoning` separately reports requested mode, managed-server token level, verified control capability and the final-answer-only display policy. Managed levels are `low` (1,024), `medium` (2,048) and `high` (4,096 reasoning tokens). `auto` means provider/model default; unsupported or undiscoverable controls remain explicitly `unsupported` or `unknown`.

Status changes use compact framed panels, but model startup and generation do not show static pseudo-progress panels. Context bars use proportional `█`/`░` blocks and switch to warning/error colors as occupancy increases. The selected palette coordinates prompts, identity, borders, labels, values and metrics; all ANSI styling is removed under `NO_COLOR`.

## Settings
`/settings` lists Appearance, Model, Reasoning, Context budget, Metrics and Streaming. One level of menu. `/theme`, `/model`, `/reasoning`, `/context` and `/code-color` are shortcuts. `/theme` reports requested and resolved background modes (for example, `auto → light`). `/models` distinguishes μgem-managed presets from provider-advertised request IDs and asks `clear` or `keep` before changing a non-empty conversation. A provider-advertised selection changes the request ID without claiming that the backend dynamically loaded a model. Backend model routing and reasoning controls are shown only when verified; unsupported and unknown capabilities remain explicit. Final-answer-only display is not presented as a generation toggle.

## Behavior and accessibility
- Responsive wrap on terminal width changes, sensible 80-column design, bright accents on dark backgrounds, darker accents on light backgrounds, and text-only fallback on missing ANSI features.
- Graceful Ctrl+C and cancel (no broken input prompt or partial garbage).
- Redact credentials; commands/help available without LLM or server.
- Theme state global, session history separate, no project-state mutations in Q&A.
