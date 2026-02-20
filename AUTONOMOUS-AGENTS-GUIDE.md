# Autonomous AI Agent System for BizObs

## Overview

Your BizObs application now has **fully autonomous chaos engineering and auto-remediation** powered by Ollama AI. The system consists of two cooperating AI agents that work together to test system resilience and automatically fix problems.

## 🤖 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Autonomous AI Agents                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Gremlin Scheduler  ──→  Chaos Injection  ──→  Dynatrace   │
│        (AI)                   ↓                    Event     │
│                           Problem                 (OPEN)     │
│                               ↓                      ↓       │
│  Fix-It Detector  ──→  Auto-Diagnose  ──→  Remediation     │
│     (Polling)              (AI)              Event           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1. **Gremlin Scheduler** 🤖👹
- **Autonomous chaos injection** using AI decision-making
- Randomly selects services and chaos types based on system state
- Uses Ollama to make realistic failure injection choices
- Sends **OPEN events** to Dynatrace for problem correlation
- Configurable intervals, intensity, and service targeting

### 2. **Fix-It Detector** 🔍🔧
- **Continuous problem monitoring** via Dynatrace API polling
- Automatically detects and diagnoses problems using AI
- Executes remediation actions (feature flag resets, circuit breakers, etc.)
- Links remediation events back to original chaos events
- Learns from past incidents using vector memory (Librarian)

### 3. **Event Correlation System** 📊
- Chaos events include unique `chaos.id` for tracking
- Fix-It links remediation events to original chaos via `correlation.chaos` property  
- Davis AI can correlate: Chaos Injection → Problem → Remediation
- All events appear in Dynatrace deployment timeline

## 🚀 Getting Started

### Prerequisites

1. **Ollama Running** with a model (e.g., `llama3.1`)
   ```bash
   ollama serve
   ollama pull llama3.1
   ```

2. **Dynatrace Environment Variables** (for AI Observability)
   ```bash
   export DT_ENVIRONMENT="https://your-env.live.dynatrace.com"
   export DT_PLATFORM_TOKEN="dt0c01.ABC..."  # Token with openTelemetryTrace.ingest scope
   ```

### Quick Start

**🎉 Agents Auto-Start by Default!**

Both agents are now **enabled by default** and start automatically when the server boots:
- **Gremlin Scheduler**: Starts with 2-hour warmup, then begins volume-based chaos
- **Fix-It Detector**: Starts immediately with continuous problem monitoring

Check agent status:
```bash
curl http://localhost:8080/api/autonomous/status | jq .
```

You should see both agents `"running": true` and Gremlin `"inWarmup": true`.

**Manual Control (if needed)**
```bash
# Stop agents
curl -X POST http://localhost:8080/api/autonomous/stop-all

# Restart agents
curl -X POST http://localhost:8080/api/autonomous/start-all
```

### API Endpoints

All endpoints are under `/api/autonomous/`

#### Gremlin Scheduler Control

```bash
# Start autonomous chaos scheduler
curl -X POST http://localhost:8080/api/autonomous/gremlin/start \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "enabled": true,
      "intervalMs": 60000,
      "chaosIntervalMs": 300000,
      "maxConcurrentFaults": 2,
      "meanTimeBetweenChaosMs": 600000,
      "allowedServices": [],
      "useAI": true
    }
  }'

# Stop scheduler
curl -X POST http://localhost:8080/api/autonomous/gremlin/stop

# Get status
curl http://localhost:8080/api/autonomous/gremlin/status

# Update configuration
curl -X PUT http://localhost:8080/api/autonomous/gremlin/config \
  -H "Content-Type: application/json" \
  -d '{"maxConcurrentFaults": 3, "useAI": true}'
```

#### Fix-It Detector Control

```bash
# Start autonomous problem detector
curl -X POST http://localhost:8080/api/autonomous/fixit/start \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "enabled": true,
      "pollIntervalMs": 120000,
      "autoRemediateEnabled": true,
      "problemLookbackWindow": "30m",
      "maxConcurrentFixes": 2
    }
  }'

# Stop detector
curl -X POST http://localhost:8080/api/autonomous/fixit/stop

# Get status
curl http://localhost:8080/api/autonomous/fixit/status

# Clear processed problems cache (allows re-detection)
curl -X POST http://localhost:8080/api/autonomous/fixit/clear-cache
```

#### Combined Control

```bash
# Start BOTH agents
curl -X POST http://localhost:8080/api/autonomous/start-all \
  -H "Content-Type: application/json" \
  -d '{
    "gremlinConfig": {"enabled": true, "useAI": true},
    "fixitConfig": {"enabled": true, "autoRemediateEnabled": true}
  }'

# Stop BOTH agents
curl -X POST http://localhost:8080/api/autonomous/stop-all

# Get overall status
curl http://localhost:8080/api/autonomous/status | jq .
```

