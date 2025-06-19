# Chat Application Logging System

This chat application now includes comprehensive logging to help track down issues with Claude API interactions and session management.

## Log Files Location

All logs are stored in the `logs/` directory relative to the application root:
- `/var/www/chat.slide.recipes/logs/`

## Types of Logs Generated

### 1. Session Logs
- **File**: `sessions_YYYYMMDD.log`
- **Purpose**: Track user sessions, messages, and general application flow
- **Content**: Session creation, user messages, response completion, errors

### 2. API Interaction Logs  
- **File**: `api_interactions_YYYYMMDD.log`
- **Purpose**: Track all interactions with the Claude API
- **Content**: API requests, streaming responses, errors, timeouts

### 3. Session Debug Files
- **File**: `session_debug_{session_id}_YYYYMMDD_HHMMSS.json`
- **Purpose**: Complete debug information for individual sessions
- **Content**: Full conversation, API responses, errors, metadata

## Debugging Endpoints

The application provides several endpoints to help with debugging:

### View Log Status
```
GET /logs/status
```
Returns overview of all log files, sizes, and modification times.

### View Recent Log Entries
```
GET /logs/recent/sessions?lines=50
GET /logs/recent/api?lines=100
```
Returns the most recent log entries from session or API logs.

### View Session Debug Data
```
GET /logs/debug/{session_id}
```
Returns detailed debug information for a specific session.

## What Gets Logged

### Session Events
- `message_received` - When a user sends a message
- `session_created` - When a new session is created
- `user_message_added` - When user message is added to session
- `response_completed` - When Claude response completes successfully
- `response_error` - When an error occurs during response generation
- `endpoint_error` - When an error occurs at the Flask endpoint level

### API Events
- `request_start` - When API request begins
- `api_request` - The actual payload sent to Claude API
- `streaming_start` - When streaming response begins
- `streaming_complete` - When streaming completes successfully
- `timeout_error` - When API request times out
- `connection_error` - When connection to API fails
- `http_error` - When API returns HTTP error
- `general_error` - Other API-related errors

## Debugging Claude Issues

### Common Issue: Claude Stops Responding Mid-Process

1. **Check Session Debug Files**: Look for the specific session that had issues
   ```bash
   ls logs/session_debug_*
   ```

2. **Check API Interaction Logs**: Look for timeout or connection errors
   ```bash
   tail -n 50 logs/api_interactions_$(date +%Y%m%d).log
   ```

3. **Use Debug Endpoints**: 
   - Visit `/logs/status` to see all available logs
   - Visit `/logs/recent/api?lines=100` to see recent API interactions
   - Visit `/logs/debug/{session_id}` with the problematic session ID

### Reading Log Entries

Each log entry is in JSON format and includes:
- `timestamp` - When the event occurred
- `session_id` - Unique identifier for the chat session
- `event_type` - Type of event (see above)
- `data` - Event-specific data
- `error` - Error information (if applicable)

## Log File Management

### Automatic Log Rotation
- New log files are created daily
- Old files are preserved for historical analysis

### Log File Sizes
- Session logs: Typically small, one entry per user interaction
- API logs: Larger, multiple entries per conversation
- Debug files: Largest, complete conversation dumps

### Cleaning Up Logs
To clean up old logs:
```bash
# Remove logs older than 7 days
find logs/ -name "*.log" -mtime +7 -delete
find logs/ -name "*.json" -mtime +7 -delete
```

## Security Notes

- API keys are never logged in full
- User messages are truncated in API logs (first 200 characters)
- Full user messages are only stored in session debug files
- IP addresses are logged for debugging but can be disabled if needed

## Example Usage

### Finding Issues with a Specific Session
1. Get the session ID from the browser's developer tools or frontend logs
2. Use the debug endpoint: `GET /logs/debug/{session_id}`
3. Look at the `latest_debug_data` for the complete conversation and any errors

### Monitoring API Performance
1. Check recent API logs: `GET /logs/recent/api?lines=200`
2. Look for patterns in timeout or error events
3. Check response times and chunk counts in `streaming_complete` events

### Troubleshooting Timeout Issues
1. Look for `timeout_error` events in API logs
2. Check if the error occurred during initial request or streaming
3. Review the request payload size and complexity
4. Check for patterns in when timeouts occur

This logging system provides comprehensive visibility into the application's behavior and Claude API interactions, making it much easier to diagnose and fix issues. 