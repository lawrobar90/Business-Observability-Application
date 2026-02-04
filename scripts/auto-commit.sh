#!/bin/bash

# Git Auto-Commit Script for BizObs
# Commits all changes with a descriptive message

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "🔍 Checking for changes..."

# Check if there are changes to commit
if [[ -z $(git status -s) ]]; then
    echo "✅ No changes to commit"
    exit 0
fi

echo "📋 Changes detected:"
git status -s

# Add all changes
echo ""
echo "📦 Staging changes..."
git add -A

# Generate commit message based on changes
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
COMMIT_MSG="chore: Auto-commit changes - $TIMESTAMP

Changes:
$(git diff --cached --stat)
"

echo ""
echo "💾 Committing..."
git commit -m "$COMMIT_MSG"

echo ""
echo "✅ Changes committed successfully!"
echo ""
echo "📤 To push to remote:"
echo "   git push origin main"
echo ""
echo "💡 Note: You may need to authenticate with GitHub"
