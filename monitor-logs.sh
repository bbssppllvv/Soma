#!/bin/bash

# Vercel Logs Monitoring Script
# Мониторинг логов Soma Diet Tracker бота

echo "🚀 Starting Vercel logs monitoring for Soma Diet Tracker..."
echo "📊 Monitoring latest deployment logs in real-time"
echo "🔍 Looking for GPT-5 and OFF integration logs..."
echo ""

# Get latest deployment URL
LATEST_DEPLOYMENT=$(vercel list --json | jq -r '.[0].url')
echo "📡 Latest deployment: https://$LATEST_DEPLOYMENT"
echo ""

# Monitor logs with filters for our key components
echo "🔍 Monitoring logs (Ctrl+C to stop):"
echo "   - GPT-5 analysis logs"
echo "   - OFF search logs" 
echo "   - Error logs"
echo "   - Performance metrics"
echo ""

# Start monitoring with JSON output and filtering
vercel logs "https://$LATEST_DEPLOYMENT" --json | while read -r line; do
  # Parse JSON log entry
  timestamp=$(echo "$line" | jq -r '.timestamp // empty')
  level=$(echo "$line" | jq -r '.level // "info"')
  message=$(echo "$line" | jq -r '.message // empty')
  
  # Skip empty messages
  if [[ -z "$message" ]]; then
    continue
  fi
  
  # Format timestamp
  if [[ -n "$timestamp" ]]; then
    formatted_time=$(date -r $(($timestamp / 1000)) '+%H:%M:%S')
  else
    formatted_time=$(date '+%H:%M:%S')
  fi
  
  # Color coding based on log level and content
  case "$level" in
    "error")
      color="\033[31m" # Red
      ;;
    "warn")
      color="\033[33m" # Yellow
      ;;
    *)
      # Special highlighting for key components
      if [[ "$message" == *"GPT-5"* ]] || [[ "$message" == *"Starting GPT"* ]]; then
        color="\033[36m" # Cyan for GPT
      elif [[ "$message" == *"[OFF]"* ]] || [[ "$message" == *"search v3 POST"* ]]; then
        color="\033[32m" # Green for OFF
      elif [[ "$message" == *"analysis"* ]] || [[ "$message" == *"resolved"* ]]; then
        color="\033[35m" # Magenta for analysis
      else
        color="\033[37m" # White for general
      fi
      ;;
  esac
  
  # Print formatted log entry
  printf "${color}[%s] %s: %s\033[0m\n" "$formatted_time" "$level" "$message"
done
