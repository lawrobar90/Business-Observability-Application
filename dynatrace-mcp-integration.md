# Dynatrace MCP Integration for BizObs Generator

## Overview
This document outlines how to use the Dynatrace MCP server to:
1. Configure Dynatrace settings for BizObs application monitoring
2. Auto-deploy dashboards based on journey configurations and business events

## Current BizObs Business Events

The BizObs Generator currently creates these business events:
- `journey_data_persisted` - When journey data is stored
- `journey_storage_failed` - When storage fails
- Journey step completions with metadata
- Customer simulation results with business value

### Business Event Structure
```json
{
  "journeyId": "journey_123",
  "correlationId": "corr_456",
  "companyName": "TechCorp",
  "industryType": "technology",
  "totalSteps": 6,
  "completedSteps": 6,
  "businessValue": 750,
  "conversionValue": 1200,
  "satisfactionScore": 9.2,
  "npsScore": 8,
  "customerId": "customer_789",
  "sessionId": "session_abc",
  "deviceType": "web",
  "steps": [...],
  "timestamp": "2026-02-03T..."
}
```

## MCP Server Setup

### 1. Install and Configure MCP Server

Add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "dynatrace-mcp-server": {
      "command": "npx",
      "args": ["-y", "@dynatrace-oss/dynatrace-mcp-server@latest"],
      "env": {
        "DT_ENVIRONMENT": "https://YOUR_TENANT.apps.dynatrace.com",
        "DT_PLATFORM_TOKEN": "YOUR_TOKEN_HERE",
        "DT_GRAIL_QUERY_BUDGET_GB": "100"
      }
    }
  }
}
```

### 2. Required Dynatrace Scopes

Your Platform Token needs:
- `app-engine:apps:run` - Execute apps
- `storage:bizevents:read` - Read business events from Grail
- `storage:logs:read` - Read application logs
- `storage:metrics:read` - Read metrics
- `storage:events:read` - Read events
- `document:documents:write` - Create dashboards
- `document:documents:read` - List/read documents
- `settings:objects:write` - Configure settings
- `settings:objects:read` - Read settings

## Use Cases

### Use Case 1: Create BizObs Monitoring Configuration

**Copilot Prompt:**
```
Using the Dynatrace MCP server, create monitoring rules for the BizObs-CustomerJourney application that:

1. Capture all business events with type containing "journey"
2. Create calculated metrics for:
   - Journey completion rate by company
   - Average business value per journey by industry
   - Customer satisfaction scores
   - NPS scores by journey type

3. Set up log monitoring rules for:
   - Service startup/shutdown events
   - Port allocation issues
   - Journey simulation errors

4. Configure error detection for:
   - Failed journey steps (status = 'failed')
   - Port exhaustion warnings
   - Service health check failures
```

### Use Case 2: Auto-Deploy Journey Dashboard

**Copilot Prompt:**
```
Create a Dynatrace dashboard for monitoring the current BizObs journey configuration:

Company: [COMPANY_NAME]
Industry: [INDUSTRY_TYPE]
Journey Steps: [STEP_NAMES]

Dashboard should include:

1. **Overview Tiles:**
   - Total journeys completed (last 24h)
   - Average journey completion time
   - Success rate by step
   - Total business value generated

2. **Journey Funnel:**
   - DQL query showing step-by-step progression
   - Drop-off rates at each step
   - Average time spent per step

3. **Business Metrics:**
   - Revenue attribution by step
   - Conversion rates
   - Customer satisfaction trends
   - NPS distribution

4. **Technical Performance:**
   - Service response times by step
   - Error rates per service
   - Port allocation status
   - Active service count

5. **Industry Comparison:**
   - Compare this journey against other industries
   - Benchmark satisfaction scores
   - Business value comparison

Use the following DQL queries as templates:

**Journey Completions:**
```dql
fetch bizevents
| filter event.type == "journey_data_persisted"
| filter companyName == "COMPANY_NAME"
| summarize count(), by: {industryType, journeyId}
| sort count desc
```

**Step Success Rates:**
```dql
fetch bizevents
| filter contains(event.type, "journey")
| expand steps
| summarize 
    total = count(),
    successful = countIf(steps[status] == "completed"),
    failed = countIf(steps[status] == "failed")
| fieldsAdd successRate = (successful / total) * 100
```

**Business Value by Industry:**
```dql
fetch bizevents
| filter event.type == "journey_data_persisted"
| summarize 
    totalValue = sum(businessValue),
    avgValue = avg(businessValue),
    journeys = count()
| by: industryType
| sort totalValue desc
```

**Journey Duration Analysis:**
```dql
fetch bizevents
| filter event.type == "journey_data_persisted"
| fieldsAdd durationMs = totalProcessingTime
| summarize 
    avgDuration = avg(durationMs),
    p50 = percentile(durationMs, 50),
    p95 = percentile(durationMs, 95)
| by: industryType
```

**Customer Satisfaction Heatmap:**
```dql
fetch bizevents
| filter event.type == "journey_data_persisted"
| summarize 
    avgSatisfaction = avg(satisfactionScore),
    avgNPS = avg(npsScore),
    count = count()
| by: {industryType, companyName}
| fieldsAdd satisfactionCategory = 
    if(avgSatisfaction >= 9, "Excellent",
    if(avgSatisfaction >= 7, "Good",
    if(avgSatisfaction >= 5, "Fair", "Poor")))
```

Deploy this dashboard using the MCP server's create_document tool.
```

### Use Case 3: Real-Time Journey Monitoring

**Copilot Prompt:**
```
Query Dynatrace using the MCP server to monitor active BizObs journeys:

