#!/bin/bash

# Start Vercel Logs Monitor in persistent session

SESSION_NAME="vercel-logs"

echo "🚀 Starting persistent Vercel logs monitor..."

# Check if session already exists
if screen -list | grep -q "$SESSION_NAME"; then
    echo "📺 Monitor session already running!"
    echo "   To view: screen -r $SESSION_NAME"
    echo "   To stop: screen -S $SESSION_NAME -X quit"
    exit 0
fi

# Start new screen session with monitor
echo "📡 Creating new monitor session: $SESSION_NAME"
screen -dmS "$SESSION_NAME" bash -c "
    cd '$(pwd)'
    echo '🎯 Vercel Logs Monitor Started'
    echo '📊 Monitoring Soma Diet Tracker logs...'
    echo '🔍 Press Ctrl+C to stop, Ctrl+A then D to detach'
    echo ''
    ./monitor-logs.sh
"

echo "✅ Monitor started in background session!"
echo ""
echo "📋 Commands:"
echo "   View logs:  screen -r $SESSION_NAME"
echo "   Detach:     Ctrl+A then D"
echo "   Stop:       screen -S $SESSION_NAME -X quit"
echo ""
echo "🎯 Monitor is now running persistently!"
