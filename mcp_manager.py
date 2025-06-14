import os
import json
import subprocess
import threading
import time
import logging
from typing import Dict, List, Optional, Any
import signal
import sys

logger = logging.getLogger(__name__)

class MCPManager:
    """
    Manages the slide-mcp-server process and communication
    """
    
    def __init__(self):
        self.process = None
        self.api_key = None
        self.is_running = False
        self.server_tools = []
        self.request_id = 0
        self.response_callbacks = {}
        self.lock = threading.Lock()
        
        # Path to the slide-mcp-server binary
        self.mcp_server_path = os.path.join(os.path.dirname(__file__), 'mcp', 'slide-mcp-server')
        
    def start_server(self, api_key: str) -> bool:
        """
        Start the MCP server with the given API key
        """
        if self.is_running:
            logger.info("MCP server is already running")
            return True
            
        try:
            self.api_key = api_key
            
            # Set up environment with API key
            env = os.environ.copy()
            env['SLIDE_API_KEY'] = api_key
            
            # Start the MCP server process
            self.process = subprocess.Popen(
                [self.mcp_server_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                text=True,
                bufsize=1
            )
            
            # Start background thread to handle server output
            self.output_thread = threading.Thread(target=self._handle_server_output, daemon=True)
            self.output_thread.start()
            
            # Initialize the MCP session
            if self._initialize_mcp_session():
                self.is_running = True
                logger.info("MCP server started successfully")
                return True
            else:
                self.stop_server()
                return False
                
        except Exception as e:
            logger.error(f"Failed to start MCP server: {e}")
            self.stop_server()
            return False
    
    def stop_server(self):
        """
        Stop the MCP server process
        """
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
            except Exception as e:
                logger.error(f"Error stopping MCP server: {e}")
            finally:
                self.process = None
                
        self.is_running = False
        self.server_tools = []
        logger.info("MCP server stopped")
    
    def _initialize_mcp_session(self) -> bool:
        """
        Initialize the MCP session by sending initialization requests
        """
        try:
            # Send initialize request
            init_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "roots": {
                            "listChanged": True
                        },
                        "sampling": {}
                    },
                    "clientInfo": {
                        "name": "slide-chat-client",
                        "version": "1.0.0"
                    }
                }
            }
            
            response = self._send_request(init_request)
            if not response or "error" in response:
                logger.error(f"MCP initialization failed: {response}")
                return False
            
            # Send initialized notification
            initialized_notification = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }
            
            self._send_notification(initialized_notification)
            
            # Get available tools
            self._get_available_tools()
            
            return True
            
        except Exception as e:
            logger.error(f"MCP initialization error: {e}")
            return False
    
    def _get_available_tools(self):
        """
        Get the list of available tools from the MCP server
        """
        try:
            tools_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_id(),
                "method": "tools/list"
            }
            
            response = self._send_request(tools_request)
            if response and "result" in response:
                self.server_tools = response["result"].get("tools", [])
                logger.info(f"Retrieved {len(self.server_tools)} tools from MCP server")
                for tool in self.server_tools:
                    logger.info(f"Available tool: {tool.get('name')} - {tool.get('description', '')}")
            else:
                logger.error(f"Failed to get tools: {response}")
                
        except Exception as e:
            logger.error(f"Error getting tools: {e}")
    
    def get_tools_for_claude(self) -> List[Dict]:
        """
        Convert MCP tools to Claude-compatible tool definitions
        """
        claude_tools = []
        
        for tool in self.server_tools:
            claude_tool = {
                "name": tool.get("name"),
                "description": tool.get("description", ""),
                "input_schema": tool.get("inputSchema", {})
            }
            claude_tools.append(claude_tool)
            
        return claude_tools
    
    def call_tool(self, tool_name: str, arguments: Dict) -> Dict:
        """
        Call a tool on the MCP server
        """
        if not self.is_running:
            return {"error": "MCP server is not running"}
            
        try:
            tool_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_id(),
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                }
            }
            
            response = self._send_request(tool_request)
            
            if response and "result" in response:
                return response["result"]
            else:
                return {"error": f"Tool call failed: {response}"}
                
        except Exception as e:
            logger.error(f"Error calling tool {tool_name}: {e}")
            return {"error": str(e)}
    
    def _send_request(self, request: Dict, timeout: float = 10.0) -> Optional[Dict]:
        """
        Send a JSON-RPC request and wait for response
        """
        if not self.process or not self.process.stdin:
            return None
            
        try:
            request_id = request.get("id")
            if request_id is not None:
                # Set up callback for response
                response_event = threading.Event()
                response_data = {"response": None}
                
                with self.lock:
                    self.response_callbacks[request_id] = (response_event, response_data)
                
                # Send request
                request_json = json.dumps(request) + "\n"
                self.process.stdin.write(request_json)
                self.process.stdin.flush()
                
                # Wait for response
                if response_event.wait(timeout):
                    with self.lock:
                        if request_id in self.response_callbacks:
                            del self.response_callbacks[request_id]
                    return response_data["response"]
                else:
                    # Timeout
                    with self.lock:
                        if request_id in self.response_callbacks:
                            del self.response_callbacks[request_id]
                    logger.error(f"Request {request_id} timed out")
                    return None
            else:
                # Notification (no response expected)
                request_json = json.dumps(request) + "\n"
                self.process.stdin.write(request_json)
                self.process.stdin.flush()
                return None
                
        except Exception as e:
            logger.error(f"Error sending request: {e}")
            return None
    
    def _send_notification(self, notification: Dict):
        """
        Send a JSON-RPC notification (no response expected)
        """
        try:
            notification_json = json.dumps(notification) + "\n"
            self.process.stdin.write(notification_json)
            self.process.stdin.flush()
        except Exception as e:
            logger.error(f"Error sending notification: {e}")
    
    def _handle_server_output(self):
        """
        Handle output from the MCP server in a background thread
        """
        try:
            while self.process and self.process.poll() is None:
                line = self.process.stdout.readline()
                if not line:
                    break
                    
                line = line.strip()
                if not line:
                    continue
                    
                try:
                    message = json.loads(line)
                    self._handle_server_message(message)
                except json.JSONDecodeError:
                    # Could be a log message or other non-JSON output
                    logger.debug(f"MCP server output: {line}")
                    
        except Exception as e:
            logger.error(f"Error in server output handler: {e}")
        finally:
            logger.info("MCP server output handler finished")
    
    def _handle_server_message(self, message: Dict):
        """
        Handle a JSON-RPC message from the server
        """
        if "id" in message:
            # This is a response to a request
            request_id = message["id"]
            with self.lock:
                if request_id in self.response_callbacks:
                    event, response_data = self.response_callbacks[request_id]
                    response_data["response"] = message
                    event.set()
        else:
            # This is a notification from the server
            method = message.get("method")
            if method:
                logger.info(f"Received notification: {method}")
    
    def _get_next_id(self) -> int:
        """
        Get the next request ID
        """
        self.request_id += 1
        return self.request_id
    
    def is_server_running(self) -> bool:
        """
        Check if the MCP server is running
        """
        return self.is_running and self.process and self.process.poll() is None
    
    def get_server_status(self) -> Dict:
        """
        Get the current status of the MCP server
        """
        return {
            "running": self.is_server_running(),
            "tools_count": len(self.server_tools),
            "tools": [tool.get("name") for tool in self.server_tools]
        }


# Global MCP manager instance
mcp_manager = MCPManager()


def cleanup_mcp_server():
    """
    Cleanup function to stop MCP server on application exit
    """
    global mcp_manager
    if mcp_manager:
        mcp_manager.stop_server()


# Register cleanup function
import atexit
atexit.register(cleanup_mcp_server)


# Handle signals for graceful shutdown
def signal_handler(signum, frame):
    logger.info(f"Received signal {signum}, shutting down MCP server...")
    cleanup_mcp_server()
    sys.exit(0)


signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler) 