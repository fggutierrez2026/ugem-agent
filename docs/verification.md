# Verification & Quality Strategy

## v0.1 MVP test levels
1. **Unit:** command parser, session history/clear, settings validation, token/latency calculation, theme selection, partial UTF-8/SSE parser.
2. **Renderer golden tests:** Markdown headings, emphasis, nested lists, tables, links, mixed code/math; arbitrary streaming chunk boundaries; widths 40/80/120 columns; no-color terminal.
3. **Provider contract tests:** local mock HTTP/SSE server, error status, dropped connection, `[DONE]`, usage present/missing, model list missing, unsupported reasoning/context fields.
4. **Manual integration:** running llama.cpp on accessible model; compare metrics to provider output where available, document assumptions.
5. **Platform:** Windows PowerShell and Linux terminal where available. Label untested environments as unverified.

## v0.1 release gates
- Model query streams with readable, lossless output; Markdown delimiters appropriately hidden and code preserved.
- Model listing/reasoning/context controls fail honestly where backend unsupported.
- Metrics distinguish provider reporting from estimates and never invent values.
- `/Q&A` cannot invoke tools, execute commands or mutate project files.
- `/clear`, `/settings`, `/theme`, `/model`, `/context`, `/reasoning`, `/stats` behavior covered.
- No secrets displayed; sensible handling of cancellation, server crash and oversized history.

## Future `/plan` and `/build` verification principles
- A task has explicit acceptance and requirement references before implementation.
- Only executable tasks/subtasks/revisions are progress counted; dependencies validated.
- Failed tests → bounded Fix → retest; if unresolved, mark `blocked`, do not say completed.
- Verify output against spec, not just test exit code; human acceptance separate.
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
