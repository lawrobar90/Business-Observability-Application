# MCP Server Auto-Detection

## Overview
The BizObs app now **automatically detects** the MCP server URL based on where the app is deployed. This makes it deployment-agnostic - users only need to configure their Dynatrace tenant URL.

## How It Works

### Auto-Detection Logic
When you open the Dynatrace Settings, the app automatically detects the MCP server URL:

- **If deployed on localhost**: MCP URL = `http://localhost:3000`
- **If deployed on remote server** (e.g., EC2): MCP URL = `http://<server-ip>:3000`

The detection happens in the `detectMcpServerUrl()` function:
```javascript
function detectMcpServerUrl() {
  const currentHost = window.location.hostname;
  const currentProtocol = window.location.protocol;
  
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  
  return `${currentProtocol}//${currentHost}:3000`;
}
```

### Current Deployment
- **BizObs App**: http://3.209.41.33:8080
- **Auto-detected MCP Server**: http://3.209.41.33:3000

## User Configuration Required

Users only need to configure **2 things**:

1. **Dynatrace Environment URL** - Your tenant (e.g., `https://abc12345.sprint.apps.dynatracelabs.com`)
2. **Grail Query Budget** - Optional, defaults to 100 GB

The MCP server URL is **auto-populated** and users typically won't need to change it unless:
- MCP server runs on a custom port
- MCP server is hosted on a different machine
- Special network configuration

## MCP Server Setup

The MCP server needs to be started on the same host as the BizObs app (or accessible from it):

```bash
# Start MCP server on default port 3000
npx -y @dynatrace-oss/dynatrace-mcp-server@latest --http

# Or with custom port (must update MCP URL field manually)
npx -y @dynatrace-oss/dynatrace-mcp-server@latest --http -p 3000
```

## Authentication Flow

1. User configures **Dynatrace tenant URL** in BizObs settings
2. User starts **MCP server** (which handles OAuth with that tenant)
3. BizObs **auto-detects** MCP server URL
4. When deploying dashboard:
   - BizObs sends request to MCP server
   - MCP server handles OAuth authentication
   - MCP server creates dashboard in Dynatrace
   - Dashboard URL returned to user

## Benefits

✅ **Deployment Agnostic** - Works anywhere (localhost, EC2, cloud, on-prem)  
✅ **No Manual Configuration** - MCP URL auto-populated  
✅ **No API Tokens** - OAuth handled by MCP server  
✅ **Works Across Environments** - Just change tenant URL  
✅ **Simple Setup** - Only 2 fields to configure  

## Architecture

```
User Browser
    ↓ (configure tenant URL)
BizObs App (port 8080)
    ↓ (auto-detect MCP URL → http://3.209.41.33:3000)
MCP Server (port 3000)
    ↓ (OAuth authentication)
Dynatrace Tenant
    ↓ (dashboard created)
Dashboard URL returned
```

## Troubleshooting

### MCP Server Not Auto-Detected
- **Check**: Is MCP server running on port 3000?
- **Solution**: Start MCP server with `npx -y @dynatrace-oss/dynatrace-mcp-server@latest --http -p 3000`

### Connection Test Fails
- **Check**: Can BizObs app reach MCP server?
- **Solution**: Test with `curl http://<mcp-url>` from the BizObs server

### Custom Port Needed
- **Solution**: Manually change the MCP Server URL field to use custom port
- **Example**: `http://3.209.41.33:3001`

### MCP on Different Machine
- **Solution**: Manually change the MCP Server URL to point to remote machine
- **Example**: `http://other-server.com:3000`

## Files Changed

- **public/index.html**:
  - Added environment URL field
  - Added `detectMcpServerUrl()` function
  - Updated `loadDynatraceSettings()` to auto-detect MCP URL
  - Updated all settings functions to handle environment URL
  
- **server.js**:
  - Updated `/api/dynatrace/deploy-dashboard-via-mcp` to accept environment URL
  
- **scripts/dynatrace-dashboard-deployer.js**:
  - Updated to accept environment URL parameter
  - Logs environment URL during deployment

## Next Steps

User should:
1. Start MCP server on the same machine as BizObs
2. Open BizObs settings
3. Verify MCP URL is auto-populated correctly
4. Enter Dynatrace tenant URL
5. Test connection
6. Deploy dashboards! 🚀
