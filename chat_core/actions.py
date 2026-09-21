"""Human-reviewed, client-bound Slide changes with durable single-dispatch receipts."""

import json
import re
import secrets
import time
from datetime import datetime, timezone
import requests
from .sources import Slide, SourceError, redact, scoped_inventory

CATALOG = {
    "start_backup": "Start backup",
    "pause_backups": "Pause backups",
    "resume_backups": "Resume backups",
    "rename_agent": "Rename agent",
    "update_agent_comments": "Update agent notes",
    "resolve_alert": "Resolve alert",
    "reopen_alert": "Reopen alert",
}


class UnknownOutcome(SourceError):
    pass


def dispatch(slide, method, path, body):
    """Exactly one HTTP attempt. Never replay a mutation after an ambiguous outcome."""
    try:
        response = requests.request(
            method,
            "https://api.slide.tech/v1/" + path,
            headers=slide.headers,
            json=body,
            timeout=(5, 30),
            allow_redirects=False,
        )
    except requests.RequestException:
        raise UnknownOutcome(
            "Slide did not confirm the result. Check the target in Slide before requesting another change; this action will not be retried."
        ) from None
    if response.status_code >= 500 or response.status_code in (408, 409):
        raise UnknownOutcome(
            "Slide did not confirm the result. Check the target in Slide before requesting another change; this action will not be retried."
        )
    if not 200 <= response.status_code < 300:
        raise SourceError(
            f"Slide rejected the change (HTTP {response.status_code}). Check the API key’s write permissions and the target’s current state."
        )
    try:
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError()
    except ValueError:
        raise UnknownOutcome(
            "Slide accepted the request but returned an unreadable result. Check the target in Slide; this action will not be retried."
        ) from None
    return redact(result)