## ⚙️ Configuration

### Gremlin Scheduler Config

| Parameter | Default | Description |
|-----------|---------|-------------|
| `enabled` | `true` | Enable/disable scheduler (auto-starts on boot) |
| `intervalMs` | `60000` | Check interval (1 min) |
| `chaosIntervalMs` | `300000` | Min time between chaos (5 min) |
| `maxConcurrentFaults` | `2` | Max simultaneous faults |
| `meanTimeBetweenChaosMs` | `600000` | Average chaos interval (10 min) |
| `allowedServices` | `[]` | Service whitelist (empty = all) |
| `useAI` | `true` | Use Ollama for decisions |
| `warmupMs` | `7200000` | Warmup period before first chaos (2 hours) |
| `transactionThreshold` | `1000` | Min transactions between chaos events |
| `useVolumeTrigger` | `true` | Trigger chaos by volume instead of time |

### Fix-It Detector Config

| Parameter | Default | Description |
|-----------|---------|-------------|
| `enabled` | `true` | Enable/disable detector (auto-starts on boot) |
| `pollIntervalMs` | `120000` | Dynatrace poll interval (2 min) |
| `autoRemediateEnabled` | `true` | Auto-fix detected problems |
| `problemLookbackWindow` | `"30m"` | Dynatrace query window |
| `maxConcurrentFixes` | `2` | Max simultaneous remediations |

### NEW: Gremlin Warmup & Volume-Based Triggering

| Parameter | Default | Description |
|-----------|---------|-------------|
| `warmupMs` | `7200000` | Warmup period (2 hours) before first chaos |
| `transactionThreshold` | `1000` | Min transactions between chaos events |
| `useVolumeTrigger` | `true` | Use transaction volume instead of pure time |

The Gremlin scheduler now features:

**🔥 Auto-Start on Server Boot**
- Both agents are now **enabled by default** (`enabled: true`)
- Agents automatically start when the server boots
- No manual API calls needed to activate chaos engineering
- Can still be manually stopped/started via API if needed

**⏰ 2-Hour Warmup Period**
- Gremlin waits **2 hours** after server start before injecting first chaos
- Allows services to stabilize and warm up caches
- Logs warmup progress every 10 minutes: `⏳ Warmup period: X minutes until chaos begins`
- Status API shows: `inWarmup`, `warmupRemainingMs`, `warmupRemainingMinutes`

**📊 Volume-Based Triggering**
- Chaos is triggered based on **transaction volume** instead of pure time intervals
- Requires at least `transactionThreshold` (default: 1000) transactions before each chaos event
- More realistic: high-traffic periods get more chaos testing
- Transaction counter tracked via `recordTransaction()` calls from journey endpoints
- Status shows: `transactionCount`, `transactionsSinceLastChaos`

**Combined Logic**
```
IF uptime < warmupMs THEN skip chaos (still warming up)
ELSE IF timeSinceLastChaos < chaosIntervalMs THEN skip (too soon)
ELSE IF useVolumeTrigger AND transactionsSinceLastChaos < threshold THEN skip (low volume)
ELSE IF randomChance < exponentialDistribution THEN inject chaos
```

**Example Status During Warmup**
```json
{
  "gremlin": {
    "running": true,
    "uptimeMs": 1800000,
    "warmupRemainingMs": 5400000,
    "inWarmup": true,
    "transactionCount": 245,
    "transactionsSinceLastChaos": 245
  }
}
```

## 🎯 How It Works

### Autonomous Chaos Flow

1. **Scheduler Tick**: Every `intervalMs`, the scheduler checks if it's time for chaos
2. **Service Discovery**: Queries `/api/admin/services/status` for running services
3. **AI Decision**: Ollama analyzes system state and selects:
   - Target service (e.g., `PaymentService`)
   - Chaos type (e.g., `increase_error_rate`)
   - Intensity (1-10)
   - Duration (1-10 minutes)
4. **Chaos Injection**: Manipulates feature flags via `/api/feature_flag`
5. **Dynatrace Event**: Sends **OPEN event** with `chaos.id` for correlation
6. **Auto-Revert**: Schedules automatic revert after duration

### Autonomous Remediation Flow

1. **Problem Detection**: Polls Dynatrace `/api/v2/problems` every `pollIntervalMs`
2. **AI Diagnosis**: Ollama analyzes:
   - Problem details from Dynatrace
   - Current feature flag state
   - Recent error logs and metrics
   - Past similar incidents from Librarian memory
3. **Fix Selection**: AI proposes remediation actions with risk levels
4. **Execution**: Executes low/medium risk fixes automatically
5. **Dynatrace Event**: Sends remediation event linked to original chaos
6. **Verification**: Checks if problem is resolved
7. **Learning**: Records incident to Librarian for future reference

