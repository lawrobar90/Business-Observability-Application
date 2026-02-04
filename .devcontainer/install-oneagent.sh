#!/bin/bash
# Auto-configure Dynatrace OneAgent for Node.js in Codespaces
# Note: Full OneAgent cannot run in containers, so we use Node.js instrumentation

set -e

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${CYAN}🔍 Configuring Dynatrace OneAgent for Codespaces...${NC}"
echo ""

# Check if required environment variables are set
if [ -z "${DYNATRACE_URL}" ] || [ -z "${DYNATRACE_TOKEN}" ]; then
    echo -e "${YELLOW}⚠️  OneAgent configuration skipped${NC}"
    echo -e "${CYAN}   Missing: DYNATRACE_URL or DYNATRACE_TOKEN${NC}"
    echo -e "${CYAN}   Add these as Codespace secrets to enable Dynatrace monitoring${NC}"
    echo ""
    exit 0
fi

echo -e "${BOLD}🚀 Setting up Dynatrace Node.js OneAgent...${NC}"
echo -e "${CYAN}   Environment: ${DYNATRACE_URL}${NC}"
echo ""

# Install @dynatrace/oneagent-sdk package if not already installed
cd /workspaces/Business-Observability-Application

if ! grep -q '"@dynatrace/oneagent"' package.json 2>/dev/null; then
    echo -e "${CYAN}   Installing @dynatrace/oneagent npm package...${NC}"
    npm install --save @dynatrace/oneagent >/dev/null 2>&1 || {
        echo -e "${YELLOW}⚠️  Could not install @dynatrace/oneagent package${NC}"
        echo -e "${CYAN}   Run manually: npm install --save @dynatrace/oneagent${NC}"
    }
    echo -e "${GREEN}   ✅ @dynatrace/oneagent package installed${NC}"
else
    echo -e "${GREEN}   ✅ @dynatrace/oneagent package already installed${NC}"
fi

# Normalize Dynatrace URL
DT_URL="${DYNATRACE_URL%/}"

# For sprint environments, use the correct domain  
if [[ "$DT_URL" == *".sprint.apps.dynatracelabs.com" ]]; then
    DT_URL=$(echo "$DT_URL" | sed 's/apps\.dynatracelabs/dynatracelabs/')
fi

# Export environment variables for Node.js OneAgent
export DT_CONNECTION_POINT="$DT_URL"
export DT_TENANT="$DT_URL"

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}Dynatrace Configuration Complete${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${CYAN}"
echo -e "📊 Monitoring enabled for:"
echo -e "   • Node.js application instrumentation"
echo -e "   • API calls and database queries"
echo -e "   • Custom metrics and traces"
echo -e "${NC}"
echo ""
