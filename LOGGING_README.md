# Logging

The current app does not log credentials, prompts, responses, tool payloads, or full session contents. Chat failures emit a generic server log with an opaque conversation ID. HTTP access logging should omit request bodies and authorization headers.

Conversation text and evidence are stored encrypted in the private workspace database for the user to revisit or export. Legacy debug logs from older deployments are not migrated; review their retention separately during rollout.
