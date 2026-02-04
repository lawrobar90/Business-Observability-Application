# 🚀 Partner PowerUp BizObs - Business Observability Engine

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://github.com/lawrobar90/Business-Observability-Application" alt="QR code linking to the Business Observability Application repository on GitHub" />
</p>

A comprehensive business observability application optimized for Dynatrace ACE-Box demo environments.

## ⚡ Quick Start

### 🚀 One-Click Cloud Deployment (No Setup Required)

#### GitHub Codespaces (Recommended)
1. Click **"Code"** → **"Codespaces"** → **"Create codespace on main"**
2. Wait for environment to load (auto-installs dependencies)
3. **Optional**: Set Dynatrace credentials in Codespace secrets:
   - `DYNATRACE_URL`: Your tenant URL (e.g., `https://abc12345.live.dynatrace.com`)
   - `DYNATRACE_TOKEN`: API token with trace ingestion permissions
4. Run: `npm start` (or `npm run start:cloud` for explicit cloud mode)
5. Open forwarded port 8080 in browser

> **Note**: Without OneAgent, the app runs in **demo mode** with console logging. For full Dynatrace integration, provide the environment variables above.

#### Alternative Cloud Options
- **Replit**: Import this repo → Run `npm start`  
- **CodeSandbox**: Import from GitHub → Auto-starts
- **Gitpod**: `https://gitpod.io/#https://github.com/lawrobar90/Partner-PowerUp-BizObs-App`
- **StackBlitz**: WebContainer-based instant deployment

### 🖥️ Local Installation

## Install OneAgent 
- Install a Dynatrace OneAgent on your machine where you are installing the BizObs application
- See Documentation here for a guide of deployment methods:
- https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/installation-and-operation

In a terminal - Git/Powershell etc
- Download this BizObs repository, and change directory to where the start-server.sh is located

- Run the complete BizObs application with a single command:
```bash
./start-server.sh
```

Or for simple Node.js startup:
```bash
npm install
npm start
```

## Add configuration to Dynatrace Tenant
Follow this guide
https://github.com/lawrobar90/Partner-PowerUp-BizObs-App/blob/main/DynatraceConfig.md

### ⚠️ Important: Sprint Environments
If deploying to a **Dynatrace Sprint environment** (e.g., `*.sprint.apps.dynatracelabs.com`):
- **Platform tokens (dt0s/dt0c) are NOT supported** for dashboard deployment
- The Document Service requires an **OAuth 2.0 token** (not an API access token):
  1. Go to: Account Settings → Identity & Access Management → OAuth clients
  2. Create new OAuth client with scopes: `document:documents:read` `document:documents:write`
  3. Generate OAuth token from the client (JWT format, >200 chars)
  4. Use this OAuth token in the Dynatrace Settings
  5. See: [Document Service SDK](https://developer.dynatrace.com/develop/sdks/client-document/)
  6. Regular Dynatrace SaaS/Managed environments can use Platform tokens normally

## 🌐 Access URLs

- **Local**: http://localhost:8080/

## 🎯 Key Features

- **Customer Journey Simulation**: Multi-step business process simulation
- **Multi-persona Load Generation**: Realistic customer behavior patterns  
- **Dynatrace Integration**: Full metadata injection and observability
- **Real-time Monitoring**: Live metrics and health endpoints
- **Error Simulation**: Configurable failure scenarios for demos

## 🏗️ Architecture

- **Main Server**: Port 8080 with full web interface
- **Child Services**: Dynamic service creation on ports 8081-8094
- **Kubernetes Ingress**: External routing via ingress controller
- **Health Monitoring**: Comprehensive service health tracking

## 🔧 Management Commands

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

- **Runtime**: Node.js v22+ with Express.js
- **Observability**: Dynatrace metadata injection (13 headers)
- **Load Balancing**: NGINX with upstream configuration
- **Process Management**: Native Node.js with health checks
- **Ingress**: Kubernetes ingress for external access

## 📁 Project Structure

```
├── server.js              # Main application server
├── start-server.sh        # Complete startup script
├── routes/                # API route handlers
├── services/              # Business logic services
├── middleware/            # Dynatrace and observability middleware
├── scripts/               # Utility and simulation scripts
├── k8s/                   # Kubernetes ingress configuration
├── nginx/                 # NGINX load balancer configuration
└── logs/                  # Application logs
```

## 🎭 Ready for Demos

This application is specifically designed for Dynatrace customer journey demonstrations with full observability integration and realistic business scenarios.

For detailed usage instructions, see [START-SERVER-GUIDE.md](START-SERVER-GUIDE.md).
For deployment details, see [DEPLOYMENT-SUMMARY.md](DEPLOYMENT-SUMMARY.md).

- **Main Server** (`server.js`): Express.js application serving frontend and coordinating services
- **Journey Simulation** (`routes/journey-simulation.js`): Core business logic for customer journey processing
- **Service Manager** (`services/service-manager.js`): Dynamic microservice spawning and management
- **Dynamic Services**: Auto-generated services for different customer journey steps
- **Frontend**: HTML interfaces for testing and simulation control


---

**Built for Dynatrace Partner Power-Up Program**  
Demonstrating advanced business observability and distributed tracing capabilities.
