#!/bin/bash

# Vercel Logs Management Commands

case "$1" in
    "start")
        echo "🚀 Starting Vercel logs monitor..."
        ./start-monitor.sh
        ;;
    "view"|"show")
        echo "📺 Connecting to logs monitor..."
        echo "   (Press Ctrl+A then D to detach, Ctrl+C to stop)"
        screen -r vercel-logs
        ;;
    "stop")
        echo "🛑 Stopping logs monitor..."
        screen -S vercel-logs -X quit
        echo "✅ Monitor stopped"
        ;;
    "status")
        if screen -list | grep -q "vercel-logs"; then
            echo "✅ Monitor is running"
            echo "   To view: ./logs-commands.sh view"
        else
            echo "❌ Monitor is not running"
            echo "   To start: ./logs-commands.sh start"
        fi
        ;;
    "restart")
        echo "🔄 Restarting logs monitor..."
        screen -S vercel-logs -X quit 2>/dev/null
        sleep 1
        ./start-monitor.sh
        ;;
    *)
        echo "🔍 Vercel Logs Monitor Commands:"
        echo ""
        echo "   ./logs-commands.sh start    - Start monitor"
        echo "   ./logs-commands.sh view     - View logs"
        echo "   ./logs-commands.sh stop     - Stop monitor"
        echo "   ./logs-commands.sh status   - Check status"
        echo "   ./logs-commands.sh restart  - Restart monitor"
        echo ""
        echo "📊 Current status:"
        if screen -list | grep -q "vercel-logs"; then
            echo "   ✅ Monitor is running"
        else
            echo "   ❌ Monitor is not running"
        fi
        ;;
esac
