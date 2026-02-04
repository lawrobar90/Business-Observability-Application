# 🚀 Partner PowerUp BizObs - Business Observability Engine

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://github.com/lawrobar90/Business-Observability-Application" alt="QR code linking to the Business Observability Application repository on GitHub" />
</p>

A comprehensive business observability application with integrated Dynatrace dashboard deployment via MCP server.

## ⚡ Quick Start

### 🚀 GitHub Codespaces (Recommended - Auto-Start)

#### 1️⃣ **Configure Secrets (Choose Your Approach)**

**Option A: Input Values Each Time** ⚡ (Recommended for security)
1. Click **"Code"** → **"Codespaces"** → **"Create codespace on main"**
2. You'll be prompted to enter:
   - `DYNATRACE_URL`: Your tenant URL (e.g., `https://abc12345.sprint.apps.dynatracelabs.com`)
   - `DYNATRACE_TOKEN`: PaaS token (scope: `PaaS integration - Installer download`)
3. **Uncheck** "Associated with repository" to avoid saving them
4. Click "Create codespace"

**Option B: Save as Repository Secrets** 🔐 (One-time setup)
1. **Go to**: Your GitHub repo → **Settings** → **Secrets and variables** → **Codespaces**
2. Click **"New repository secret"** and add:

| Secret Name | Description | Example |
|------------|-------------|---------|
| `DYNATRACE_URL` | Your Dynatrace tenant URL | `https://abc12345.sprint.apps.dynatracelabs.com` |
| `DYNATRACE_TOKEN` | **PaaS token** (scope: `PaaS integration - Installer download`) | `dt0c01.ABC123...` |

3. Future Codespaces will use these automatically

> 💡 **How to create a PaaS token:**
> 1. Go to your Dynatrace tenant → **Settings** → **Access tokens** → **Generate new token**
> 2. Name: `Codespace OneAgent`
> 3. Scope: ✓ **PaaS integration - Installer download**
> 4. Copy the token (starts with `dt0c01.`)

#### 2️⃣ **Create Codespace**
1. If not already done, click **"Code"** → **"Codespaces"** → **"Create codespace on main"**
2. Wait for environment to build (~2-3 minutes):
   - ✅ OneAgent installs automatically (if secrets configured)
   - ✅ Dependencies install via `npm install`
   - ✅ App and MCP server start automatically
3. **That's it!** Open forwarded port **8080** in your browser

#### 3️⃣ **Access the Application**
- The app starts automatically on port **8080**
- MCP server runs automatically on port **3000**
- Click the **Ports** tab and open the forwarded URL for port 8080
- No manual commands needed! 🎉

> **🔍 What happens automatically:**
> - OneAgent installs during container creation (if `DYNATRACE_TOKEN` provided)
> - BizObs app starts with MCP server integration enabled
> - Dynatrace MCP server starts for OAuth-based dashboard deployment
> - All services ready to use immediately

#### ⚙️ **Optional: Add Your Own Dynatrace Settings**
Once the app is running:
1. Click **"Dynatrace Settings"** in the UI
2. Your MCP server URL is auto-detected (`http://localhost:3000`)
3. Add your environment URL (e.g., `https://bko67471.sprint.apps.dynatracelabs.com`)
4. Click **"Test Connection"** to authenticate via OAuth popup
5. Deploy dashboards with one click! 🚀

> **📝 Note**: Without secrets configured, the app runs in demo mode. You can still add Dynatrace settings manually in the UI.

---

### 🖥️ Local Installation (For Development)

#### Prerequisites
1. **Install Dynatrace OneAgent** on your local machine:
   - See [Installation Guide](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/installation-and-operation)
2. **Clone this repository**

#### Quick Start Commands
```bash
# Option 1: Complete startup with all services
./start-server.sh

# Option 2: Simple Node.js startup
npm install
npm start

# Option 3: Start with Dynatrace environment configured
export DT_ENVIRONMENT='https://your-tenant.dynatrace.com'
node server.js
```

#### Configure Dynatrace Tenant

**Option 1: Automated Configuration** 🤖 (Recommended)
```bash
# Set environment variables
export DT_ENVIRONMENT='https://your-tenant.dynatrace.com'
export DT_API_TOKEN='dt0c01.XXX...'  # Token with settings.write scope

# Run automated deployment
cd dynatrace-monaco
node deploy.js
```

**Option 2: Monaco (Monitoring as Code)** 📦
```bash
# Install Monaco CLI
brew install dynatrace/dynatrace/monaco

# Deploy configuration
cd dynatrace-monaco
monaco deploy manifest.yaml
```

**Option 3: Manual Configuration** 🔧
Follow the [DynatraceConfig.md](DynatraceConfig.md) guide for step-by-step UI instructions.

**What Gets Configured:**
- ✅ Business Event Capture Rules
- ✅ Service Naming Rules  
- ✅ OpenPipeline Pipelines & Processors
- ✅ Dynamic Routing
- ⚠️ OneAgent Features (manual step required)