class Actions:
    def __init__(self, store, wid, state):
        self.store, self.wid, self.state = store, wid, state
        self.slide = Slide(state["slide_key"])
        with store.connection() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, payload BLOB NOT NULL)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS actions_workspace ON actions(workspace)"
            )
            db.execute(
                "DELETE FROM actions WHERE workspace NOT IN (SELECT id FROM workspaces)"
            )

    def public(self, action):
        return {k: v for k, v in action.items() if not k.startswith("_")}

    def read(self, action_id):
        with self.store.connection() as db:
            row = db.execute(
                "SELECT payload FROM actions WHERE id=? AND workspace=?",
                (action_id, self.wid),
            ).fetchone()
        if not row:
            raise SourceError("Action not found in this workspace.")
        action = json.loads(self.store.cipher.decrypt(row[0]))
        if action["status"] == "pending" and action["expires_at"] < time.time():
            return self.change(
                action_id,
                lambda a: (
                    a.update(status="expired") if a["status"] == "pending" else None
                ),
            )
        if (
            action["status"] == "running"
            and action.get("started_at", 0) < time.time() - 120
        ):
            return self.change(
                action_id,
                lambda a: (
                    a.update(
                        status="unknown",
                        result={
                            "message": "Execution was interrupted. Check the target in Slide before requesting another change; this action will not be retried."
                        },
                    )
                    if a["status"] == "running"
                    else None
                ),
            )
        return action

    def change(self, action_id, mutate):
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT payload FROM actions WHERE id=? AND workspace=?",
                (action_id, self.wid),
            ).fetchone()
            if not row:
                raise SourceError("Action not found in this workspace.")
            action = json.loads(self.store.cipher.decrypt(row[0]))
            mutate(action)
            db.execute(
                "UPDATE actions SET payload=? WHERE id=? AND workspace=?",
                (self.store.encode(action), action_id, self.wid),
            )
        return action

    def target(self, action, target_id, client_id):
        if not client_id:
            raise SourceError("Select one client before preparing a change.")
        if not isinstance(target_id, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,100}", target_id
        ):
            raise SourceError("Invalid target identifier.")
        inventory = self.slide.inventory()
        fleet = scoped_inventory(inventory, client_id)
        kind = "alert" if action in ("resolve_alert", "reopen_alert") else "agent"
        ids = {a["agent_id"] for a in fleet["agents"]}
        if kind == "agent" and target_id not in ids:
            raise SourceError("This agent is outside the selected client scope.")
        row = self.slide.get(f"{kind}/{target_id}")
        if not isinstance(row, dict) or row.get(kind + "_id") != target_id:
            raise SourceError("Slide returned an unexpected target record.")
        if kind == "agent":
            # Recheck the detail response too, in case ownership changed during the reads.
            if row.get("client_id") and row["client_id"] != client_id:
                raise SourceError(
                    "The target’s client has changed. Refresh the context."
                )
            if row.get("device_id") not in {d["device_id"] for d in fleet["devices"]}:
                raise SourceError(
                    "The target’s device is outside the selected client scope."
                )
        else:
            if row.get("agent_id"):
                allowed = row["agent_id"] in ids
            else:
                device = next(
                    (
                        d
                        for d in inventory["devices"]
                        if d.get("device_id") == row.get("device_id")
                    ),
                    {},
                )
                owners = {
                    a.get("client_id")
                    for a in inventory["agents"]
                    if a.get("device_id") == row.get("device_id")
                }
                allowed = device.get("client_id") == client_id or (
                    bool(device)
                    and not device.get("client_id")
                    and owners == {client_id}
                )
            if not allowed:
                raise SourceError("This alert is outside the selected client scope.")
            if row.get("device_id") and row["device_id"] not in {
                d["device_id"] for d in fleet["devices"]
            }:
                raise SourceError(
                    "This alert’s device is outside the selected client scope."
                )
        return kind, row

    def plan(self, name, row, value):
        if not isinstance(value, str):
            raise SourceError("Action value must be text.")
        if (
            name not in ("pause_backups", "rename_agent", "update_agent_comments")
            and value
        ):
            raise SourceError("This action does not accept an additional value.")
        target_id = row.get("agent_id")
        path, method = "agent/" + str(target_id), "PATCH"
        keys, after = [], {}
        if name == "start_backup":
            method, path, body = "POST", "backup", {"agent_id": target_id}
            keys = ["sealed", "backup_paused_until", "backup_paused_indefinite"]
            after = {"Backup": "Request one new backup"}
            summary = "Requests a backup now. The job can continue after this chat; acceptance does not mean the backup completed."
        elif name in ("pause_backups", "resume_backups"):
            keys = ["backup_paused_until", "backup_paused_indefinite"]
            if name == "pause_backups":
                try:
                    until = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    if (
                        until.tzinfo is None
                        or not 60 < until.timestamp() - time.time() <= 7 * 86400
                    ):
                        raise ValueError()
                except ValueError:
                    raise SourceError(
                        "Provide an exact pause end time with a time zone, between one minute and seven days from now."
                    ) from None
                value = (
                    until.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                )
                body = {"backup_paused_until": value, "backup_paused_indefinite": False}
                after = {"Backups paused until": value, "Paused indefinitely": False}
                summary = "Scheduled backups stop until this time, leaving a gap in new recovery points. Replaces any existing pause, including an indefinite pause."
            else:
                body = {"backup_resume": True}
                after = {"Backup schedule": "Resumed", "Paused indefinitely": False}
                summary = "Clears the timed or indefinite pause and resumes scheduled backups. This does not request an immediate backup."
        elif name == "rename_agent":
            if (
                not value.strip()
                or len(value) > 128
                or any(ord(c) < 32 for c in value)
                or redact(value) != value
            ):
                raise SourceError("Provide an agent display name of 1–128 characters.")
            keys, body = ["display_name"], {"display_name": value.strip()}
            after = {"Display name": value.strip()}
            summary = "Changes the agent’s display name in Slide. The server hostname is unchanged."
        elif name == "update_agent_comments":
            if len(value) > 4000 or redact(value) != value:
                raise SourceError(
                    "Provide notes of up to 4,000 characters without credentials."
                )
            keys, body = ["comments"], {"comments": value}
            after = {"Notes": value or "(empty)"}
            summary = "Replaces the agent’s existing notes with the text shown here."
        else:
            path = "alert/" + row["alert_id"]
            keys, body = ["resolved"], {"resolved": name == "resolve_alert"}
            after = {"Resolved": body["resolved"]}
            summary = "Changes the alert’s resolved status. Resolving an alert does not fix the underlying cause."
        expected = {key: row.get(key) for key in keys}
        labels = {
            "backup_paused_until": "Backups paused until",
            "backup_paused_indefinite": "Paused indefinitely",
            "comments": "Notes",
            "display_name": "Display name",
            "resolved": "Resolved",
            "sealed": "Encryption sealed",
        }
        before = {
            labels[k]: redact(v) if v is not None else "Not reported"
            for k, v in expected.items()
        }
        # Pin identity as well as the fields being changed; display names and ownership can move.
        expected.update(
            {
                k: row.get(k)
                for k in (
                    "agent_id",
                    "device_id",
                    "client_id",
                    "display_name",
                    "alert_type",
                )
            }
        )
        return method, path, body, before, after, expected, summary

    def propose(self, arguments, client_id, conversation_id):
        if self.state.get("mode", "read") != "write":
            raise SourceError("Enable Write mode before preparing a change.")
        if (
            not isinstance(arguments, dict)
            or set(arguments) != {"action", "target_id", "value"}
            or arguments.get("action") not in CATALOG
        ):
            raise SourceError("Unsupported action or arguments.")
        name = arguments["action"]
        kind, row = self.target(name, arguments["target_id"], client_id)
        method, path, body, before, after, expected, summary = self.plan(
            name, row, arguments["value"]
        )
        label = (
            row.get("display_name")
            or row.get("hostname")
            or row.get("alert_type", "Alert").replace("_", " ")
        )
        action = {
            "id": secrets.token_urlsafe(18),
            "action": name,
            "label": CATALOG[name],
            "target": {
                "type": kind,
                "id": arguments["target_id"],
                "label": redact(label),
            },
            "client_id": client_id,
            "conversation_id": conversation_id,
            "summary": summary,
            "before": before,
            "after": after,
            "status": "pending",
            "created_at": time.time(),
            "expires_at": time.time() + 900,
            "confirmation": secrets.token_urlsafe(32),
            "_method": method,
            "_path": path,
            "_body": body,
            "_expected": expected,
        }
        with self.store.connection() as db:
            db.execute(
                "INSERT INTO actions VALUES(?,?,?)",
                (action["id"], self.wid, self.store.encode(action)),
            )
        return self.public(action)

    def cancel(self, action_id):
        def cancel(action):
            if action["status"] == "pending":
                action.update(status="cancelled", finished_at=time.time())

        return self.public(self.change(action_id, cancel))

    def execute(self, action_id, confirmation, client_id):
        if self.state.get("mode", "read") != "write":
            raise SourceError("Enable Write mode to execute a reviewed change.")

        def claim(action):
            if action["status"] != "pending":
                raise SourceError(
                    "This action has already been handled. Refresh its result; it cannot be replayed."
                )
            if action["client_id"] != client_id:
                raise SourceError("Select the proposal’s client before executing it.")
            if action["expires_at"] <= time.time():
                raise SourceError(
                    "This proposal expired. Ask Chat to prepare a fresh change."
                )
            if not isinstance(confirmation, str) or not secrets.compare_digest(
                action["confirmation"], confirmation
            ):
                raise SourceError("Review this exact proposal before executing it.")
            action.update(status="running", started_at=time.time())

        action = self.change(action_id, claim)
        try:
            _, row = self.target(action["action"], action["target"]["id"], client_id)
            if any(row.get(k) != v for k, v in action["_expected"].items()):
                raise SourceError(
                    "The target changed since this proposal was prepared. No change was sent. Ask Chat to prepare a fresh proposal."
                )
            if action["action"] == "pause_backups":
                self.plan(action["action"], row, action["_body"]["backup_paused_until"])
            result = dispatch(
                self.slide, action["_method"], action["_path"], action["_body"]
            )
            status = "succeeded"
            message = (
                "Slide accepted the backup request. Check backup activity for its progress."
                if action["action"] == "start_backup"
                else "Slide accepted the change."
            )
            outcome = {"message": message, "data": result}
        except UnknownOutcome as exc:
            status, outcome = "unknown", {"message": str(exc)}
        except SourceError as exc:
            status, outcome = "failed", {"message": str(exc)}
        except Exception:
            status, outcome = "unknown", {
                "message": "Execution was interrupted. Check the target in Slide before requesting another change; this action will not be retried."
            }
        return self.public(
            self.change(
                action_id,
                lambda a: a.update(
                    status=status, result=outcome, finished_at=time.time()
                ),
            )
        )
