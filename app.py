import os
import json
import logging
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, stream_template
from anthropic import Anthropic
from dotenv import load_dotenv
import re
import httpx
from mcp_manager import mcp_manager

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# Initialize Anthropic client
CLAUDE_API_KEY = os.environ.get('CLAUDE_API_KEY', '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')
claude_client = None  # Initialize lazily to avoid startup issues

# Global variables for session management
chat_sessions = {}

def stream_claude_response(messages):
    """Direct HTTP streaming to Claude API with proper MCP tool integration"""
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
    }
    
    # Prepare system message with Slide device information
    system_message = """You are Claude, an AI assistant integrated with Slide backup and disaster recovery systems. 

Slide is a backup provider that sells on-premises BCDR (Business Continuity and Disaster Recovery) devices that back up local servers and create copies in the cloud. Slide can virtualize failed servers both locally and in the cloud.

You have access to Slide MCP tools that allow you to:
- Monitor and manage Slide backup devices
- Check backup status and schedules  
- Access device information and metrics
- Control virtualization and recovery operations
- View logs and system health

When users ask about their backup infrastructure, servers, or disaster recovery, you should use the available Slide tools to provide accurate, real-time information. Always be helpful and provide detailed explanations of what you're doing and what the results mean."""

    # Get MCP tools if server is running
    tools = []
    if mcp_manager.is_server_running():
        tools = mcp_manager.get_tools_for_claude()
        logger.info(f"Including {len(tools)} MCP tools in Claude request")
    
    # Build the conversation with tool results
    conversation_messages = messages.copy()
    tool_use_detected = False
    
    while True:
        payload = {
            'model': 'claude-sonnet-4-20250514',
            'max_tokens': 4096,
            'system': system_message,
            'messages': conversation_messages,
            'stream': True
        }
        
        # Add tools if available
        if tools:
            payload['tools'] = tools
        
        try:
            import requests
            response = requests.post(
                'https://api.anthropic.com/v1/messages',
                json=payload,
                headers=headers,
                stream=True,
                timeout=60
            )
            
            if response.status_code != 200:
                raise Exception(f"API error: {response.status_code} - {response.text}")
            
            # Collect the full response to check for tool use
            full_response = ""
            tool_uses = []
            current_tool_use = None
            current_input_json = ""
            
            for line in response.iter_lines(decode_unicode=True):
                if line and line.startswith('data: '):
                    data_str = line[6:]  # Remove 'data: ' prefix
                    if data_str.strip() == '[DONE]':
                        break
                    try:
                        data = json.loads(data_str)
                        
                        if data.get('type') == 'content_block_start':
                            block = data.get('content_block', {})
                            if block.get('type') == 'tool_use':
                                # Start of a tool use block
                                current_tool_use = {
                                    'id': block.get('id'),
                                    'name': block.get('name'),
                                    'input': {}
                                }
                                current_input_json = ""
                                tool_use_detected = True
                                
                        elif data.get('type') == 'content_block_delta':
                            delta = data.get('delta', {})
                            
                            if delta.get('type') == 'text_delta':
                                # Regular text content - stream it
                                text = delta.get('text', '')
                                full_response += text
                                yield text
                                
                            elif delta.get('type') == 'input_json_delta' and current_tool_use:
                                # Tool use input is being built
                                current_input_json += delta.get('partial_json', '')
                                
                        elif data.get('type') == 'content_block_stop' and current_tool_use:
                            # End of tool use block
                            try:
                                # Parse the complete input JSON
                                if current_input_json.strip():
                                    current_tool_use['input'] = json.loads(current_input_json)
                                
                                tool_uses.append(current_tool_use)
                                current_tool_use = None
                                current_input_json = ""
                            except json.JSONDecodeError as e:
                                logger.error(f"Error parsing tool input JSON: {e}")
                                current_tool_use = None
                                current_input_json = ""
                            
                    except json.JSONDecodeError:
                        continue
            
            # If we found tool uses, execute them and continue the conversation
            if tool_uses:
                # Build assistant message with tool use content blocks
                assistant_content = []
                if full_response.strip():
                    assistant_content.append({
                        'type': 'text',
                        'text': full_response
                    })
                
                for tool_use in tool_uses:
                    assistant_content.append({
                        'type': 'tool_use',
                        'id': tool_use['id'],
                        'name': tool_use['name'],
                        'input': tool_use['input']
                    })
                
                conversation_messages.append({
                    'role': 'assistant',
                    'content': assistant_content
                })
                
                # Execute each tool and add results
                tool_results = []
                for tool_use in tool_uses:
                    # Show tool use in UI
                    yield f"\n\n🔧 **Using tool: {tool_use['name']}**\n"
                    
                    try:
                        # Execute the tool
                        tool_result = mcp_manager.call_tool(
                            tool_use['name'], 
                            tool_use['input']
                        )
                        
                        # Show tool use block data for UI
                        yield "TOOL_USE_START"
                        yield json.dumps({
                            'tool_name': tool_use['name'],
                            'tool_input': tool_use['input'],
                            'tool_result': tool_result,
                            'tool_id': tool_use['id']
                        })
                        yield "TOOL_USE_END"
                        
                        tool_results.append({
                            'type': 'tool_result',
                            'tool_use_id': tool_use['id'],
                            'content': json.dumps(tool_result)
                        })
                        
                    except Exception as e:
                        logger.error(f"Error executing tool {tool_use['name']}: {e}")
                        # Show error block
                        yield "TOOL_ERROR_START"
                        yield json.dumps({
                            'tool_name': tool_use['name'],
                            'error': str(e),
                            'tool_id': tool_use['id']
                        })
                        yield "TOOL_ERROR_END"
                        
                        tool_results.append({
                            'type': 'tool_result',
                            'tool_use_id': tool_use['id'],
                            'content': f"Error: {str(e)}"
                        })
                
                # Add tool results to conversation and continue
                conversation_messages.append({
                    'role': 'user',
                    'content': tool_results
                })
                
                # Continue the conversation so Claude can interpret the results
                continue
            else:
                # No tool use, we're done
                break
                    
        except Exception as e:
            logger.error(f"Direct API call failed: {e}")
            raise