See [dynatrace-monaco/README.md](dynatrace-monaco/README.md) for detailed automation documentation.

---

### 🔐 Authentication Methods

#### OAuth via MCP Server (Recommended)
- **Automatic in Codespaces**: MCP server handles all OAuth flows
- **Best for**: Sprint environments, SaaS tenants
- **No API tokens needed**: Sign in once via browser popup
- **Uses**: Dynatrace MCP Server v1.3.1+ in HTTP mode

#### Dashboard Deployment
- All dashboard deployments go through the **Dynatrace MCP Server**
- OAuth authentication handled automatically via popup
- Works with all Dynatrace environments (Sprint, SaaS, Managed)

---

### 🔍 Codespaces Troubleshooting

#### View Application Logs
```bash
# View live logs
tail -f /tmp/bizobs.log

# Check if app is running
ps aux | grep node

# Check port status
netstat -tuln | grep -E '8080|3000'
```

#### Manual Restart (If Needed)
```bash
# Kill existing processes
pkill -f "node server.js"
pkill -f "dynatrace-mcp-server"

# Start manually with your environment
export DT_ENVIRONMENT='https://your-tenant.dynatrace.com'
node server.js
```

#### Verify OneAgent Installation
```bash
# Check if OneAgent is installed
ls -la /opt/dynatrace/oneagent

# View OneAgent logs
sudo tail -f /var/log/dynatrace/oneagent/oneagent.log
```

---

## 🌐 Access URLs

- **Codespaces**: Check **Ports** tab, open port **8080**
- **Local**: http://localhost:8080/

## 🎯 Key Features

- **Customer Journey Simulation**: Multi-step business process simulation
- **Multi-persona Load Generation**: Realistic customer behavior patterns  
- **Dynatrace Dashboard Deployment**: One-click dashboard creation via MCP server
- **OAuth Integration**: Secure authentication via Dynatrace MCP Server
- **Real-time Monitoring**: Live metrics and health endpoints
- **Error Simulation**: Configurable failure scenarios for demos

## 🏗️ Architecture

- **Main Server**: Port 8080 with full web interface
- **MCP Server**: Port 3000 for Dynatrace dashboard deployment (auto-starts with DT_ENVIRONMENT)
- **Child Services**: Dynamic service creation on ports 8099-8101
- **OAuth Authentication**: Handled by Dynatrace MCP Server (no API tokens needed)
- **Health Monitoring**: Comprehensive service health tracking

## 🔧 Management Commands

**Codespaces** (auto-start enabled):
```bash
# View logs
tail -f /tmp/bizobs.log

# Restart if needed
pkill -f "node server.js" && node server.js &
```

**Local Development**:
```bash
./start-server.sh    # Complete startup with ingress deployment
./status.sh          # Detailed status report
./stop.sh            # Stop all services
./restart.sh         # Restart application
```

## 📊 Demo Scenarios

### Insurance Journey Example
PolicyDiscovery → QuoteGeneration → PolicySelection → PaymentProcessing → PolicyActivation → OngoingEngagement

### Customer Personas
- **Karen (Retail)**: Price-conscious shopper
- **Raj (Insurance)**: Risk-aware professional  
- **Alex (Tech)**: Innovation-focused buyer
- **Sophia (Enterprise)**: Process-oriented decision maker

## 🛠️ Technical Stack

- **Runtime**: Node.js v20+ with Express.js
- **Observability**: Dynatrace OneAgent with full APM instrumentation
- **Dashboard Deployment**: Dynatrace MCP Server v1.3.1+ (JSON-RPC via HTTP)
- **Authentication**: OAuth 2.0 via MCP server (no API tokens needed)
- **Process Management**: Native Node.js with auto-start in Codespaces

## 📁 Project Structure

```
├── server.js                      # Main application server
├── .devcontainer/
│   ├── devcontainer.json          # Codespaces configuration
│   ├── install-oneagent.sh        # OneAgent auto-installer
│   └── start-app.sh               # Auto-start script
├── routes/                        # API route handlers
├── services/                      # Business logic services
├── middleware/                    # Dynatrace observability middleware
├── scripts/
│   └── dynatrace-dashboard-deployer.js  # MCP proxy for dashboards
└── public/index.html              # Main UI with Dynatrace settings
```

## 🎭 Ready for Codespaces & Demos

This application is specifically designed for:
- **GitHub Codespaces**: One-click deployment with auto-start
- **Dynatrace Integration**: OneAgent auto-installation and full APM
- **Dashboard Deployment**: OAuth-based deployment via MCP server
- **Customer Journey Demos**: Realistic business scenarios with full observability

### Additional Documentation
- **MCP Integration**: [dynatrace-mcp-integration.md](dynatrace-mcp-integration.md)
- **Quick Start Guide**: [MCP-QUICK-START.md](MCP-QUICK-START.md)
- **Dynatrace Config**: [DynatraceConfig.md](DynatraceConfig.md)

---

**Built for Dynatrace Partner Power-Up Program**  
Demonstrating advanced business observability with integrated dashboard deployment.
