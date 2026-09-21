# Reviewed operations and consistent answers

Slide Chat 2.1 keeps read mode as the default. Switching to Write lets Astra propose the operations below for a selected client. The browser presents the target, current values, intended values, consequence, and expiry. Review opens the latest server record; Execute submits its opaque confirmation to the server. Merely enabling Write or generating a proposal never changes a Slide system.

| Operation | Slide API request | Behavior |
|---|---|---|
| Start backup | `POST /v1/backup` with `agent_id` | Requests one job; acceptance is distinct from completion. |
| Pause backups | `PATCH /v1/agent/{id}` with `backup_paused_until`, `backup_paused_indefinite=false` | An explicit timezone-qualified end time, one minute to seven days ahead; replaces existing pauses. |
| Resume backups | `PATCH /v1/agent/{id}` with `backup_resume=true` | Clears timed/indefinite pauses; does not start an immediate backup. |
| Rename agent | `PATCH /v1/agent/{id}` with `display_name` | At most 128 characters; does not rename the host OS. |
| Replace agent notes | `PATCH /v1/agent/{id}` with `comments` | Replaces the complete notes field, up to 4,000 characters. |
| Resolve/reopen alert | `PATCH /v1/alert/{id}` with `resolved` | Changes the alert state, not its underlying cause. |

Paths and request fields were checked against the [Slide OpenAPI schema](https://api.slide.tech/openapi.json) on September 21, 2026. Keys need the corresponding write permissions. No arbitrary HTTP, restore, deletion, script, RMM mutation, billing mutation, or companion mutation route is exposed by this catalog.

## Execution semantics

- Proposals are encrypted in the same private SQLite store as workspace data and bound to workspace, conversation and client. Expiry is 15 minutes. The browser’s confirmation value is separate from the model’s ability to propose.
- Browser session, CSRF, Write mode and selected client are checked at execution. Companion bearer tokens cannot use mode or action endpoints.
- The server atomically claims a pending proposal before dispatch, re-fetches inventory and target ownership, and compares the fields and identity pinned at review. A changed target requires a fresh proposal. Duplicate execution requests do not dispatch twice.
- Each mutation has one HTTP attempt, no redirects and no automatic retry. Network uncertainty, server errors and interrupted workers leave an `unknown` receipt. The operator must inspect Slide before requesting another change.
- Receipts distinguish pending, cancelled, expired, running, succeeded, failed and unknown. Conversation reloads and subsequent model turns refresh receipts from the action store. Read mode blocks execution of old proposals.
- A workspace lease serializes chat generation, mode changes and execution across workers. Credentials stay outside prompts, source details are redacted, and neither prompts nor upstream bodies are logged.

## Response contract

A named agent is a protected server/workload; a device is a Slide appliance; a backup is an attempt/job; a snapshot is a recovery point; an alert reports a condition. A successful backup, cloud copy, successful verification, and demonstrated application recovery are separate statements.

The model uses `[[agent:ID]]`, `[[device:ID]]`, `[[client:ID]]`, `[[backup:ID]]`, `[[snapshot:ID]]`, and `[[alert:ID]]` for records actually returned by the tools. Server-derived metadata supplies chip names, details, observation timestamps and source IDs. Models cannot create trusted chip metadata. Copy and Markdown export expand references into names and IDs.

Answers start with a concrete finding and next step. Operational tables use at most five columns and short cells, consistently styled with headers, tabular numeric values and horizontal overflow when needed. Each workflow has a suggested table shape; incomplete evidence is labeled rather than turned into a complete fleet total. Dates are labeled UTC unless the user requests a known alternative. RMM and billing workflows specify missing connections/imports instead of inventing coverage or charges.

OpenAI integration follows [strict function calling](https://developers.openai.com/api/docs/guides/function-calling) and [Responses streaming events](https://developers.openai.com/api/docs/guides/streaming-responses). The model remains GPT-6 Astra. Partial Markdown is rendered through the same safe DOM pipeline as final messages; source text is never inserted as executable HTML.

## Validation

Python tests cover client isolation, CSRF, mode and companion restrictions, durable single dispatch across concurrent workers, stale targets, expiry, cancellation, uncertain outcomes, all supported request bodies, and typed entities/export. Frontend tests cover partial Markdown, tables, citations, entity rendering, and action review behavior. Browser QA uses an isolated fixture server for actual Execute clicks; live Slide verification reads inventory and prepares/cancels a proposal without dispatching fleet changes.


## Clarification replies and compact workflows

Chat uses `ask_question` for bounded clarification choices. Client labels are resolved from accessible inventory, generic buttons submit exactly their visible label, and replies never execute a change. Questions and choices persist with conversation history. A client choice continues the original task in a new conversation scoped to that client; prior clarification questions and answers travel with the task, while prior client evidence does not. Saved client questions with verified entity references also receive reply buttons.

All eight homepage workflows run on click. When no client is selected, a searchable client picker opens before any model request. Navigation, scope changes, manual sends, and action execution are locked while a selection resolves. The homepage omits marketing copy and uses a compact two-column layout.

Server service reads preserve every returned name, state, startup setting and verification flag, while omitting verbose OS descriptions and service IDs. This prevents descriptions from exhausting the answer context and hiding application evidence. Pagination metadata remains intact.

Validation: 51 Python and 21 frontend tests; actual Astra answers for all eight workflows against the authorized demo account; clarification and generic reply flows; 1280×720 desktop and 390×667 mobile screenshots, including dark mode. Evaluations and screenshots are private local artifacts, not repository fixtures.
