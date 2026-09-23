"""Evidence-backed network diagrams. Layout and identity joins are deterministic."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html import escape
import re
import textwrap

from .sources import SourceError, connector_data, scoped_inventory


def mac(value):
    value = re.sub(r"[:-]", "", str(value).lower())
    return value if re.fullmatch(r"[a-f0-9]{12}", value) and value not in ("0" * 12, "f" * 12) else ""


def name(row):
    return row.get("display_name") or row.get("name") or row.get("hostname") or row.get("agent_id") or row.get("device_id") or "Unnamed"


def network_data(fleet, connectors, client_id):
    scoped = scoped_inventory(fleet, client_id)
    clients = {c["client_id"]: name(c) for c in scoped["clients"]}
    devices = {d["device_id"]: d for d in scoped["devices"]}
    agents = {a["agent_id"]: a for a in scoped["agents"]}
    # Ambiguity is checked against the whole authorized account, including other clients.
    agent_macs = defaultdict(set)
    for a in fleet["agents"]:
        for address in a.get("addresses", []) or []:
            if isinstance(address, dict) and (m := mac(address.get("mac", ""))):
                agent_macs[m].add(a["agent_id"])
    groups, warnings, sources = [], [], []
    connected = [c for c in connectors if c["kind"] == "speckrmm" and (not client_id or c["client_id"] == client_id)]
    # An explicitly account-wide connection supersedes duplicate site sources in All clients.
    if not client_id and any(not c["client_id"] for c in connected):
        connected = [c for c in connected if not c["client_id"]]
    if not connected:
        warnings.append("No Speck RMM connection in this scope. Add one in Connections to include Proxmox hosts and guests.")
    seen = set()
    for c in connected:
        scoped_inventory(fleet, c["client_id"])
        try:
            data = connector_data(c, "topology")
        except SourceError as exc:
            warnings.append(c["name"] + ": " + str(exc))
            continue
        if not data.get("enabled"):
            warnings.append(c["name"] + ": this token has no Proxmox topology grants. Create a token with the relevant Proxmox connections in Speck Settings.")
        if data.get("unavailable_connections"):
            warnings.append(c["name"] + ": a granted Proxmox connection was removed.")
        for group in data.get("connections", []):
            if group["id"] in seen:
                continue
            seen.add(group["id"])
            sources.append({"name": c["name"], "connection": group["name"], "checked_at": group.get("checked_at"), "stale": group.get("stale", False)})
            if group.get("stale") or group.get("truncated") or group.get("status") != "connected":
                warnings.append(group["name"] + ": " + (group.get("error") or "Inventory incomplete.") + " Treat this topology as incomplete or stale.")
            groups.append(group)
    all_guests = [(g, r) for g in groups for r in g["resources"] if r["kind"] in ("qemu", "lxc")]
    mac_counts = Counter(m for _, r in all_guests for m in {mac(v) for v in r.get("identity", {}).get("macs", [])} if m)
    explicit_counts = Counter(r.get("endpoint", {}).get("slide_agent_id") for _, r in all_guests if r.get("endpoint", {}).get("slide_agent_id"))
    used, hosts, total = set(), [], 0
    def workload(a):
        box = devices.get(a.get("device_id"))
        return {"agent_id": a["agent_id"], "name": name(a), "client": clients.get(a.get("client_id"), "Client not reported"),
                "client_id": a.get("client_id"), "device_id": box.get("device_id") if box else None,
                "appliance": name(box) if box else "Slide appliance not returned"}
    for group in groups:
        nodes = {r["id"]: r for r in group["resources"] if r["kind"] == "node"}
        by_host = defaultdict(list)
        for row in group["resources"]:
            if row["kind"] not in ("qemu", "lxc"):
                continue
            total += 1
            endpoint_id = row.get("endpoint", {}).get("slide_agent_id")
            candidates = set()
            for v in row.get("identity", {}).get("macs", []):
                m = mac(v)
                if m and mac_counts[m] == 1 and len(agent_macs[m]) == 1:
                    candidates |= agent_macs[m]
            if endpoint_id:
                candidates.add(endpoint_id)
            match = agents.get(next(iter(candidates))) if len(candidates) == 1 and (not endpoint_id or explicit_counts[endpoint_id] == 1) else None
            guest = {"id": row["id"], "kind": row["kind"], "name": row["name"], "status": row.get("status", "unknown"),
                     "template": row.get("template", False), "client": "Client not established", "appliance": "Protection not established",
                     "match": "Unmatched" if not candidates else "Ambiguous or outside scope"}
            if match:
                guest.update(workload(match), name=row["name"], match="Slide agent ID" if endpoint_id else "Unique MAC")
                used.add(match["agent_id"])
            by_host[row.get("node") or "Placement not reported"].append(guest)
        for node in sorted(set(nodes) | set(by_host)):
            hosts.append({"name": node, "cluster": group["name"], "status": nodes.get(node, {}).get("status", "unknown"),
                          "stale": group.get("stale", False), "checked_at": group.get("checked_at"),
                          "guests": sorted(by_host[node], key=lambda r: r["name"].lower())})
    unplaced = [workload(a) for a in agents.values() if a["agent_id"] not in used]
    if unplaced:
        hosts.append({"name": "Placement unknown", "cluster": "Slide workloads", "status": "not established", "guests": unplaced})
    if total > 500:
        raise SourceError("This network contains more than 500 guests. Select one client or narrow the Speck topology grants.")
    return {"scope": clients.get(client_id, "All accessible clients"), "hosts": hosts,
            "clients": [{"client_id": c["client_id"], "name": name(c)} for c in scoped["clients"]],
            "appliances": [{"device_id": d["device_id"], "name": name(d), "serial_number": d.get("serial_number", "")} for d in scoped["devices"]],
            "sources": sources, "warnings": warnings,
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "note": "Edges show Proxmox placement and configured Slide protection via exact agent ID or unique hardware MAC. No hostname/IP matching. Unmatched is not proof of being unprotected. Backup success, replication, and recovery verification were not checked."}


def render_network(data, evidence_id):
    """One readable sheet per host, with additional sheets for more than 12 guests."""
    diagrams = []
    def txt(x, y, value, size=14, color="#334155", weight="400"):
        # Control characters and fence characters cannot break XML/Markdown framing.
        value = ''.join(c for c in str(value) if c >= ' ' or c in '\n\t').replace('`', '\u2019')
        return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}">{escape(value)}</text>'
    def lines(x, y, value, width=40, size=14, color="#334155", limit=2):
        chunks = textwrap.wrap(str(value), width=width) or [""]
        return ''.join(txt(x, y+i*(size+5), s if i < limit-1 or len(chunks) <= limit else s[:width-1]+"…", size, color) for i,s in enumerate(chunks[:limit]))
    hosts = data["hosts"] or [{"name": "No host inventory", "cluster": data["scope"], "guests": []}]
    for host in hosts:
        guests = host["guests"]
        for offset in range(0, max(1, len(guests)), 12):
            page = guests[offset:offset+12]
            height = max(420, 255 + max(1, len(page))*110)
            title = f'{data["scope"]} · {host["name"]}' + (f' · {offset//12+1}' if len(guests)>12 else '')
            svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 {height}" font-family="Arial, sans-serif">',
                   '<title>'+escape(title.replace('`', '’'))+'</title>', '<desc>Proxmox hosts, guests, client attribution and configured Slide protection. Unknown relationships are labeled. Protection links do not establish backup health.</desc>',
                   f'<rect width="1280" height="{height}" rx="20" fill="#f1f5f9"/>',
                   '<rect width="1280" height="104" rx="20" fill="#0f172a"/><rect y="70" width="1280" height="34" fill="#0f172a"/>',
                   txt(32,32,"SLIDE / NETWORK & PROTECTION",12,"#67e8f9","700"),
                   lines(32,70,title,85,25,"#ffffff",1),
                   txt(32,130,host["cluster"],14), txt(32,160,"HOST",11,"#64748b","700"),
                   txt(296,160,"WORKLOAD / CLIENT",11,"#64748b","700"), txt(950,160,"SLIDE APPLIANCE",11,"#64748b","700")]
            y=182
            svg += [f'<rect x="32" y="{y}" width="206" height="130" rx="12" fill="#1e293b"/>',
                    lines(48,y+30,host["name"],20,17,"#ffffff"), txt(48,y+86,host.get("status","unknown"),12,"#cbd5e1"),
                    txt(48,y+111,"Stale inventory" if host.get("stale") else f'{len(guests)} workloads',12,"#67e8f9")]
            boxes = {}
            for i, guest in enumerate(page):
                gid = guest.get("device_id")
                if gid and gid not in boxes:
                    boxes[gid] = (guest["appliance"], y+i*110)
            for i, guest in enumerate(page):
                gy=y+i*110
                if host["name"] != "Placement unknown":
                    svg.append(f'<path d="M238 {y+65} H266 V{gy+42} H296" fill="none" stroke="#cbd5e1" stroke-width="2"/>')
                gid = guest.get("device_id")
                if gid:
                    by=boxes[gid][1]
                    svg.append(f'<path d="M802 {gy+42} H{850+i*4} V{by+42} H950" fill="none" stroke="#14b8a6" stroke-width="2"/>')
                svg += [f'<rect x="296" y="{gy}" width="506" height="94" rx="12" fill="#ffffff" stroke="#e2e8f0"/>',
                        f'<rect x="296" y="{gy+16}" width="4" height="62" rx="2" fill="'+('#14b8a6' if gid else '#f59e0b')+'"/>',
                        lines(314,gy+27,guest["name"],52,16,"#0f172a",1),
                        lines(314,gy+49,guest["client"],65,12,"#475569",1),
                        txt(314,gy+73,("Template · " if guest.get("template") else "") + (f'{guest.get("kind", "Slide agent")} {guest.get("id", "")} · {guest.get("status", "Placement not established")}' if gid else guest["appliance"]),11,"#64748b")]
            for gid, (label, by) in boxes.items():
                svg += [f'<rect x="950" y="{by}" width="298" height="90" rx="12" fill="#ccfbf1" stroke="#5eead4"/>',
                        lines(966,by+28,label,30,16,"#115e59"),txt(966,by+69,"Configured protection",11,"#0f766e")]
            if not page:
                svg.append(txt(296,220,"No guests returned for this host.",15))
            svg += [txt(32,height-43,f'{evidence_id} · Observed {data["observed_at"][:19].replace("T", " ")} UTC',12,"#64748b"),
                    txt(32,height-22,"Lines: host placement / configured protection. Backup health not checked. Amber: protection not established.",12,"#64748b"), '</svg>']
            diagrams.append('\n'.join(svg))
    return diagrams
