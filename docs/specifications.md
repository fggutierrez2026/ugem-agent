# Product Specifications — μgem agent

## Vision and scope
Minimalist terminal assistant for local/open-weight LLMs; eventual coding workflows use deliberate planning, researched API use, small actionable tasks, tools and evidence-backed verification. Runtime Node.js >=20; works on Windows and Linux. Default provider: `llama.cpp` via OpenAI-compatible chat-completions endpoint. Other compatible endpoints should work within detected capabilities. No Python dependency for μgem.

## Version boundaries
- **v0.1 `/Q&A`**: *only* question/answer conversation and terminal UX; no tools, skills, project read/write, MCP, planning or build tasks during Q&A.
- **v0.2 `/plan`**: Planning → Research → Design & Tasks. Ask necessary clarification, inspect dependencies/docs using read-only capabilities, maintain compact spec/architecture/tasks; human approval before execution; no source edits.
- **v0.3 `/debug`**: Capture → Diagnose → Classify → Resolve (environment guidance) or propose Task Revision. Accept pasted stack traces or descriptions; correlate task/issue; ask approval to update plan; no unsolicited code edits.
- **Future `/build`**: Implement → Test → Fix → Verify; one selected task by default when explicitly requested, tasks/subtasks/revisions, bounded fix loop, evidence; version TBD. `/build` alone always shows status and asks user which action.

## v0.1 functional requirements
| ID | Requirement | Acceptance concept |
|---|---|---|
| QA-001 | Interactive CLI with default Q&A and explicit `/Q&A` | Typed prompt yields model reply; `/help` and `/exit` work |
| QA-002 | Configurable OpenAI-compatible provider | Handles errors; streams `POST /v1/chat/completions` |
| QA-003 | Session history, `/clear`, interrupt | Follow-ups use history; reset actually clears |
| QA-004 | Rich Markdown output | Headings/emphasis/lists/tables/links/code rendered; no raw markers for valid input |
| QA-005 | Legible math | Common LaTeX shown as Unicode/layout; truthful fallback for unsupported expressions |
| QA-006 | Metrics | prompt/output tokens if available, speed, latency, TTFT, context; reported vs estimate shown |
| QA-007 | Theme selection | dark/light/auto, persisted, never changes host terminal theme |
| QA-008 | Model selection | list actual provider models, no fake dynamic switching; clarify history on switch |
| QA-009 | Reasoning settings | auto/on/off *where supported*; generation control distinct from visibility |
| QA-010 | Context setting | session budget ≤ known server max, warn before overflow, reserve generation output |
| QA-011 | Settings menu and persistence | OS-local config, no plaintext secrets, robust invalid-config recovery |
| QA-012 | Streaming renderer robustness | fragmented SSE/Unicode/Markdown correctly reconstructed |

## v0.1 nonfunctional requirements
- Minimal, consistent TUI; no unnecessary panels or emoji; accessible contrast and plain-text fallback.
- Streams should be responsive with no content loss or duplicate chunks; cancel gracefully.
- Store only explicitly chosen settings by default; Q&A does not write project metadata or inject AGENTS.md.
- Secret values never logged. Network request timeouts, failure recovery, redaction of sensitive headers.
- Testing by mock endpoints and real local server where available; report untested OS/provider combinations.

## Planned v0.2 contracts
- `/plan <request>` produces approved/reviewable tasks with IDs, depends_on, files, acceptance, spec references.
- Flat tasks for simple projects; optional two-level subtasks for complexity. Split when tasks are too broad for limited context; avoid gratuitous splitting.
- Plan is incrementally editable; revisions `R###` relate to completed work through `revises`; revisions are **not** subtasks.
- No-argument `/plan` shows current plan/options; planning may write approved metadata under `.ugem/` but never application code.
- Hierarchical Context Tree, Context Compiler and Memory Manager; short JSON summaries, stable IDs, relevant branches by phase; evidence/logs outside context.

## Planned v0.3 contracts
- `/debug` accepts arbitrary traceback or natural-language symptom, or no arguments opens issue menu.
- Distinguish environment issue, reproduced code defect, behavior improvement, or design/spec change.
- Issues `I###` capture origin, summary, evidence and status; no one-to-one requirement with revisions.
- Code defects in finished tasks: propose `R###`, subject to approval; environment problems may need no revision.

## Future `/build` contracts (no committed release number)
- `/build` without arguments: status + prompt for selection; never edits.
- `/build next`, `/build T001`, `/build T001.1`, `/build R001`, `/build all`; natural-language equivalents parsed deterministically when possible.
- Verify dependencies before execution; parent aggregations complete only after all children + integration verification.
- User-acceptance status separate from technical completion. Never declare completion on model assertion alone.
- User approval required for dependency installation, destructive commands and changes beyond approved scope.
