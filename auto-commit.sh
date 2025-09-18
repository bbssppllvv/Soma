#!/bin/bash
echo "Waiting 5 minutes before git operations..."
echo "Started at: $(date)"
sleep 300
echo "5 minutes passed, executing git commands at: $(date)"
git add .
git commit -m "OFF pipeline analysis and simplification recommendations"
git push origin master
echo "Published to GitHub at: $(date)"
