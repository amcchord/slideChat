# Speck RMM integration

Slide Chat connects to the read-only integration API at `https://speckrmm.com`.
In Speck, assign the relevant machines to a named Site, then open Settings →
Slide Chat and create an integration token for that exact Site. In Chat →
Connections, choose Speck RMM, select the corresponding Slide client, enter the
exact Site name and paste the token. Chat tests the live connection before saving
it encrypted with the workspace. Tokens are shown once in Speck and can be
revoked there immediately; their default lifetime is 30 days.

The connector reads paginated inventory and open alerts, individual machine
health/detail, volumes, services and existing patch reports. All results are
restricted on the Speck server to the token's Site; Chat also checks the returned
Site, device identity and current Slide client access. Archived machines are
excluded and moving a machine out of a Site removes its integration access.
Narrow the selected Site if it exceeds 5,000 records.

Data is the latest existing agent report, not a new scan. Use `last_seen`,
`collected_at` and patch `scanned` timestamps when judging freshness. Installed
software inventory is not collected by this integration. Commands, remote
sessions, files, configuration and recovery operations are unavailable, including
in Write mode or through the companion. The token grants no operator session or
agent authentication and is rejected when its creating admin is disabled or loses
the admin role.

Validation: source tests cover fixed origin, exact Site/client binding, hostile
cursors, wrong-device responses, unsupported categories and credential redaction.
The existing tool/API checks cover workspace isolation, CSRF, external companion
scope and read-only enforcement. Speck separately checks server-side token
creation, expiry, revocation, role changes, request limits and Site isolation.
