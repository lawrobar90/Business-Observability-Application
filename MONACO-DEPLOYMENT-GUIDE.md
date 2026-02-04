# Monaco Deployment Guide - BizObs Automation

This guide explains how to deploy self-healing workflows, BizEvents, and process detection rules to Dynatrace using Monaco (Monitoring as Code).

## 📋 Prerequisites

1. **Monaco CLI installed**:
   ```bash
   curl -L https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64 -o monaco
   chmod +x monaco
   sudo mv monaco /usr/local/bin/
   ```

2. **Environment variables**:
   ```bash
   export DT_ENVIRONMENT="https://abc12345.live.dynatrace.com"
   export DT_API_TOKEN="dt0c01.***"
   export BIZOBS_API_URL="https://your-codespace-url.app.github.dev"
   export DT_WORKFLOW_OWNER="bizobs-automation"
   ```

3. **API Token scopes required**:
   - `WriteConfig` - Write configuration
   - `ReadConfig` - Read configuration
   - `events.ingest` - Ingest events
   - `automation.workflows` - Create/update workflows
   - `settings.read` - Read settings
   - `settings.write` - Write settings

## 🚀 Quick Deployment

Deploy all automation configs in one command:

```bash
cd "/home/ec2-user/BizObs Generator/monaco"
monaco deploy -e bizobs-production manifest.yaml
```

## 📦 What Gets Deployed

### 1. **Self-Healing Workflows** (3 workflows)

#### Workflow 1: Disable Error Injection
- **Trigger**: Davis Problem opened with error category
- **Filter**: Problems affecting BizObs processes with "error" in name
- **Actions**:
  1. Check error rate via Metrics API
  2. POST to `/api/remediation/feature-flag` to disable `errorInjectionEnabled`
  3. Send CUSTOM_DEPLOYMENT event to Dynatrace
  4. Wait 2 minutes for stabilization
  5. Verify problem status

#### Workflow 2: Auto Recovery
- **Trigger**: Davis Problem closed
- **Filter**: Error problems affecting BizObs processes
- **Actions**:
  1. Check current flag status
  2. Re-enable `errorInjectionEnabled` if disabled
  3. Send CUSTOM_DEPLOYMENT recovery event

#### Workflow 3: Bulk Toggle
- **Trigger**: Davis Problem with multiple categories (error, slowdown, resource)
- **Actions**:
  1. Bulk toggle multiple flags (`errorInjectionEnabled`, `slowResponsesEnabled`)
  2. Send individual CUSTOM_DEPLOYMENT events for each flag

### 2. **BizEvents Capture Rule**
- Captures journey simulation events from Node.js processes
- Extracts: `journey.id`, `customer.id`, `customer.name`, `revenue`, `steps.completed`
- Triggers on paths: `/api/journey-simulation/*`, `/api/simulate-journey`, `/api/simulate-multiple-journeys`

### 3. **Process Group Detection**
- Identifies BizObs processes by `DT_SERVICE_NAME` environment variable
- Groups processes correctly for entity mapping
- Enables proper event targeting

## 🔧 Configuration Files

```
monaco/
├── manifest.yaml                          # Monaco manifest
└── bizobs-automation/
    ├── config.yaml                        # Config definitions
    ├── workflow-disable-error-injection.json
    ├── workflow-auto-recovery.json
    ├── workflow-bulk-toggle.json
    ├── bizevents-nodejs.json
    └── process-detection.json
```

## 🎯 Deployment by Component

### Deploy only workflows:
```bash
monaco deploy -e bizobs-production manifest.yaml \
  --config workflow-disable-error-injection \
  --config workflow-auto-recovery \
  --config workflow-bulk-toggle
```

### Deploy only BizEvents:
```bash
monaco deploy -e bizobs-production manifest.yaml \
  --config bizevents-nodejs
```

### Deploy only process detection:
```bash
monaco deploy -e bizobs-production manifest.yaml \
  --config process-detection-bizobs
```

## 🧪 Testing After Deployment

### 1. Verify workflows exist:
```bash
curl "$DT_ENVIRONMENT/api/v2/automation/workflows" \
  -H "Authorization: Api-Token $DT_API_TOKEN"
```

### 2. Manually trigger workflow:
```bash
# Simulate feature flag change
curl -X POST "https://your-codespace.app.github.dev/api/remediation/feature-flag" \
  -H "Content-Type: application/json" \
  -d '{
    "flag": "errorInjectionEnabled",
    "value": false,
    "reason": "Test deployment",
    "triggeredBy": "manual_test"
  }'
```

### 3. Check events in Dynatrace:
```dql
fetch events
| filter event.type == "CUSTOM_DEPLOYMENT"
| filter contains(event.name, "Feature Flag")
| sort timestamp desc
| limit 10
```

### 4. Generate journey data:
```bash
# Start continuous journey generation
export ENABLE_CONTINUOUS_JOURNEYS=true
npm start
```

## 🔄 Update Existing Workflows

Monaco will **update** existing workflows if they exist:

```bash
# Update all workflows
monaco deploy -e bizobs-production manifest.yaml

# Update single workflow
monaco deploy -e bizobs-production manifest.yaml \
  --config workflow-disable-error-injection
```

## 🗑️ Delete All Automation

```bash
monaco delete -e bizobs-production manifest.yaml
```

