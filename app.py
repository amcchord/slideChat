import os
import json
import logging
import uuid
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, stream_template, send_from_directory
from anthropic import Anthropic
from dotenv import load_dotenv
import re
import httpx
from mcp_manager import mcp_manager
from haml_processor import convert_haml_to_html
import tempfile
import time
from context_manager import ContextManager

# Application version
VERSION = "1.1.0"

# Claude model configuration
CLAUDE_MODEL = 'claude-sonnet-4-20250514'
MAX_TOKENS = 16000  # Keep current max tokens for responses
CONTEXT_WINDOW = 200000  # Approximate context window for Claude Sonnet 4

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create logs directory if it doesn't exist
LOGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(LOGS_DIR, exist_ok=True)

# Create artifacts directory if it doesn't exist
ARTIFACTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'artifacts')
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

# Enhanced logging setup for API interactions
def setup_detailed_logging():
    """Setup detailed logging for API interactions and debugging"""
    # Create a separate logger for API interactions
    api_logger = logging.getLogger('api_interactions')
    api_logger.setLevel(logging.DEBUG)
    
    # Create file handler for API logs
    today_str = datetime.now().strftime("%Y%m%d")
    api_log_file = os.path.join(LOGS_DIR, f'api_interactions_{today_str}.log')
    api_handler = logging.FileHandler(api_log_file)
    api_handler.setLevel(logging.DEBUG)
    
    # Create file handler for session logs
    session_log_file = os.path.join(LOGS_DIR, f'sessions_{today_str}.log')
    session_handler = logging.FileHandler(session_log_file)
    session_handler.setLevel(logging.INFO)
    
    # Create detailed formatter
    detailed_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    api_handler.setFormatter(detailed_formatter)
    session_handler.setFormatter(detailed_formatter)
    
    # Add handlers to loggers
    api_logger.addHandler(api_handler)
    api_logger.propagate = False  # Don't propagate to root logger
    
    session_logger = logging.getLogger('sessions')
    session_logger.addHandler(session_handler)
    session_logger.setLevel(logging.INFO)
    session_logger.propagate = False
    
    return api_logger, session_logger

# Initialize detailed loggers
api_logger, session_logger = setup_detailed_logging()

def log_session_interaction(session_id, event_type, data, error=None):
    """Log session interactions for debugging"""
    log_entry = {
        'timestamp': datetime.now().isoformat(),
        'session_id': session_id,
        'event_type': event_type,
        'data': data,
        'error': str(error) if error else None
    }
    
    if error:
        session_logger.error(f"SESSION_ERROR: {json.dumps(log_entry, indent=2)}")
    else:
        session_logger.info(f"SESSION_EVENT: {json.dumps(log_entry, indent=2)}")

def log_api_interaction(session_id, event_type, payload=None, response_data=None, error=None):
    """Log API interactions for debugging"""
    log_entry = {
        'timestamp': datetime.now().isoformat(),
        'session_id': session_id,
        'event_type': event_type,
        'payload': payload,
        'response_data': response_data,
        'error': str(error) if error else None
    }
    
    if error:
        api_logger.error(f"API_ERROR: {json.dumps(log_entry, indent=2)}")
    else:
        api_logger.info(f"API_EVENT: {json.dumps(log_entry, indent=2)}")

def save_session_debug_log(session_id, messages, response_content, error=None, user_agent=None, ip_address=None):
    """Save a complete session debug log to a separate file"""
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    debug_log_file = os.path.join(LOGS_DIR, f'session_debug_{session_id}_{timestamp_str}.json')
    
    debug_data = {
        'session_id': session_id,
        'timestamp': datetime.now().isoformat(),
        'messages': messages,
        'response_content': response_content,
        'error': str(error) if error else None,
        'metadata': {
            'user_agent': user_agent or 'Unknown',
            'ip_address': ip_address or 'Unknown',
            'content_length': len(response_content) if response_content else 0
        }
    }
    
    try:
        with open(debug_log_file, 'w', encoding='utf-8') as f:
            json.dump(debug_data, f, indent=2, ensure_ascii=False)
        logger.info(f"Debug log saved: {debug_log_file}")
    except Exception as e:
        logger.error(f"Failed to save debug log: {e}")

def convert_haml_to_html_content(haml_content):
    """Convert HAML content to HTML using our custom processor"""
    try:
        # Convert HAML to HTML using our custom processor
        html_content = convert_haml_to_html(haml_content)
        
        return html_content
    except Exception as e:
        logger.error(f"Error converting HAML to HTML: {e}")
        raise Exception(f"HAML processing error: {str(e)}")

