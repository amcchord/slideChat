"""Fixed-origin, bounded read adapters. Tools cannot choose a URL or an HTTP method."""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import requests


class SourceError(Exception):
    pass


def request_json(url, *, headers=None, params=None, data=None, auth=None):
    # URLs are assembled only by fixed adapters below; redirects never carry credentials.
    for attempt in range(3 if data is None else 1):
        try:
            response = requests.request(
                "POST" if data is not None else "GET",
                url,
                headers=headers,
                params=params,
                data=data,
                auth=auth,
                timeout=(5, 30),
                allow_redirects=False,
            )
        except requests.RequestException:
            if data is None and attempt < 2:
                time.sleep(0.25 * (2**attempt))
                continue
            raise SourceError(
                "The source did not respond. Try again shortly."
            ) from None
        if (
            response.status_code in (429, 502, 503, 504)
            and attempt < 2
            and data is None
        ):
            retry_after = response.headers.get("Retry-After", "0.5")
            try:
                delay = float(retry_after)
            except ValueError:
                try:
                    retry_at = parsedate_to_datetime(retry_after)
                    if retry_at.tzinfo is None:
                        retry_at = retry_at.replace(tzinfo=timezone.utc)
                    delay = (retry_at - datetime.now(timezone.utc)).total_seconds()
                except (ValueError, TypeError, OverflowError):
                    delay = 0.5
            if delay > 5:
                raise SourceError(
                    "The source requested a longer retry delay. Try again later; this request was not retried early."
                )
            delay = max(0.25, delay)
            time.sleep(delay)
            continue
        if not 200 <= response.status_code < 300:
            raise SourceError(
                f"Source returned HTTP {response.status_code}. Check permissions and connection settings."
            )
        if len(response.content) > 8_000_000:
            raise SourceError("Source response exceeds 8 MB. Narrow the query.")
        try:
            return response.json()
        except ValueError:
            raise SourceError("Source returned invalid JSON.") from None


SECRET_FIELD = re.compile(
    r"(password|passphrase|secret|token|authorization|private.key|recovery.key|api.?key|access.?key|credential|download.uri|vnc)",
    re.I,
)


def redact(value):
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items() if not SECRET_FIELD.search(k)}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return re.sub(
            r"\b(?:tk_|sk-|sk_live_|rk_live_|sc_)[A-Za-z0-9_-]{16,}",
            "[credential removed]",
            value,
        )[:10000]
    return value


def compact_service_page(page):
    """Keep every returned service and operational field without verbose OS help text."""
    if not isinstance(page, dict) or not isinstance(page.get("data"), list):
        raise SourceError("Unexpected service collection shape.")
    fields = ("name", "display_name", "state", "startup", "verify_on_boot")
    return {
        **{key: value for key, value in page.items() if key != "data"},
        "data": [
            {key: row[key] for key in fields if key in row}
            for row in page["data"]
            if isinstance(row, dict)
        ],
        "note": "Descriptions and service IDs omitted. All returned service names, states, startup settings and verification flags retained. This is the returned page, not proof of application recovery or a dependency map.",
    }


def compact_alert_page(page):
    """Keep operational evidence structured; embedded inventory is historical, not live."""
    for row in page.get("data", []):
        raw = row.pop("alert_fields", None)
        if not raw:
            continue
        try:
            fields = json.loads(raw) if isinstance(raw, str) else raw
        except (ValueError, TypeError):
            fields = raw
        if isinstance(fields, dict):
            details = {
                k: v
                for k, v in fields.items()
                if k not in ("account", "agent", "device")
            }
            for kind in ("agent", "device"):
                source = fields.get(kind)
                if isinstance(source, dict):
                    details[kind] = {
                        k: v
                        for k, v in source.items()
                        if k
                        in (
                            "name",
                            "hostname",
                            "last_seen",
                            "storage_used",
                            "storage_total",
                            "storage_health",
                            "storage_available",
                        )
                    }
            details = redact(details)
        else:
            details = redact(fields)
        encoded = json.dumps(details, ensure_ascii=False)
        row["details_at_alert_time"] = (
            details
            if len(encoded) <= 1500
            else {"excerpt": encoded[:1500], "truncated": True}
        )
    return page


