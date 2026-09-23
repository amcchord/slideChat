import unittest
from unittest.mock import patch

from chat_core.sources import SourceError, connected_device, connector_data, redact, validate_connector


class SpeckIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.config = {"api_key": "speck_ro_" + "a" * 43, "site": "Clinic A"}
        self.connection = {"kind": "speckrmm", "name": "Speck clinic", "client_id": "c1", "config": self.config}
        self.inventory = {"clients": [{"client_id": "c1"}], "agents": [], "devices": []}
        self.device = {"id": "b" * 32, "site": "Clinic A"}

    def test_validation_and_credentials_redaction(self):
        self.assertEqual(validate_connector(self.connection, self.inventory)["config"], self.config)
        for override in ({"site": ""}, {"api_key": "operator-password"}, {"site": "Clinic\nA"}):
            with self.assertRaises(SourceError):
                validate_connector({**self.connection, "config": {**self.config, **override}}, self.inventory)
        with self.assertRaises(SourceError):
            validate_connector({**self.connection, "client_id": "different"}, self.inventory)
        self.assertNotIn(self.config["api_key"], str(redact({"api_key": self.config["api_key"], "text": self.config["api_key"]})))

    @patch("chat_core.sources.request_json")
    def test_inventory_fixed_origin_and_pagination(self, request):
        request.side_effect = [
            {"site": "Clinic A", "devices": [self.device], "next_cursor": "b" * 32},
            {"site": "Clinic A", "devices": [{"id": "c" * 32, "site": "Clinic A"}], "next_cursor": None},
        ]
        data = connector_data(self.connection)
        self.assertEqual(len(data["devices"]), 2)
        self.assertEqual(request.call_args.args[0], "https://speckrmm.com/api/integrations/v1/devices")
        self.assertEqual(request.call_args.kwargs["params"]["after"], "b" * 32)
        self.assertEqual(request.call_args.kwargs["headers"]["Authorization"], "Bearer " + self.config["api_key"])

    @patch("chat_core.sources.request_json")
    def test_wrong_site_or_device_and_pagination_rejected(self, request):
        for response in (
            {"site": "Other", "devices": []},
            {"site": "Clinic A", "devices": [{"id": "b" * 32, "site": "Other"}]},
            {"site": "Clinic A", "devices": [self.device], "next_cursor": "https://attacker.invalid"},
        ):
            request.return_value = response
            with self.assertRaises(SourceError):
                connector_data(self.connection)
        request.return_value = {"site": "Clinic A", "devices": [self.device], "next_cursor": "b" * 32}
        with self.assertRaises(SourceError):
            connector_data(self.connection)
        request.return_value = {"site": "Clinic A", "device": {"id": "c" * 32, "site": "Clinic A"}}
        with self.assertRaises(SourceError):
            connected_device(self.connection, "b" * 32, "detail")

    @patch("chat_core.sources.request_json")
    def test_read_categories_and_unsupported_operations(self, request):
        request.return_value = {"site": "Clinic A", "alerts": [{"id": "a"}]}
        self.assertEqual(connector_data(self.connection, "alerts")["state"], "active")
        request.return_value = {"site": "Clinic A", "device_id": "b" * 32, "available": False}
        self.assertFalse(connected_device(self.connection, "b" * 32, "patches")["available"])
        with self.assertRaises(SourceError):
            connected_device(self.connection, "../other", "detail")
        with self.assertRaises(SourceError):
            connected_device(self.connection, "b" * 32, "software")
        with self.assertRaises(SourceError):
            connector_data(self.connection, "invoices")


if __name__ == "__main__":
    unittest.main()
