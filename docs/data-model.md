# Data Model — Compact Hierarchical Context & Work Items

> **Design contract for future releases**, not required to implement the v0.1 chat MVP. Use JSON for machine state, short Markdown for human instructions. Keys should remain readable; reducing irrelevant content saves more tokens than abbreviating everything.

## Hierarchy and loading
- **L0 snapshot:** project id/goal/platform/runtime/active task/mode.
- **L1 map:** IDs and relationships among specs, components, work items, decisions, files.
- **L2 details:** only referenced requirements, code snippets, API evidence, current tests/errors.
- **External evidence:** full logs, Git history, original stack traces and test reports outside the context payload.
- Context Compiler selects per phase and applies an output-token reserve; Memory Manager stores a short current-state summary, not unbounded changelog.

## Suggested state under `.ugem/` (future)
```text
.ugem/
  project.json   # metadata, capabilities, refs
  context.json   # hierarchy/ref index
  specs.json     # requirements by stable ID
  tasks.json     # work items, dependencies, approval
  memory.json    # active state and unresolved issues
  issues.json    # issue records
  diagnostics/   # original logs outside prompt
```
Small projects may combine logically equivalent records into one `state.json`.

## Compact work-item schema
```json
{
  "id": "T002",
  "type": "task",
  "title": "Snake movement",
  "status": "completed",
  "review": "changes_requested",
  "depends_on": ["T001"],
  "spec_refs": ["FR002"],
  "files": ["game.py", "tests/test_game.py"],
  "acceptance": ["moves_on_grid", "blocks_reverse"],
  "children": [],
  "revisions": ["R001"]
}
```
Statuses: `pending | in_progress | blocked | completed | skipped`. Review: `not_reviewed | accepted | changes_requested`. Technical completion != user acceptance.

## Optional subtasks
Use IDs such as `T002.1`. `parent` denotes decomposition of work, and a parent is a non-executable grouping when it has children; it requires child verification and appropriate integration checks to be considered completed. Avoid arbitrary depth (initial maximum two levels).

## Revisions, distinct from subtasks
```json
{
  "id": "R001",
  "type": "revision",
  "title": "Prevent rapid direction reversal",
  "revises": "T002",
  "source_issue": "I002",
  "status": "pending",
  "depends_on": ["T002"],
  "reason": "user_feedback",
  "problem": "Two inputs accepted during one tick",
  "files": ["game.py", "tests/test_game.py"],
  "acceptance": ["one_turn_per_tick", "old_tests_pass"],
  "regression_tests": ["test_movement", "test_collision"]
}
```
`revises` is a traceability edge, `depends_on` is an execution dependency, `parent` is decomposition. Do not conflate them. A revision is an executable work item using the future `/build` workflow, not a new command. Keep original completed task and evidence immutable; append revision reference.

## Issues
```json
{
  "id": "I002",
  "kind": "code_defect",
  "status": "open",
  "source": "user",
  "summary": "Snake changes direction twice in one tick",
  "related_tasks": ["T002"],
  "evidence_ref": "diagnostics/I002.log",
  "resolved_by": null
}
```
Possible kinds: `environment | code_defect | improvement | design_change | unknown`. Issues may be resolved without code revisions; one revision may close multiple issues.

## Plan and task versioning
Keep monotonic plan revision, explicit approval, stable IDs, compact change record and Git-backed history. Only apply incremental modifications. Never silently overwrite completed work or mark tests passed from LLM assertions.

## Referential integrity and validation
- Every referenced work/spec/issue ID must exist; reject cycles in depends_on.
- Work item completion requires evidence refs and verified acceptance, not self-report.
- Parent progress counts only executable leaf tasks, not the grouping twice.
- On edits impacting completed work, create revision and assess regression impact.
