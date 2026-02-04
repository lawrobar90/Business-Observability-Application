# 🎨 Codespace Startup Experience

When your Codespace starts, you'll see this beautiful startup summary:

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║           🚀 BizObs - Business Observability Engine 🚀           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝


1️⃣  Dynatrace OneAgent Status
   ✅ Dynatrace Node.js OneAgent configured
   ✅ Connected to: https://bko67471.sprint.apps.dynatracelabs.com
   ℹ️  Note: Full OneAgent not available in containers

2️⃣  Starting BizObs Application
   ✅ BizObs app started (PID: 12345)
   ⏳ Waiting for server to be ready...
   ✅ Server is ready!

3️⃣  MCP Server Status
   ✅ MCP server auto-started
   Port: 3000

4️⃣  Dynatrace Configuration (Monaco)
   🚀 Auto-deploying Monaco configuration...
   ✅ Monaco configuration deployed
   ⚠️  Some configurations may need manual setup

╔══════════════════════════════════════════════════════════════════╗
║                     🎉 READY TO USE! 🎉                          ║
╚══════════════════════════════════════════════════════════════════╝

🌐 Access URLs:
   BizObs App:  https://lawrobar90-redesigned-space-fishstick-r9wq69r5r5h9p9w-8080.app.github.dev
   MCP Server:  https://lawrobar90-redesigned-space-fishstick-r9wq69r5r5h9p9w-3000.app.github.dev

📊 Quick Actions:
   • View logs:          tail -f /tmp/bizobs.log
   • Monaco logs:        cat /tmp/monaco-deploy.log
   • Configure Dynatrace:npm run configure:dynatrace
   • Restart app:        pkill -f 'node server.js' && bash .devcontainer/start-app.sh

📚 Documentation:
   • Quick Start:        AUTOMATED-CONFIG-QUICKSTART.md
   • README:             README.md
   • Monaco Setup:       dynatrace-monaco/README.md

💡 Next Steps:
   1. Click the BizObs App URL above
   2. Create a customer journey
   3. Configure Dynatrace settings in UI
   4. Review Monaco deployment logs if needed
```
   3. Configure Dynatrace settings in UI
   4. Deploy dashboards with MCP server

═══════════════════════════════════════════════════════════════════
```

## 🎯 What Happens Automatically

### ✅ During Codespace Creation:
1. **OneAgent Installation** (if `DYNATRACE_TOKEN` provided)
   - Downloads latest OneAgent
   - Installs with full APM instrumentation
   - Connects to your Dynatrace tenant

2. **Dependencies Installation**
   - Runs `npm install`
   - Prepares all required packages

### ✅ During Codespace Start:
1. **BizObs Application**
   - Starts automatically on port 8080
   - Logs to `/tmp/bizobs.log`
   - Health check validates it's ready

2. **MCP Server**
   - Auto-starts when `DT_ENVIRONMENT` is set
   - Listens on port 3000
   - Ready for OAuth dashboard deployment

3. **Startup Banner**
   - Shows all service statuses
   - Displays **clickable Codespace URLs**
   - Provides quick commands and documentation links

### 🔧 Optional: Configure Dynatrace
If you set `DT_API_TOKEN`, you can run:
```bash
npm run configure:dynatrace
```

This automatically configures:
- ✅ OneAgent Features (Node.js Business Events)
- ✅ Business Event Capture Rules
- ✅ Service Naming Rules
- ✅ OpenPipeline Pipelines
- ✅ Dynamic Routing

**No manual UI steps required!** 🎉

## 🌟 Key Features

### 🎨 Color-Coded Output
- 🟢 **Green**: Success messages
- 🔵 **Blue/Cyan**: Information and URLs
- 🟡 **Yellow**: Warnings or optional steps
- 🔴 **Red**: Errors (rare!)

### 🔗 Clickable URLs
In VS Code Codespaces terminal, the URLs are **clickable**:
- `Ctrl+Click` (Windows/Linux) or `Cmd+Click` (Mac) to open
- Direct access to your running application
- No need to check Ports tab manually

### 📋 Quick Reference
All common commands displayed right in the startup banner:
- View logs
- Configure Dynatrace
- Restart application
- Access documentation

## 🚀 Usage Examples

### First Time Setup:
```bash
# Create Codespace secrets first
DYNATRACE_URL = https://your-tenant.dynatrace.com
DYNATRACE_TOKEN = dt0c01.XXX...  # PaaS token

# Create Codespace - everything starts automatically!
```

### Configure Dynatrace (One Command):
```bash
export DT_API_TOKEN='dt0c01.XXX...'  # Settings token
npm run configure:dynatrace
```

### Restart After Changes:
```bash
bash .devcontainer/start-app.sh
# Beautiful banner shows up again!
```

## 🎓 Learning Resources

The startup banner provides direct links to:
- **Quick Start Guide**: Get started in minutes
- **README**: Full documentation
- **Monaco Setup**: Advanced configuration

Everything you need is right there when you start! 🎉
