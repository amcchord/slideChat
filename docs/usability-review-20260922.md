# Chat usability review — September 22, 2026

Reviewed the production workspace at chat.slide.recipes using the connected demo workspace. Exercised client selection, a real recovery-readiness investigation, streaming answers, tables, citations, entity details, conversation history, Connections, and a 390px phone layout. Production HTML, CSS and JavaScript matched the local baseline commit `c00c828` before changes.

## Findings and changes

| Priority | Observed problem | Implemented change |
| --- | --- | --- |
| High | Starting a workflow disabled controls while only a small “Refreshing…” label in the right rail explained the wait. | Client loading appears beneath the scope bar, Refresh shows a busy state, errors persist with a recovery instruction, and the client picker uses already-loaded inventory immediately. |
| High | During a real answer, “Connecting the evidence” remained visible after prose started streaming. There was no elapsed time or indication of a quiet stream. | An event-driven response panel shows the current operation, elapsed time, collected sources and expandable activity. Text deltas switch the label to “Writing your answer.” After 30 seconds without an event, the panel explicitly says that no new update has arrived. |
| High | Visible progress disappeared at completion. Stopped or failed requests relied on a toast and error text deep in the answer. | Persistent “Answer ready,” “Response stopped,” or “Response interrupted” states, browser-tab status, and an explicit Edit and resend action. Source errors remain recorded as limitations. Resending is always a separate user action. |
| High | The entire evidence panel disappeared below 1150px, including on small laptops. | An Evidence button beside client scope opens the full source list. The progress panel also links to it at every size. Existing individual citation details remain available. |
| Medium | Answer text was 13px, table text 12px, table headers 10px, composer input 12px, and source timestamps 9px. Phone citations measured about 20×20px and Refresh 24×26px. | 16px answers/composer, 14px table text, 12px table headers and supporting labels, 44px primary controls, and larger citation/entity targets. Muted light-theme text has stronger contrast. |
| Medium | Phone tables had 90px columns, splitting ordinary words across lines. | Tables keep readable 160–170px minimum column widths and scroll inside their own container. |
| Medium | Entity hover details opened over content while it moved beneath the pointer during streaming. | Hover previews wait 400ms and remain off during generation. Deliberate clicks and keyboard focus still open details. |
| Medium | Controls looked available during work even when their click handlers silently ignored interaction. | Starter workflows and history controls visibly disable during requests. The composer remains available for drafting a follow-up. |

The existing two-column workflow grid, client scope, Markdown renderer, encrypted storage, source adapters, model and operational review/execute controls remain in use. No backend capability or authorization change is part of this pass.

## Validation

- 51 Python tests and 26 frontend tests, including new coverage of quiet streams, source limitations, phase changes, bounded activity, and terminal-state integrity.
- Isolated browser fixture exercises delayed context loading, successful streaming, slow responses, manual stop, errors, evidence dialogs and readable tables without making changes to client systems.
- Production verification and screenshots are recorded in the deployment handoff under the parent workspace's `output/slide-chat-usability-20260922/` directory.

## Remaining larger opportunities

- Saved conversation titles are the beginning of the original prompt and can be hard to distinguish. A future pass could add concise titles, client labels and dates.
- Connections leads directly into a technical setup form. A connection overview with explicit source availability would make missing RMM/billing data clearer before starting those workflows.
- Progress is bounded by what the server reports. Elapsed time and quiet-stream messages do not estimate percent complete. Stopping the browser stream does not guarantee cancellation of work already dispatched upstream.
