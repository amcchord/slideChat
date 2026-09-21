import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import Mock, patch
from app import create_app
from chat_core.agent import Toolbox, run_chat, hosted_key_available
from chat_core.sources import (
    Slide,
    SourceError,
    redact,
    scoped_inventory,
    connector_data,
    validate_connector,
)
from chat_core.store import Store

FLEET = {
    "clients": [
        {"client_id": "c1", "name": "Acme"},
        {"client_id": "c2", "name": "Other"},
    ],
    "devices": [{"device_id": "d1"}, {"device_id": "d2"}],
    "agents": [
        {"agent_id": "a1", "client_id": "c1", "device_id": "d1"},
        {"agent_id": "a2", "client_id": "c2", "device_id": "d2"},
    ],
}
STATE = {"slide_key": "tk_test", "openai_key": "sk-private-test", "connectors": []}


class SourceTests(unittest.TestCase):
    def test_client_scope_joins_devices_through_agents(self):
        scoped = scoped_inventory(FLEET, "c1")
        self.assertEqual([d["device_id"] for d in scoped["devices"]], ["d1"])
        self.assertEqual([a["agent_id"] for a in scoped["agents"]], ["a1"])
        with self.assertRaises(SourceError):
            scoped_inventory(FLEET, "unknown")

    def test_cannot_query_an_agent_or_connector_from_another_client(self):
        box = Toolbox(
            {**STATE, "connectors": [{"id": "other", "client_id": "c2"}]}, "c1", FLEET
        )
        with self.assertRaises(SourceError):
            box.call("slide_agent", {"agent_id": "a2"})
        with self.assertRaises(SourceError):
            box.call("connected_data", {"source_id": "other", "category": "inventory"})
        with self.assertRaises(SourceError):
            box.call("delete_agent", {"agent_id": "a1"})
        with self.assertRaises(SourceError):
            box.call("slide_inventory", {"url": "http://169.254.169.254"})

    def test_activity_rechecks_scope_even_if_api_ignores_filter(self):
        box = Toolbox(STATE, "c1", FLEET)
        box.slide.get = Mock(
            return_value={"data": [{"agent_id": "a1"}, {"agent_id": "a2"}]}
        )
        data = box.call("slide_activity", {"agent_id": "a1", "kind": "alert"})
        self.assertEqual(data["data"]["recent_page"]["data"], [{"agent_id": "a1"}])

    def test_secret_fields_removed_recursively(self):
        result = redact(
            {
                "passphrases": ["secret"],
                "host": "server",
                "nested": [{"client_secret": "secret", "name": "ok"}],
                "note": "tk_" + "a" * 30,
            }
        )
        self.assertNotIn("secret", json.dumps(result))
        self.assertNotIn("a" * 30, json.dumps(result))
        self.assertEqual(result["nested"], [{"name": "ok"}])

    def test_pagination_falls_back_without_next_offset_and_rejects_loop(self):
        slide = Slide("key")
        slide.get = Mock(
            side_effect=[{"data": [{"n": x} for x in range(50)]}, {"data": [{"n": 50}]}]
        )
        self.assertEqual(len(slide.all("agent")), 51)
        self.assertEqual(slide.get.call_args_list[1].args[1]["offset"], 50)
        slide.get = Mock(
            return_value={"data": [1] * 50, "pagination": {"next_offset": 0}}
        )
        with self.assertRaises(SourceError):
            slide.all("agent")

    @patch("chat_core.sources.request_json")
    def test_stripe_customer_binding_and_cursor(self, request):
        request.side_effect = [
            {"data": [{"id": "in_1", "customer": "cus_123"}], "has_more": True},
            {"data": [{"id": "in_2", "customer": "cus_123"}], "has_more": False},
        ]
        c = {
            "kind": "stripe",
            "config": {"api_key": "rk_test", "customer_id": "cus_123"},
        }
        self.assertEqual(len(connector_data(c)["invoices"]), 2)
        for call in request.call_args_list:
            self.assertEqual(call.args[0], "https://api.stripe.com/v1/invoices")
            self.assertEqual(call.kwargs["params"]["customer"], "cus_123")
        self.assertEqual(request.call_args.kwargs["params"]["starting_after"], "in_1")

    @patch("chat_core.sources.request_json")
    def test_ninja_pagination_and_device_ownership(self, request):
        from chat_core.sources import ninja_devices, connected_device

        request.side_effect = [[{"id": x} for x in range(1, 101)], [{"id": 101}]]
        rows = ninja_devices("https://app.ninjaone.com", {}, 7)
        self.assertEqual(len(rows), 101)
        self.assertEqual(request.call_args.kwargs["params"]["after"], 100)
        request.side_effect = [{"access_token": "test"}, [{"id": 10}]]
        c = {
            "kind": "ninjaone",
            "config": {
                "region": "us",
                "organization_id": "7",
                "client_id": "id",
                "client_secret": "secret",
            },
        }
        with self.assertRaises(SourceError):
            connected_device(c, "99", "software")
        self.assertEqual(request.call_count, 4)

    def test_external_url_and_unmapped_source_are_rejected(self):
        with self.assertRaises(SourceError):
            validate_connector(
                {"kind": "web", "config": {"url": "http://localhost"}}, FLEET
            )
        with self.assertRaises(SourceError):
            validate_connector(
                {
                    "kind": "import",
                    "name": "Import",
                    "client_id": "",
                    "records": [{"a": 1}],
                },
                FLEET,
            )

    @patch("chat_core.sources.requests.request")
    def test_redirects_are_rejected_without_secret_forwarding(self, request):
        request.return_value = Mock(status_code=302, headers={})
        with self.assertRaises(SourceError):
            Slide("private-token").get("agent")
        self.assertFalse(request.call_args.kwargs["allow_redirects"])
        self.assertEqual(request.call_count, 1)