1. Show journeys that started in the last 10 minutes
2. Identify any failing steps across all active journeys
3. Calculate real-time success rates
4. Alert on any anomalies (completion time > p95, error rate > 5%)

Provide a summary report with recommendations.
```

### Use Case 4: Automated Dashboard Updates

**Copilot Prompt:**
```
When I generate a new journey configuration in BizObs:

1. Detect the new configuration (company, industry, steps)
2. Check if a dashboard already exists for this company
3. If exists: Update with new journey steps and queries
4. If not: Create new dashboard from template
5. Configure alerts for:
   - Journey completion failures > 10%
   - Business value drops > 20%
   - Step response time > 5 seconds
```

## Integration Code Example

### Create Node.js Script for Dashboard Deployment

```javascript
// dynatrace-dashboard-deployer.js
import fetch from 'node-fetch';

const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT;
const DT_TOKEN = process.env.DT_PLATFORM_TOKEN;

async function deployJourneyDashboard(journeyConfig) {
  const { companyName, industryType, steps } = journeyConfig;
  
  const dashboard = {
    dashboardMetadata: {
      name: `BizObs Journey: ${companyName}`,
      shared: true,
      owner: "bizobs-generator",
      tags: ["bizobs", industryType, "auto-generated"]
    },
    tiles: [
      {
        name: "Journey Overview",
        tileType: "DATA_EXPLORER",
        configured: true,
        query: {
          metricSelector: "",
          resolution: "5m",
          dql: `fetch bizevents
| filter event.type == "journey_data_persisted"
| filter companyName == "${companyName}"
| summarize count(), avg(businessValue), avg(satisfactionScore)
| by: bin(timestamp, 1h)`
        }
      },
      // Add more tiles for each step
      ...steps.map((step, idx) => ({
        name: `Step ${idx + 1}: ${step.stepName}`,
        tileType: "DATA_EXPLORER",
        configured: true,
        query: {
          dql: `fetch logs
| filter k8s.deployment.name contains "${step.serviceName}"
| filter loglevel in {"ERROR", "WARN"}
| summarize count() by: loglevel`
        }
      }))
    ]
  };
  
  // Use MCP server or direct API call
  const response = await fetch(
    `${DT_ENVIRONMENT}/api/v2/documents`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Api-Token ${DT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dashboard)
    }
  );
  
  const result = await response.json();
  console.log(`Dashboard created: ${result.id}`);
  return result;
}

export { deployJourneyDashboard };
```

## AI Copilot Integration Workflow

### Option 1: Via GitHub Copilot Chat

1. Open `.vscode/mcp.json` and configure Dynatrace MCP server
2. In GitHub Copilot Chat, use: `@workspace /mcp`
3. Ask: "Create a Dynatrace dashboard for the currently loaded BizObs journey"
4. Copilot will use the MCP server to deploy the dashboard

### Option 2: Via API Endpoint

Create an endpoint in BizObs server:

```javascript
// Add to server.js
app.post('/api/dynatrace/deploy-dashboard', async (req, res) => {
  const { journeyConfig } = req.body;
  
  // Use MCP server or direct API
  try {
    const dashboard = await deployJourneyDashboard(journeyConfig);
    res.json({
      success: true,
      dashboardId: dashboard.id,
      dashboardUrl: `${DT_ENVIRONMENT}/ui/document/${dashboard.id}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Option 3: Automated on Journey Generation

Modify the journey generation workflow to auto-create dashboards:

```javascript
// In public/index.html, after journey generation:
async function onJourneyGenerated(journey) {
  // Auto-deploy dashboard
  const response = await fetch('/api/dynatrace/deploy-dashboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ journeyConfig: journey })
  });
  
  const result = await response.json();
  if (result.success) {
    alert(`Dashboard created! View at: ${result.dashboardUrl}`);
  }
}
```

## Example DQL Queries for BizObs Monitoring

### All Journeys with Business Value
```dql
fetch bizevents
| filter event.type == "journey_data_persisted"
| fields timestamp, companyName, industryType, totalSteps, completedSteps, 
         businessValue, satisfactionScore, npsScore
| sort timestamp desc
| limit 100
```

### Journey Funnel Analysis
```dql
fetch bizevents
| filter event.type == "journey_data_persisted"
| expand steps
| summarize 
    started = count(),
    completed = countIf(steps[status] == "completed"),
    failed = countIf(steps[status] == "failed")
| by: steps[stepName]
| fieldsAdd 
    successRate = (completed / started) * 100,
    failureRate = (failed / started) * 100
| sort started desc
```

### Port Exhaustion Monitoring
```dql
fetch logs
| filter contains(content, "No available ports")
| summarize count() by: bin(timestamp, 5m)
| fieldsAdd alert = if(count > 10, "CRITICAL", "OK")
```

### Service Performance by Journey Step
```dql
fetch spans
| filter service.name contains "Service"
| summarize 
    avgDuration = avg(duration),
    p95Duration = percentile(duration, 95),
    errorRate = (countIf(error == true) / count()) * 100
| by: service.name
| sort avgDuration desc
```

## Benefits

1. **Automated Observability**: Dashboards created automatically for each journey
2. **Real-time Monitoring**: Live view of journey performance and business metrics
3. **Business Context**: Connect technical metrics to business value
4. **AI-Powered Insights**: Use Davis Copilot for natural language queries
5. **Cost Tracking**: Monitor Grail query costs with budget controls
6. **Configuration as Code**: Dynatrace settings managed programmatically

## Next Steps

1. ✅ Set up Dynatrace MCP server in VS Code
2. ✅ Create Platform Token with required scopes
3. ✅ Test with sample queries
4. 🔨 Create dashboard template for BizObs journeys
5. 🔨 Add automation to journey generation workflow
6. 🔨 Configure alerts for critical business metrics
