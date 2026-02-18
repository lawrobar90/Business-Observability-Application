# 🚀 Business Observability Engine

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://github.com/lawrobar90/Business-Observability-Application" alt="QR code linking to the Business Observability Application repository on GitHub" />
</p>

A full-stack business observability platform that dynamically creates microservices, simulates multi-step customer journeys across industries, and integrates deeply with Dynatrace — featuring AI-powered chaos injection, automated remediation, and operational memory.

---

## 🎯 Key Features

| Feature | Description |
|---------|-------------|
| **Dynamic Microservices** | Spawns real Node.js child processes per journey step — each with its own Express server, Dynatrace OneAgent identity, and health endpoint |
| **7 Industry Companies** | Banking, Insurance, Manufacturing, Retail, Smyths, Telecommunications, Travel & Hospitality — each with unique journey definitions |
| **Auto-Load System** | Generates 30–60 journeys/minute per active company with zero manual interaction |
| **AI Agent Hub** | 4 AI agents — Gremlin (chaos), Fix-It (remediation), Librarian (memory), Dashboard (deployment) |
| **Per-Service Chaos Injection** | Target individual services with configurable error rates without affecting the rest of the fleet |
| **Chaos State Persistence** | All feature flag overrides survive server restarts via `.chaos-state.json` |
| **Port Persistence** | Services get the same port across restarts via `.port-allocations.json` |
| **Dynatrace Integration** | OneAgent metadata propagation, event ingestion (CUSTOM_DEPLOYMENT), OAuth SSO, dashboard deployment, DT API proxy |
| **Monaco Config-as-Code** | Automated Dynatrace configuration deployment (capture rules, service naming, OpenPipeline, OneAgent features) |
| **Saved Config Library** | 24 pre-built industry journeys + user-saved configs with export/import |

---

## ⚡ Quick Start

### Prerequisites
- **Node.js v22+** (tested on v22.22.0)
- **Dynatrace OneAgent** installed ([Installation Guide](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/installation-and-operation))

### Install & Run

```bash
git clone https://github.com/lawrobar90/Business-Observability-Application.git
cd Business-Observability-Application
npm install
npm start
```

The server starts on **port 8080**. Open `http://localhost:8080` in your browser.

### Alternative Start Methods

```bash
./start-server.sh        # Full startup with nginx + services
./restart.sh             # Restart application
./stop.sh                # Stop all services
./status.sh              # Status report
```

### Environment Configuration

Copy `.env.template` to `.env` and set:

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Main server port | `8080` |
| `DT_ENVIRONMENT` | Dynatrace tenant URL | `https://abc12345.sprint.apps.dynatracelabs.com` |
| `DT_PLATFORM_TOKEN` | Platform token for event ingestion | `dt0c01.XXX...` |
| `OLLAMA_ENDPOINT` | LLM backend for AI agents | `http://localhost:11434` |
| `SERVICE_PORT_MIN` | Dynamic service port range start | `8081` |
| `SERVICE_PORT_MAX` | Dynamic service port range end | `8200` |

Or configure Dynatrace credentials from the UI via the ⚙️ **Settings** modal (persisted to `.dt-credentials.json`).

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser UI (public/index.html) — Tailwind CSS Dark Theme       │
│  5-Tab Wizard: Welcome → Details → Prompts → Data → Agent Hub   │
├─────────────────────────────────────────────────────────────────┤
│  nginx (port 443, SSL) → reverse proxy                          │
├─────────────────────────────────────────────────────────────────┤
│  Main Server (port 8080) — Express.js + Socket.IO               │
│  ├── 18 API route modules (75+ endpoints)                       │
│  ├── AI Agent APIs (Gremlin, Fix-It, Librarian, Dashboard)      │
│  ├── Feature Flag Manager (per-service isolation)               │
│  ├── Auto-Load Watcher (30-60 journeys/min per company)         │
│  └── Dynatrace Event Ingestion + DT API Proxy                  │
├─────────────────────────────────────────────────────────────────┤
│  Dynamic Child Services (ports 8081–8200)                       │
│  Each service = separate Node.js process with:                  │
│  ├── Own Express server + /health endpoint                      │
│  ├── Dynatrace OneAgent identity (DT_APPLICATION_ID, DT_TAGS)   │
│  ├── Per-service feature flag config                            │
│  └── Service-to-service call chaining for journey steps         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🤖 AI Agent Hub

