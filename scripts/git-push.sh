#!/bin/bash

# Git Push Helper for BizObs
# Helps push commits to GitHub with authentication guidance

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

echo "🚀 BizObs Git Push Helper"
echo "=========================="
echo ""

# Check if there are commits to push
UNPUSHED=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l || echo "0")

if [ "$UNPUSHED" -eq 0 ]; then
    echo "✅ No commits to push - already up to date"
    exit 0
fi

echo "📦 You have $UNPUSHED commit(s) to push"
echo ""
echo "Recent commits:"
git log origin/main..HEAD --oneline || git log --oneline -n 5
echo ""

# Check if git credential helper is configured
if ! git config --get credential.helper &>/dev/null; then
    echo "⚙️  Configuring git credential helper..."
    git config --global credential.helper 'cache --timeout=3600'
    echo "✅ Credentials will be cached for 1 hour"
    echo ""
fi

# Attempt to push
echo "📤 Attempting to push to origin/main..."
echo ""

if git push origin main 2>&1; then
    echo ""
    echo "✅ Successfully pushed to GitHub!"
    echo ""
    echo "🔗 View commits at:"
    REPO_URL=$(git config --get remote.origin.url | sed 's/\.git$//')
    if [[ $REPO_URL == git@* ]]; then
        REPO_URL=$(echo $REPO_URL | sed 's/git@github.com:/https:\/\/github.com\//')
    fi
    echo "   $REPO_URL/commits/main"
else
    EXIT_CODE=$?
    echo ""
    echo "⚠️  Push failed!"
    echo ""
    echo "🔐 Authentication Options:"
    echo ""
    echo "Option 1: Use GitHub Personal Access Token (Recommended)"
    echo "   1. Go to: https://github.com/settings/tokens"
    echo "   2. Generate new token (classic) with 'repo' scope"
    echo "   3. Run: git push origin main"
    echo "   4. Username: your-github-username"
    echo "   5. Password: paste-your-token"
    echo ""
    echo "Option 2: Use SSH Key"
    echo "   1. Generate SSH key: ssh-keygen -t ed25519 -C 'your-email@example.com'"
    echo "   2. Add to GitHub: https://github.com/settings/keys"
    echo "   3. Change remote: git remote set-url origin git@github.com:lawrobar90/Business-Observability-Application.git"
    echo "   4. Try push again: git push origin main"
    echo ""
    echo "Option 3: Use GitHub CLI"
    echo "   1. Install: sudo yum install gh"
    echo "   2. Login: gh auth login"
    echo "   3. Try push again: git push origin main"
    echo ""
    echo "💡 After authenticating once, credentials are cached for 1 hour"
    echo ""
    exit $EXIT_CODE
fi
