# Slide Chat rebuild validation

Date: 2026-09-21. Implementation is on a draft PR; production has not been deployed.

## Verified

- Real Demo Slide read-only inventory: 2 clients, 3 devices, 7 agents. Brawndo scope: 4 agents and 1 device.
- Real **gpt-6-astra** Responses tool call and answer: selected Brawndo inventory, correct 4-agent/1-device count, timestamp and evidence S1; 5,789 input and 66 output tokens for the first smoke test.
- Safari end-to-end: Slide login, client selection, streamed server inventory table, correct operating systems and assigned device, clickable evidence, saved recent conversation, light/dark theme, and connection settings. A second real API answer used 6,044 total tokens.
- Automated tests cover tenant scoping including ignored upstream filters, recursive secret redaction, pagination without `next_offset`, stalled cursors, redirect rejection, encrypted storage, session isolation, CSRF, token rotation/revocation, spend allowlisting/budgets, incomplete streams, reasoning/tool continuity, and the credential-free companion archive.
- Downloaded companion validated locally through its actual HTTP and stdio MCP path: initialize, list six tools, read a mapped import, remove a secret-shaped field, and reject the token after workspace deletion.
- Responsive navigation was verified in a narrow native Safari window; connections and Runbooks remained reachable through the mobile menu.
- Source integration contracts were checked against the official NinjaOne OpenAPI document and Stripe invoice-list documentation. Provider request behavior is tested with fixtures.

Local screenshot evidence is kept outside Git in `output/slide-chat-rebuild/` in the enclosing development workspace; it contains demo customer inventory and is not published in this public repository.

## Not claimed

- NinjaOne and Stripe were not live-tested: no customer credentials were supplied for those providers. They require deployment-account validation. Imports do not pretend to be live API connections.
- Operational writes, billing payments, production restores and fleet changes were not performed. Chat exposes no such tool.
- No benchmark establishes a tenfold end-to-end improvement. This rebuild changes capability, safety, context, API use, and usability; it does not make an unsupported performance claim.

## Primary API references

- [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Migration and model guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart): Responses for tool use; no temperature/top-p; low through max reasoning.
- [NinjaOne OpenAPI](https://app.ninjaone.com/apidocs/NinjaRMM-API-v2.json): organization-device pagination and device detail/software/volume/service GET endpoints.
- [NinjaOne OAuth configuration](https://www.ninjaone.com/docs/application-programming-interface-api/oauth-token-configuration/): client credentials and Monitoring scope.
- [Stripe invoices](https://docs.stripe.com/api/invoices/list): exact customer filtering, minor-unit amounts and cursor pagination.
- Slide operational schemas were verified against the local `slidehq/publicapi` generated routes and real read-only Demo requests. Those public routes contain account addresses but no invoices/subscriptions API.
