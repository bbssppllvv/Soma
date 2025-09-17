#!/bin/bash

# Simple Vercel Logs Monitor

DEPLOYMENT_URL="https://soma-iiznj1c7o-bespalovmike-gmailcoms-projects.vercel.app"
LOGFILE="vercel-logs.txt"

echo "🚀 Starting Vercel logs monitor..."
echo "📡 Monitoring: $DEPLOYMENT_URL"
echo "📝 Logs will be saved to: $LOGFILE"
echo ""
echo "🔍 Watching for:"
echo "   - GPT-5 analysis logs"
echo "   - OFF search logs"
echo "   - Error messages"
echo "   - Performance metrics"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start monitoring
vercel logs "$DEPLOYMENT_URL" --json | while read -r line; do
    # Parse JSON
    timestamp=$(echo "$line" | jq -r '.timestamp // empty' 2>/dev/null)
    level=$(echo "$line" | jq -r '.level // "info"' 2>/dev/null)
    message=$(echo "$line" | jq -r '.message // empty' 2>/dev/null)
    
    # Skip empty messages
    if [[ -z "$message" ]]; then
        continue
    fi
    
    # Format timestamp
    if [[ -n "$timestamp" ]]; then
        formatted_time=$(date -r $(($timestamp / 1000)) '+%H:%M:%S' 2>/dev/null || date '+%H:%M:%S')
    else
        formatted_time=$(date '+%H:%M:%S')
    fi
    
    # Create log entry
    log_entry="[$formatted_time] $level: $message"
    
    # Save to file
    echo "$log_entry" >> "$LOGFILE"
    
    # Color output for console
    case "$level" in
        "error")
            printf "\033[31m%s\033[0m\n" "$log_entry" # Red
            ;;
        "warn")
            printf "\033[33m%s\033[0m\n" "$log_entry" # Yellow
            ;;
        *)
            if [[ "$message" == *"GPT-5"* ]] || [[ "$message" == *"Starting GPT"* ]]; then
                printf "\033[36m%s\033[0m\n" "$log_entry" # Cyan
            elif [[ "$message" == *"[OFF]"* ]] || [[ "$message" == *"search v3 POST"* ]]; then
                printf "\033[32m%s\033[0m\n" "$log_entry" # Green
            elif [[ "$message" == *"analysis"* ]] || [[ "$message" == *"resolved"* ]]; then
                printf "\033[35m%s\033[0m\n" "$log_entry" # Magenta
            else
                printf "\033[37m%s\033[0m\n" "$log_entry" # White
            fi
            ;;
    esac
done
