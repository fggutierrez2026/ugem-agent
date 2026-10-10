# Verification & Quality Strategy

## v0.1 MVP test levels
1. **Unit:** command parser, session history/clear, settings paths/schema/migration/atomic persistence, token/latency calculation, theme/background selection, terminal color capability, partial UTF-8/SSE parser.
2. **Renderer golden tests:** Markdown headings, emphasis, nested lists, tables, links, mixed code/math; arbitrary streaming chunk boundaries; widths 40/80/120 columns; no-color terminal.
3. **Provider contract tests:** local mock HTTP/SSE server, error status, dropped connection, `[DONE]`, usage present/missing, advertised model selection, rejected unknown IDs, model list missing, supported/unsupported/unknown reasoning control, hidden reasoning chunks, separate `reasoning_budget_tokens`, combined reserved `max_tokens`, finish reasons and unsupported context fields.
4. **Manual integration:** running llama.cpp on accessible model; compare metrics to provider output where available, document assumptions.
5. **Platform:** Windows PowerShell and Linux terminal where available. Label untested environments as unverified.

## v0.1 release gates
- Model query streams with readable, lossless output; Markdown delimiters appropriately hidden and code preserved.
- Model listing/reasoning/context controls fail honestly where backend unsupported; rejected model/reasoning changes preserve active state and history.
- Context budgets cannot exceed a confirmed server limit; estimated input plus reasoning and final-output reserves must fit, overflow does not contact the provider or alter history, and output-limit finishes are explicit.
- Reasoning tests keep generation control separate from response visibility and ensure `reasoning_content` never enters final-answer rendering/history.
- Metrics distinguish provider reporting from estimates, separate retained context from all-token generation peak and never invent values.
- Settings persist only allowlisted explicit choices, environment overrides win, secrets are discarded, and missing/corrupt/future schemas recover with a visible explanation.
- `/Q&A` cannot invoke tools, execute commands or mutate project files.
- `/clear`, `/settings`, `/theme`, `/model`, `/context`, `/reasoning`, `/code-color`, `/stats` behavior covered.
- No secrets displayed; sensible handling of cancellation, server crash and oversized history.

## Future `/plan` and `/build` verification principles
- A task has explicit acceptance and requirement references before implementation.
- Only executable tasks/subtasks/revisions are progress counted; dependencies validated.
- Failed tests → bounded Fix → retest; if unresolved, mark `blocked`, do not say completed.
- Verify output against spec, not just test exit code; human acceptance separate.
- Theme checks cover dark/light variants at 40/80 columns, environment-based auto detection, `TERM=dumb`, Node color capability, `NO_COLOR`, and simulated Windows Terminal ANSI support; real Windows visual verification remains part of T011.
- Revisions carry impact and regression checks; issues may be environmental and need no code change.
- Persist test evidence references outside short working memory.

## Reporting template
```text
Work item: <ID>
Tests run: <command or test id>
Result: PASS / FAIL / NOT_VERIFIED
Evidence: <log path or tool result>
Limitations: <what could not be checked>
Next action: <specific step>
```
