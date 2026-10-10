# CLI Command Contracts

## v0.1 (implemented progressively per PLAN.md)
| Command | Meaning |
|---|---|
| `/Q&A` | Enter chat mode; Q&A also starts by default |
| `/Q&A <question>` | Ask and remain in Q&A mode |
| `/clear` | Clear chat history, retain global settings |
| `/settings` | Interactive settings menu |
| `/theme [classic\|ocean\|forest\|violet\|mono]` | Show/select the session UI palette |
| `/models [id] [auto\|on\|off]` | List/select managed local presets and optional reasoning mode; `/model` is an alias |
| `/reasoning [auto\|on\|off]` | Change requested reasoning mode, capability-aware |
| `/context [tokens]` | Show/set local session context budget within server limit |
| `/code-color [auto\|blue\|cyan\|green\|magenta\|red\|white\|yellow]` | Show/select fenced-code text color for this session |
| `/stats [on\|off]` | Show metrics / toggle footer |
| `/help` | List commands |
| `/exit` | Exit cleanly |

An empty `/theme`, `/models`, `/reasoning`, `/context` or `/settings` opens a compact chooser/status rather than changing a value. Human input not recognized as a command goes to the active Q&A session. Unsupported options return clear instructions. Commands are case-insensitive only where unambiguous (e.g. `/Q&A` alias `/q&a`).

When the configured endpoint is local and unavailable, μgem can start the adjacent `apps/llama-server.bash` launcher, wait for `/health`, and stop only the process it owns. It defaults to `gemma4-e4b`; `UGEM_LLAMA_PRESET` (or a non-default `UGEM_MODEL`) selects another preset, `UGEM_AUTO_START=0` disables autostart, and `UGEM_LLAMA_LAUNCHER`, `UGEM_LLAMA_PRESETS` and `UGEM_LLAMA_START_TIMEOUT_MS` override discovery. `/models qwen3.5-4b off` selects a preset and its reasoning mode in one operation; `/reasoning off` changes the mode for the active preset. Either change restarts the owned server when necessary and clears conversation history. External healthy servers are never stopped or replaced.

μgem waits for local model startup without printing a static loading panel, then shows the ready panel. The default `classic` palette uses blue/green instead of turquoise/purple; `ocean`, `forest`, `violet` and `mono` are selectable with `/theme` for the current session, or initially through `UGEM_THEME`. `NO_COLOR` still disables ANSI styling. With `/stats on`, each answer is separated from a framed multiline block showing reasoning mode, output tokens, generation speed, wall time and used/available/total context. A warning is emitted once when retained estimated context reaches 90%, even when the footer is off; `/clear` resets it. Fenced Markdown code renders in a width-aware box with its language in the title. `/code-color` changes only its display color; the raw assistant message remains unchanged.

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
