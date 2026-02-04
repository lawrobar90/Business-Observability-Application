#!/bin/bash
#
# Repository Traffic Statistics Viewer
# This script fetches and displays traffic statistics for the repository
#
# Usage: ./view-traffic-stats.sh [GITHUB_TOKEN]
#
# If GITHUB_TOKEN is not provided, the script will attempt to use:
# 1. The GITHUB_TOKEN environment variable
# 2. The gh CLI if installed
#

set -e

REPO="lawrobar90/Partner-PowerUp-BizObs-App"

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check for GitHub token
if [ -n "$1" ]; then
    TOKEN="$1"
elif [ -n "$GITHUB_TOKEN" ]; then
    TOKEN="$GITHUB_TOKEN"
elif command -v gh &> /dev/null; then
    print_warning "No token provided, attempting to use GitHub CLI..."
    USE_GH_CLI=true
else
    print_error "Error: GitHub token required"
    echo ""
    echo "Usage: $0 [GITHUB_TOKEN]"
    echo ""
    echo "Alternatively, set the GITHUB_TOKEN environment variable:"
    echo "  export GITHUB_TOKEN=your_token_here"
    echo "  $0"
    echo ""
    echo "Or install the GitHub CLI (gh) from https://cli.github.com/"
    exit 1
fi

# Function to fetch data
fetch_data() {
    local endpoint="$1"
    local description="$2"
    
    if [ "$USE_GH_CLI" = true ]; then
        gh api "/repos/${REPO}${endpoint}"
    else
        curl -s -H "Authorization: token $TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/repos/${REPO}${endpoint}"
    fi
}

# Function to parse and display clone stats
display_clone_stats() {
    local data="$1"
    
    # Extract total clones and unique cloners
    local count=$(echo "$data" | grep -o '"count":[0-9]*' | head -1 | cut -d':' -f2)
    local uniques=$(echo "$data" | grep -o '"uniques":[0-9]*' | head -1 | cut -d':' -f2)
    
    if [ -n "$count" ] && [ -n "$uniques" ]; then
        echo "  Total Clones (14 days): $count"
        echo "  Unique Cloners: $uniques"
        echo ""
        echo "  Daily Breakdown:"
        echo "$data" | grep -A 1 '"timestamp"' | grep -v '^--$' | \
            sed 's/.*"timestamp":"\([^"]*\)".*/    \1/' | head -14
    else
        print_warning "No clone data available or unable to parse"
    fi
}

# Function to parse and display view stats
display_view_stats() {
    local data="$1"
    
    # Extract total views and unique visitors
    local count=$(echo "$data" | grep -o '"count":[0-9]*' | head -1 | cut -d':' -f2)
    local uniques=$(echo "$data" | grep -o '"uniques":[0-9]*' | head -1 | cut -d':' -f2)
    
    if [ -n "$count" ] && [ -n "$uniques" ]; then
        echo "  Total Views (14 days): $count"
        echo "  Unique Visitors: $uniques"
        echo ""
    else
        print_warning "No view data available or unable to parse"
    fi
}

# Main execution
echo ""
print_header "Repository Traffic Statistics"
echo "Repository: $REPO"
echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Fetch clone statistics
print_header "Clone Statistics"
CLONE_DATA=$(fetch_data "/traffic/clones" "Clone statistics")
if [ $? -eq 0 ]; then
    display_clone_stats "$CLONE_DATA"
else
    print_error "Failed to fetch clone statistics"
fi
echo ""

# Fetch view statistics
print_header "View Statistics"
VIEW_DATA=$(fetch_data "/traffic/views" "View statistics")
if [ $? -eq 0 ]; then
    display_view_stats "$VIEW_DATA"
else
    print_error "Failed to fetch view statistics"
fi
echo ""

# Fetch popular paths
print_header "Popular Paths"
PATHS_DATA=$(fetch_data "/traffic/popular/paths" "Popular paths")
if [ $? -eq 0 ]; then
    echo "$PATHS_DATA" | grep -o '"path":"[^"]*"' | sed 's/"path":"//;s/"$//' | head -10 | \
        awk '{print "  " NR". " $0}'
else
    print_error "Failed to fetch popular paths"
fi
echo ""

# Fetch referrers
print_header "Top Referrers"
REFERRERS_DATA=$(fetch_data "/traffic/popular/referrers" "Referrers")
if [ $? -eq 0 ]; then
    echo "$REFERRERS_DATA" | grep -o '"referrer":"[^"]*"' | sed 's/"referrer":"//;s/"$//' | head -10 | \
        awk '{print "  " NR". " $0}'
else
    print_error "Failed to fetch referrers"
fi
echo ""

print_success "Traffic statistics retrieved successfully!"
echo ""
print_warning "Note: GitHub only provides traffic data for the last 14 days."
print_warning "For historical data, check the .github/traffic-data/ directory."
echo ""