The Agent Hub (Step 4 in the UI) provides four specialized AI agents powered by an LLM backend (Ollama).

### 👹 Gremlin — Chaos Agent
Controlled chaos injection with LLM-powered recipe selection.

- **7 chaos recipes**: `enable_errors`, `increase_error_rate`, `slow_responses`, `disable_circuit_breaker`, `disable_cache`, `target_company`, `custom_flag`
- **Per-service targeting**: Errors only affect the targeted service — other services remain healthy
- **Configurable intensity**: Scale 1–10 maps to 10%–100% error rates
- **Auto-revert**: Configurable duration timers automatically restore healthy state
- **Safety lock**: Max concurrent faults limit
- **Dynatrace events**: Every chaos injection sends a `CUSTOM_DEPLOYMENT` event with `[ROOT CAUSE]` metadata

### 🔧 Fix-It — Remediation Agent
Autonomous problem detection, diagnosis, and remediation.

- **Full pipeline**: Detect → Diagnose → Propose Fix → Execute → Verify → Learn
- **Dynatrace-aware**: Queries DT problems, logs, metrics, and topology for diagnosis
- **7 fix types**: `disable_errors`, `reset_feature_flags`, `reduce_error_rate`, `enable_circuit_breaker`, `enable_cache`, `disable_slow_responses`, `send_dt_event`
- **LLM agent loop**: Function calling for intelligent decision-making
- **Learning**: Records outcomes to Librarian for future reference

### 📚 Librarian — Operational Memory
Persistent knowledge store for the AI agent ecosystem.

- **Vector store**: Similarity search across past incidents
- **History store**: Chronological event timeline
- **Records**: Chaos events, reverts, DT problems, diagnoses, fixes, outcomes
- **LLM-powered learning**: Generates insights from incident history

### 📊 Dashboard — AI Dashboard Deployer
One-click Dynatrace dashboard deployment.

- **Pre-built dashboards**: Generate from journey configurations
- **AI-generated**: LLM creates custom dashboard JSON
- **Deployment**: Via Dynatrace Document API (OAuth or API token auth)

---

## 🔄 Auto-Load System

Once services are running, the auto-load system automatically generates realistic traffic:

- **30–60 journeys/minute** per active company
- **Zero interaction required** — starts automatically when services come online
- **Service watcher**: Polls for new/removed companies every 10 seconds
- **Randomized profiles**: 10 customer profiles across 4 priority levels
- **Tracks metrics**: Iterations, successes, and errors per company
- **Stops automatically** when services are shut down

---

## 🎲 Chaos Injection & Feature Flags

