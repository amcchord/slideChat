import os
import json
import subprocess
import logging
from typing import Dict, List, Optional, Any
import tempfile
import time

logger = logging.getLogger(__name__)

class MCPManager:
    """
    Manages direct calls to the slide-mcp-server process (stateless)
    """
    
    def __init__(self):
        # Path to the slide-mcp-server binary
        self.mcp_server_path = os.path.join(os.path.dirname(__file__), 'mcp', 'slide-mcp-server')
        self._cached_tools = None
        self._cache_time = 0
        self._cache_timeout = 300  # 5 minutes cache for tools
        
    def _get_available_tools(self, api_key: str) -> List[Dict]:
        """
        Get the list of available tools from the MCP server using direct call
        """
        # Check cache first
        current_time = time.time()
        if self._cached_tools and (current_time - self._cache_time) < self._cache_timeout:
            return self._cached_tools
            
        try:
            # Create a temporary script to get tools
            script_content = '''#!/bin/bash
set -e

# Initialize MCP session and get tools
{
    echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"roots": {"listChanged": true}, "sampling": {}}, "clientInfo": {"name": "slide-chat-client", "version": "1.1.0"}}}'
    echo '{"jsonrpc": "2.0", "method": "notifications/initialized"}'
    echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}'
} | "$1" --api-key "$2" --tools full-safe 2>/dev/null | grep -E '{"jsonrpc":"2.0","id":2' | head -1
'''
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as f:
                f.write(script_content)
                script_path = f.name
            
            try:
                os.chmod(script_path, 0o755)
                
                # Execute the script
                result = subprocess.run(
                    [script_path, self.mcp_server_path, api_key],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                if result.returncode == 0 and result.stdout.strip():
                    response_data = json.loads(result.stdout.strip())
                    if "result" in response_data and "tools" in response_data["result"]:
                        tools = response_data["result"]["tools"]
                        
                        # Cache the tools
                        self._cached_tools = tools
                        self._cache_time = current_time
                        
                        logger.info(f"Retrieved {len(tools)} tools from MCP server")
                        return tools
                else:
                    logger.error(f"Failed to get tools. Return code: {result.returncode}, stderr: {result.stderr}")
                    
            finally:
                # Clean up the temporary script
                try:
                    os.unlink(script_path)
                except:
                    pass
                    
        except Exception as e:
            logger.error(f"Error getting tools: {e}")
            
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
        """
        Call a tool on the MCP server using direct subprocess call
        """
        try:
            # Create a temporary script to call the tool
            script_content = '''#!/bin/bash
set -e

# Initialize MCP session and call tool
{
    echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"roots": {"listChanged": true}, "sampling": {}}, "clientInfo": {"name": "slide-chat-client", "version": "1.1.0"}}}'
    echo '{"jsonrpc": "2.0", "method": "notifications/initialized"}'
    echo "$3"
} | "$1" --api-key "$2" --tools full-safe 2>/dev/null | grep -E '{"jsonrpc":"2.0","id":3' | head -1
'''
            
            # Prepare the tool call request
            tool_request = {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                }
            }
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as f:
                f.write(script_content)
                script_path = f.name
            
            try:
                os.chmod(script_path, 0o755)
                
                # Execute the script
                result = subprocess.run(
                    [script_path, self.mcp_server_path, api_key, json.dumps(tool_request)],
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                
                if result.returncode == 0 and result.stdout.strip():
                    response_data = json.loads(result.stdout.strip())
                    
                    if "result" in response_data:
                        return response_data["result"]
                    elif "error" in response_data:
                        return {"error": f"MCP server error: {response_data['error']}"}
                    else:
                        return {"error": "Unexpected response format from MCP server"}
                else:
                    error_msg = f"MCP server call failed. Return code: {result.returncode}"
                    if result.stderr:
                        error_msg += f", stderr: {result.stderr}"
                    return {"error": error_msg}
                    
            finally:
                # Clean up the temporary script
                try:
                    os.unlink(script_path)
                except:
                    pass
                    
        except subprocess.TimeoutExpired:
            return {"error": "MCP server call timed out"}
        except Exception as e:
            logger.error(f"Error calling tool {tool_name}: {e}")
            return {"error": str(e)}
    
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