# Architecture — μgem agent

## Structural principle
One minimal Node.js 20+ runtime and mode-specific workflows rather than heavyweight agents. Commands route into workflows; inference, TUI, settings and telemetry are reusable. v0.1 builds only shared primitives needed for `/Q&A`.

```text
Terminal UI → Command Router → Mode Handler
                             └─ Q&A Session → Provider Adapter → llama.cpp / compatible server
                      Renderer ← response events → Metrics Collector
                      Settings Store (global user preferences)

Future: /plan  → Planning → Research → Design & Tasks ─┐
        /debug → Capture → Diagnose → Classify ───────┼→ Context Tree / Issue & Revision stores
        /build → Implement → Test → Fix → Verify ─────┘
                             ↑ Context Compiler / Memory Manager
```

## v0.1 components
- **CLI & Router:** parse local commands deterministically; default free text goes to Q&A. `/Q&A` never enables tools.
- **Provider Adapter:** JSON request/response + SSE streaming; capability discovery; compatible with OpenAI-like endpoints, default llama.cpp.
- **Local Server Lifecycle:** optionally reuse the adjacent preset launcher, probe health, own one child process and shut down only that child; model/reasoning-mode changes restart only the owned process, while per-request reasoning-budget changes do not reload it and external endpoints remain unmanaged.
- **Conversation:** message history, clear, cancellation, budget check, keep/cancel failed turns deterministically.
- **Renderer:** streaming Markdown state, code blocks, math fallbacks, ANSI themes, terminal resize and no-color fallback.
- **Metrics:** usage from server when available, otherwise explicitly labeled estimates; distinguish TTFT, wall time, generation throughput, retained conversation context and the generation peak that includes hidden reasoning.
- **Settings:** sparse, versioned OS-local preferences with atomic replacement, allowlisted validation, legacy migration and safe fallback; environment variables override persisted values and plaintext secrets are never accepted.

## Provider capability negotiation
Do **not** assume `/v1/models` implies multiple models loadable. Model selection, reasoning controls, server context introspection and token-timing fields are optional per backend/build. Features need advertised/verified support and graceful fallback. External llama.cpp reasoning control is verified without inference by comparing `/apply-template` output with `enable_thinking` disabled and enabled; all other undiscoverable controls remain unknown. Reasoning generation is separate from response parsing/display, which retains final content only. The managed llama.cpp path supports 1,024/2,048/4,096-token reasoning budgets through `reasoning_budget_tokens`; `max_tokens` covers that budget plus the separate final-output reserve. A client conversation budget is accepted only beneath a confirmed server maximum. It reserves both completion portions and prevents sending estimated-overflow requests without silently evicting history. It does not modify `llama-server --ctx-size`; changing the server limit may require a model reload or process restart.

## Separation of contexts
- v0.1 Q&A: minimal system instruction (optional), session messages and prompt only; no project docs, skills, MCP, tool schemas or project memory.
- Future `/plan`/`/build`/`/debug`: project snapshot L0 → task/reference index L1 → relevant code/evidence L2, selected by Context Compiler and constrained by tokenizer budget.
- Distinguish evidence obtained from files/tests/tools from model-generated hypotheses; retain original artifacts outside prompt.

## Future command boundaries
- `/plan`: analysis/research/design and plan metadata only; no application-code edits.
- `/debug`: issue diagnosis and suggested actions; no unapproved code edits; may return to `/plan` for revisions.
- `/build`: executes approved work items with safe command permissions, tests, bounded retries and verified completion. `/build` empty = interactive status/menu.

## Project layout (target v0.1)
```text
ugem-agent/
  AGENTS.md  MEMORY.md  PLAN.md
  docs/
  src/
    cli/         # CLI, routing, theme
    providers/   # openai-compatible client
    session/     # chat history / budget
    renderer/    # Markdown, stream, math, code
    metrics/     # inference telemetry
    settings/    # config + validation
    index.js
  tests/
  package.json
```
All `src/` and tests are planned, not created by this documentation package.