### Per-Service Isolation
Each child service fetches its own feature flags from the main server (`GET /api/feature_flag?service=<name>`). Only services with explicit overrides receive elevated error rates.

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/feature_flag` | Get global + per-service flags |
| `POST` | `/api/feature_flag` | Set global or targeted (`targetService`) overrides |
| `DELETE` | `/api/feature_flag/service/:name` | Remove a per-service override |
| `POST` | `/api/remediation/feature-flag` | Set remediation flags + send DT event |

### Persistence
- Feature flag overrides → `.chaos-state.json` (restored on startup)
- Service port assignments → `.port-allocations.json` (restored on startup)
- Dynatrace credentials → `.dt-credentials.json` (restored on startup)

---

## 🔗 Dynatrace Integration

### Event Ingestion
Every chaos injection and remediation action sends a `CUSTOM_DEPLOYMENT` event to Dynatrace with rich metadata:
- `deployment.project`, `deployment.name`, `deployment.version`
- `dt.event.is_rootcause_relevant: true`
- `dt.event.description` with `[ROOT CAUSE]` or `[REMEDIATION]` prefixes

### DT API Proxy
Agents query Dynatrace through local proxy endpoints:

| Endpoint | DT API |
|----------|--------|
| `/api/dt-proxy/problems` | Problems v2 |
| `/api/dt-proxy/events` | Events v2 |
| `/api/dt-proxy/metrics` | Metrics v2 |
| `/api/dt-proxy/entities` | Entities v2 |
| `/api/dt-proxy/logs` | Logs v2 |

### OneAgent Metadata
Each child service gets Dynatrace environment variables:
- `DT_APPLICATION_ID`, `DT_CUSTOM_PROP`, `DT_TAGS`, `DT_CLUSTER_ID`
- Release metadata for version tracking

### Authentication
- **OAuth SSO**: Dynatrace Sprint SSO via `simple-oauth2` (authorization code grant)
- **API Token**: Direct token auth for event ingestion
- **UI Config**: ⚙️ Settings modal for credential management

### Monaco Config-as-Code

```bash
# Automated deployment via Settings API
npm run configure:dynatrace

