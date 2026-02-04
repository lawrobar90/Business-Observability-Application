#!/bin/bash
# Auto-start BizObs app and MCP server in Codespaces with startup summary

set -e

# Colors for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Clear screen for clean output
clear

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║           🚀 BizObs - Business Observability Engine 🚀           ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

cd /workspaces/Business-Observability-Application || exit 1

# Check OneAgent installation
echo -e "${BOLD}1️⃣  OneAgent Status${NC}"
if [ -d "/opt/dynatrace/oneagent" ]; then
    echo -e "   ${GREEN}✅ Dynatrace OneAgent installed${NC}"
    if [ -n "${DYNATRACE_URL}" ]; then
        echo -e "   ${GREEN}✅ Connected to: ${DYNATRACE_URL}${NC}"
    fi
else
    echo -e "   ${YELLOW}⚠️  OneAgent not installed (running in demo mode)${NC}"
fi
echo ""

# Export Dynatrace environment if configured
if [ -n "${DYNATRACE_URL}" ]; then
    export DT_ENVIRONMENT="${DYNATRACE_URL}"
fi

# Start the BizObs application
echo -e "${BOLD}2️⃣  Starting BizObs Application${NC}"
nohup node server.js > /tmp/bizobs.log 2>&1 &
APP_PID=$!
echo -e "   ${GREEN}✅ BizObs app started (PID: ${APP_PID})${NC}"

# Wait for app to start
echo -e "   ${CYAN}⏳ Waiting for server to be ready...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "   ${GREEN}✅ Server is ready!${NC}"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "   ${YELLOW}⚠️  Server taking longer than expected${NC}"
    fi
done
echo ""

# Check MCP Server status
echo -e "${BOLD}3️⃣  MCP Server Status${NC}"
if [ -n "${DT_ENVIRONMENT}" ]; then
    echo -e "   ${GREEN}✅ MCP server will auto-start when needed${NC}"
    echo -e "   ${CYAN}   Port: 3000${NC}"
else
    echo -e "   ${YELLOW}⚠️  No DT_ENVIRONMENT set - configure in UI${NC}"
fi
echo ""

# Check if Monaco configuration needed
echo -e "${BOLD}4️⃣  Dynatrace Configuration${NC}"
if [ -n "${DT_API_TOKEN}" ] && [ -n "${DYNATRACE_URL}" ]; then
    echo -e "   ${CYAN}💡 Ready to deploy configuration${NC}"
    echo -e "   ${CYAN}   Run: npm run configure:dynatrace${NC}"
else
    echo -e "   ${YELLOW}⚠️  Set DT_API_TOKEN to auto-configure Dynatrace${NC}"
fi
echo ""

# Get Codespace URL
CODESPACE_NAME="${CODESPACE_NAME:-}"
if [ -n "$CODESPACE_NAME" ]; then
    # Extract GitHub username from Codespace name
    APP_URL="https://${CODESPACE_NAME}-8080.app.github.dev"
    MCP_URL="https://${CODESPACE_NAME}-3000.app.github.dev"
else
    APP_URL="http://localhost:8080"
    MCP_URL="http://localhost:3000"
fi

# Display access information
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                     🎉 READY TO USE! 🎉                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${BOLD}🌐 Access URLs:${NC}"
echo -e "   ${CYAN}BizObs App:  ${BOLD}${APP_URL}${NC}"
echo -e "   ${CYAN}MCP Server:  ${BOLD}${MCP_URL}${NC}"
echo ""
echo -e "${BOLD}📊 Quick Actions:${NC}"
echo -e "   ${CYAN}• View logs:          ${NC}tail -f /tmp/bizobs.log"
echo -e "   ${CYAN}• Configure Dynatrace:${NC}npm run configure:dynatrace"
echo -e "   ${CYAN}• Restart app:        ${NC}pkill -f 'node server.js' && bash .devcontainer/start-app.sh"
echo ""
echo -e "${BOLD}📚 Documentation:${NC}"
echo -e "   ${CYAN}• Quick Start:        ${NC}AUTOMATED-CONFIG-QUICKSTART.md"
echo -e "   ${CYAN}• README:             ${NC}README.md"
echo -e "   ${CYAN}• Monaco Setup:       ${NC}dynatrace-monaco/README.md"
echo ""
echo -e "${BOLD}💡 Next Steps:${NC}"
echo -e "   1. ${GREEN}Click the BizObs App URL above${NC}"
echo -e "   2. ${GREEN}Create a customer journey${NC}"
echo -e "   3. ${GREEN}Configure Dynatrace settings in UI${NC}"
echo -e "   4. ${GREEN}Deploy dashboards with MCP server${NC}"
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
