# Slide Chat

A client-scoped operations workspace powered by **GPT-6 Astra** through the OpenAI Responses API. Slide Chat reads live Slide inventory, investigates servers and recovery points, reconciles connected RMM data, and explains billing from actual billing records. Answers carry clickable, timestamped evidence and entity chips with details on hover or focus. Markdown and tables stay formatted while answers stream.

## Run locally

Requires Python 3.10+.

```sh
python3 -m venv venv
. venv/bin/activate
pip install -r requirements.txt
cp config.example .env
# Set FLASK_ENV=development and a writable CHAT_DATA_DIR for a localhost preview.
python app.py
```

Open `http://127.0.0.1:8882`. Connect a Slide key with read permissions for clients, devices, agents, and the operational endpoints you need. Add your OpenAI key in Connections, or configure a server key and explicitly allowlisted Slide-key hashes. GPT-6 Astra access must be enabled in the corresponding OpenAI project; there is no automatic fallback model.

## Workspace capabilities

- Client selector, encrypted conversation history, readable Markdown exports, light/dark themes, and responsive navigation.
- Eight starter workflows: daily brief, failed backups, recovery readiness, recovery-point comparison, RMM coverage, alert triage, capacity, and billing.
- Read mode by default. Write mode prepares reviewed changes for one selected client: start a backup, pause scheduled backups until a specified time (up to seven days), resume backups, rename an agent, replace agent notes, and resolve/reopen alerts. Each proposal shows the exact target and before/after values and requires a separate Execute click. Your Slide key must permit the operation.
- Live Slide inventory; individual server and service detail; recent backup, snapshot, and alert evidence. Device ownership is joined through agents when the API omits `client_id`.
- NinjaOne machine-to-machine OAuth with Monitoring scope, mapped to a specific Slide client and NinjaOne organization. Paged inventory and scoped hardware/software/volume/service reads.
- Speck RMM read-only integration tokens mapped to one exact Speck site and one Slide client. Live inventory, reported health, volumes, services, open alerts and existing patch reports. Create/revoke tokens in Speck Settings → Slide Chat; Chat cannot run commands or open remote sessions.
- Stripe restricted keys mapped to a specific customer; paged invoices and subscriptions. Slide's public operational API does **not** supply invoice records, so Chat will not infer charges from device or storage counts.
- Client-bound JSON/CSV imports for other RMM, PSA, documentation, or billing systems. These are labeled as imported snapshots, not live integrations.
- A credential-free downloadable skill and Python CLI/stdio MCP companion for Claude Desktop, Claude Code, Codex, or other MCP hosts. Create/revoke a 30-day token in **Use in your AI**. No OpenAI key is needed to call read-only tools from an external model.
- Link to the [Runbooks workspace](https://slide.recipes/runbooks/) for executable plans and approved operational actions.

## Architecture

`app.py` owns session authentication, CSRF, SSE, conversation storage, downloads, and companion endpoints. `chat_core/sources.py` owns fixed-origin read adapters; models cannot select arbitrary URLs, methods, credentials, or client mappings. `chat_core/agent.py` owns a strict tool catalog and bounded Responses loop. `chat_core/store.py` encrypts all workspace content at rest, stores only companion-token hashes, and coordinates leases/budget counters through SQLite transactions.

Responses use `model=gpt-6-astra`, reasoning `medium`, `store=false`, streamed output, and encrypted reasoning continuity within a turn. At most 8 model rounds, 16 source calls, and 6,000 output tokens per round. Up to 20 recent text messages are sent on each new turn. Previous evidence is not silently treated as current; the agent refreshes sources. Interrupted or failed responses are not presented as successful or saved as completed answers. Requests are not retried after model dispatch.

`chat_core/actions.py` owns the fixed write catalog and encrypted action receipts. The model can only propose changes; execution requires the browser session, CSRF, Write mode, the same selected client, and the exact proposal confirmation. Proposals expire after 15 minutes. Execution rechecks ownership and current field values, atomically claims the proposal, and sends one upstream HTTP request. A timeout or interrupted dispatch is recorded as unknown and never automatically retried. Successful backup submission means accepted, not completed. RMM, billing and companion tools remain read-only.

`chat_core/entities.py` derives agent, appliance, client, backup, snapshot and alert chips from observed records. Unknown entity references remain plain text. One safe DOM renderer handles streamed and saved messages, including partial Markdown, source citations, scrollable tables and sanitized SVG image previews. Diagrams include Expand, zoom and Download SVG. Generated SVG never becomes active page markup; an allowlist removes scripts, CSS, external resources and foreign content before preview or download. Source payloads are untrusted evidence, secret-shaped fields are removed, and the UI renders safe DOM text/Markdown rather than model-generated HTML. Source keys never enter model input. Full prompts, credentials, and source responses are not logged.

## Tests

```sh
python -m unittest discover -s tests -v
node --check static/js/workspace.js
npm ci
npm test
```

See [operations and response contract](docs/operations.md), [deployment](DEPLOYMENT.md) and [validation](docs/rebuild-validation.md) for rollout details and verified limits.


## Connect from Recipes

Opening this app from Slide Recipes automatically reuses the connected Slide account through an encrypted, single-use browser handoff. The first unauthenticated home-page visit checks Recipes once, with manual login as the fallback. Set `RECIPES_HANDOFF_KEY` to the app-specific 64-character hex secret configured in the Recipes issuer's private `/etc/slide-recipes/handoff.json`. Keep it out of Git. Reports additionally sets `RECIPES_HANDOFF_DB` to a private writable SQLite path; Chat uses its existing private state directory. Existing app secrets and key-cookie formats must be preserved.

The protocol module is mirrored between `slideChat/chat_core/recipes_handoff.py` and `slideReports/lib/recipes_handoff.py`; test and update both copies together. Handoffs expire after 60 seconds, require browser state and the exact Recipes origin, and can be consumed only once across workers. Raw keys are never placed in handoff URLs.


## SVG and network diagrams

Ask “Draw a network diagram of this client’s Proxmox hosts and guests, with the Slide boxes protecting them and client names.” Select the client first. Chat's `network_diagram` tool combines current Slide inventory with the selected client's Speck topology grant, matches explicit Slide agent IDs or unique hardware MACs, and lays out readable SVG sheets per host. Larger hosts continue onto additional sheets. It does not infer physical cabling or backup health. Missing matches and placement stay explicit; source timestamps, stale/partial connections and missing grants appear in evidence and the answer. The diagrams and their evidence remain in encrypted conversation history and Markdown exports.

For other drawings, the model can emit fenced `svg` blocks. Only complete, valid, bounded SVG documents render. Incomplete streams show “Drawing your diagram”; invalid documents keep a readable source fallback. No public artifact URL or new upload route is introduced.

In Speck Settings → Slide Chat, create a named-site token and explicitly select the Proxmox connections belonging to that client. Existing tokens have no topology grants. In Chat Connections, bind that exact site to the matching Slide client. For an account-wide overview, create an all-sites token with the desired clusters and connect it using site `*` and **All clients**. That broader source is unavailable in individual-client conversations; add each client's own source for that workflow. Grants confer read-only topology access, never provider commands, credentials or console access. Tokens expire and can be revoked in Speck.