def get_claude_client():
    """Get Claude client with proper initialization - keeping for potential future use"""
    return None  # We're bypassing the SDK for now

@app.route('/')
def index():
    """Main chat interface"""
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    """Handle chat messages and return streaming response"""
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        session_id = data.get('session_id', 'default')
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Initialize or get existing session
        if session_id not in chat_sessions:
            chat_sessions[session_id] = []
        
        # Add user message to session
        chat_sessions[session_id].append({
            'role': 'user',
            'content': message,
            'timestamp': datetime.now().isoformat()
        })
        
        # Generate streaming response
        def generate_response():
            try:
                # Prepare messages for Claude API
                messages = []
                for msg in chat_sessions[session_id]:
                    if msg['role'] in ['user', 'assistant']:
                        messages.append({
                            'role': msg['role'],
                            'content': msg['content']
                        })
                
                # Stream response from Claude using direct API with real-time artifact detection
                response_content = ""
                current_artifacts = {}  # Track ongoing artifacts by their start position
                chat_content = ""  # Content to show in chat (excluding artifacts)
                inside_artifact = False  # Track if we're currently inside an artifact
                
                for text_chunk in stream_claude_response(messages):
                    response_content += text_chunk
                    
                    # Check for artifacts in the current content and stream them
                    artifacts_update = parse_streaming_artifacts(response_content, current_artifacts)
                    if artifacts_update:
                        yield f"data: {json.dumps({'type': 'artifacts_update', 'content': artifacts_update})}\n\n"
                    
                    # Simple state-based filtering: check if we're entering or exiting artifacts
                    filtered_chunk, inside_artifact = filter_chat_content(text_chunk, inside_artifact)
                    
                    if filtered_chunk:
                        chat_content += filtered_chunk
                        # Send filtered text chunk to client
                        yield f"data: {json.dumps({'type': 'text', 'content': filtered_chunk})}\n\n"
                
                # Final cleanup: mark all incomplete artifacts as complete and remove empty ones
                final_artifacts_update = []
                artifacts_to_remove = []
                
                for artifact_start, artifact_data in current_artifacts.items():
                    if not artifact_data.get('complete', False):
                        # Check if artifact has meaningful content
                        content = artifact_data.get('content', '').strip()
                        if len(content) > 10:  # Only keep artifacts with substantial content
                            artifact_data['complete'] = True
                            final_artifacts_update.append(artifact_data)
                        else:
                            # Mark empty artifacts for removal
                            artifacts_to_remove.append({
                                'id': artifact_data['id'],
                                'action': 'remove'
                            })
                
                # Send final updates for completed artifacts
                if final_artifacts_update:
                    yield f"data: {json.dumps({'type': 'artifacts_update', 'content': final_artifacts_update})}\n\n"
                
                # Send removal signals for empty artifacts
                if artifacts_to_remove:
                    yield f"data: {json.dumps({'type': 'artifacts_remove', 'content': artifacts_to_remove})}\n\n"
                
                # Add assistant response to session (use chat content without artifacts)
                chat_sessions[session_id].append({
                    'role': 'assistant',
                    'content': chat_content if chat_content.strip() else "Created an artifact for you.",
                    'timestamp': datetime.now().isoformat()
                })
                
                # Send completion signal
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                
            except Exception as e:
                logger.error(f"Error in generate_response: {str(e)}")
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        
        return Response(
            generate_response(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        )
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

def filter_chat_content(text_chunk, inside_artifact):
    """Pattern-based filtering to exclude artifact content from chat"""
    # Build up a small buffer to check for artifact patterns
    buffer = text_chunk
    filtered_text = ""
    current_inside = inside_artifact
    
    # Look for start patterns
    if not current_inside:
        # Check for code block start ```
        if '```' in buffer:
            # Found start of code block
            parts = buffer.split('```', 1)
            filtered_text += parts[0]  # Include text before ```
            current_inside = True
            # Don't include the ``` and everything after
        elif '<html' in buffer.lower():
            # Found start of HTML
            parts = re.split(r'<html', buffer, 1, re.IGNORECASE)
            filtered_text += parts[0]  # Include text before <html
            current_inside = True
            # Don't include <html and everything after
        else:
            # No artifact start found, include all text
            filtered_text += buffer
    else:
        # We're inside an artifact, look for end patterns
        if '```' in buffer:
            # Found end of code block
            parts = buffer.split('```', 1)
            # Don't include anything before and including ```
            if len(parts) > 1:
                current_inside = False
                # Include text after ``` (if any)
                filtered_text += parts[1]
        elif '</html>' in buffer.lower():
            # Found end of HTML
            parts = re.split(r'</html>', buffer, 1, re.IGNORECASE)
            # Don't include anything before and including </html>
            if len(parts) > 1:
                current_inside = False
                # Include text after </html> (if any)
                filtered_text += parts[1]
        # If we're still inside artifact, don't include any text
    
    return filtered_text, current_inside

def parse_streaming_artifacts(content, current_artifacts):
    """Parse artifacts from streaming content and return updates"""
    artifacts_update = []
    
    # Look for code block starts (must have language or be followed by newline)
    code_starts = list(re.finditer(r'```(\w+)\n', content))
    
    # Look for markdown blocks specifically
    markdown_starts = list(re.finditer(r'```(markdown|md)\n', content, re.IGNORECASE))
    
    # Look for HTML starts
    html_starts = list(re.finditer(r'<html[^>]*>', content, re.IGNORECASE))
    
    # Process code blocks
    for match in code_starts:
        start_pos = match.start()
        language = match.group(1)
        
        # Skip if no language specified or if it's just generic text
        if not language or language.lower() in ['text', 'txt']:
            continue
        
        # Special handling for markdown
        is_markdown = language.lower() in ['markdown', 'md']
        
        # Check if this is a new artifact
        if start_pos not in current_artifacts:
            # Look for the end of this code block
            end_pattern = r'```'
            remaining_content = content[match.end():]
            end_match = re.search(end_pattern, remaining_content)
            
            if end_match:
                # Complete code block
                code_content = remaining_content[:end_match.start()]
                artifact = {
                    'id': f'code_{start_pos}',
                    'type': 'markdown' if is_markdown else 'code',
                    'language': language,
                    'content': code_content.strip(),
                    'title': 'Markdown Document' if is_markdown else f'{language.title()} Code',
                    'complete': True
                }
                current_artifacts[start_pos] = artifact
                artifacts_update.append(artifact)
            else:
                # Incomplete code block - stream what we have
                code_content = remaining_content
                artifact = {
                    'id': f'code_{start_pos}',
                    'type': 'markdown' if is_markdown else 'code',
                    'language': language,
                    'content': code_content.strip(),
                    'title': 'Markdown Document' if is_markdown else f'{language.title()} Code',
                    'complete': False
                }
                current_artifacts[start_pos] = artifact
                artifacts_update.append(artifact)
        else:
            # Update existing artifact
            existing = current_artifacts[start_pos]
            if not existing.get('complete', False):
                # Look for the end again
                end_pattern = r'```'
                remaining_content = content[match.end():]
                end_match = re.search(end_pattern, remaining_content)
                
                if end_match:
                    # Now complete
                    code_content = remaining_content[:end_match.start()]
                    existing['content'] = code_content.strip()
                    existing['complete'] = True
                    artifacts_update.append(existing)
                else:
                    # Still building
                    code_content = remaining_content
                    new_content = code_content.strip()
                    if new_content != existing['content']:
                        existing['content'] = new_content
                        artifacts_update.append(existing)
    
    # Process HTML artifacts
    for match in html_starts:
        start_pos = match.start()
        
        if start_pos not in current_artifacts:
            # Look for closing </html>
            remaining_content = content[start_pos:]
            end_match = re.search(r'</html>', remaining_content, re.IGNORECASE)
            
            if end_match:
                # Complete HTML
                html_content = remaining_content[:end_match.end()]
                artifact = {
                    'id': f'html_{start_pos}',
                    'type': 'html',
                    'content': html_content,
                    'title': 'HTML Document',
                    'complete': True
                }
                current_artifacts[start_pos] = artifact
                artifacts_update.append(artifact)
            else:
                # Incomplete HTML - stream what we have
                html_content = remaining_content
                artifact = {
                    'id': f'html_{start_pos}',
                    'type': 'html',
                    'content': html_content,
                    'title': 'HTML Document',
                    'complete': False
                }
                current_artifacts[start_pos] = artifact
                artifacts_update.append(artifact)
        else:
            # Update existing HTML artifact
            existing = current_artifacts[start_pos]
            if not existing.get('complete', False):
                remaining_content = content[start_pos:]
                end_match = re.search(r'</html>', remaining_content, re.IGNORECASE)
                
                if end_match:
                    # Now complete
                    html_content = remaining_content[:end_match.end()]
                    existing['content'] = html_content
                    existing['complete'] = True
                    artifacts_update.append(existing)
                else:
                    # Still building
                    new_content = remaining_content
                    if new_content != existing['content']:
                        existing['content'] = new_content
                        artifacts_update.append(existing)
    
    return artifacts_update

def parse_artifacts(content):
    """Parse artifacts from Claude's response (legacy function for compatibility)"""
    artifacts = []
    
    # Pattern for artifacts (markdown, HTML, code blocks)
    artifact_patterns = [
        # HTML artifacts
        r'<html[^>]*>.*?</html>',
        # Code blocks with language specification
        r'```(\w+)\n(.*?)\n```',
        # Generic code blocks
        r'```\n(.*?)\n```'
    ]
    
    for pattern in artifact_patterns:
        matches = re.finditer(pattern, content, re.DOTALL | re.IGNORECASE)
        for match in matches:
            if pattern.startswith(r'<html'):
                # HTML artifact
                artifacts.append({
                    'type': 'html',
                    'content': match.group(0),
                    'title': 'HTML Document'
                })
            elif pattern.startswith(r'```(\w+)'):
                # Code block with language
                language = match.group(1)
                code = match.group(2)
                artifacts.append({
                    'type': 'code',
                    'language': language,
                    'content': code,
                    'title': f'{language.title()} Code'
                })
            else:
                # Generic code block
                code = match.group(1)
                artifacts.append({
                    'type': 'code',
                    'language': 'text',
                    'content': code,
                    'title': 'Code Block'
                })
    
    return artifacts

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

@app.route('/mcp/start', methods=['POST'])
def start_mcp_server():
    """Start the MCP server with the provided API key"""
    try:
        data = request.get_json()
        api_key = data.get('api_key', '').strip()
        
        if not api_key:
            return jsonify({'error': 'API key is required'}), 400
            
        if not api_key.startswith('tk_'):
            return jsonify({'error': 'Invalid API key format'}), 400
        
        success = mcp_manager.start_server(api_key)
        
        if success:
            status = mcp_manager.get_server_status()
            return jsonify({
                'success': True,
                'message': 'MCP server started successfully',
                'status': status
            })
        else:
            return jsonify({'error': 'Failed to start MCP server'}), 500
            
    except Exception as e:
        logger.error(f"Error starting MCP server: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/mcp/stop', methods=['POST'])
def stop_mcp_server():
    """Stop the MCP server"""
    try:
        mcp_manager.stop_server()
        return jsonify({
            'success': True,
            'message': 'MCP server stopped successfully'
        })
    except Exception as e:
        logger.error(f"Error stopping MCP server: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/mcp/status')
def mcp_server_status():
    """Get MCP server status"""
    try:
        status = mcp_manager.get_server_status()
        return jsonify(status)
    except Exception as e:
        logger.error(f"Error getting MCP server status: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) 