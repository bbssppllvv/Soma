#!/bin/bash

# Stop Vercel logs monitor

PIDFILE="monitor.pid"

if [[ -f "$PIDFILE" ]]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "🛑 Stopping monitor (PID: $PID)..."
        kill "$PID"
        rm -f "$PIDFILE"
        echo "✅ Monitor stopped"
    else
        echo "❌ Monitor not running (stale PID file)"
        rm -f "$PIDFILE"
    fi
else
    echo "❌ Monitor not running (no PID file)"
fi

# Also stop any screen sessions
if screen -list | grep -q "vercel-logs"; then
    echo "🛑 Stopping screen session..."
    screen -S vercel-logs -X quit
fi