class Slide:
    def __init__(self, key):
        self.headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}

    def get(self, path, params=None):
        if not re.fullmatch(r"[A-Za-z0-9_/-]+", path) or ".." in path:
            raise SourceError("Invalid Slide resource.")
        return request_json(
            "https://api.slide.tech/v1/" + path, headers=self.headers, params=params
        )

    def all(self, path, params=None, max_pages=100):
        records, offset = [], 0
        for _ in range(max_pages):
            page = self.get(path, {**(params or {}), "limit": 50, "offset": offset})
            if not isinstance(page, dict) or not isinstance(page.get("data"), list):
                raise SourceError("Unexpected Slide collection shape.")
            rows = page["data"]
            records.extend(rows)
            next_offset = page.get("pagination", {}).get(
                "next_offset", page.get("next_offset")
            )
            if not rows or (len(rows) < 50 and next_offset is None):
                return records
            next_offset = (
                int(next_offset) if next_offset is not None else offset + len(rows)
            )
            if next_offset <= offset:
                raise SourceError("Slide pagination did not advance.")
            offset = next_offset
        raise SourceError(
            "Inventory exceeds the current 5,000-record limit. Narrow the API key scope."
        )

    def inventory(self):
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(self.all, ["client", "device", "agent"]))
        return dict(zip(["clients", "devices", "agents"], results))


def scoped_inventory(inventory, client_id):
    if not client_id:
        return inventory
    clients = [c for c in inventory["clients"] if c.get("client_id") == client_id]
    if not clients:
        raise SourceError("Selected client is not accessible with this Slide key.")
    directly_owned = {
        d.get("device_id")
        for d in inventory["devices"]
        if d.get("client_id") == client_id
    }
    agents = [
        a
        for a in inventory["agents"]
        if a.get("client_id") == client_id
        or (not a.get("client_id") and a.get("device_id") in directly_owned)
    ]
    device_ids = directly_owned | {a.get("device_id") for a in agents}
    devices = [d for d in inventory["devices"] if d.get("device_id") in device_ids]
    return {"clients": clients, "devices": devices, "agents": agents}


NINJA_HOSTS = {
    "us": "https://app.ninjaone.com",
    "eu": "https://eu.ninjaone.com",
    "oc": "https://oc.ninjaone.com",
}


def ninja_auth(config):
    base = NINJA_HOSTS[config["region"]]
    token = request_json(
        base + "/ws/oauth/token",
        data={
            "grant_type": "client_credentials",
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "scope": "monitoring",
        },
    )
    if not isinstance(token.get("access_token"), str):
        raise SourceError("NinjaOne did not return an access token.")
    return base, {"Authorization": "Bearer " + token["access_token"]}


def ninja_devices(base, headers, organization):
    records, after = [], 0
    for _ in range(51):
        rows = request_json(
            f"{base}/v2/organization/{organization}/devices",
            headers=headers,
            params={"pageSize": 100, "after": after},
        )
        if not isinstance(rows, list):
            raise SourceError("Unexpected NinjaOne inventory shape.")
        records.extend(rows)
        if len(records) > 5000:
            raise SourceError("NinjaOne inventory exceeds 5,000 records.")
        if len(rows) < 100:
            return records
        cursor = rows[-1].get("id")
        if not isinstance(cursor, int) or cursor <= after:
            raise SourceError("NinjaOne pagination did not advance.")
        after = cursor
    raise SourceError("NinjaOne inventory pagination limit reached.")


def connected_device(connector, device_id, category):
    if connector["kind"] != "ninjaone" or not device_id.isdigit():
        raise SourceError("Choose a NinjaOne device ID from the connected inventory.")
    config = connector["config"]
    base, headers = ninja_auth(config)
    devices = ninja_devices(base, headers, int(config["organization_id"]))
    if int(device_id) not in {d.get("id") for d in devices}:
        raise SourceError("This RMM device is outside the mapped client organization.")
    suffix = {
        "detail": "",
        "software": "/software",
        "volumes": "/volumes",
        "services": "/windows-services",
    }.get(category)
    if suffix is None:
        raise SourceError("Unsupported device detail category.")
    return request_json(f"{base}/v2/device/{int(device_id)}{suffix}", headers=headers)


