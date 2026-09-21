import json
import tempfile
import unittest
from unittest.mock import patch

from app import create_app
from chat_core.agent import run_chat, TOOLS
from chat_core.choices import question_choices, clarification_context
from chat_core.sources import SourceError, compact_service_page

FLEET = {
    "clients": [
        {"client_id": "c1", "name": "Acme"},
        {"client_id": "c2", "name": "Other"},
    ],
    "agents": [],
    "devices": [],
}
QUESTION = {
    "question": "Which client?",
    "choices": [
        {"label": "Acme", "client_id": "c1"},
        {"label": "Other", "client_id": "c2"},
    ],
}


class ChoiceTests(unittest.TestCase):
    def test_client_reply_keeps_prior_task_and_clarifications_without_evidence(self):
        conversation = {
            "messages": [
                {
                    "role": "assistant",
                    "choices": QUESTION["choices"],
                    "content": "Which period?",
                    "reply_context": "Investigate failed backups",
                    "evidence": [{"data": "OTHER CLIENT FACTS"}],
                }
            ]
        }
        carried = clarification_context(conversation, "Last 7 days")
        self.assertIn("Investigate failed backups", carried)
        self.assertIn("Last 7 days", carried)
        self.assertIn("Which period?", carried)
        self.assertNotIn("OTHER CLIENT FACTS", carried)
        self.assertLessEqual(
            len(
                clarification_context(
                    {
                        "messages": [
                            {
                                "role": "assistant",
                                "choices": QUESTION["choices"],
                                "reply_context": "a" * 16000,
                            }
                        ]
                    },
                    "b" * 16000,
                )
            ),
            16000,
        )
        self.assertEqual(
            clarification_context(
                {"messages": [{"role": "assistant", "content": "Done."}]}, "New task"
            ),
            "New task",
        )

    def test_service_compaction_preserves_all_operational_records_and_pagination(self):
        rows = [
            {
                "name": "service" + str(i),
                "display_name": "Service " + str(i),
                "state": "Running",
                "startup": "Automatic",
                "verify_on_boot": i % 2 == 0,
                "description": "Long operating system help text. " * 100,
            }
            for i in range(200)
        ]
        page = compact_service_page({"data": rows, "pagination": {"next_offset": 200}})
        self.assertEqual(len(page["data"]), 200)
        self.assertEqual(page["pagination"], {"next_offset": 200})
        self.assertTrue(page["data"][198]["verify_on_boot"])
        self.assertFalse(page["data"][199]["verify_on_boot"])
        self.assertEqual(page["data"][199]["name"], "service199")
        self.assertNotIn("description", page["data"][0])
        self.assertLess(len(json.dumps(page)), 45000)

    def test_client_names_come_from_inventory_not_model(self):
        question = {
            **QUESTION,
            "choices": [
                {"label": "Disguised target", "client_id": "c1"},
                {"label": "Other", "client_id": "c2"},
            ],
        }
        self.assertEqual(
            question_choices(question, FLEET["clients"])[1][0]["label"], "Acme"
        )

    def test_unknown_or_out_of_scope_clients_rejected(self):
        with self.assertRaises(SourceError):
            question_choices(QUESTION, FLEET["clients"][:1])

    def test_duplicates_hidden_arguments_and_unbounded_choices_rejected(self):
        for choices in [
            [QUESTION["choices"][0]] * 2,
            QUESTION["choices"] * 5,
            [{**QUESTION["choices"][0], "execute": True}, QUESTION["choices"][1]],
        ]:
            with self.assertRaises(SourceError):
                question_choices({**QUESTION, "choices": choices}, FLEET["clients"])

    def test_generic_replies_are_literal_labels(self):
        choices = [
            {"label": "Last 24 hours", "client_id": ""},
            {"label": "Last 7 days", "client_id": ""},
        ]
        self.assertEqual(
            question_choices({"question": "Which period?", "choices": choices}, [])[1],
            choices,
        )

    def test_question_finishes_in_one_round_without_source_reads_or_proposals(self):
        payloads = []

        def events(payload, key):
            payloads.append(payload)
            yield {
                "type": "response.completed",
                "response": {
                    "output": [
                        {
                            "type": "function_call",
                            "name": "ask_question",
                            "arguments": json.dumps(QUESTION),
                            "call_id": "question",
                        }
                    ],
                    "usage": {"input_tokens": 100, "output_tokens": 20},
                },
            }

        with patch("chat_core.sources.Slide.get") as read, patch(
            "chat_core.actions.Actions.propose"
        ) as propose:
            result = list(
                run_chat(
                    {
                        "slide_key": "tk_fixture",
                        "openai_key": "sk_fixture",
                        "connectors": [],
                    },
                    {"messages": []},
                    "Check backups for this client",
                    inventory=FLEET,
                    event_stream=events,
                )
            )[-1]
            read.assert_not_called()
            propose.assert_not_called()
        self.assertEqual(len(payloads), 1)
        self.assertEqual(result["content"], "Which client?")
        self.assertEqual(result["choices"], QUESTION["choices"])
        self.assertEqual(result["reply_context"], "Check backups for this client")
        self.assertNotIn("ask_question", [t["name"] for t in TOOLS])

    def test_question_buttons_survive_saved_history(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app({"TESTING": True, "DATA_DIR": directory})
            store = app.extensions["chat_store"]
            wid = store.create("tk_fixture")
            store.update(wid, lambda s: s.update(openai_key="sk_fixture"))
            client = app.test_client()
            with client.session_transaction() as session:
                session["workspace"], session["csrf"] = wid, "test-csrf"
            done = {
                "type": "done",
                "content": QUESTION["question"],
                "choices": QUESTION["choices"],
                "reply_context": "Check backups",
                "evidence": [],
                "usage": {},
            }
            with patch("app.run_chat", return_value=iter([done])):
                response = client.post(
                    "/api/chat",
                    json={"message": "Check backups", "client_id": ""},
                    headers={"X-CSRF-Token": "test-csrf"},
                )
                self.assertEqual(response.status_code, 200)
                self.assertIn(b'"choices"', response.data)
            conversation = store.get(wid)["conversations"][0]
            message = client.get("/api/conversations/" + conversation["id"]).json[
                "messages"
            ][-1]
            self.assertEqual(message["choices"], QUESTION["choices"])
            self.assertEqual(message["reply_context"], "Check backups")