# Or via Monaco CLI
npm run configure:monaco
```

Deploys: OneAgent features, capture rules, service naming, OpenPipeline pipelines & routing.

---

## 📋 UI Overview

### 5-Tab Wizard

| Tab | Description |
|-----|-------------|
| 🏠 **Welcome** | Application overview and getting-started guide |
| **Step 1: Customer Details** | Company name, domain, industry type input |
| **Step 2: Generate Prompts** | AI/Copilot prompt generation for journey creation |
| **Step 3: Generate Data** | Journey simulation controls, data generation, LoadRunner integration |
| 🤖 **Step 4: AI Agent Hub** | Gremlin / Fix-It / Librarian / Dashboard agent controls |

### Additional UI Elements
- **Saved Prompts Sidebar** (left panel): Save/load/duplicate/delete/export/import journey configs. 24 pre-built + user-saved configs.
- **Service Status Dropdown** (top-right): Live service status with refresh.
- **Dynatrace Settings Modal**: Configure DT environment URL + API token from the UI.

---

## 🛠️ Technical Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js v22+ (ESM modules) |
| **Framework** | Express.js 4 + Socket.IO 4 |
| **AI Agents** | TypeScript → compiled to `dist/` |
| **LLM Backend** | Ollama (llama3.2) |
| **Observability** | Dynatrace OneAgent + OpenTelemetry |
| **Frontend** | Single-page HTML + Tailwind CSS (dark theme) |
| **Auth** | OAuth 2.0 via `simple-oauth2` |
| **Proxy** | nginx with SSL (port 443) |

---

## 📁 Project Structure

```
├── server.js                    # Main application server (~4,700 lines, 75+ endpoints)
├── package.json                 # business-observability-engine v0.1.0
├── .env.template                # Environment variable template
│
├── agents/                      # TypeScript AI agent source
│   ├── gremlin/                 # Chaos injection agent
│   ├── fixit/                   # Auto-remediation agent
│   └── librarian/               # Operational memory agent
├── dist/                        # Compiled TypeScript output
│
├── tools/                       # TypeScript tool libraries
│   ├── chaos/                   # 7 chaos recipes
│   ├── dynatrace/               # DT API wrappers + LLM tool definitions
│   └── fixes/                   # 7 fix type implementations
├── utils/                       # LLM client, config, logger, OpenTelemetry
│
├── routes/                      # 18 Express route modules
│   ├── journey-simulation.js    # Full journey simulation engine (2,639 lines)
│   ├── oauth.js                 # Dynatrace OAuth SSO
│   ├── mcp-integration.js       # MCP session management (1,305 lines)
│   ├── ai-dashboard.js          # AI dashboard generation
│   ├── loadrunner-*.js          # LoadRunner integration
│   └── ...                      # Journey, simulate, metrics, steps, flow, config, proxy
│
├── services/                    # Core service infrastructure
│   ├── service-manager.js       # Dynamic service creation (1,040 lines)
│   ├── dynamic-step-service.cjs # Child service template (1,183 lines)
│   ├── auto-load.js             # Auto-load watcher (327 lines)
│   ├── port-manager.js          # Port allocation + persistence (364 lines)
│   ├── service-runner.cjs       # Individual service spawner
│   └── ...                      # Child-caller, event service, metrics service
│
├── middleware/                   # Express middleware
│   └── dynatrace-metadata.js    # DT metadata injection/propagation
│
├── public/                      # Frontend
│   └── index.html               # Single-page UI (~10,800 lines)
│
├── saved-configs/               # 32 persisted journey configs (24 default + 8 user)
├── dynatrace-monaco/            # Monaco v2 config-as-code project
├── dynatrace-workflows/         # Self-healing workflow JSON
├── dashboards/                  # Sample/generated dashboard JSON
├── loadrunner-tests/            # LoadRunner scenarios by industry
├── memory/                      # Vector + history stores for Librarian
├── prompts/                     # AI prompt templates (system context, DQL, dashboards)
├── scripts/                     # Operational scripts (deploy, simulate, nginx, autostart)
├── nginx/                       # Nginx reverse proxy config
├── k8s/                         # Kubernetes deployment manifests
├── logs/                        # Application + continuous-generation logs
│
├── .chaos-state.json            # Persisted chaos/feature flag state
├── .dt-credentials.json         # Persisted Dynatrace credentials
└── .port-allocations.json       # Persisted port-to-service mappings
```

---

## 📊 API Route Summary

| Mount | Purpose |
|-------|---------|
| `/api/journey-simulation` | Full journey simulation engine |
| `/api/journey` | Journey CRUD |
| `/api/simulate` | Basic simulation |
| `/api/metrics` | Metrics endpoints |
| `/api/steps` | Step management |
| `/api/flow` | Flow visualization |
| `/api/config` | Copilot prompt generation |
| `/api/gremlin` | Gremlin chaos agent API |
| `/api/fixit` | Fix-It remediation agent API |
| `/api/librarian` | Librarian memory agent API |
| `/api/ai-dashboard` | AI dashboard generation |
| `/api/loadrunner` | LoadRunner integration |
| `/api/loadrunner-service` | LoadRunner service management |
| `/api/oauth` | Dynatrace OAuth SSO |
| `/api/service-proxy` | Service proxy |
| `/api/feature_flag` | Feature flag management |
| `/api/remediation/*` | Remediation flag management |
| `/api/dt-proxy/*` | Dynatrace API proxy |
| `/api/dynatrace/*` | Dashboard deployment, connection test |
| `/api/admin/*` | Service management, config persistence, credentials |

---

## 🔧 Management Commands

```bash
./start-server.sh    # Full startup with nginx + all services
./status.sh          # Detailed status report
./stop.sh            # Stop all services
./restart.sh         # Restart application
```

```bash
npm start                       # Start server
npm run build:agents            # Compile TypeScript agents
npm run configure:dynatrace     # Deploy DT config via Settings API
npm run configure:monaco        # Deploy DT config via Monaco CLI
```

---

## 📊 Demo Walkthrough

1. **Start the server** → services auto-create as journeys are defined
2. **Step 1**: Enter company details (or pick from 24 pre-built industry journeys)
3. **Step 2**: Generate AI/Copilot prompts for journey definition
4. **Step 3**: Run journey simulation — services spin up dynamically, auto-load begins
5. **Step 4**: Open the AI Agent Hub:
   - Use **Gremlin** to inject chaos into a specific service
   - Watch **Dynatrace** detect the problem
   - Let **Fix-It** autonomously diagnose and remediate
   - Review the full incident timeline in **Librarian**
   - Deploy a **Dashboard** to visualize the journey

---

**Built for Dynatrace Partner Power-Up Program**
Demonstrating advanced business observability with AI-powered chaos engineering and automated remediation.
