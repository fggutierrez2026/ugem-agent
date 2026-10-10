# v0.1 Release Verification

**Date:** 2026-10-10  
**Scope:** terminal-only `/Q&A` MVP

## Automated evidence

Command:

```text
npm run check
```

Result: **PASS — 122 tests, 118 top-level cases, 0 failures.**

The suite covers:

- OpenAI-compatible JSON and fragmented SSE, malformed responses, disconnects, timeouts and cancellation;
- one full CLI → provider → SSE → renderer → metrics integration path;
- model discovery/selection and honest single-model fallback;
- supported, unsupported and unknown reasoning control, plus hidden reasoning content;
- final/reasoning budgets, context overflow, 90% warning and `/clear` reset;
- Markdown, code, math, width 40/80/120, themes, ANSI removal and no-color output;
- settings paths, schema, migration, atomic persistence, environment precedence, permissions and corrupt-file recovery;
- exact Q&A request body without `tools` or `tool_choice`.

The end-to-end mock asks Q&A to create a temporary file. The request is sent only as a user message, contains no tool declarations, and the file remains absent. This verifies the v0.1 runtime has no tool execution or file-writing path.

## Real llama.cpp evidence

Environment:

| Item | Verified value |
|---|---|
| OS | Linux |
| GPU | NVIDIA RTX 3060 Laptop, 6 GiB |
| llama.cpp | tag `v0.6.0`, commit `d812350` |
| Initial model | `gemma4-e4b`, 32,768-token preset |
| Selected model | `qwen3.5-4b`, 65,536-token preset |
| μgem endpoint | managed local llama.cpp |

Manual result: **PASS.**

Verified sequence:

1. μgem started Gemma 4 and displayed the confirmed 32,768-token limit.
2. `/models` listed the actual local presets.
3. `/models qwen3.5-4b medium clear` stopped only the owned Gemma process, loaded Qwen and reported 65,536 tokens.
4. A streamed answer rendered a Markdown heading, list, `E=mc²` and a titled JavaScript code box.
5. With `medium`, llama.cpp reported 2,125 completion tokens; μgem displayed 2,048 reasoning + 4,096 final budget, 67.6 tok/s and a 2,176-token reported generation peak while retaining only the visible conversation estimate.
6. `/context` displayed the same retained count, server limit and 6,144-token combined completion reserve.
7. `/reasoning off` reloaded the owned model, cleared the conversation and produced a two-token `OK` response with zero reasoning budget.
8. `/clear` reset context and `/stats` to “no completed answer yet.”
9. `/exit` shut down the owned llama.cpp process; no server remained running.

The throughput values are single-run observations, not benchmarks.

## Platform matrix

| Platform | Status | Evidence |
|---|---|---|
| Linux terminal | Verified | Full suite, persistence restart, real llama.cpp/GPU session |
| Windows path/config behavior | Automated | `%APPDATA%` path and schema tests |
| Windows Terminal ANSI behavior | Automated | capability, themed and no-color paths |
| Physical Windows host | **Unverified** | No Windows machine was available |

The current full suite ran with the available Node.js 18.19.1/npm 9.2.0 environment, although μgem's supported runtime remains Node.js 20+. Earlier renderer verification ran on Node.js 24.21.0. A fresh full run on a supported Node.js version is still recommended before distributing an npm package.

## Capability limitations

- Managed model switching is launcher-specific; external `/v1/models` selection changes only the request model ID.
- Reasoning levels are sent only to the managed llama.cpp build that exposes `reasoning_budget_tokens`.
- External reasoning control degrades to `unsupported` or `unknown` unless `/props` and `/apply-template` verify it.
- Context token counts are estimated when the provider does not report them; μgem never claims tokenizer precision for those values.
- Arbitrary LaTeX cannot be fully typeset in a terminal; unsupported expressions retain an explicit textual fallback.
- Q&A intentionally has no tools, repository context, project mutation, `/plan`, `/debug` or `/build`.
