#!/bin/bash

# Start persistent Vercel logs monitor with file logging

LOGFILE="vercel-logs.txt"
PIDFILE="monitor.pid"

echo "🚀 Starting persistent Vercel monitor..."

# Check if already running
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
    echo "📺 Monitor already running (PID: $(cat $PIDFILE))"
    echo "   View logs: tail -f $LOGFILE"
    echo "   Stop: ./stop-monitor.sh"
    exit 0
fi

# Get latest deployment
LATEST_DEPLOYMENT=$(vercel list --json 2>/dev/null | jq -r '.[0].url // empty' 2>/dev/null)

if [[ -z "$LATEST_DEPLOYMENT" ]]; then
    echo "❌ Could not get latest deployment"
    exit 1
fi

echo "📡 Monitoring: https://$LATEST_DEPLOYMENT"
echo "📝 Logs file: $LOGFILE"

# Start monitoring in background
nohup bash -c "
    echo '🎯 Vercel Logs Monitor Started at $(date)' > '$LOGFILE'
    echo '📊 Monitoring: https://$LATEST_DEPLOYMENT' >> '$LOGFILE'
    echo '─────────────────────────────────────────────────────' >> '$LOGFILE'
    
    vercel logs 'https://$LATEST_DEPLOYMENT' --json 2>/dev/null | while read -r line; do
        timestamp=\$(echo \"\$line\" | jq -r '.timestamp // empty' 2>/dev/null)
        level=\$(echo \"\$line\" | jq -r '.level // \"info\"' 2>/dev/null)
        message=\$(echo \"\$line\" | jq -r '.message // empty' 2>/dev/null)
        
        if [[ -n \"\$message\" ]]; then
            if [[ -n \"\$timestamp\" ]]; then
                formatted_time=\$(date -r \$((\$timestamp / 1000)) '+%H:%M:%S' 2>/dev/null || echo \$(date '+%H:%M:%S'))
            else
                formatted_time=\$(date '+%H:%M:%S')
            fi
            
            echo \"[\$formatted_time] \$level: \$message\" >> '$LOGFILE'
            
            # Also echo important messages to console
            if [[ \"\$message\" == *\"GPT-5\"* ]] || [[ \"\$message\" == *\"[OFF]\"* ]] || [[ \"\$level\" == \"error\" ]]; then
                echo \"[\$formatted_time] \$level: \$message\"
            fi
        fi
    done
" > /dev/null 2>&1 & 

# Save PID
echo $! > "$PIDFILE"

echo "✅ Monitor started in background!"
echo ""
echo "📋 Commands:"
echo "   View logs:  tail -f $LOGFILE"
echo "   Live view:  ./view-logs.sh"
echo "   Stop:       ./stop-monitor.sh"
echo ""
echo "🎯 Monitor is now running persistently!"
