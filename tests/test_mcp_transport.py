import json
import subprocess
import unittest
from unittest.mock import patch,Mock
from mcp_manager import MCPManager

class MCPTests(unittest.TestCase):
    @patch('mcp_manager.subprocess.run')
    def test_json_protocol_and_key_stays_out_of_argv(self,run):
        run.return_value=Mock(stdout='{"method":"notifications/progress"}\n'+json.dumps({'result':{'content':[{'text':'ok'}]},'id':3,'jsonrpc':'2.0'}))
        result=MCPManager().call_tool('test',{'path':"a'b`c"},'private-test-token')
        self.assertEqual(result['content'][0]['text'],'ok')
        args,kw=run.call_args
        self.assertNotIn('private-test-token',args[0])
        self.assertEqual(kw['env']['SLIDE_API_KEY'],'private-test-token')
        self.assertEqual(json.loads(kw['input'].splitlines()[-1])['params']['arguments']['path'],"a'b`c")
    def test_tool_metadata_is_scoped_to_account(self):
        manager=MCPManager()
        manager._request=Mock(side_effect=[{'tools':[{'name':'A'}]},{'tools':[{'name':'B'}]}])
        self.assertEqual(manager._get_available_tools('key-a')[0]['name'],'A')
        self.assertEqual(manager._get_available_tools('key-b')[0]['name'],'B')
        self.assertEqual(manager._get_available_tools('key-a')[0]['name'],'A')
        self.assertEqual(manager._request.call_count,2)
    @patch('mcp_manager.subprocess.run',side_effect=subprocess.TimeoutExpired('process',60))
    def test_timeout_does_not_retry(self,run):
        self.assertIn('timed out',MCPManager().call_tool('create',{},'test')['error'])
        self.assertEqual(run.call_count,1)
if __name__=='__main__':unittest.main()