## 🔗 Event Correlation in Dynatrace

### Chaos Event Structure
```json
{
  "eventType": "CUSTOM_DEPLOYMENT",
  "title": "💥 Chaos Injection: increase_error_rate on PaymentService",
  "properties": {
    "change.type": "chaos-injection",
    "chaos.id": "chaos-1708252123456-1",
    "chaos.type": "increase_error_rate",
    "chaos.target": "PaymentService",
    "chaos.intensity": 6,
    "chaos.duration.ms": 300000,
    "chaos.autonomous": true,
    "triggered.by": "gremlin-agent"
  }
}
```
**Note**: No `timeout` property = event stays **OPEN** until reverted

### Remediation Event Structure
```json
{
  "eventType": "CUSTOM_DEPLOYMENT",
  "title": "✅ Auto-Remediation Complete: High Error Rate",
  "properties": {
    "change.type": "remediation",
    "problem.id": "PROBLEM-123",
    "chaos.id": "chaos-1708252123456-1",
    "correlation.chaos": "chaos-1708252123456-1",
    "root.cause": "Feature flag errors_per_transaction elevated to 0.6",
    "fixes.executed": 2,
    "verified": true,
    "triggered.by": "fixit-agent"
  }
}
```
**Correlation**: Davis AI links events via matching `chaos.id`

## 📊 Ollama AI Observability (oTel)

### Current Status
The system already instruments all Ollama calls with **GenAI spans** following OpenTelemetry conventions. However, these may not appear in Dynatrace yet.

### Diagnostic Logging
Check server logs for oTel initialization:
```
✅ Initializing OTel tracing for AI Observability
   Endpoint: https://your-env.live.dynatrace.com/api/v2/otlp/v1/traces
   Service: bizobs-ai-agents v1.0.0
🎯 OTel tracing initialized — GenAI spans for Ollama calls will appear in Dynatrace
```

### Required Environment Variables
```bash
export DT_ENVIRONMENT="https://abc12345.live.dynatrace.com"
export DT_PLATFORM_TOKEN="dt0c01.ABC..."  # Needs openTelemetryTrace.ingest scope
```

### Troubleshooting Missing Spans

1. **Check Token Permissions**
   - Token needs `openTelemetryTrace.ingest` scope
   - Create via: Settings → Access Tokens → Generate Token

2. **Verify Environment URL**
   - Should be `https://XXX.live.dynatrace.com` (no `/api/`)
   - Remove `.apps.` if present

3. **Check Logs**
   - Look for: `⚠️  OTel tracing NOT enabled` warnings
   - Verify: `✅ Initializing OTel tracing` success message

4. **View in Dynatrace**
   - Navigate to: **Notebooks > Davis AI > AI Observability**
   - Filter by: Service = `bizobs-ai-agents`
   - Look for spans with `gen_ai.*` attributes

5. **Manual Trace Test**
   ```bash
   # Trigger AI call to generate spans
   curl -X POST http://localhost:8080/api/gremlin/smart \
     -H "Content-Type: application/json" \
     -d '{"goal": "cause intermittent errors on payment service"}'
   ```

## 🧪 Testing the System

### 1. Start Autonomous Agents
```bash
# Start both agents
curl -X POST http://localhost:8080/api/autonomous/start-all \
  -H "Content-Type: application/json" \
  -d '{
    "gremlinConfig": {
      "enabled": true,
      "intervalMs": 30000,
      "chaosIntervalMs": 120000,
      "useAI": true
    },
    "fixitConfig": {
      "enabled": true,
      "pollIntervalMs": 60000,
      "autoRemediateEnabled": true
    }
  }'
```

### 2. Monitor Activity
```bash
# Watch status
watch -n 5 'curl -s http://localhost:8080/api/autonomous/status | jq .'

# Check active chaos
curl http://localhost:8080/api/gremlin/active | jq .

# Check Fix-It status
curl http://localhost:8080/api/autonomous/fixit/status | jq .
```

### 3. View in Dynatrace
1. **Events**: Go to **Problems & Events > Events > Custom deployment**
   - Look for chaos injection and remediation events
   - Check `chaos.id` correlation

2. **Problems**: Go to **Problems**
   - See if Gremlin-caused problems appear
   - Check if Fix-It closes them

3. **AI Observability**: Go to **Notebooks > Davis AI**
   - View GenAI spans for Ollama decisions
   - Analyze AI reasoning for chaos/fixes

## 🛡️ Safety Features

### Built-in Protections
- **Default Disabled**: Both agents start disabled for safety
- **Max Concurrent Limits**: Prevents chaos overload
- **Auto-Revert**: Chaos automatically reverts after duration
- **Risk Assessment**: High-risk fixes are skipped
- **Problem Cache**: Prevents duplicate fixes on same problem
- **Min Intervals**: Enforces cooldown between chaos events

