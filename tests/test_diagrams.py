import copy
import json
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch
from chat_core.diagrams import network_data, render_network
from chat_core.agent import Toolbox, run_chat
from chat_core.sources import validate_connector, SourceError

FLEET = {
    'clients': [{'client_id': 'c1', 'name': 'Clinic A'}, {'client_id': 'c2', 'name': 'Other'}],
    'devices': [{'device_id': 'd1', 'display_name': 'Slide One'}, {'device_id': 'd2', 'display_name': 'Other Box'}],
    'agents': [{'agent_id': 'a1', 'client_id': 'c1', 'device_id': 'd1', 'hostname': 'server', 'addresses': [{'mac': '00:11:22:33:44:55'}]},
               {'agent_id': 'a2', 'client_id': 'c2', 'device_id': 'd2', 'hostname': 'server'}],
}
SOURCE = {'id': 's1', 'kind': 'speckrmm', 'name': 'Clinic RMM', 'client_id': 'c1', 'config': {'site': 'Clinic A', 'api_key': 'speck_ro_'+'a'*43}}
DATA = {'site': 'Clinic A', 'enabled': True, 'connections': [{'id': 'cluster1', 'name': 'Cluster', 'status': 'connected', 'checked_at': 1,
    'resources': [{'id': 'pve1', 'name': 'pve1', 'node': 'pve1', 'kind': 'node'},
                  {'id': '101', 'name': 'VM One', 'kind': 'qemu', 'node': 'pve1', 'identity': {'macs': ['001122334455']}},
                  {'id': '102', 'name': 'server', 'kind': 'qemu', 'node': 'pve1', 'identity': {}}]}]}

class DiagramTests(unittest.TestCase):
    @patch('chat_core.diagrams.connector_data', return_value=DATA)
    def test_joins_exact_macs_and_preserves_unknowns_without_name_guess(self, read):
        graph = network_data(FLEET, [SOURCE], 'c1')
        guests = graph['hosts'][0]['guests']
        matched = next(g for g in guests if g['id']=='101')
        self.assertEqual(matched['device_id'], 'd1')
        self.assertEqual(matched['client'], 'Clinic A')
        self.assertNotIn('agent_id', next(g for g in guests if g['id']=='102'))
        self.assertNotIn('Other Box', json.dumps(graph))
        self.assertIn('not proof', graph['note'])
        read.assert_called_once_with(SOURCE, 'topology')

    @patch('chat_core.diagrams.connector_data', return_value=DATA)
    def test_duplicate_mac_anywhere_in_account_is_ambiguous(self, read):
        fleet = copy.deepcopy(FLEET)
        fleet['agents'][1]['addresses'] = fleet['agents'][0]['addresses']
        graph = network_data(fleet, [SOURCE], 'c1')
        self.assertNotIn('agent_id', graph['hosts'][0]['guests'][0])
        self.assertEqual(graph['hosts'][-1]['name'], 'Placement unknown')

    @patch('chat_core.diagrams.connector_data')
    def test_full_network_source_is_inaccessible_in_client_scope(self, read):
        all_source = {**SOURCE, 'client_id': '', 'config': {**SOURCE['config'], 'site': '*'}}
        graph = network_data(FLEET, [all_source], 'c1')
        read.assert_not_called()
        self.assertIn('No Speck', graph['warnings'][0])
        box = Toolbox({'slide_key': 'x', 'connectors': [all_source]}, 'c1', FLEET)
        with self.assertRaises(SourceError):
            box.call('connected_data', {'source_id': 's1', 'category': 'topology'})
        validate_connector(all_source, FLEET)
        with self.assertRaises(SourceError): validate_connector({**all_source, 'client_id': 'c1'}, FLEET)
        with self.assertRaises(SourceError): validate_connector({**SOURCE, 'client_id': ''}, FLEET)

    @patch('chat_core.diagrams.connector_data', return_value=DATA)
    def test_all_clients_and_explicit_id_join(self, read):
        data = copy.deepcopy(DATA)
        data['connections'][0]['resources'][1]['identity'] = {}
        data['connections'][0]['resources'][1]['endpoint'] = {'slide_agent_id': 'a1'}
        read.return_value = data
        graph = network_data(FLEET, [SOURCE], '')
        self.assertEqual(next(g for g in graph['hosts'][0]['guests'] if g['id']=='101')['match'], 'Slide agent ID')
        self.assertEqual(len(graph['clients']), 2)

    @patch('chat_core.diagrams.connector_data', side_effect=SourceError('Unavailable'))
    def test_failure_still_produces_slide_diagram_and_limitation(self, read):
        graph = network_data(FLEET, [SOURCE], 'c1')
        self.assertIn('Unavailable', graph['warnings'][0])
        self.assertEqual(graph['hosts'][0]['name'], 'Placement unknown')
        self.assertIn('Slide One', render_network(graph, 'S1')[0])

    @patch('chat_core.diagrams.connector_data', return_value=DATA)
    def test_large_layout_splits_without_omitting_guests_and_escapes_labels(self, read):
        graph = network_data(FLEET, [SOURCE], 'c1')
        graph['hosts'][0]['guests'] = [{'name': f'VM {i} <script> & "', 'client': 'Clinic', 'appliance': 'Unknown'} for i in range(25)]
        drawings = render_network(graph, 'S1')
        self.assertEqual(len(drawings), 3)
        for drawing in drawings: ET.fromstring(drawing)
        self.assertNotIn('<script>', ''.join(drawings))
        self.assertIn('VM 24', drawings[-1])

    @patch('chat_core.diagrams.connector_data', return_value=DATA)
    def test_agent_loop_streams_and_saves_same_svg_without_model_markup(self, read):
        count = 0
        def stream(payload, key):
            nonlocal count
            count += 1
            if count == 1:
                yield {'type': 'response.completed', 'response': {'output': [{'type': 'function_call', 'name': 'network_diagram', 'arguments': '{}', 'call_id': 'test'}]}}
            else:
                yield {'type': 'response.output_text.delta', 'delta': 'Placement and configured protection. [S1]'}
                yield {'type': 'response.completed', 'response': {'output': []}}
        state = {'slide_key': 'x', 'openai_key': 'test', 'connectors': [{**SOURCE, 'updated':'today'}]}
        events = list(run_chat(state, {'messages': []}, 'Draw my network diagram', 'c1', FLEET, event_stream=stream))
        final = events[-1]
        self.assertEqual(final['type'], 'done')
        self.assertEqual(final['content'], ''.join(e['text'] for e in events if e['type']=='delta'))
        self.assertIn('```svg', final['content'])
        self.assertIn('Clinic A', final['content'])
        self.assertEqual(final['evidence'][0]['tool'], 'network_diagram')
