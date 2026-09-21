import os
import json
import subprocess
import logging
from typing import Dict, List, Optional, Any
import hashlib
import threading
import time

logger = logging.getLogger(__name__)

class MCPManager:
    """
    Manages direct calls to the slide-mcp-server process (stateless)
    """
    
    def __init__(self):
        # Path to the slide-mcp-server binary
        self.mcp_server_path = os.path.join(os.path.dirname(__file__), 'mcp', 'slide-mcp-server')
        self._tools_by_account = {}
        self._cache_lock = threading.Lock()
        self._cache_timeout = 300  # 5 minutes cache for tools
        
    def _request(self, method: str, params: Dict, api_key: str, timeout: int) -> Dict:
        """Send JSON directly to stdio; tolerate notifications and JSON key order."""
        request_id = 3 if method == 'tools/call' else 2
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2024-11-05", "capabilities": {},
                "clientInfo": {"name": "slide-chat-client", "version": "1.6.0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
        ]
        env = dict(os.environ, SLIDE_API_KEY=api_key)
        result = subprocess.run(
            [self.mcp_server_path, '--tools', 'full-safe'],
            input='\n'.join(json.dumps(message) for message in messages) + '\n',
            capture_output=True, text=True, encoding='utf-8', timeout=timeout, env=env,
        )
        # Parse the protocol, not a grep pattern. Never copy process output into logs.
        for line in result.stdout.splitlines():
            try:
                response = json.loads(line)
            except (ValueError, TypeError):
                continue
            if not isinstance(response, dict) or response.get('id') != request_id:
                continue
            if 'error' in response:
                return {'error': 'The Slide tool could not complete the request.'}
            return response.get('result', {})
        return {'error': 'No response from the Slide tools service. Please retry.'}

    def _get_available_tools(self, api_key: str) -> List[Dict]:
        """Cache metadata per credential so account permissions cannot bleed across sessions."""
        cache_key = hashlib.sha256(api_key.encode()).hexdigest()
        now = time.monotonic()
        with self._cache_lock:
            entry = self._tools_by_account.get(cache_key)
            if entry and now - entry[0] < self._cache_timeout:
                return entry[1]
        try:
            response = self._request('tools/list', {}, api_key, timeout=30)
            tools = response.get('tools', [])
            if tools:
                with self._cache_lock:
                    self._tools_by_account = {k: v for k, v in self._tools_by_account.items() if now - v[0] < self._cache_timeout}
                    if len(self._tools_by_account) >= 100:
                        self._tools_by_account.pop(next(iter(self._tools_by_account)))
                    self._tools_by_account[cache_key] = (now, tools)
            return tools
        except (OSError, subprocess.TimeoutExpired):
            logger.warning('Slide tool discovery unavailable')
            return []
    
    def get_tools_for_claude(self, api_key: str) -> List[Dict]:
        """
        Convert MCP tools to Claude-compatible tool definitions
        """
        tools = self._get_available_tools(api_key)
        claude_tools = []
        
        for tool in tools:
            input_schema = tool.get("inputSchema", {})
            
            # Transform MCP schemas to Claude-compatible format
            # Claude doesn't support allOf, oneOf, anyOf at the top level
            claude_schema = self._transform_schema_for_claude(input_schema)
            
            claude_tool = {
                "name": tool.get("name"),
                "description": tool.get("description", ""),
                "input_schema": claude_schema
            }
            claude_tools.append(claude_tool)
            
        return claude_tools
    
    def _transform_schema_for_claude(self, mcp_schema: Dict) -> Dict:
        """
        Transform MCP schema to Claude-compatible format
        """
        # If schema uses allOf/oneOf/anyOf at top level, simplify it
        if "allOf" in mcp_schema:
            # Extract properties and required fields from allOf structure
            transformed = {
                "type": mcp_schema.get("type", "object"),
                "properties": mcp_schema.get("properties", {}),
                "required": mcp_schema.get("required", [])
            }
            return transformed
        elif "oneOf" in mcp_schema or "anyOf" in mcp_schema:
            # For oneOf/anyOf, merge all possible properties
            transformed = {
                "type": "object",
                "properties": {},
                "required": []
            }
            
            # Merge properties from all schemas
            for schema in mcp_schema.get("oneOf", []) + mcp_schema.get("anyOf", []):
                if "properties" in schema:
                    transformed["properties"].update(schema["properties"])
                if "required" in schema:
                    transformed["required"].extend(schema["required"])
            
            # Remove duplicates from required
            transformed["required"] = list(set(transformed["required"]))
            return transformed
        else:
            # Schema is already compatible
            return mcp_schema
    
    def call_tool(self, tool_name: str, arguments: Dict, api_key: str) -> Dict:
        # Tool calls may mutate the fleet. Never retry automatically.
        try:
            return self._request('tools/call', {'name': tool_name, 'arguments': arguments}, api_key, timeout=60)
        except subprocess.TimeoutExpired:
            return {'error': 'Slide tool timed out. Check the operation status before trying again.'}
        except OSError:
            logger.warning('Slide tools service unavailable')
            return {'error': 'The Slide tools service is unavailable.'}
    
    def is_server_available(self) -> bool:
        """
        Check if the MCP server binary is available
        """
        return os.path.exists(self.mcp_server_path) and os.access(self.mcp_server_path, os.X_OK)
    
    def get_server_status(self) -> Dict:
        """
        Get the current status of the MCP server
        """
        return {
            "available": self.is_server_available(),
            "server_path": self.mcp_server_path,
            "stateless": True
        }


# Global MCP manager instance
mcp_manager = MCPManager()
