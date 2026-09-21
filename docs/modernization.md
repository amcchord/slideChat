# First modernization pass (superseded)

This document records the earlier transport/theme pass. The current GPT-6 Astra rebuild is documented in [README](../README.md) and [rebuild validation](rebuild-validation.md). It replaces the UI/provider pipeline described below.


Chat now uses the Recipes visual language: Archivo typography, light/dark themes, a shared suite bar and back link, calmer chat/artifact panes, and responsive stacking. Message input and send controls have explicit accessible labels.

`MCPManager` now sends JSON-RPC directly to the existing MCP binary with `subprocess.run`, replacing temporary shell scripts and grep/head response parsing. It reads the matching response ID regardless of JSON property order or intervening notifications. Credentials are passed as `SLIDE_API_KEY` in the child environment rather than command-line arguments. Raw subprocess output is not logged.

Tool metadata caches are keyed by a credential hash, expire after five minutes, and cap at 100 entries. Tool calls remain stateless and are never automatically retried, because they can mutate the fleet. On timeout the UI is told to check the operation before retrying. This does not introduce persistent MCP sessions or change the LLM provider/model.

```sh
python -m unittest discover -s tests -v
```

Three focused tests cover protocol parsing, key placement, account cache isolation, and timeout behavior. The deployed binary's help confirms environment-key support; a read-only JSON-RPC initialize/list exchange against that binary returned response IDs 1 and 2 and 12 tools using a noncredential placeholder. Local light/dark UI was inspected. No paid LLM conversation or fleet mutation was executed. Validate an authenticated read-only conversation and representative artifacts with the configured provider before rollout.

Preserve the MCP binary, provider credentials, service settings, and existing cookie/session configuration when deploying. No production changes were made.
