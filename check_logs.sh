#!/bin/bash

# Simple script to check chat application logs for debugging

echo "=== Chat Application Log Checker ==="
echo

# Check if logs directory exists
if [ ! -d "logs" ]; then
    echo "❌ Logs directory doesn't exist yet. Start the application to create it."
    exit 1
fi

echo "📁 Logs directory: $(pwd)/logs"
echo

# Show log files summary
echo "📊 Log Files Summary:"
echo "--------------------"
ls -lh logs/ | grep -E '\.(log|json)$' | while read line; do
    echo "$line"
done
echo

# Show recent session activity
TODAY=$(date +%Y%m%d)
SESSION_LOG="logs/sessions_${TODAY}.log"
API_LOG="logs/api_interactions_${TODAY}.log"

if [ -f "$SESSION_LOG" ]; then
    echo "📝 Recent Session Activity (last 10 entries):"
    echo "----------------------------------------------"
    tail -n 10 "$SESSION_LOG" | grep -o '"event_type":"[^"]*"' | cut -d'"' -f4 | sort | uniq -c | sort -nr
    echo
    
    echo "🔍 Last 5 Session Events:"
    echo "-------------------------"
    tail -n 5 "$SESSION_LOG" | jq -r '.timestamp + " - " + .event_type + " (" + .session_id + ")"' 2>/dev/null || tail -n 5 "$SESSION_LOG"
    echo
else
    echo "ℹ️  No session log for today yet."
    echo
fi

if [ -f "$API_LOG" ]; then
    echo "🌐 Recent API Activity (last 10 entries):"
    echo "-----------------------------------------"
    tail -n 10 "$API_LOG" | grep -o '"event_type":"[^"]*"' | cut -d'"' -f4 | sort | uniq -c | sort -nr
    echo
    
    echo "🔍 Last 5 API Events:"
    echo "--------------------"
    tail -n 5 "$API_LOG" | jq -r '.timestamp + " - " + .event_type' 2>/dev/null || tail -n 5 "$API_LOG"
    echo
else
    echo "ℹ️  No API log for today yet."
    echo
fi

# Check for recent errors
echo "⚠️  Recent Errors:"
echo "------------------"
ERROR_COUNT=0
if [ -f "$SESSION_LOG" ]; then
    ERRORS=$(grep -c '"error":' "$SESSION_LOG" 2>/dev/null || echo 0)
    if [ "$ERRORS" -gt 0 ]; then
        echo "Session errors: $ERRORS"
        grep '"error":' "$SESSION_LOG" | tail -n 3 | jq -r '.timestamp + " - " + .event_type + ": " + .error' 2>/dev/null || grep '"error":' "$SESSION_LOG" | tail -n 3
        ERROR_COUNT=$((ERROR_COUNT + ERRORS))
    fi
fi

if [ -f "$API_LOG" ]; then
    ERRORS=$(grep -c '"error":' "$API_LOG" 2>/dev/null || echo 0)
    if [ "$ERRORS" -gt 0 ]; then
        echo "API errors: $ERRORS"
        grep '"error":' "$API_LOG" | tail -n 3 | jq -r '.timestamp + " - " + .event_type + ": " + .error' 2>/dev/null || grep '"error":' "$API_LOG" | tail -n 3
        ERROR_COUNT=$((ERROR_COUNT + ERRORS))
    fi
fi

if [ "$ERROR_COUNT" -eq 0 ]; then
    echo "✅ No errors found in today's logs!"
fi

echo
echo "🔧 Debug Commands:"
echo "------------------"
echo "View all logs:           ls -la logs/"
echo "Session logs:            tail -f $SESSION_LOG"
echo "API logs:                tail -f $API_LOG"
echo "Recent debug files:      ls -lt logs/session_debug_* | head -5"
echo "Clean old logs:          find logs/ -name '*.log' -mtime +7 -delete"
echo
echo "🌐 Web Endpoints:"
echo "-----------------"
echo "Log status:              curl http://localhost:5000/logs/status"
echo "Recent sessions:         curl http://localhost:5000/logs/recent/sessions?lines=20"
echo "Recent API:              curl http://localhost:5000/logs/recent/api?lines=20"
echo "Session debug:           curl http://localhost:5000/logs/debug/{session_id}"
echo

echo "Done! 🎉" 