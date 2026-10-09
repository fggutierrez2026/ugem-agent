# CLI Command Contracts

## v0.1 (implemented progressively per PLAN.md)
| Command | Meaning |
|---|---|
| `/Q&A` | Enter chat mode; Q&A also starts by default |
| `/Q&A <question>` | Ask and remain in Q&A mode |
| `/clear` | Clear chat history, retain global settings |
| `/settings` | Interactive settings menu |
| `/theme [dark\|light\|auto]` | Show/select palette |
| `/model [id]` | Show provider model(s); select only when supported |
| `/reasoning [auto\|on\|off]` | Change requested reasoning mode, capability-aware |
| `/context [tokens]` | Show/set local session context budget within server limit |
| `/stats [on\|off]` | Show metrics / toggle footer |
| `/help` | List commands |
| `/exit` | Exit cleanly |

An empty `/theme`, `/model`, `/reasoning`, `/context` or `/settings` opens a compact chooser/status rather than changing a value. Human input not recognized as a command goes to the active Q&A session. Unsupported options return clear instructions. Commands are case-insensitive only where unambiguous (e.g. `/Q&A` alias `/q&a`).

## v0.2 `/plan` (future)
- `/plan` → current plan + review/edit choices; no code edits.
- `/plan <request>` → Planning → Research → Design & Tasks; question user when necessary; generate/update compact plan and wait for approval.
- Requests can create task, optionally subtasks, or an R### revision after completed work; preserve stable IDs.

## v0.3 `/debug` (future)
- `/debug` → issues/status and new issue action.
- `/debug <traceback or symptom>` → capture/report, inspect with safe tools, diagnose, classify; propose guidance or approved revision through `/plan`.
- Error in another terminal can be pasted or described. Do not assume execution environment is identical. Avoid creating R### for every missing dependency or user-reported symptom.

## `/build` (future release TBD)
- `/build` → show plan status/progress and ask user what to execute; **never automatically executes**.
- `/build next` or `/build completa la siguiente tarea` → next eligible leaf task.
- `/build T001`, `/build completa la tarea T001` → named work item.
- `/build T001.1` → subtask; `/build R001` → revision.
- `/build T001` where it is a parent with children → execute eligible subtree, subject to approval and dependencies.
- `/build all` → remaining approved tasks in dependency order; bounded retries and stop on blockers.
- Never bypass dependency checks or unapproved installations/destructive operations.

## User experience
Menus are implemented in deterministic Node.js, not by repeatedly asking the LLM. Avoid large modal UIs, invented progress, and unrequested modifications. Display clear distinction between pending technical work and user review.
