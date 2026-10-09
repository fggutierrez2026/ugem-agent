# Architecture Decision Records — μgem agent

Each decision below is accepted unless otherwise marked. Keep ADRs brief; add new entries when a design change materially affects the project.

## ADR-001 — Node.js-only runtime
**Decision:** μgem itself requires Node.js >=20, supporting Windows and Linux. It does not require Python or uv. User projects may of course use their own language/runtime. **Why:** portable minimalist CLI.

## ADR-002 — One runtime, mode-specific commands
**Decision:** single inference/runtime core with `/Q&A`, `/plan`, `/debug`, and future `/build` workflows; no requirement for subagents or LangGraph. **Why:** small-model suitability, low complexity, predictable boundaries.

## ADR-003 — Staged releases
**Decision:** v0.1 `/Q&A`, v0.2 `/plan`, v0.3 `/debug`; `/build` deferred, no release number assigned. **Why:** incremental MVP with reusable terminal, provider and context infrastructure. `/build` remains a documented future contract.

## ADR-004 — Compatible inference protocol
**Decision:** default llama.cpp, OpenAI-compatible chat completions/SSE; optional backend capabilities detected, not assumed. **Why:** support different local models and servers without coupling to one inference backend.

## ADR-005 — Rich minimal terminal
**Decision:** rendered Markdown/code and legible LaTeX with safe fallback; themes light/dark/auto, compact stats. **Why:** readable model output and distinctive but restrained identity. Maintain raw response separate from rendered display.

## ADR-006 — Q&A isolation
**Decision:** Q&A never loads `AGENTS.md`, project state, tools, skills, MCP or coding workflows; no project writes. **Why:** allows unbiased comparison and evaluation of loaded LLMs.

## ADR-007 — Hierarchical external context (future)
**Decision:** stable IDs, compact JSON tree, references and on-demand phase-specific Context Compiler; current-state Memory Manager with logs and Git outside prompt. **Why:** small models have limited useful context and cannot retain the entire project.

## ADR-008 — Planning and execution separation (future)
**Decision:** `/plan` plans and updates metadata, `/build` executes approved tasks. `/build` without arguments displays status and asks; code edits require explicit work selection. **Why:** human control and traceability.

## ADR-009 — Tasks/subtasks/revisions (future)
**Decision:** `T###` task, `T###.n` optional subtask, `R###` revision with `revises`; preserve completed task evidence. Technical completion separate from user acceptance. **Why:** incremental project evolution without rewriting history.

## ADR-010 — Issues and diagnostic-only mode (future)
**Decision:** `I###` issue records; `/debug` accepts pasted logs or natural language, distinguishes environment errors from code defects, proposes rather than unilaterally applies changes. **Why:** diagnosis must precede modification.

## ADR-011 — Evidence and permissions
**Decision:** automated test reports and real tool results determine verification; bounded retries. Approval required for installation, destructive/system changes and unapproved scope; no silent context truncation. **Why:** reliability and safety.