## 🔐 Security Best Practices

1. **API Token Management**:
   - Store token in environment variable, never commit
   - Use separate tokens for dev/prod
   - Rotate tokens regularly

2. **Workflow Authentication**:
   - Workflows call BizObs API - ensure proper network access
   - Consider adding API key authentication to remediation endpoints
   - Use HTTPS for production deployments

3. **Event Data**:
   - CUSTOM_DEPLOYMENT events appear in deployment timeline
   - Include audit trail: `triggered.by`, `problem.id`, `change.reason`
   - Events tied to BizObs-MainServer process group

## 📊 Monitoring Automation

### DQL Queries

**View all remediation actions**:
```dql
fetch events
| filter event.type == "CUSTOM_DEPLOYMENT"
| filter contains(properties["application"], "BizObs")
| summarize count(), by: {properties["feature.flag"], properties["triggered.by"]}
```

**Track self-healing effectiveness**:
```dql
fetch events
| filter event.type == "CUSTOM_DEPLOYMENT"
| filter properties["remediation.type"] == "feature_flag_toggle"
| fields timestamp, properties["feature.flag"], properties["new.value"], properties["problem.id"]
| sort timestamp desc
```

**Workflow execution history**:
```dql
fetch dt.davis.automation.workflow:execution
| filter workflow.name contains "BizObs"
| fields workflow.name, status, start_time, duration
| sort start_time desc
```

## 🐛 Troubleshooting

### Deployment fails with "401 Unauthorized"
- **Fix**: Check API token has required scopes
- **Fix**: Verify token not expired

### Workflows not triggering
- **Fix**: Check workflow filter queries match your problem events
- **Fix**: Verify BIZOBS_API_URL is publicly accessible
- **Fix**: Test remediation endpoint manually

### Events not appearing
- **Fix**: Check DT_ENVIRONMENT and DT_API_TOKEN in workflow payload
- **Fix**: Verify process group name matches "BizObs-MainServer"
- **Fix**: Check Events API token has `events.ingest` scope

### Monaco can't find files
- **Fix**: Run monaco from `/home/ec2-user/BizObs Generator/monaco/` directory
- **Fix**: Check file paths in `config.yaml` match actual filenames

## 🔗 Integration with Continuous Journeys

When continuous journey generation is enabled (`ENABLE_CONTINUOUS_JOURNEYS=true`):

1. **Journeys run every 30 seconds** (configurable via `JOURNEY_INTERVAL_MS`)
2. **5 customers per batch** (configurable via `JOURNEY_BATCH_SIZE`)
3. **Errors are injected automatically** if `errorInjectionEnabled=true`
4. **Self-healing workflows react** to high error rates
5. **CUSTOM_DEPLOYMENT events** track all flag changes

### Complete Flow:
```
Continuous Generator → High Error Rate → Davis Problem → 
Workflow Triggered → Flag Disabled → CUSTOM_DEPLOYMENT Event → 
Errors Stop → Problem Resolves → Recovery Workflow → 
Flag Re-enabled → CUSTOM_DEPLOYMENT Event → Normal Operation
```

## 📝 Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DT_ENVIRONMENT` | Dynatrace environment URL | - | ✅ |
| `DT_API_TOKEN` | API token with required scopes | - | ✅ |
| `BIZOBS_API_URL` | BizObs API URL (for workflows) | `http://localhost:8080` | ⚠️  (Workflows) |
| `DT_WORKFLOW_OWNER` | Workflow owner identifier | `bizobs-automation` | ❌ |
| `ENABLE_CONTINUOUS_JOURNEYS` | Auto-start journey generator | `false` | ❌ |
| `JOURNEY_INTERVAL_MS` | Time between journey batches | `30000` (30s) | ❌ |
| `JOURNEY_BATCH_SIZE` | Customers per batch | `5` | ❌ |

## 🚀 Full Automation Setup

Complete setup from scratch:

```bash
# 1. Set environment variables
export DT_ENVIRONMENT="https://abc12345.live.dynatrace.com"
export DT_API_TOKEN="dt0c01.***"
export BIZOBS_API_URL="https://your-codespace.app.github.dev"

# 2. Deploy Monaco configs
cd "/home/ec2-user/BizObs Generator/monaco"
monaco deploy -e bizobs-production manifest.yaml

# 3. Start BizObs with continuous journeys
cd "/home/ec2-user/BizObs Generator"
export ENABLE_CONTINUOUS_JOURNEYS=true
npm start

# 4. Monitor in Dynatrace
# - Go to Workflows → See 3 new workflows
# - Go to Settings → Business Events → See capture rule
# - Go to Problems → Wait for Davis problem
# - Go to Workflows → See execution logs
# - Go to Events → See CUSTOM_DEPLOYMENT events
```

## 🎉 Success Indicators

✅ **Monaco deployment successful**: "All configurations deployed successfully"
✅ **Workflows visible**: Automation → Workflows shows 3 new workflows
✅ **Continuous journeys running**: Console shows journey completions every 30s
✅ **Events appearing**: Dynatrace Events shows CUSTOM_DEPLOYMENT entries
✅ **Self-healing working**: High error rate → workflow triggers → flag disabled → errors stop

---

**Need help?** Check workflow execution logs in Dynatrace → Automation → Workflows → Executions
