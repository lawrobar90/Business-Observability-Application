#!/bin/bash
# Auto-start BizObs app and MCP server in Codespaces

echo "🚀 Starting BizObs Application..."

# Export Dynatrace environment if configured
if [ -n "${DYNATRACE_URL}" ]; then
    export DT_ENVIRONMENT="${DYNATRACE_URL}"
    echo "✅ DT_ENVIRONMENT set to: ${DT_ENVIRONMENT}"
else
    echo "ℹ️ No DYNATRACE_URL configured - running in demo mode"
fi

# Start the BizObs application in background
# The server.js will auto-start the MCP server when DT_ENVIRONMENT is set
cd /workspaces/Business-Observability-Application || exit 1

# Start app in background with logs
nohup node server.js > /tmp/bizobs.log 2>&1 &
APP_PID=$!

echo "✅ BizObs app started (PID: ${APP_PID})"
echo "📝 Logs available at: /tmp/bizobs.log"
echo ""
echo "🌐 Access the app on port 8080 (check Ports tab)"
echo "🔧 MCP Server will auto-start on port 3000 when configured"
echo ""
echo "To view logs: tail -f /tmp/bizobs.log"