def save_artifact_to_file(artifact):
    """Save a completed artifact to the artifacts directory and return the permalink"""
    try:
        # Ensure artifacts directory exists
        os.makedirs(ARTIFACTS_DIR, exist_ok=True)
        
        # Validate artifact data
        if not artifact or not isinstance(artifact, dict):
            raise ValueError("Invalid artifact data")
        
        content = artifact.get('content', '').strip()
        if not content:
            raise ValueError("Artifact content is empty")
        
        # Process HAML content to HTML if needed
        original_type = artifact.get('type', 'text')
        if original_type == 'haml':
            try:
                content = convert_haml_to_html_content(content)
                logger.info(f"Successfully converted HAML to HTML ({len(content)} chars)")
            except Exception as e:
                logger.error(f"HAML conversion failed: {e}")
                raise ValueError(f"Failed to process HAML content: {str(e)}")
        
        # Generate unique filename using timestamp and random ID
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        
        # Determine file extension based on artifact type
        extensions = {
            'html': '.html',
            'haml': '.html',  # HAML artifacts are saved as HTML after processing
            'code': '.txt',
            'markdown': '.md',
            'text': '.txt'
        }
        
        # Get extension, default to .txt
        extension = extensions.get(artifact.get('type', 'text'), '.txt')
        
        # For code artifacts, try to use language-specific extension
        if artifact.get('type') == 'code' and artifact.get('language'):
            lang_extensions = {
                'python': '.py',
                'javascript': '.js',
                'typescript': '.ts',
                'html': '.html',
                'css': '.css',
                'json': '.json',
                'xml': '.xml',
                'yaml': '.yml',
                'sql': '.sql',
                'java': '.java',
                'cpp': '.cpp',
                'c': '.c',
                'go': '.go',
                'rust': '.rs',
                'php': '.php',
                'ruby': '.rb',
                'bash': '.sh',
                'shell': '.sh'
            }
            extension = lang_extensions.get(artifact.get('language', '').lower(), '.txt')
        
        # Create safe filename from title
        title = artifact.get('title', 'Untitled')
        safe_title = re.sub(r'[^a-zA-Z0-9_\-\s]', '', title)
        safe_title = re.sub(r'\s+', '_', safe_title.strip())[:50]  # Limit length
        if not safe_title:
            safe_title = 'Untitled'
        
        filename = f"{timestamp}_{safe_title}_{unique_id}{extension}"
        filepath = os.path.join(ARTIFACTS_DIR, filename)
        
        # Create metadata
        metadata = {
            'id': artifact.get('id'),
            'title': title,
            'type': artifact.get('type', 'text'),
            'original_type': original_type,  # Preserve original type for HAML artifacts
            'language': artifact.get('language'),
            'created_at': datetime.now().isoformat(),
            'filename': filename,
            'content_length': len(content),
            'processed': original_type == 'haml'  # Flag to indicate content was processed
        }
        
        # Save the artifact content
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Verify file was written
        if not os.path.exists(filepath):
            raise IOError(f"Failed to create file: {filepath}")
        
        # Check file size matches expected
        actual_size = os.path.getsize(filepath)
        if actual_size == 0:
            raise IOError(f"File was created but is empty: {filepath}")
        
        # Save metadata file
        metadata_filename = f"{timestamp}_{safe_title}_{unique_id}.meta.json"
        metadata_filepath = os.path.join(ARTIFACTS_DIR, metadata_filename)
        
        with open(metadata_filepath, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        
        # Return permalink path
        permalink = f"/artifacts/{filename}"
        
        logger.info(f"Artifact saved successfully: {filepath} ({actual_size} bytes)")
        return {'success': True, 'permalink': permalink, 'filename': filename, 'size': actual_size}
        
    except Exception as e:
        error_msg = f"Failed to save artifact: {str(e)}"
        logger.error(error_msg)
        return {'success': False, 'error': error_msg, 'error_type': type(e).__name__}

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')

# Initialize Anthropic client
CLAUDE_API_KEY = os.environ.get('CLAUDE_API_KEY')
if not CLAUDE_API_KEY:
    raise ValueError("CLAUDE_API_KEY environment variable is required. Please check your configuration.")
claude_client = None  # Initialize lazily to avoid startup issues

# Global variables for session management
chat_sessions = {}
context_managers = {}  # Store context manager per session

def get_session_context_manager(session_id: str) -> ContextManager:
    """Get or create a context manager for a specific session"""
    if session_id not in context_managers:
        context_managers[session_id] = ContextManager(
            context_window=CONTEXT_WINDOW,
            warning_threshold=0.7,
            soft_limit_threshold=0.8,
            hard_limit_threshold=0.9
        )
    return context_managers[session_id]

def stream_claude_response(messages, session_id=None, slide_api_key=None):
    """Direct HTTP streaming to Claude API with proper MCP tool integration"""
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
    }
    
    # Log the start of API interaction
    if session_id:
        log_api_interaction(session_id, 'request_start', {'message_count': len(messages)})
    
    # Prepare system message with Slide device information
    current_datetime = datetime.utcnow().strftime("%A, %B %d, %Y at %I:%M %p UTC")
    system_message = f"""You are Claude, an AI assistant integrated with Slide backup and disaster recovery systems. 

CURRENT DATE & TIME: {current_datetime}
(This timestamp is updated for each request, so you always have the current time)

Slide is a backup provider that sells on-premises BCDR (Business Continuity and Disaster Recovery) devices that back up local servers and create copies in the cloud. Slide can virtualize failed servers both locally and in the cloud.

You have access to Slide MCP tools that allow you to:
- Monitor and manage Slide backup devices
- Check backup status and schedules  
- Control virtualization and recovery operations

The Hierachy of the Slide system is: Clients have Devices which have Agents that take of Backups that become Snapshots.
When doing a restore we start with a Snapshot. When reffering to an agent users tend to preffer either use the display name if they have given one or the hostname.

When users ask about their backup infrastructure, servers, or disaster recovery, you should use the available Slide tools to provide accurate, real-time information. Always be helpful and provide detailed explanations of what you're doing and what the results mean.

Users like data presented as a markdown artifact that uses tables and only a few emoji.

IMPORTANT: When users ask for a report they typically want HTML and you should check the slide_presentation tool if there is an existing template. If not when generating HTML always use tailwind css.
EXTREMELY IMPORTANT: Users MUST GET COMPLETE and ACCURATE reports. If you cannot genereate a COMPLETE and ACCURATE report it is okay to stop and tell the user I can't generate this report because it may contain inaccurate information.
NEVER GENERATE AN INNACURATE REPORT

IMPORTANT: It's helpful to check slide_presentation first to see if there is a template for what the user might want.

IMPORTANT: When creating markdown you should always do it as a markdown artifact. We support GitHub Flavored Markdown which means images can be embedded. Users like embedded images of screenshots.

IMPORTANT: When creating artifacts (code, HTML, HAML, markdown documents), you MUST wrap them in <artifact> tags like this:

<artifact type="markdown" title="Report Title">
# Your markdown content here
</artifact>

<artifact type="html" title="Web Page">
<!DOCTYPE html>
<html>...</html>
</artifact>

<artifact type="haml" title="HAML Web Page">
!!!
%html
  %head
    %title My Page
  %body
    %h1 Hello World
</artifact>

<artifact type="code" language="python" title="Python Script">
def hello_world():
    print("Hello, World!")
</artifact>

Use these artifact tags for ANY substantial content that could be rendered separately from your explanation, including:
- Markdown reports and documents
- HTML pages and components
- HAML templates (which get converted to HTML automatically)
- Code in any programming language
- JSON data structures
- XML files
- Any other structured content

The artifact tags help the interface properly display and manage your creations.

NOTE: HAML artifacts are particularly useful for reducing token usage while creating HTML content. When you use HAML, the content is automatically converted to HTML when saved, but the source view shows the original HAML for reference.

"""

    # Get MCP tools if API key is available
    tools = []
    if slide_api_key and mcp_manager.is_server_available():
        try:
            tools = mcp_manager.get_tools_for_claude(slide_api_key)
            logger.info(f"Including {len(tools)} MCP tools in Claude request")
        except Exception as e:
            logger.warning(f"Failed to get MCP tools with provided API key: {e}")
            # Continue without tools rather than failing the entire request
    
    # Build the conversation with tool results
    conversation_messages = messages.copy()
    tool_use_detected = False
    
    while True:
        payload = {
            'model': 'claude-sonnet-4-20250514',
            'max_tokens': 16000,
            'system': system_message,
            'messages': conversation_messages,
            'stream': True
        }
        
        # Add tools if available
        if tools:
            payload['tools'] = tools
        
        # Log the API request payload (excluding sensitive data)
        if session_id:
            safe_payload = payload.copy()
            if 'messages' in safe_payload:
                safe_messages = []
                for msg in safe_payload['messages']:
                    safe_msg = {'role': msg['role']}
                    content = msg['content']
                    
                    # Handle different content types (string, list, etc.)
                    if isinstance(content, str):
                        # String content - truncate if too long
                        safe_msg['content'] = content[:200] + '...' if len(content) > 200 else content
                    elif isinstance(content, list):
                        # List content (tool results, etc.) - summarize
                        safe_msg['content'] = f"[List with {len(content)} items: {str(content)[:100]}...]"
                    else:
                        # Other types - convert to string and truncate
                        content_str = str(content)
                        safe_msg['content'] = content_str[:200] + '...' if len(content_str) > 200 else content_str
                    
                    safe_messages.append(safe_msg)
                safe_payload['messages'] = safe_messages
            log_api_interaction(session_id, 'api_request', safe_payload)
        
        try:
            import requests
            response = requests.post(
                'https://api.anthropic.com/v1/messages',
                json=payload,
                headers=headers,
                stream=True,
                timeout=(10, 120)  # (connection timeout, read timeout)
            )
            
            if response.status_code != 200:
                error_msg = f"API error: {response.status_code} - {response.text}"
                if session_id:
                    log_api_interaction(session_id, 'api_error', response_data={'status_code': response.status_code, 'error': response.text})
                raise Exception(error_msg)
            
            # Collect the full response to check for tool use
            full_response = ""
            tool_uses = []
            current_tool_use = None
            current_input_json = ""
            response_chunks = []  # For logging
            
            if session_id:
                log_api_interaction(session_id, 'streaming_start', response_data={'status_code': response.status_code})
            
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
                                
                                # Log chunk for debugging
                                if session_id:
                                    response_chunks.append({
                                        'timestamp': datetime.now().isoformat(),
                                        'type': 'text_delta',
                                        'content': text[:100] + '...' if len(text) > 100 else text
                                    })
                                
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
                    yield f"\n\n🔧 **Using tool: {tool_use['name']}**\n\n"
                    
                    try:
                        # Execute the tool
                        if not slide_api_key:
                            tool_result = {"error": "Slide API key is required to use Slide tools. Please provide your API key."}
                        else:
                            tool_result = mcp_manager.call_tool(
                                tool_use['name'], 
                                tool_use['input'],
                                slide_api_key
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
                if session_id:
                    log_api_interaction(session_id, 'streaming_complete', response_data={
                        'response_length': len(full_response),
                        'chunks_received': len(response_chunks),
                        'tool_uses': len(tool_uses)
                    })
                break
                    
        except requests.exceptions.Timeout as e:
            error_msg = "Claude API request timed out. This may be due to high server load or a complex query. Please try again with a simpler request."
            logger.error(f"Claude API timeout: {e}")
            if session_id:
                log_api_interaction(session_id, 'timeout_error', error=e)
            raise Exception(error_msg)
        except requests.exceptions.ConnectionError as e:
            error_msg = "Unable to connect to Claude API. Please check your internet connection and try again."
            logger.error(f"Claude API connection error: {e}")
            if session_id:
                log_api_interaction(session_id, 'connection_error', error=e)
            raise Exception(error_msg)
        except requests.exceptions.HTTPError as e:
            logger.error(f"Claude API HTTP error: {e}")
            if session_id:
                log_api_interaction(session_id, 'http_error', response_data={'status_code': e.response.status_code}, error=e)
            if e.response.status_code == 429:
                raise Exception("Rate limit exceeded. Please wait a moment before sending another message.")
            elif e.response.status_code == 503:
                raise Exception("Claude API is currently experiencing high demand. Please try again in a few moments.")
            else:
                raise Exception(f"Claude API error (HTTP {e.response.status_code}). Please try again.")
        except Exception as e:
            logger.error(f"Direct API call failed: {e}")
            if session_id:
                log_api_interaction(session_id, 'general_error', error=e)
            # Check if it's a stream-related error
            if "stream" in str(e).lower() or "incomplete" in str(e).lower():
                raise Exception("Claude stopped responding mid-stream. This may be due to a complex query or network issues. Please try rephrasing your question or breaking it into smaller parts.")
            raise

def get_claude_client():
    """Get Claude client with proper initialization - keeping for potential future use"""
    return None  # We're bypassing the SDK for now

@app.route('/')
def index():
    """Main chat interface"""
    return render_template('index.html', version=VERSION)

@app.route('/chat', methods=['POST'])
def chat():
    """Handle chat messages and return streaming response"""
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        session_id = data.get('session_id', 'default')
        slide_api_key = data.get('slide_api_key', '').strip()
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Log session start
        log_session_interaction(session_id, 'message_received', {
            'message_length': len(message),
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'ip_address': request.remote_addr
        })
        
        # Initialize or get existing session
        if session_id not in chat_sessions:
            chat_sessions[session_id] = []
            log_session_interaction(session_id, 'session_created', {'session_id': session_id})
        
        # Add user message to session
        chat_sessions[session_id].append({
            'role': 'user',
            'content': message,
            'timestamp': datetime.now().isoformat()
        })
        
        log_session_interaction(session_id, 'user_message_added', {
            'message_count': len(chat_sessions[session_id]),
            'message_preview': message[:100] + '...' if len(message) > 100 else message
        })
        
        # Apply context management to session messages
        context_manager = get_session_context_manager(session_id)
        session_messages = chat_sessions[session_id]
        
        # Create a simple system message for context management
        system_message_preview = "You are Claude, an AI assistant integrated with Slide backup and disaster recovery systems."
        
        managed_messages, management_info = context_manager.manage_context(session_messages, system_message_preview)
        
        # Update session with managed messages if optimization was applied
        if management_info['action'] != 'none':
            chat_sessions[session_id] = managed_messages
            log_session_interaction(session_id, 'context_management', management_info)
        
        # Get context status information 
        state = context_manager.get_context_state(session_messages, system_message_preview)
        status_msg = context_manager.get_context_status_message(state)
        context_status_to_send = None
        context_percentage = None
        
        # Always send context percentage for frontend indicator
        if state and 'usage_percentage' in state:
            context_percentage = state['usage_percentage']
        
        # Send context status message if there's a warning
        if status_msg:
            log_session_interaction(session_id, 'context_status', {'message': status_msg, 'state': state})
            context_status_to_send = status_msg
        
        # Capture request context data before entering generator
        user_agent = request.headers.get('User-Agent', 'Unknown')
        ip_address = request.remote_addr
        
        # Generate streaming response
        def generate_response():
            messages = []  # Initialize outside try block for error handling
            response_content = ""  # Initialize outside try block for error handling
            
            try:
                # Get the session context manager for this session
                context_manager = get_session_context_manager(session_id)
                
                # Prepare messages for Claude API using managed messages
                for msg in chat_sessions[session_id]:
                    if msg['role'] in ['user', 'assistant']:
                        messages.append({
                            'role': msg['role'],
                            'content': msg['content']
                        })
                
                # Send context status message if available 
                if context_status_to_send:
                    yield f"data: {json.dumps({'type': 'context_status', 'content': context_status_to_send})}\n\n"
                
                # Always send context percentage for indicator
                if context_percentage is not None:
                    yield f"data: {json.dumps({'type': 'context_percentage', 'percentage': context_percentage})}\n\n"
                
                # Stream response from Claude using direct API with real-time artifact detection
                current_artifacts = {}  # Track ongoing artifacts by their start position
                chat_content = ""  # Content to show in chat (excluding artifacts)
                inside_artifact = False  # Track if we're currently inside an artifact
                
                for text_chunk in stream_claude_response(messages, session_id, slide_api_key):
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
                
                # Final cleanup: finalize incomplete artifacts and remove empty ones
                # IMPORTANT: Wrap this in try-catch to ensure completion signal is always sent
                try:
                    final_artifacts_update = []
                    artifacts_to_remove = []
                    save_errors = []  # Track save errors to report to user
                    
                    for artifact_start, artifact_data in current_artifacts.items():
                        if not artifact_data.get('complete', False):
                            # Check if artifact has meaningful content
                            content = artifact_data.get('content', '').strip()
                            if len(content) > 10:  # Only keep artifacts with substantial content
                                artifact_data['complete'] = True
                                
                                # Finalize streaming artifact file if it exists
                                if 'filepath' in artifact_data and os.path.exists(artifact_data['filepath']):
                                    try:
                                        finalize_result = finalize_artifact_file(artifact_data['filepath'], artifact_data)
                                        if finalize_result['success']:
                                            artifact_data['saved_size'] = finalize_result['size']
                                            logger.info(f"Successfully finalized streaming artifact {artifact_data.get('id', 'unknown')}: {artifact_data.get('permalink', 'unknown')}")
                                        else:
                                            artifact_data['save_error'] = finalize_result['error']
                                            save_errors.append({
                                                'artifact_id': artifact_data.get('id', 'unknown'),
                                                'artifact_title': artifact_data.get('title', 'Untitled'),
                                                'error': finalize_result['error'],
                                                'error_type': 'FinalizationError'
                                            })
                                            logger.error(f"Failed to finalize streaming artifact {artifact_data.get('id', 'unknown')}: {finalize_result['error']}")
                                    except Exception as finalize_error:
                                        error_msg = f"Unexpected error finalizing artifact: {str(finalize_error)}"
                                        artifact_data['save_error'] = error_msg
                                        save_errors.append({
                                            'artifact_id': artifact_data.get('id', 'unknown'),
                                            'artifact_title': artifact_data.get('title', 'Untitled'),
                                            'error': error_msg,
                                            'error_type': type(finalize_error).__name__
                                        })
                                        logger.error(f"Unexpected error finalizing artifact {artifact_data.get('id', 'unknown')}: {finalize_error}")
                                elif 'file_error' in artifact_data:
                                    # Artifact had file creation error, try fallback save
                                    try:
                                        save_result = save_artifact_to_file(artifact_data)
                                        if save_result['success']:
                                            artifact_data['permalink'] = save_result['permalink']
                                            artifact_data['filename'] = save_result['filename']
                                            artifact_data['saved_size'] = save_result['size']
                                            # Remove file_error since fallback worked
                                            artifact_data.pop('file_error', None)
                                            logger.info(f"Successfully saved artifact via fallback {artifact_data.get('id', 'unknown')}: {save_result['permalink']}")
                                        else:
                                            save_errors.append({
                                                'artifact_id': artifact_data.get('id', 'unknown'),
                                                'artifact_title': artifact_data.get('title', 'Untitled'),
                                                'error': save_result['error'],
                                                'error_type': save_result.get('error_type', 'Unknown')
                                            })
                                    except Exception as save_error:
                                        error_msg = f"Fallback save failed: {str(save_error)}"
                                        save_errors.append({
                                            'artifact_id': artifact_data.get('id', 'unknown'),
                                            'artifact_title': artifact_data.get('title', 'Untitled'),
                                            'error': error_msg,
                                            'error_type': type(save_error).__name__
                                        })
                                
                                final_artifacts_update.append(artifact_data)
                            else:
                                # Remove empty artifacts and clean up any files
                                if 'filepath' in artifact_data and os.path.exists(artifact_data['filepath']):
                                    try:
                                        os.remove(artifact_data['filepath'])
                                        logger.info(f"Cleaned up empty artifact file: {artifact_data['filepath']}")
                                    except Exception as cleanup_error:
                                        logger.warning(f"Failed to clean up empty artifact file {artifact_data['filepath']}: {cleanup_error}")
                                
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
                    
                    # Send error notifications for failed saves
                    if save_errors:
                        for error in save_errors:
                            yield f"data: {json.dumps({'type': 'artifact_save_error', 'content': error})}\n\n"
                
                except Exception as artifact_error:
                    logger.error(f"Error during final artifact processing: {artifact_error}")
                    # Send error notification about artifact processing failure
                    yield f"data: {json.dumps({'type': 'artifact_processing_error', 'content': {'error': str(artifact_error)}})}\n\n"
                
                # Add assistant response to session (use chat content without artifacts)
                assistant_content = chat_content if chat_content.strip() else "Created an artifact for you."
                chat_sessions[session_id].append({
                    'role': 'assistant',
                    'content': assistant_content,
                    'timestamp': datetime.now().isoformat()
                })
                
                # Send updated context percentage after adding assistant message
                updated_state = context_manager.get_context_state(chat_sessions[session_id], system_message_preview)
                if updated_state and 'usage_percentage' in updated_state:
                    yield f"data: {json.dumps({'type': 'context_percentage', 'percentage': updated_state['usage_percentage']})}\n\n"
                
                # Log successful completion
                log_session_interaction(session_id, 'response_completed', {
                    'response_length': len(response_content),
                    'chat_content_length': len(assistant_content),
                    'artifacts_count': len(current_artifacts)
                })
                
                # Save debug log for this session
                try:
                    save_session_debug_log(session_id, messages, response_content, user_agent=user_agent, ip_address=ip_address)
                except Exception as log_error:
                    logger.error(f"Failed to save debug log: {log_error}")
                
                # ALWAYS send completion signal - this ensures UI stops showing "working" state
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                
            except Exception as e:
                logger.error(f"Error in generate_response: {str(e)}")
                
                # Log the error
                log_session_interaction(session_id, 'response_error', {
                    'error_type': type(e).__name__,
                    'error_message': str(e)
                }, error=e)
                
                # Save debug log for this failed session
                try:
                    save_session_debug_log(session_id, messages, response_content, error=e, user_agent=user_agent, ip_address=ip_address)
                except Exception as log_error:
                    logger.error(f"Failed to save error debug log: {log_error}")
                
                # Remove any timeout warning that might be showing
                yield f"data: {json.dumps({'type': 'hide_warning'})}\n\n"
                
                # Provide specific error handling based on error type
                error_message = str(e)
                error_type = 'error'
                
                if 'timeout' in error_message.lower():
                    error_type = 'timeout_error'
                elif 'rate limit' in error_message.lower():
                    error_type = 'rate_limit_error'
                elif 'connection' in error_message.lower():
                    error_type = 'connection_error'
                elif 'stopped responding' in error_message.lower():
                    error_type = 'stream_error'
                
                yield f"data: {json.dumps({'type': error_type, 'content': error_message})}\n\n"
        
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
        
        # Log the endpoint error
        session_id = data.get('session_id', 'unknown') if 'data' in locals() else 'unknown'
        log_session_interaction(session_id, 'endpoint_error', {
            'error_type': type(e).__name__,
            'error_message': str(e)
        }, error=e)
        
        return jsonify({'error': str(e)}), 500

def filter_chat_content(text_chunk, inside_artifact):
    """Filter out artifact content from chat using <artifact> tags"""
    buffer = text_chunk
    filtered_text = ""
    current_inside = inside_artifact
    
    # Look for artifact start and end tags
    if not current_inside:
        # Check for artifact start tag
        if '<artifact' in buffer.lower():
            # Found start of artifact
            parts = re.split(r'<artifact[^>]*>', buffer, 1, re.IGNORECASE)
            filtered_text += parts[0]  # Include text before <artifact>
            current_inside = True
            # Don't include the <artifact> tag and everything after
        else:
            # No artifact start found, include all text
            filtered_text += buffer
    else:
        # We're inside an artifact, look for end tag
        if '</artifact>' in buffer.lower():
            # Found end of artifact
            parts = re.split(r'</artifact>', buffer, 1, re.IGNORECASE)
            # Don't include anything before and including </artifact>
            if len(parts) > 1:
                current_inside = False
                # Include text after </artifact> (if any)
                filtered_text += parts[1]
        # If we're still inside artifact, don't include any text
    
    return filtered_text, current_inside

def generate_artifact_filename(artifact_type, title, artifact_id=None):
    """Generate a safe filename for an artifact"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_id = artifact_id or str(uuid.uuid4())[:8]
    
    # Determine file extension based on artifact type
    extensions = {
        'html': '.html',
        'haml': '.html',
        'code': '.txt',
        'markdown': '.md',
        'text': '.txt'
    }
    extension = extensions.get(artifact_type, '.txt')
    
    # For code artifacts, try to use language-specific extension
    if artifact_type == 'code' and language:
        lang_extensions = {
            'python': '.py',
            'javascript': '.js',
            'typescript': '.ts',
            'html': '.html',
            'css': '.css',
            'json': '.json',
            'xml': '.xml',
            'yaml': '.yml',
            'sql': '.sql',
            'java': '.java',
            'cpp': '.cpp',
            'c': '.c',
            'go': '.go',
            'rust': '.rs',
            'php': '.php',
            'ruby': '.rb',
            'bash': '.sh',
            'shell': '.sh'
        }
        extension = lang_extensions.get(language.lower(), '.txt')
    
    # Create safe filename from title
    safe_title = re.sub(r'[^a-zA-Z0-9_\-\s]', '', title or 'Untitled')
    safe_title = re.sub(r'\s+', '_', safe_title.strip())[:50]
    if not safe_title:
        safe_title = 'Untitled'
    
    filename = f"{timestamp}_{safe_title}_{unique_id}{extension}"
    return filename

def create_streaming_artifact_file(artifact_type, title, language=None, artifact_id=None):
    """Create a new artifact file for streaming writes"""
    try:
        # Ensure artifacts directory exists
        os.makedirs(ARTIFACTS_DIR, exist_ok=True)
        
        # Generate filename and path
        filename = generate_artifact_filename(artifact_type, title, artifact_id)
        filepath = os.path.join(ARTIFACTS_DIR, filename)
        
        # Create the file
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('')  # Create empty file
        
        permalink = f"/artifacts/{filename}"
        
        return {
            'success': True,
            'filepath': filepath,
            'filename': filename,
            'permalink': permalink
        }
    except Exception as e:
        logger.error(f"Failed to create streaming artifact file: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }

def append_to_artifact_file(filepath, content, max_retries=3):
    """Append content to an existing artifact file with retry logic"""
    for attempt in range(max_retries):
        try:
            with open(filepath, 'a', encoding='utf-8') as f:
                f.write(content)
            return True
        except (OSError, IOError) as e:
            logger.warning(f"Attempt {attempt + 1} failed to append to artifact file {filepath}: {str(e)}")
            if attempt < max_retries - 1:
                time.sleep(0.1)  # Brief delay before retry
            else:
                logger.error(f"Failed to append to artifact file {filepath} after {max_retries} attempts: {str(e)}")
                return False
        except Exception as e:
            logger.error(f"Unexpected error appending to artifact file {filepath}: {str(e)}")
            return False

def finalize_artifact_file(filepath, artifact_data):
    """Finalize an artifact file and create metadata"""
    try:
        # Verify file exists and get size
        if not os.path.exists(filepath):
            raise IOError(f"Artifact file not found: {filepath}")
        
        file_size = os.path.getsize(filepath)
        if file_size == 0:
            raise IOError(f"Artifact file is empty: {filepath}")
        
        # Create metadata file
        filename = os.path.basename(filepath)
        base_name = os.path.splitext(filename)[0]
        metadata_filename = f"{base_name}.meta.json"
        metadata_filepath = os.path.join(ARTIFACTS_DIR, metadata_filename)
        
        metadata = {
            'id': artifact_data.get('id'),
            'title': artifact_data.get('title', 'Untitled'),
            'type': artifact_data.get('type', 'text'),
            'language': artifact_data.get('language'),
            'created_at': datetime.now().isoformat(),
            'filename': filename,
            'content_length': file_size,
            'streaming_created': True
        }
        
        with open(metadata_filepath, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Finalized artifact file: {filepath} ({file_size} bytes)")
        return {
            'success': True,
            'size': file_size,
            'metadata_file': metadata_filepath
        }
    except Exception as e:
        logger.error(f"Failed to finalize artifact file {filepath}: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }

def parse_streaming_artifacts(content, current_artifacts):
    """Parse artifacts from streaming content and write to files immediately"""
    artifacts_update = []
    
    # Look for artifact tags
    artifact_pattern = r'<artifact\s+([^>]*)>(.*?)</artifact>'
    artifact_start_pattern = r'<artifact\s+([^>]*)>'
    
    # Find complete artifacts first
    complete_artifacts = list(re.finditer(artifact_pattern, content, re.DOTALL | re.IGNORECASE))
    
    for match in complete_artifacts:
        start_pos = match.start()
        attributes_str = match.group(1)
        artifact_content = match.group(2).strip()
        
        # Parse attributes
        attributes = {}
        attr_pattern = r'(\w+)=["\']([^"\']*)["\']'
        attr_matches = re.findall(attr_pattern, attributes_str)
        for attr_name, attr_value in attr_matches:
            attributes[attr_name.lower()] = attr_value
        
        artifact_id = f'artifact_{start_pos}'
        artifact_type = attributes.get('type', 'text')
        artifact_title = attributes.get('title', 'Untitled Artifact')
        
        # Check if this is a new complete artifact or an update to existing
        if start_pos not in current_artifacts:
            # New complete artifact - create file and write content
            file_result = create_streaming_artifact_file(
                artifact_type, 
                artifact_title, 
                attributes.get('language'), 
                artifact_id
            )
            
            if file_result['success']:
                # Write content to file
                with open(file_result['filepath'], 'w', encoding='utf-8') as f:
                    f.write(artifact_content)
                
                # Create artifact object
                artifact = {
                    'id': artifact_id,
                    'type': artifact_type,
                    'title': artifact_title,
                    'content': artifact_content,
                    'complete': True,
                    'permalink': file_result['permalink'],
                    'filename': file_result['filename'],
                    'filepath': file_result['filepath']
                }
                
                if artifact_type == 'code':
                    artifact['language'] = attributes.get('language', 'text')
                
                # Finalize the file
                finalize_result = finalize_artifact_file(file_result['filepath'], artifact)
                if finalize_result['success']:
                    artifact['saved_size'] = finalize_result['size']
                
                current_artifacts[start_pos] = artifact
                artifacts_update.append(artifact)
            else:
                # Fallback to memory-based artifact if file creation fails
                artifact = {
                    'id': artifact_id,
                    'type': artifact_type,
                    'title': artifact_title,
                    'content': artifact_content,
                    'complete': True,
                    'file_error': file_result['error']
                }
                
                if artifact_type == 'code':
                    artifact['language'] = attributes.get('language', 'text')
                
                current_artifacts[start_pos] = artifact
                artifacts_update.append(artifact)
        else:
            # Update existing artifact to complete
            existing_artifact = current_artifacts[start_pos]
            existing_artifact['content'] = artifact_content
            existing_artifact['complete'] = True
            
            # Update file if it exists
            if 'filepath' in existing_artifact and os.path.exists(existing_artifact['filepath']):
                with open(existing_artifact['filepath'], 'w', encoding='utf-8') as f:
                    f.write(artifact_content)
                
                # Finalize the file
                finalize_result = finalize_artifact_file(existing_artifact['filepath'], existing_artifact)
                if finalize_result['success']:
                    existing_artifact['saved_size'] = finalize_result['size']
            
            artifacts_update.append(existing_artifact)
    
    # Find incomplete artifacts (opening tag without closing tag)
    incomplete_starts = list(re.finditer(artifact_start_pattern, content, re.IGNORECASE))
    
    for match in incomplete_starts:
        start_pos = match.start()
        
        # Skip if this is part of a complete artifact we already processed
        is_complete = any(complete_match.start() == start_pos for complete_match in complete_artifacts)
        if is_complete:
            continue
        
        attributes_str = match.group(1)
        
        # Parse attributes
        attributes = {}
        attr_pattern = r'(\w+)=["\']([^"\']*)["\']'
        attr_matches = re.findall(attr_pattern, attributes_str)
        for attr_name, attr_value in attr_matches:
            attributes[attr_name.lower()] = attr_value
        
        # Get content after the opening tag
        remaining_content = content[match.end():].strip()
        
        artifact_id = f'artifact_{start_pos}'
        artifact_type = attributes.get('type', 'text')
        artifact_title = attributes.get('title', 'Untitled Artifact')
        
        if start_pos not in current_artifacts:
            # New incomplete artifact - create file
            file_result = create_streaming_artifact_file(
                artifact_type, 
                artifact_title, 
                attributes.get('language'), 
                artifact_id
            )
            
            artifact = {
                'id': artifact_id,
                'type': artifact_type,
                'title': artifact_title,
                'content': remaining_content,
                'complete': False
            }
            
            if artifact_type == 'code':
                artifact['language'] = attributes.get('language', 'text')
            
            if file_result['success']:
                artifact['permalink'] = file_result['permalink']
                artifact['filename'] = file_result['filename']
                artifact['filepath'] = file_result['filepath']
                
                # Write initial content
                if remaining_content:
                    with open(file_result['filepath'], 'w', encoding='utf-8') as f:
                        f.write(remaining_content)
            else:
                artifact['file_error'] = file_result['error']
            
            current_artifacts[start_pos] = artifact
            artifacts_update.append(artifact)
        else:
            # Update existing incomplete artifact
            existing_artifact = current_artifacts[start_pos]
            if existing_artifact.get('content') != remaining_content:
                # Calculate new content to append
                old_content = existing_artifact.get('content', '')
                if remaining_content.startswith(old_content):
                    # New content is an extension of old content
                    new_content = remaining_content[len(old_content):]
                    if new_content:
                        # Append to file
                        if 'filepath' in existing_artifact and os.path.exists(existing_artifact['filepath']):
                            append_to_artifact_file(existing_artifact['filepath'], new_content)
                else:
                    # Content has changed significantly, rewrite file
                    if 'filepath' in existing_artifact and os.path.exists(existing_artifact['filepath']):
                        with open(existing_artifact['filepath'], 'w', encoding='utf-8') as f:
                            f.write(remaining_content)
                
                existing_artifact['content'] = remaining_content
                artifacts_update.append(existing_artifact)
    
    return artifacts_update

def parse_artifacts(content):
    """Parse artifacts from Claude's response using <artifact> tags"""
    artifacts = []
    
    # Look for artifact tags
    artifact_pattern = r'<artifact\s+([^>]*)>(.*?)</artifact>'
    matches = re.finditer(artifact_pattern, content, re.DOTALL | re.IGNORECASE)
    
    for match in matches:
        attributes_str = match.group(1)
        artifact_content = match.group(2).strip()
        
        # Parse attributes
        attributes = {}
        attr_pattern = r'(\w+)=["\']([^"\']*)["\']'
        attr_matches = re.findall(attr_pattern, attributes_str)
        for attr_name, attr_value in attr_matches:
            attributes[attr_name.lower()] = attr_value
        
        # Create artifact
        artifact = {
            'type': attributes.get('type', 'text'),
            'title': attributes.get('title', 'Untitled Artifact'),
            'content': artifact_content
        }
        
        # Add language for code artifacts
        if artifact['type'] == 'code':
            artifact['language'] = attributes.get('language', 'text')
        
        artifacts.append(artifact)
    
    return artifacts

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

@app.route('/version')
def version():
    """Get application version"""
    return jsonify({'version': VERSION, 'timestamp': datetime.now().isoformat()})

@app.route('/artifacts/<filename>')
def serve_artifact(filename):
    """Serve saved artifacts from the artifacts directory"""
    try:
        # Check if file exists first
        file_path = os.path.join(ARTIFACTS_DIR, filename)
        if not os.path.exists(file_path):
            return jsonify({'error': 'Artifact not found'}), 404
        
        # Determine MIME type based on file extension
        if filename.endswith('.html'):
            mimetype = 'text/html'
        elif filename.endswith('.css'):
            mimetype = 'text/css'
        elif filename.endswith('.js'):
            mimetype = 'application/javascript'
        elif filename.endswith('.json'):
            mimetype = 'application/json'
        elif filename.endswith('.xml'):
            mimetype = 'application/xml'
        else:
            mimetype = None  # Let Flask auto-detect
        
        return send_from_directory(ARTIFACTS_DIR, filename, mimetype=mimetype)
    except FileNotFoundError:
        return jsonify({'error': 'Artifact not found'}), 404

@app.route('/mcp/validate', methods=['POST'])
def validate_slide_api_key():
    """Validate a Slide API key by attempting to get tools"""
    try:
        data = request.get_json()
        api_key = data.get('api_key', '').strip()
        
        if not api_key:
            return jsonify({'error': 'API key is required'}), 400
            
        if not api_key.startswith('tk_'):
            return jsonify({'error': 'Invalid API key format'}), 400
        
        # Try to get tools to validate the key
        tools = mcp_manager.get_tools_for_claude(api_key)
        
        if tools:
            return jsonify({
                'valid': True,
                'message': 'API key is valid',
                'tools_count': len(tools),
                'tools': [tool.get('name') for tool in tools]
            })
        else:
            return jsonify({
                'valid': False,
                'error': 'Failed to retrieve tools with this API key'
            }), 400
            
    except Exception as e:
        logger.error(f"Error validating API key: {str(e)}")
        return jsonify({
            'valid': False,
            'error': str(e)
        }), 500

@app.route('/mcp/test', methods=['POST'])
def test_mcp_tool():
    """Test a specific MCP tool with the provided API key"""
    try:
        data = request.get_json()
        api_key = data.get('api_key', '').strip()
        tool_name = data.get('tool_name', '').strip()
        tool_args = data.get('arguments', {})
        
        if not api_key:
            return jsonify({'error': 'API key is required'}), 400
            
        if not tool_name:
            return jsonify({'error': 'Tool name is required'}), 400
        
        # Call the tool
        result = mcp_manager.call_tool(tool_name, tool_args, api_key)
        
        return jsonify({
            'success': True,
            'tool_name': tool_name,
            'result': result
        })
        
    except Exception as e:
        logger.error(f"Error testing MCP tool: {str(e)}")
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

@app.route('/context/status')
def context_status():
    """Get context window usage for a session"""
    try:
        session_id = request.args.get('session_id', 'default')
        
        # System message for context calculation
        system_message = """You are Claude, an AI assistant integrated with Slide backup and disaster recovery systems. 

Your primary purpose is to help users manage, monitor, and troubleshoot their Slide backup solutions.

Key capabilities:
- Query backup status and health metrics
- Monitor virtualization and replication status
- Analyze backup schedules and retention policies
- Troubleshoot backup failures and performance issues
- Generate reports on backup coverage and compliance
- Provide guidance on disaster recovery procedures

You have access to real-time data from Slide devices through integrated MCP tools."""
        
        if session_id not in chat_sessions:
            return jsonify({
                'session_id': session_id,
                'tokens_used': 0,
                'tokens_limit': CONTEXT_WINDOW,
                'usage_percentage': 0,
                'message_count': 0,
                'status': 'empty',
                'strategy': 'none',
                'tokens_remaining': CONTEXT_WINDOW
            })
        
        # Get context manager and calculate state
        context_manager = get_session_context_manager(session_id)
        session_messages = chat_sessions[session_id]
        state = context_manager.get_context_state(session_messages, system_message)
        
        return jsonify({
            'session_id': session_id,
            **state
        })
        
    except Exception as e:
        logger.error(f"Error getting context status: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/chat/optimize', methods=['POST'])
def optimize_context():
    """Manually trigger context optimization for a session"""
    try:
        data = request.get_json()
        session_id = data.get('session_id', 'default')
        
        if session_id not in chat_sessions:
            return jsonify({'error': 'Session not found'}), 404
        
        # Get context manager
        context_manager = get_session_context_manager(session_id)
        
        # System message for context calculation
        system_message = """You are Claude, an AI assistant integrated with Slide backup and disaster recovery systems. 

Your primary purpose is to help users manage, monitor, and troubleshoot their Slide backup solutions.

Key capabilities:
- Query backup status and health metrics
- Monitor virtualization and replication status
- Analyze backup schedules and retention policies
- Troubleshoot backup failures and performance issues
- Generate reports on backup coverage and compliance
- Provide guidance on disaster recovery procedures

You have access to real-time data from Slide devices through integrated MCP tools."""
        
        # Force optimization
        current_messages = chat_sessions[session_id]
        optimized_messages, management_info = context_manager.manage_context(
            current_messages, 
            system_message
        )
        
        # Update session
        chat_sessions[session_id] = optimized_messages
        
        # Log the action
        log_session_interaction(session_id, 'context_optimized', management_info)
        
        return jsonify({
            'message': f"Removed {management_info['removed']} messages, created {management_info.get('summarized', 0)} summaries",
            'management_info': management_info
        })
        
    except Exception as e:
        logger.error(f"Error optimizing context: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/logs/status')
def logs_status():
    """Get logging status and available log files"""
    try:
        log_files = []
        if os.path.exists(LOGS_DIR):
            for filename in os.listdir(LOGS_DIR):
                if filename.endswith('.log') or filename.endswith('.json'):
                    filepath = os.path.join(LOGS_DIR, filename)
                    file_size = os.path.getsize(filepath)
                    modified_time = datetime.fromtimestamp(os.path.getmtime(filepath)).isoformat()
                    log_files.append({
                        'filename': filename,
                        'size_bytes': file_size,
                        'size_mb': round(file_size / (1024 * 1024), 2),
                        'modified': modified_time
                    })
        
        return jsonify({
            'logs_directory': LOGS_DIR,
            'log_files': sorted(log_files, key=lambda x: x['modified'], reverse=True),
            'total_files': len(log_files),
            'total_size_mb': round(sum(f['size_bytes'] for f in log_files) / (1024 * 1024), 2)
        })
    except Exception as e:
        logger.error(f"Error getting logs status: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/logs/recent/<log_type>')
def get_recent_logs(log_type):
    """Get recent log entries for debugging"""
    try:
        lines_limit = request.args.get('lines', 50, type=int)
        today = datetime.now().strftime("%Y%m%d")
        
        if log_type == 'sessions':
            log_file = os.path.join(LOGS_DIR, f'sessions_{today}.log')
        elif log_type == 'api':
            log_file = os.path.join(LOGS_DIR, f'api_interactions_{today}.log')
        else:
            return jsonify({'error': 'Invalid log type. Use "sessions" or "api"'}), 400
        
        if not os.path.exists(log_file):
            return jsonify({
                'log_type': log_type,
                'log_file': log_file,
                'entries': [],
                'message': 'Log file does not exist yet'
            })
        
        # Read the last N lines from the log file
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            recent_lines = lines[-lines_limit:] if len(lines) > lines_limit else lines
        
        return jsonify({
            'log_type': log_type,
            'log_file': log_file,
            'entries': [line.strip() for line in recent_lines if line.strip()],
            'total_lines': len(lines),
            'showing_lines': len(recent_lines)
        })
        
    except Exception as e:
        logger.error(f"Error getting recent logs: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/logs/debug/<session_id>')
def get_session_debug(session_id):
    """Get debug logs for a specific session"""
    try:
        debug_files = []
        if os.path.exists(LOGS_DIR):
            for filename in os.listdir(LOGS_DIR):
                if filename.startswith(f'session_debug_{session_id}') and filename.endswith('.json'):
                    filepath = os.path.join(LOGS_DIR, filename)
                    modified_time = datetime.fromtimestamp(os.path.getmtime(filepath)).isoformat()
                    debug_files.append({
                        'filename': filename,
                        'modified': modified_time,
                        'filepath': filepath
                    })
        
        debug_files.sort(key=lambda x: x['modified'], reverse=True)
        
        # If we have debug files, return the most recent one's content
        if debug_files:
            latest_file = debug_files[0]['filepath']
            with open(latest_file, 'r', encoding='utf-8') as f:
                debug_data = json.load(f)
            
            return jsonify({
                'session_id': session_id,
                'debug_files': debug_files,
                'latest_debug_data': debug_data
            })
        else:
            return jsonify({
                'session_id': session_id,
                'debug_files': [],
                'message': 'No debug files found for this session'
            })
        
    except Exception as e:
        logger.error(f"Error getting session debug: {str(e)}")
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