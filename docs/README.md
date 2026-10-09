# μgem agent — Documentation Map

## Release sequence
1. **v0.1:** `/Q&A` — first executable MVP; minimal terminal conversation, display, inference settings and telemetry.
2. **v0.2:** `/plan` — planning, research and design/tasks; future milestone.
3. **v0.3:** `/debug` — capture and diagnose reported issues; future milestone.
4. **Future version TBD:** `/build` — execute approved plan tasks and revisions. Intentionally not assigned v0.3.

## Documents
| File | Purpose |
|---|---|
| `specifications.md` | Functional/nonfunctional requirements, version boundaries |
| `architecture.md` | Shared core, modes, workflows and responsibilities |
| `data-model.md` | Compact hierarchical JSON contracts, references and lifecycles |
| `commands.md` | CLI syntax and interactive behavior |
| `ui-design.md` | Distinctive lightweight TUI, Markdown/math, settings, metrics |
| `adr.md` | Architectural decisions and tradeoffs |
| `verification.md` | Test and acceptance strategy |
| `../AGENTS.md` | Instructions for coding agents |
| `../MEMORY.md` | Current operational memory |
| `../PLAN.md` | Actionable checklist **only up to v0.1** |

## Source-of-truth order
Explicit user requirements and approved changes > `specifications.md` > approved plan state > implementation. `AGENTS.md` governs contributor agents, not user-facing Q&A prompts. Updating a release contract requires updating the relevant docs and recording the decision.