class AgentTests(unittest.TestCase):
    def test_hosted_openai_key_requires_explicit_slide_allowlist(self):
        import hashlib

        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "sk-host", "CHAT_HOSTED_SLIDE_KEY_HASHES": ""},
        ):
            self.assertFalse(hosted_key_available(STATE))
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "sk-host",
                "CHAT_HOSTED_SLIDE_KEY_HASHES": hashlib.sha256(
                    STATE["slide_key"].encode()
                ).hexdigest(),
            },
        ):
            self.assertTrue(hosted_key_available(STATE))
            self.assertFalse(hosted_key_available({"slide_key": "other"}))

    def test_responses_tool_loop_retains_reasoning_and_returns_evidence(self):
        requests = []

        def events(payload, key):
            requests.append(payload)
            if len(requests) == 1:
                yield {
                    "type": "response.completed",
                    "response": {
                        "output": [
                            {"type": "reasoning", "encrypted_content": "opaque"},
                            {
                                "type": "function_call",
                                "name": "slide_inventory",
                                "arguments": "{}",
                                "call_id": "call_1",
                            },
                        ],
                        "usage": {"input_tokens": 10, "output_tokens": 3},
                    },
                }
            else:
                yield {
                    "type": "response.output_text.delta",
                    "delta": "One protected agent. [S1]",
                }
                yield {
                    "type": "response.completed",
                    "response": {
                        "output": [],
                        "usage": {"input_tokens": 20, "output_tokens": 4},
                    },
                }

        output = list(
            run_chat(STATE, {"messages": []}, "Count agents", "c1", FLEET, events)
        )
        done = output[-1]
        self.assertEqual(done["content"], "One protected agent. [S1]")
        self.assertEqual(done["usage"], {"input_tokens": 30, "output_tokens": 7})
        self.assertEqual(len(done["evidence"][0]["data"]["agents"]), 1)
        self.assertIn(
            {"type": "reasoning", "encrypted_content": "opaque"}, requests[1]["input"]
        )
        for payload in requests:
            self.assertEqual(payload["model"], "gpt-6-astra")
            self.assertFalse(payload["store"])
            self.assertNotIn("temperature", payload)
            self.assertNotIn("top_p", payload)

    def test_failed_stream_never_reports_done(self):
        def events(payload, key):
            yield {"type": "response.output_text.delta", "delta": "partial"}

        with self.assertRaises(SourceError):
            list(run_chat(STATE, {"messages": []}, "hello", "c1", FLEET, events))


class StoreAndAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app({"TESTING": True, "DATA_DIR": self.temp.name})
        self.client = self.app.test_client()
        self.store = self.app.extensions["chat_store"]
        self.wid = self.store.create("tk-private-test")
        with self.client.session_transaction() as session:
            session["workspace"] = self.wid
            session["csrf"] = "csrf-test"

    def tearDown(self):
        self.temp.cleanup()

    def test_state_is_encrypted_and_isolated(self):
        self.store.update(
            self.wid,
            lambda state: state.update(
                openai_key="sk-private-key", notes="confidential-server"
            ),
        )
        raw = self.store.path.read_bytes()
        self.assertNotIn(b"sk-private-key", raw)
        self.assertNotIn(b"confidential-server", raw)
        other = self.store.create("other")
        self.assertNotIn("openai_key", self.store.get(other))
        self.assertEqual(self.store.get(self.wid)["openai_key"], "sk-private-key")

    def test_browser_get_with_json_content_type(self):
        self.assertEqual(
            self.client.get(
                "/api/session", headers={"Content-Type": "application/json"}
            ).status_code,
            200,
        )

    def test_csrf_protection_and_token_rotation(self):
        self.assertEqual(self.client.post("/api/token", json={}).status_code, 403)
        token = self.client.post(
            "/api/token", json={}, headers={"X-CSRF-Token": "csrf-test"}
        ).json["token"]
        self.assertEqual(self.store.authenticate(token), self.wid)
        replacement = self.store.token(self.wid)
        self.assertIsNone(self.store.authenticate(token))
        self.assertEqual(self.store.authenticate(replacement), self.wid)
        self.store.delete(self.wid)
        self.assertIsNone(self.store.authenticate(replacement))

    def test_cookie_cannot_bypass_companion_auth(self):
        response = self.client.post(
            "/api/tools/call", json={"name": "slide_inventory", "arguments": {}}
        )
        self.assertEqual(response.status_code, 401)

    def test_conversation_access_is_per_workspace(self):
        self.store.update(
            self.wid,
            lambda state: state["conversations"].append(
                {"id": "private", "title": "Secret"}
            ),
        )
        other = self.app.test_client()
        self.assertEqual(other.get("/api/conversations/private").status_code, 401)
        self.assertEqual(
            self.client.get("/api/conversations/private").json["title"], "Secret"
        )

    def test_lease_and_request_budget(self):
        self.assertTrue(self.store.acquire(self.wid))
        self.assertFalse(self.store.acquire(self.wid))
        self.store.release(self.wid)
        self.assertTrue(self.store.acquire(self.wid))
        with patch.dict(os.environ, {"CHAT_DAILY_WORKSPACE_REQUESTS": "1"}):
            self.assertTrue(self.store.allow_request("key-a"))
            self.assertFalse(self.store.allow_request("key-a"))
            self.assertTrue(self.store.allow_request("key-b"))

    def test_download_has_working_skill_and_no_workspace_data(self):
        response = self.client.get("/downloads/slide-chat-companion.zip")
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            self.assertIn("slide-chat/SKILL.md", archive.namelist())
            self.assertIn("slide-chat/scripts/slide_chat.py", archive.namelist())
            self.assertNotIn(
                b"tk-private-test",
                b"".join(archive.read(n) for n in archive.namelist()),
            )


if __name__ == "__main__":
    unittest.main()