### Emergency Stop
```bash
# Stop all autonomous activity
curl -X POST http://localhost:8080/api/autonomous/stop-all

# Revert all active chaos
curl -X POST http://localhost:8080/api/gremlin/revert-all
```

## 📈 Use Cases

### 1. Continuous Resilience Testing
- Let Gremlin inject random failures 24/7
- Verify Fix-It can automatically remediate
- Build confidence in system self-healing

### 2. Davis AI Training
- Generate realistic problem/remediation sequences
- Train Davis to recognize chaos patterns
- Improve problem correlation accuracy

### 3. AI Observability Validation
- Verify Ollama spans appear in Dynatrace
- Track AI decision-making latency
- Analyze token usage and model performance

### 4. SRE Automation Demo
- Showcase AI-powered chaos engineering
- Demonstrate autonomous incident response
- Validate Dynatrace business observability

## 🎓 Advanced Features

### Custom Chaos Recipes
Gremlin supports multiple chaos types:
- `enable_errors`: Global error injection
- `increase_error_rate`: Service-specific error elevation
- `slow_responses`: Latency simulation
- `disable_circuit_breaker`: Remove cascade protection
- `disable_cache`: Increase load
- `target_company`: Company-specific failures

### AI Decision Temperature
Gremlin uses `temperature: 0.7` for varied chaos decisions
Fix-It uses `temperature: 0.2` for consistent remediation

### Librarian Memory Integration
- Chaos events stored in vector memory
- Fix-It searches for similar past incidents
- Learns from remediation outcomes
- Improves diagnosis accuracy over time

## 🔧 Troubleshooting

### Gremlin Not Injecting Chaos
1. Check scheduler is running: `curl http://localhost:8080/api/autonomous/gremlin/status`
2. Verify services are running: `curl http://localhost:8080/api/admin/services/status`
3. Check Ollama is available: `curl http://localhost:11434/api/tags`
4. Review logs for: `🤖 [gremlin-scheduler]` messages

### Fix-It Not Auto-Remediating
1. Check detector is running: `curl http://localhost:8080/api/autonomous/fixit/status`
2. Verify Dynatrace connectivity: Check `DT_ENVIRONMENT` and token
3. Check for active problems: `curl http://localhost:8080/api/dynatrace/problems`
4. Review logs for: `🔍 [problem-detector]` messages

✅ **Auto-Start on Boot** - Agents enabled by default, no manual startup needed  
✅ **2-Hour Warmup** - Waits for services to stabilize before first chaos  
✅ **Volume-Based Triggering** - Chaos scales with actual transaction load  

All agents use Ollama extensively for decision-making. Once you set `DT_ENVIRONMENT` and `DT_PLATFORM_TOKEN`, their GenAI spans will appear in Dynatrace AI Observability.

**Key Behaviors**:
1. **Server starts** → Both agents auto-start
2. **Gremlin enters 2-hour warmup** → Logs progress every 10 minutes
3. **After warmup + 1000 transactions** → First chaos injection (random chance)
4. **Chaos creates problem** → Fix-It detects and auto-remediates
5. **All events correlated** → Visible in Dynatrace timeline with `chaos.id`

**Next Steps**:
1. Set Dynatrace environment variables (optional, for AI Observability)
2. Start server - agents activate automatically!
3. Run some journeys to build transaction volume
4. Monitor in Dynatrace for chaos → problem → remediation flow
5. Check AI Observability for Ollama GenAI spans
6. Review logs every 10 minutes during warmup for status update

- [Gremlin Agent Manual](./routes/gremlin.ts)
- [Fix-It Agent Manual](./routes/fixit.ts)
- [Chaos Recipes](./tools/chaos/chaosRecipes.ts)
- [Fix Tools](./tools/fixes/fixTools.ts)
- [Librarian Memory](./agents/librarian/librarianAgent.ts)

## 🎉 Summary

You now have a fully autonomous chaos engineering and auto-remediation system powered by AI:

✅ **Gremlin Scheduler** - Randomly injects realistic failures using Ollama  
✅ **Fix-It Detector** - Automatically detects and remediates problems  
✅ **Event Correlation** - Links chaos, problems, and fixes in Dynatrace  
✅ **AI Observability** - All Ollama calls instrumented with oTel GenAI spans  
✅ **Safety Features** - Multiple protections and emergency stops  

All agents use Ollama extensively for decision-making. Once you set `DT_ENVIRONMENT` and `DT_PLATFORM_TOKEN`, their GenAI spans will appear in Dynatrace AI Observability.

**Next Steps**:
1. Set Dynatrace environment variables
2. Start both agents with `/api/autonomous/start-all`
3. Monitor in Dynatrace for chaos → problem → remediation flow
4. Check AI Observability for Ollama GenAI spans
