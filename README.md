# Slide Chat

A client-scoped operations workspace powered by **GPT-6 Astra** through the OpenAI Responses API. Slide Chat reads live Slide inventory, investigates servers and recovery points, reconciles connected RMM data, and explains billing from actual billing records. Answers carry clickable, timestamped evidence.

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

- Client selector, encrypted conversation history, Markdown exports, light/dark themes, and responsive navigation.
- Live Slide inventory; individual server and service detail; recent backup, snapshot, and alert evidence. Device ownership is joined through agents when the API omits `client_id`.
- NinjaOne machine-to-machine OAuth with Monitoring scope, mapped to a specific Slide client and NinjaOne organization. Paged inventory and scoped hardware/software/volume/service reads.
- Stripe restricted keys mapped to a specific customer; paged invoices and subscriptions. Slide's public operational API does **not** supply invoice records, so Chat will not infer charges from device or storage counts.
- Client-bound JSON/CSV imports for other RMM, PSA, documentation, or billing systems. These are labeled as imported snapshots, not live integrations.
- A credential-free downloadable skill and Python CLI/stdio MCP companion for Claude Desktop, Claude Code, Codex, or other MCP hosts. Create/revoke a 30-day token in **Use in your AI**. No OpenAI key is needed to call read-only tools from an external model.
- Link to the [Runbooks workspace](https://slide.recipes/runbooks/) for executable plans and approved operational actions.

## Architecture

`app.py` owns session authentication, CSRF, SSE, conversation storage, downloads, and companion endpoints. `chat_core/sources.py` owns fixed-origin read adapters; models cannot select arbitrary URLs, methods, credentials, or client mappings. `chat_core/agent.py` owns a strict tool catalog and bounded Responses loop. `chat_core/store.py` encrypts all workspace content at rest, stores only companion-token hashes, and coordinates leases/budget counters through SQLite transactions.

Responses use `model=gpt-6-astra`, reasoning `medium`, `store=false`, streamed output, and encrypted reasoning continuity within a turn. At most 8 model rounds, 16 source calls, and 6,000 output tokens per round. Up to 20 recent text messages are sent on each new turn. Previous evidence is not silently treated as current; the agent refreshes sources. Interrupted or failed responses are not presented as successful or saved as completed answers. Requests are not retried after model dispatch.

No operational write tools are exposed. Source payloads are untrusted evidence, secret-shaped fields are removed, and the UI renders safe DOM text/Markdown rather than model-generated HTML. Source keys never enter model input. Full prompts, credentials, and source responses are not logged.

## Tests

```sh
python -m unittest discover -s tests -v
node --check static/js/workspace.js
```

See [deployment](DEPLOYMENT.md) and [validation](docs/rebuild-validation.md) for rollout details and verified limits.


## Connect from Recipes

Opening this app from Slide Recipes automatically reuses the connected Slide account through an encrypted, single-use browser handoff. The first unauthenticated home-page visit checks Recipes once, with manual login as the fallback. Set `RECIPES_HANDOFF_KEY` to the app-specific 64-character hex secret configured in the Recipes issuer's private `/etc/slide-recipes/handoff.json`. Keep it out of Git. Reports additionally sets `RECIPES_HANDOFF_DB` to a private writable SQLite path; Chat uses its existing private state directory. Existing app secrets and key-cookie formats must be preserved.

The protocol module is mirrored between `slideChat/chat_core/recipes_handoff.py` and `slideReports/lib/recipes_handoff.py`; test and update both copies together. Handoffs expire after 60 seconds, require browser state and the exact Recipes origin, and can be consumed only once across workers. Raw keys are never placed in handoff URLs.
