# SVG diagrams — September 23, 2026

Production at https://chat.slide.recipes uses runtime `97cb58c`, including `ebbee19` and `7e66d54`. SVG generation, inline image previews, expanded zoom/pan, SVG downloads, encrypted history, Markdown exports and entity chips are enabled. The rendering path rebuilds an allowlisted static SVG document, then uses image context; scripts, CSS, external assets, foreign content and events cannot survive preview/download. Partial SVG streams show a placeholder, and invalid final SVG retains an explicit source fallback.

The read-only network diagram tool joins current Slide client/agent/appliance inventory with explicitly granted Speck Proxmox topology. Exact Slide agent IDs and unique hardware MACs establish protection joins; names/IPs never do. Layout is deterministic, with up to 12 workloads per sheet and all returned workloads retained in evidence. The model receives a compact summary so large networks do not exhaust output budgets. Unknown relationships, stale/incomplete sources, client filtering and the distinction between configured protection and backup health remain explicit.

Single-client Speck connections are bound to one named site. Account-wide connections require site `*` and All clients; they are rejected within an individual-client scope. Speck's companion release adds opt-in topology grants, global identity ambiguity checks and site-matched guest/parent filtering. Existing tokens gain no permissions.

## Validation

- 62 Python tests and 32 frontend tests passed, plus JavaScript syntax and Git whitespace checks. Regression coverage includes hostile SVG, partial streams, download equivalence, zoom/close/focus behavior, exact/ambiguous joins, missing sources, client isolation, split layouts, and streamed/saved SVG content.
- Chromium local fixture: desktop and 390-pixel phone width, expanded pan/zoom, saved-history reload, no document overflow and no console errors.
- Safari production: the real model generated and displayed a fictional SVG; a real single-client request drew five guests, their parent host, client labels and configured Slide appliance; the all-clients request drew all 7 hosts and 183 guests in 18 SVG sheets, with 12 protection matches across 3 appliances. No backup, recovery, guest command or host operation ran. Exact live topology checks and customer diagrams are retained only in ignored private output.
- Saved evidence is complete, all 18 SVG documents parse, entity references render as chips, and account-wide inventory/topology reads are rejected inside the client scope.
- Both public health endpoints are healthy; public Chat assets match release hashes. Deployments verified baseline hashes and idle workspaces, backed up code and private state, and gracefully reloaded workers. Brief public 502s occurred during the initial worker handover and cleared; subsequent checks and live streams succeeded.

Two explicitly scoped read-only Speck connections were configured in the tested browser workspace. Its five BYD endpoints, verified by their existing Slide agent IDs, were assigned the BYD site while preserving tags and maintenance settings. The existing Newark site was preserved. Tokens expire after 30 days and remain revocable in Speck Settings.

## Recovery

Production code lives under `/opt/slide-recipes/releases/20260923T014416Z-speck/chat`. Root-only guarded rollback scripts on slide.recipes are under `/var/backups/slide-chat/svg-97cb58c`, `/var/backups/slide-chat/svg-7e66d54`, and `/var/backups/slide-chat/svg-ebbee19-2`. After checking for active work and later deployments, run the scripts in that reverse order to restore the pre-feature runtime. Current workspace data and credentials remain intact; extra unused JavaScript/Python modules are harmless. The initial backup-only attempt (`svg-ebbee19`) stopped before code mutation because the encryption key is environment-backed; the successful backup includes that environment file. Do not restore old workspace databases over current conversations.

Speck source/rollout details are in its `docs/operations/chat-topology.md`. This rollout preserved the newer Proxmox machine and alerts releases and was coordinated with their release owner.
