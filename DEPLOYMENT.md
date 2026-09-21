# Deploy Slide Chat 2.0

This is a standalone Flask app at `chat.slide.recipes`. Deploy only this repository. The older root Recipes chat copy is not authoritative.

1. Back up the existing deployment and configuration. The new app does not import the previous client-side conversation history or public HTML artifacts. Legacy public artifact URLs are intentionally not served by this application.
2. Create a Python 3.10+ virtualenv and install `requirements.txt`. Use a dedicated service account and a persistent private directory, e.g. `/var/lib/slide-chat` (0700), outside the web root.
3. Set `CHAT_DATA_DIR`, `SECRET_KEY` (a stable random secret), and `FLASK_ENV=production`. Optionally provide `CHAT_ENCRYPTION_KEY` as a Fernet key through a secret manager; otherwise the app generates `encryption.key` (0600) exactly once in the data directory. Back up the SQLite database **and** encryption key together. Losing that key loses access to saved workspaces. Do not regenerate either secret during routine deploys.
4. Use BYO OpenAI keys per workspace, or set `OPENAI_API_KEY` and `CHAT_HOSTED_SLIDE_KEY_HASHES` to explicitly approved SHA-256 hashes of Slide API keys. An empty allowlist disables use of the hosted key. Hash a key privately; do not put the plaintext key in process arguments or logs. Configure project spend limits in OpenAI as well as the app’s request budgets.
5. Launch behind HTTPS with streaming supported:

   ```sh
   gunicorn --bind 127.0.0.1:8882 --workers 2 --threads 4 --timeout 600 app:app
   ```

   Disable proxy buffering for `/api/chat`, allow long-lived SSE responses, and set a suitable proxy read timeout. Cookies are Secure, HttpOnly and SameSite=Lax in production. Never expose the development server publicly. This app assumes its own origin at `/`, not a subpath. Existing `wsgi.py` remains compatible with the current Apache deployment.
6. Test `/health`, connect an approved read-only Slide key, verify client scoping, generate a paid test answer, inspect its citations, reopen the saved conversation, test an import, and download the companion. Each additional provider needs its own credentials and permissions verified in the target account before rollout.
7. Switch traffic only after those checks. Roll back application traffic to the previous checkout if necessary; keep the new private state directory and encryption key intact.

## Limits and retention

- Workspaces expire after 30 days without a state update. Their browser cookie is the login session; signing in again starts a separate workspace. There is no shared account login or cross-browser history synchronization.
- Workspace content, imported records, source keys, OpenAI keys, and conversation evidence are encrypted in SQLite. Deleting a workspace removes its database rows and revokes companion tokens; encrypted pages can remain in filesystem/database backups according to the operator’s backup policy.
- Each workspace holds at most 50 conversations, 100 messages per conversation, and 20 sources. Imports are limited to 2 MB/5,000 records. Slide inventories stop at 5,000 records with an explicit error. Stripe reads stop at 1,000 records with a truncation warning. Recent Slide activity returns a maximum 50-record page, never a complete historical total.
- `CHAT_DAILY_WORKSPACE_REQUESTS` defaults to 100 per Slide-key hash per UTC day, even across newly created browser workspaces. `CHAT_DAILY_HOSTED_REQUESTS` defaults to 200 total hosted-key requests per UTC day. These are request guards, not currency-denominated spend limits.
- A transaction-backed workspace lease prevents overlapping responses. A worker lost mid-request can leave a lease for up to one hour. An interrupted browser stream can still incur cost for already-dispatched model work.
- The app sends relevant client data to OpenAI. `store=false` disables Responses storage; it is not a claim about every provider retention policy. The downloadable companion sends source evidence to the user’s chosen external AI host when invoked there.
- Server-to-source HTTP requests have fixed origins, no redirects, bounded retries for GET only, and timeouts. No arbitrary-URL or shell execution connector exists. Add new sources as audited, fixed-origin adapters with explicit client mappings.

## Compatibility

The old Anthropic/HAML/artifact-rendering pipeline is replaced. `CLAUDE_API_KEY` is no longer used. Old `/chat` and public artifact endpoints are not retained; clients should use the new authenticated `/api/chat` and `/api/tools` endpoints. `mcp_manager.py` and its transport regression tests remain available for the prior standalone Slide MCP transport; the new Chat agent uses direct bounded API adapters.
