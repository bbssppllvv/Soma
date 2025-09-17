#!/bin/bash

# View Vercel logs in real-time

LOGFILE="vercel-logs.txt"

if [[ ! -f "$LOGFILE" ]]; then
    echo "❌ No logs file found. Start monitor first:"
    echo "   ./start-persistent-monitor.sh"
    exit 1
fi

echo "📺 Viewing Vercel logs (Ctrl+C to exit)"
echo "📝 File: $LOGFILE"
echo ""

# Show last 20 lines and follow
tail -20 "$LOGFILE"
echo "─────────────────────────────────────────────────────"
tail -f "$LOGFILE"
