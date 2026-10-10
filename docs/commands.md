# CLI Command Contracts

## v0.1 (implemented progressively per PLAN.md)
| Command | Meaning |
|---|---|
| `/Q&A` | Enter chat mode; Q&A also starts by default |
| `/Q&A <question>` | Ask and remain in Q&A mode |
| `/clear` | Clear chat history and its latest metrics; retain global settings |
| `/settings` | Interactive settings menu |
| `/theme [auto\|dark\|light] [classic\|ocean\|forest\|violet\|mono]` | Show/select background mode and session UI palette; either argument may be used alone |
| `/models [id] [auto\|on\|off\|low\|medium\|high] [clear\|keep]` | List/select a managed preset or provider-advertised request model; `/model` is an alias |
| `/reasoning [auto\|on\|off\|low\|medium\|high]` | Change requested reasoning mode or managed-server token level |
| `/context [tokens\|auto]` | Show/set a validated local session context budget; `auto` follows the server limit |
| `/code-color [auto\|blue\|cyan\|green\|magenta\|red\|white\|yellow]` | Show/select fenced-code text color for this session |
| `/stats [on\|off]` | Show metrics / toggle the per-answer footer, enabled by default |
| `/help` | List commands |
| `/exit` | Exit cleanly |

An empty `/theme`, `/models`, `/reasoning`, `/context` or `/settings` opens a compact chooser/status rather than changing a value. Human input not recognized as a command goes to the active Q&A session. Unsupported options return clear instructions. Commands are case-insensitive only where unambiguous (e.g. `/Q&A` alias `/q&a`).

When the configured endpoint is local and unavailable, μgem can start the adjacent `apps/llama-server.bash` launcher, wait for `/health`, and stop only the process it owns. It defaults to `gemma4-e4b`; `UGEM_LLAMA_PRESET` (or a non-default `UGEM_MODEL`) selects another preset, `UGEM_AUTO_START=0` disables autostart, and `UGEM_LLAMA_LAUNCHER`, `UGEM_LLAMA_PRESETS` and `UGEM_LLAMA_START_TIMEOUT_MS` override discovery. `/models qwen3.5-4b medium clear` selects a preset, a 2,048-token reasoning budget and a new conversation in one operation; `/reasoning off` disables reasoning for the active preset. External healthy servers are never stopped or replaced.

For an external endpoint, `/models` lists IDs returned by `/v1/models`. Selecting one changes the `model` field sent in later requests; it does not claim the model was loaded or that the backend supports dynamic loading. IDs absent from discovery are rejected without changing the active request model. If discovery is unavailable, μgem truthfully presents the configured single model and explains that `UGEM_BASE_URL` and `UGEM_MODEL` configure another endpoint before startup. When the current conversation is non-empty, a real model change requires an explicit `clear` or `keep`; without either, μgem shows both choices and makes no change.

`/reasoning` reports three separate facts: the requested generation mode, whether control is `supported`, `unsupported` or `unknown`, and the fixed final-answer-only display policy. On the managed llama.cpp server, `low`, `medium` and `high` enable reasoning with limits of 1,024, 2,048 and 4,096 tokens. `on` is a compatibility alias for `high`; `auto` leaves enablement to the model/backend with the same 4,096-token ceiling. A level-only change is applied per request without reloading the model or clearing history; changing `auto`/`on`/`off` restarts the owned process and clears history. `UGEM_REASONING_LEVEL` or `UGEM_REASONING_BUDGET_TOKENS` can choose the startup budget. For an external llama.cpp-compatible endpoint, μgem performs no-inference `/props` and `/apply-template` probes and enables per-request `auto`/`on`/`off` control only when `enable_thinking=true` and `false` produce different prompts. Token levels remain unavailable because generic compatible endpoints do not advertise this llama.cpp-specific capability. `on`/`off` use `chat_template_kwargs.enable_thinking`; `reasoning_format=deepseek` keeps an extracted reasoning trace separate from final `content`. Generic endpoints without a verifiable capability remain `unknown`, and μgem refuses to claim a successful change. `auto` means backend/model default, never “reasoning off.”

Reasoning generation and reasoning visibility are intentionally different settings. μgem renders and stores only final `content`; streamed `reasoning_content` is not shown or added to conversation history. Hiding it does not disable its generation or token cost. `/stats` and the per-answer footer label the generation request while continuing to show speed and context use. The footer starts enabled and can be disabled for the current session with `/stats off`.

`/context` shows retained estimated usage, the session budget, the confirmed server limit, the final-output reserve, the active reasoning budget, their combined completion reserve and the remaining estimated input room. `/context <tokens>` succeeds only when the endpoint has exposed a server limit and the requested budget does not exceed it or the space already needed by the current conversation. `/context auto` removes the custom session budget. μgem reserves up to 4,096 final-output tokens per answer (or one quarter of a smaller active capacity), adds the selected reasoning budget, sends the combined value as `max_tokens`, and sends llama.cpp's `reasoning_budget_tokens` separately. For example, `high` allows up to 4,096 reasoning plus 4,096 final tokens. A question is rejected before contacting the provider when estimated input plus the combined reserve cannot fit. It never silently drops older messages. Provider-reported `finish_reason: length` produces an explicit incomplete-answer warning, and overflow messages offer `/clear`. Character-based retained counts remain labeled estimates because compatible endpoints do not expose a standard tokenizer-counting API.

The session budget only constrains μgem requests. It does not change llama.cpp's `--ctx-size`; changing that server limit may require reloading the model or restarting `llama-server`. If the server limit is unknown, μgem reports `N/A` and refuses to pretend a requested budget was validated.

μgem waits for local model startup without printing a static loading panel, then shows the ready panel. The default `classic` palette uses blue/green instead of turquoise/purple; `ocean`, `forest`, `violet` and `mono` are also available. `/theme light forest`, `/theme dark ocean`, or either value alone changes the current session. `auto` checks `TERM_BACKGROUND`, `TERMINAL_THEME`, `COLOR_SCHEME`, `GTK_THEME` and `COLORFGBG`, falling back conservatively to dark. `UGEM_THEME` and `UGEM_THEME_MODE` select startup values. `TERM=dumb`, a negative Node `hasColors()` result, `NO_COLOR`, and the `mono` palette provide capability-aware fallbacks. μgem emits ANSI only and never changes the terminal's own palette or background. With `/stats on`, each answer is separated from a framed multiline block showing reasoning mode/level, output tokens, generation speed, wall time, retained context, generation peak and the split reasoning/final budget. The retained bar estimates what remains in conversation history; the peak bar uses provider-reported prompt plus completion tokens and therefore reflects hidden reasoning when reported. A warning is emitted once when retained estimated context reaches 90%, even when the footer is off; `/clear` resets it and removes the previous conversation's latest metrics. Fenced Markdown code renders in a width-aware box with its language in the title. `/code-color` changes only its display color; the raw assistant message remains unchanged.

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
