import copy
import json
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
import requests
from app import create_app
from chat_core.actions import Actions, UnknownOutcome, dispatch
from chat_core.agent import TOOLS, Toolbox, run_chat
from chat_core.entities import collect, plain_markdown
from chat_core.sources import Slide, SourceError, compact_alert_page

FLEET = {
    "clients": [
        {"client_id": "c1", "name": "Acme"},
        {"client_id": "c2", "name": "Other"},
    ],
    "devices": [
        {"device_id": "d1", "client_id": "c1"},
        {"device_id": "d2", "client_id": "c2"},
    ],
    "agents": [
        {
            "agent_id": "a1",
            "device_id": "d1",
            "client_id": "c1",
            "display_name": "Acme Files",
        },
        {"agent_id": "a2", "device_id": "d2", "client_id": "c2"},
    ],
}
AGENT = {
    **FLEET["agents"][0],
    "backup_paused_indefinite": False,
    "backup_paused_until": None,
    "sealed": False,
    "comments": "Existing notes",
}


class ActionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app({"TESTING": True, "DATA_DIR": self.temp.name})
        self.store = self.app.extensions["chat_store"]
        self.wid = self.store.create("tk-private-test")
        self.store.update(
            self.wid, lambda s: s.update(mode="write", openai_key="sk-test")
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as s:
            s["workspace"], s["csrf"] = self.wid, "csrf"
        self.headers = {"X-CSRF-Token": "csrf"}
        self.inventory = patch.object(
            Slide, "inventory", return_value=copy.deepcopy(FLEET)
        ).start()
        self.get = patch.object(Slide, "get", return_value=copy.deepcopy(AGENT)).start()
        self.dispatch = patch(
            "chat_core.actions.dispatch",
            return_value={"backup_id": "b1", "status": "created"},
        ).start()
        self.actions = Actions(self.store, self.wid, self.store.get(self.wid))

    def tearDown(self):
        patch.stopall()
        self.temp.cleanup()

    def proposal(self, action="start_backup", value="", target="a1", client="c1"):
        return self.actions.propose(
            {"action": action, "target_id": target, "value": value},
            client,
            "conversation",
        )

    def execute(self, proposal, **changes):
        body = {
            "confirmation": proposal["confirmation"],
            "client_id": proposal["client_id"],
            **changes,
        }
        return self.client.post(
            "/api/actions/" + proposal["id"] + "/execute",
            json=body,
            headers=self.headers,
        )

    def test_proposal_never_executes_and_durable_single_dispatch(self):
        p = self.proposal()
        self.dispatch.assert_not_called()
        self.assertNotIn("_body", p)
        self.assertNotIn(b"Acme Files", self.store.path.read_bytes())
        response = self.execute(p)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["action"]["status"], "succeeded")
        self.assertIn(
            "accepted the backup request", response.json["action"]["result"]["message"]
        )
        self.dispatch.assert_called_once()
        self.assertEqual(
            self.dispatch.call_args.args[1:], ("POST", "backup", {"agent_id": "a1"})
        )
        self.assertEqual(self.execute(p).status_code, 400)
        self.dispatch.assert_called_once()
        self.assertEqual(
            Actions(self.store, self.wid, self.store.get(self.wid)).read(p["id"])[
                "status"
            ],
            "succeeded",
        )

    def test_scope_and_exact_review_are_enforced(self):
        for target, client in (("a2", "c1"), ("a1", ""), ("../agent/a1", "c1")):
            with self.assertRaises(SourceError):
                self.proposal(target=target, client=client)
        p = self.proposal()
        self.assertEqual(self.execute(p, client_id="c2").status_code, 400)
        self.assertEqual(self.execute(p, confirmation="other").status_code, 400)
        self.dispatch.assert_not_called()
        other = self.store.create("other")
        with self.assertRaises(SourceError):
            Actions(self.store, other, self.store.get(other)).read(p["id"])
        self.assertEqual(self.actions.read(p["id"])["status"], "pending")

    def test_read_mode_and_csrf_and_companion_cannot_write(self):
        p = self.proposal()
        self.store.update(self.wid, lambda s: s.update(mode="read"))
        self.assertEqual(self.execute(p).status_code, 400)
        self.assertEqual(
            self.client.post("/api/mode", json={"mode": "write"}).status_code, 403
        )
        token = self.store.token(self.wid)
        response = self.client.post(
            "/api/mode",
            json={"mode": "write"},
            headers={**self.headers, "Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("propose_slide_action", [t["name"] for t in TOOLS])
        self.dispatch.assert_not_called()

    def test_current_scope_and_preconditions_rechecked(self):
        p = self.proposal("rename_agent", "New name")
        self.get.return_value = {**AGENT, "display_name": "Changed elsewhere"}
        response = self.execute(p)
        self.assertEqual(response.json["action"]["status"], "failed")
        self.assertIn("target changed", response.json["action"]["result"]["message"])
        self.dispatch.assert_not_called()
        self.get.return_value = AGENT
        p = self.proposal()
        self.inventory.return_value = {**FLEET, "agents": [FLEET["agents"][1]]}
        self.assertEqual(self.execute(p).json["action"]["status"], "failed")
        self.dispatch.assert_not_called()

    def test_timeout_never_replays_and_crash_is_unknown(self):
        p = self.proposal()
        self.dispatch.side_effect = UnknownOutcome("Check Slide; not retried.")
        self.assertEqual(self.execute(p).json["action"]["status"], "unknown")
        self.assertEqual(self.execute(p).status_code, 400)
        self.dispatch.assert_called_once()
        p = self.proposal()
        self.actions.change(
            p["id"], lambda a: a.update(status="running", started_at=time.time() - 150)
        )
        self.assertEqual(self.actions.read(p["id"])["status"], "unknown")
        self.assertEqual(self.execute(p).status_code, 400)
        self.dispatch.assert_called_once()

    def test_cancel_expiry_and_busy_workspace_block_execution(self):
        p = self.proposal()
        self.actions.cancel(p["id"])
        self.assertEqual(self.execute(p).status_code, 400)
        p = self.proposal()
        self.actions.change(p["id"], lambda a: a.update(expires_at=time.time() - 1))
        self.assertEqual(self.actions.read(p["id"])["status"], "expired")
        self.assertEqual(self.execute(p).status_code, 400)
        p = self.proposal()
        self.store.acquire(self.wid)
        self.assertEqual(self.execute(p).status_code, 409)
        self.assertEqual(
            self.client.post(
                "/api/mode", json={"mode": "read"}, headers=self.headers
            ).status_code,
            409,
        )
        self.dispatch.assert_not_called()

    def test_atomic_claim_across_workers(self):
        p = self.proposal()

        def run(_):
            try:
                return Actions(self.store, self.wid, self.store.get(self.wid)).execute(
                    p["id"], p["confirmation"], "c1"
                )["status"]
            except SourceError:
                return "blocked"

        with ThreadPoolExecutor(max_workers=4) as pool:
            outcomes = list(pool.map(run, range(4)))
        self.assertEqual(outcomes.count("succeeded"), 1)
        self.assertEqual(outcomes.count("blocked"), 3)
        self.dispatch.assert_called_once()

    def test_all_supported_changes_use_pinned_documented_bodies(self):
        from datetime import datetime, timezone

        until = datetime.fromtimestamp(time.time() + 3600, timezone.utc).isoformat()
        cases = [
            (
                "pause_backups",
                until,
                {
                    "backup_paused_until": until.replace("+00:00", "Z"),
                    "backup_paused_indefinite": False,
                },
            ),
            ("resume_backups", "", {"backup_resume": True}),
            ("rename_agent", "Files 2", {"display_name": "Files 2"}),
            ("update_agent_comments", "New notes", {"comments": "New notes"}),
        ]
        for name, value, body in cases:
            p = self.proposal(name, value)
            self.assertEqual(self.execute(p).json["action"]["status"], "succeeded")
            self.assertEqual(
                self.dispatch.call_args.args[1:], ("PATCH", "agent/a1", body)
            )
        for value in (
            "tomorrow",
            "2026-01-01T12:00:00Z",
            "2030-01-01T12:00:00Z",
            "2026-09-22T12:00:00",
        ):
            with self.assertRaises(SourceError):
                self.proposal("pause_backups", value)
        with self.assertRaises(SourceError):
            self.proposal("rename_agent", "x" * 129)
        with self.assertRaises(SourceError):
            self.proposal("start_backup", "ignored-injection")
        for name, resolved in (("resolve_alert", True), ("reopen_alert", False)):
            self.get.return_value = {
                "alert_id": "al1",
                "agent_id": "a1",
                "device_id": "d1",
                "alert_type": "agent_backup_failed",
                "resolved": not resolved,
            }
            p = self.proposal(name, target="al1")
            self.execute(p)
            self.assertEqual(
                self.dispatch.call_args.args[1:],
                ("PATCH", "alert/al1", {"resolved": resolved}),
            )
        self.get.return_value = {
            "alert_id": "al2",
            "agent_id": "a2",
            "device_id": "d2",
            "resolved": False,
        }
        with self.assertRaises(SourceError):
            self.proposal("resolve_alert", target="al2")

    def test_model_can_only_propose_and_history_includes_fresh_receipt(self):
        captured = []

        def events(payload, key):
            captured.append(copy.deepcopy(payload))
            if len(captured) == 1:
                yield {
                    "type": "response.completed",
                    "response": {
                        "output": [
                            {
                                "type": "function_call",
                                "name": "propose_slide_action",
                                "arguments": json.dumps(
                                    {
                                        "action": "start_backup",
                                        "target_id": "a1",
                                        "value": "",
                                    }
                                ),
                                "call_id": "call1",
                            }
                        ]
                    },
                }
            else:
                yield {
                    "type": "response.output_text.delta",
                    "delta": "Review the backup request below.",
                }
                yield {"type": "response.completed", "response": {"output": []}}

        output = list(
            run_chat(
                self.store.get(self.wid),
                {"messages": []},
                "Start a backup of Acme Files",
                "c1",
                FLEET,
                events,
                propose=lambda args: self.actions.propose(args, "c1", "c"),
            )
        )
        self.assertEqual(output[-1]["actions"][0]["status"], "pending")
        self.assertIn("propose_slide_action", [t["name"] for t in captured[0]["tools"]])
        self.dispatch.assert_not_called()
        self.assertNotIn(
            output[-1]["actions"][0]["confirmation"], json.dumps(captured[-1])
        )

    def test_chat_reloads_mode_under_lease_and_disconnect_preserves_active_receipt(
        self,
    ):
        acquire = self.store.acquire

        def acquire_after_mode_change(wid):
            self.store.update(wid, lambda state: state.update(mode="read"))
            return acquire(wid)

        seen = []

        def stream(state, *args, **kwargs):
            seen.append(state["mode"])
            yield {"type": "done", "content": "Read only", "evidence": [], "usage": {}}

        with patch.object(
            self.store, "acquire", side_effect=acquire_after_mode_change
        ), patch("app.run_chat", stream):
            response = self.client.post(
                "/api/chat",
                json={"message": "Analyze", "client_id": "c1"},
                headers=self.headers,
            )
            response.get_data()
        self.assertEqual(seen, ["read"])
        p = self.proposal()
        self.assertTrue(self.store.acquire(self.wid))
        self.assertEqual(
            self.client.delete("/api/session", headers=self.headers).status_code, 409
        )
        self.assertEqual(
            self.client.post(
                "/api/session",
                json={"slide_key": "tk_replacement"},
                headers=self.headers,
            ).status_code,
            409,
        )
        self.assertIsNotNone(self.store.get(self.wid))
        self.assertEqual(self.actions.read(p["id"])["status"], "pending")

    def test_device_alerts_filter_other_clients_even_if_upstream_filter_ignored(self):
        box = Toolbox(self.store.get(self.wid), "c1", FLEET)
        self.get.return_value = {
            "data": [
                {"alert_id": "al_device", "device_id": "d1", "resolved": False},
                {
                    "alert_id": "al_agent",
                    "device_id": "d1",
                    "agent_id": "a1",
                    "resolved": False,
                },
                {"alert_id": "al_other", "device_id": "d1", "agent_id": "a2"},
                {"alert_id": "al_device2", "device_id": "d2"},
            ]
        }
        result = box.call("slide_device_alerts", {"device_id": "d1"})
        self.assertEqual(
            [r["alert_id"] for r in result["data"]["recent_page"]["data"]],
            ["al_device", "al_agent"],
        )
        self.assertEqual(set(box.entities), {"alert:al_device", "alert:al_agent"})
        with self.assertRaises(SourceError):
            box.call("slide_device_alerts", {"device_id": "d2"})

    def test_saved_conversation_refreshes_action_receipts_and_exports_entity_names(
        self,
    ):
        p = self.proposal()
        convo = {
            "id": "c",
            "title": "Backup",
            "client_id": "c1",
            "updated": time.time(),
            "messages": [
                {
                    "role": "assistant",
                    "content": "[[agent:a1]] [S1]",
                    "entities": [
                        {"ref": "agent:a1", "id": "a1", "label": "Acme Files"}
                    ],
                    "actions": [p],
                }
            ],
        }
        self.store.update(self.wid, lambda s: s["conversations"].append(convo))
        self.actions.cancel(p["id"])
        response = self.client.get("/api/conversations/c")
        self.assertEqual(
            response.json["messages"][0]["actions"][0]["status"], "cancelled"
        )
        exported = self.client.get("/api/conversations/c/export").data.decode()
        self.assertIn("Acme Files (`a1`)", exported)
        self.assertIn("cancelled", exported)
        self.assertNotIn("[[", exported)


class DispatchAndEntityTests(unittest.TestCase):
    @patch("chat_core.actions.requests.request")
    def test_mutation_never_retries_or_follows_redirects(self, request):
        for response in (
            requests.Timeout(),
            Mock(status_code=503),
            Mock(status_code=302),
        ):
            request.reset_mock()
            request.side_effect = response if isinstance(response, Exception) else None
            request.return_value = response
            with self.assertRaises(SourceError):
                dispatch(Slide("private"), "POST", "backup", {"agent_id": "a1"})
            self.assertEqual(request.call_count, 1)
            self.assertFalse(request.call_args.kwargs["allow_redirects"])

    def test_alert_details_are_compact_redacted_and_explicitly_historical(self):
        page = {
            "data": [
                {
                    "alert_id": "al1",
                    "alert_fields": json.dumps(
                        {
                            "account": {"name": "Private"},
                            "device": {
                                "name": "Appliance",
                                "storage_used": 123,
                                "addresses": ["10.0.0.1"],
                            },
                            "backup_error_message": "VSS timeout",
                            "client_secret": "must-remove",
                        }
                    ),
                }
            ]
        }
        result = compact_alert_page(page)["data"][0]
        self.assertNotIn("alert_fields", result)
        self.assertEqual(
            result["details_at_alert_time"]["backup_error_message"], "VSS timeout"
        )
        self.assertNotIn("must-remove", json.dumps(result))
        self.assertNotIn("Private", json.dumps(result))
        self.assertNotIn("10.0.0.1", json.dumps(result))
        self.assertEqual(result["details_at_alert_time"]["device"]["storage_used"], 123)

    def test_entities_are_typed_observed_and_exports_remain_readable(self):
        evidence = {
            "id": "S1",
            "tool": "slide_activity",
            "arguments": {"kind": "backup"},
            "observed_at": "2026-09-21T12:00:00Z",
            "data": {
                "recent_page": {
                    "data": [
                        {
                            "backup_id": "b1",
                            "agent_id": "a1",
                            "snapshot_id": "s1",
                            "status": "succeeded",
                            "started_at": "2026-09-21T11:00:00Z",
                            "private_key": "secret",
                        }
                    ]
                }
            },
        }
        entities = collect(evidence)
        self.assertEqual([e["ref"] for e in entities], ["backup:b1"])
        self.assertNotIn("secret", json.dumps(entities))
        text = plain_markdown("[[backup:b1]] [S1] and [[agent:a2]]", entities)
        self.assertNotIn("[[", text)
        self.assertIn("Backup", text)
        self.assertIn("`a2`", text)
        self.assertEqual(collect({**evidence, "data": {"truncated": True}}), [])


if __name__ == "__main__":
    unittest.main()
