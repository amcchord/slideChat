"""Presentation metadata derived only from observed Slide records."""

import re
from datetime import datetime, timezone
from .sources import redact

FIELDS = {
    "client": ("name", "comments"),
    "device": (
        "display_name",
        "hostname",
        "last_seen_at",
        "device_version",
        "storage_used_bytes",
        "storage_total_bytes",
    ),
    "agent": (
        "hostname",
        "platform",
        "os_version",
        "agent_version",
        "last_seen_at",
        "backup_paused_until",
        "backup_paused_indefinite",
        "sealed",
        "timezone",
    ),
    "backup": (
        "status",
        "started_at",
        "ended_at",
        "error_code",
        "error_message",
        "snapshot_id",
    ),
    "snapshot": (
        "backup_started_at",
        "backup_ended_at",
        "verify_boot_status",
        "verify_fs_status",
        "verify_service_status",
        "deleted",
    ),
    "alert": ("alert_type", "created_at", "resolved", "resolved_at"),
}
LABELS = {
    "os_version": "OS version",
    "verify_boot_status": "Boot verification",
    "verify_fs_status": "Filesystem verification",
    "verify_service_status": "Service verification",
    "last_seen_at": "Last seen",
    "backup_started_at": "Backup started",
    "backup_ended_at": "Backup ended",
    "backup_paused_until": "Backups paused until",
    "backup_paused_indefinite": "Paused indefinitely",
    "sealed": "Encryption sealed",
}
TOKEN = re.compile(
    r"\[\[(client|device|agent|backup|snapshot|alert):([A-Za-z0-9_-]+)\]\]"
)


def collect(evidence):
    name, data = evidence["tool"], evidence["data"]
    if not isinstance(data, dict) or data.get("truncated"):
        return []
    rows = []
    if name == "slide_inventory":
        for kind in ("client", "device", "agent"):
            rows.extend((kind, r) for r in data.get(kind + "s", []))
    elif name == "network_diagram":
        rows = [("client", row) for row in data.get("clients", [])]
        rows.extend(("device", row) for row in data.get("appliances", []))
        seen = set()
        for host in data.get("hosts", []):
            for guest in host.get("guests", []):
                if guest.get("agent_id") and guest["agent_id"] not in seen:
                    seen.add(guest["agent_id"])
                    rows.append(("agent", {"agent_id": guest["agent_id"], "display_name": guest["name"],
                                           "client_id": guest.get("client_id"), "device_id": guest.get("device_id")}))
    elif name == "slide_agent":
        rows = [("agent", data.get("agent", {}))]
    elif name in ("slide_activity", "slide_device_alerts"):
        kind = (
            "alert" if name == "slide_device_alerts" else evidence["arguments"]["kind"]
        )
        rows = [(kind, r) for r in data.get("recent_page", {}).get("data", [])]
    entities = []
    for kind, raw in rows:
        row = redact(raw)
        identity = row.get(kind + "_id")
        if not isinstance(identity, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,100}", identity
        ):
            continue
        label = row.get("display_name") or row.get("hostname") or row.get("name")
        if not label:
            if kind == "alert":
                label = (
                    str(row.get("alert_type", "Alert")).replace("_", " ").capitalize()
                )
            else:
                stamp = row.get("started_at") or row.get("backup_started_at")
                try:
                    label = (
                        datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
                        .astimezone(timezone.utc)
                        .strftime("%Y-%m-%d %H:%M UTC")
                        if stamp
                        else identity
                    )
                except ValueError:
                    label = str(stamp) if stamp else identity
        status = row.get("status", "")
        if kind == "alert":
            status = (
                "resolved"
                if row.get("resolved") is True
                else "unresolved" if row.get("resolved") is False else ""
            )
        fields = [{"label": "ID", "value": identity}]
        for key in FIELDS[kind]:
            if (
                key in row
                and row[key] is not None
                and isinstance(row[key], (str, int, float, bool))
            ):
                value = (
                    "Yes"
                    if row[key] is True
                    else "No" if row[key] is False else str(row[key])
                )
                fields.append(
                    {
                        "label": LABELS.get(key, key.replace("_", " ").capitalize()),
                        "value": value[:1000],
                    }
                )
        for key in ("client_id", "device_id", "agent_id"):
            if key != kind + "_id" and row.get(key):
                fields.append(
                    {"label": key.replace("_id", "").title(), "value": str(row[key])}
                )
        if kind == "snapshot" and isinstance(row.get("locations"), list):
            locations = [
                (
                    str(
                        r.get("type")
                        or r.get("location")
                        or r.get("location_type")
                        or "Reported location"
                    )
                    if isinstance(r, dict)
                    else str(r)
                )
                for r in row["locations"]
            ]
            fields.append({"label": "Locations", "value": ", ".join(locations)[:1000]})
        entities.append(
            {
                "ref": kind + ":" + identity,
                "type": kind,
                "id": identity,
                "label": str(label)[:180],
                "status": status,
                "fields": fields,
                "source_ids": [evidence["id"]],
                "observed_at": evidence["observed_at"],
            }
        )
    return entities


def plain_markdown(text, entities):
    index = {e["ref"]: e for e in entities}

    def expand(match):
        entity = index.get(match[1] + ":" + match[2])
        if not entity:
            return match[1].title() + " `" + match[2] + "`"
        readable = entity["label"]
        if match[1] in ("backup", "snapshot") and not readable.lower().startswith(
            match[1]
        ):
            readable = match[1].title() + " " + readable
        label = re.sub(r"([\\`*_{}\[\]<>|])", r"\\\1", readable)
        return label + " (`" + entity["id"] + "`)"

    return TOKEN.sub(expand, text)