def connector_data(connector, category="inventory"):
    config = connector["config"]
    if connector["kind"] == "import":
        return {
            "records": connector["records"],
            "snapshot": True,
            "imported_at": connector["updated"],
        }
    if connector["kind"] == "ninjaone":
        base, headers = ninja_auth(config)
        org = int(config["organization_id"])
        return {
            "devices": ninja_devices(base, headers, org),
            "organization_id": org,
            "scope": "monitoring",
        }
    if connector["kind"] == "stripe":
        if category not in ("invoices", "subscriptions", "inventory"):
            raise SourceError("Choose invoices or subscriptions for billing.")
        endpoint = "subscriptions" if category == "subscriptions" else "invoices"
        params = {"customer": config["customer_id"], "limit": 100}
        if endpoint == "subscriptions":
            params["status"] = "all"
        rows = []
        for _ in range(10):
            page = request_json(
                "https://api.stripe.com/v1/" + endpoint,
                headers={
                    "Authorization": "Bearer " + config["api_key"],
                    "Stripe-Version": "2025-04-30.basil",
                },
                params=params,
            )
            batch = page.get("data", [])
            if not isinstance(batch, list) or any(
                not isinstance(row, dict) for row in batch
            ):
                raise SourceError("Unexpected Stripe collection shape.")
            if any(row.get("customer") != config["customer_id"] for row in batch):
                raise SourceError(
                    "Stripe returned a record outside the mapped customer."
                )
            rows.extend(batch)
            if not page.get("has_more"):
                return {
                    endpoint: rows,
                    "customer_id": config["customer_id"],
                    "amounts": "Stripe amounts are integer minor currency units. Respect currency-specific decimal rules.",
                }
            if not batch:
                raise SourceError("Stripe pagination did not advance.")
            params["starting_after"] = batch[-1]["id"]
        return {
            endpoint: rows,
            "truncated": True,
            "warning": "Only first 1,000 records; do not report complete totals.",
        }
    raise SourceError("Unknown connector.")


def validate_connector(body, inventory):
    kind = body.get("kind")
    if kind not in ("ninjaone", "stripe", "import"):
        raise SourceError("Choose a supported source.")
    client_id = str(body.get("client_id", ""))
    scoped_inventory(inventory, client_id)
    if not client_id:
        raise SourceError("Bind this source to a Slide client.")
    name = str(body.get("name", "")).strip()[:80]
    if not name:
        raise SourceError("Give the connection a name.")
    config = body.get("config", {})
    if not isinstance(config, dict):
        raise SourceError("Invalid connection settings.")
    clean = {}
    required = {
        "ninjaone": ["client_id", "client_secret", "organization_id", "region"],
        "stripe": ["api_key", "customer_id"],
        "import": [],
    }[kind]
    for field in required:
        value = str(config.get(field, "")).strip()
        if not value or len(value) > 2000 or "\n" in value or "\r" in value:
            raise SourceError("Complete all connection fields.")
        clean[field] = value
    if kind == "ninjaone" and (
        clean["region"] not in NINJA_HOSTS or not clean["organization_id"].isdigit()
    ):
        raise SourceError("Choose a NinjaOne region and numeric organization ID.")
    if kind == "stripe" and (
        not re.fullmatch(r"cus_[A-Za-z0-9]+", clean["customer_id"])
        or not clean["api_key"].startswith(("rk_", "sk_"))
    ):
        raise SourceError("Provide a Stripe customer ID and API key.")
    result = {
        "kind": kind,
        "name": name,
        "client_id": client_id,
        "config": clean,
        "updated": datetime.now(timezone.utc).isoformat(),
    }
    if kind == "import":
        rows = body.get("records")
        if (
            not isinstance(rows, list)
            or not rows
            or len(rows) > 5000
            or any(not isinstance(row, dict) for row in rows)
        ):
            raise SourceError("Import a JSON array or CSV with 1–5,000 records.")
        if len(json.dumps(rows)) > 2_000_000:
            raise SourceError("Import must be smaller than 2 MB.")
        result["records"] = redact(rows)
    return result
