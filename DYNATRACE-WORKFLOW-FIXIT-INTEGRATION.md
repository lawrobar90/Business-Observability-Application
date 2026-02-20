# Dynatrace Workflow + Fix-It Agent Integration Guide

## Overview

This guide shows you how to automatically trigger the Fix-It agent from **Dynatrace Workflows** when problems are detected, with enhanced root cause analysis from **Davis AI** via the **Dynatrace MCP Server**.

## 🎯 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Dynatrace Workflow                            │
│  Trigger: Problem Detected → Davis AI Analysis → HTTP Request   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ↓ POST /api/workflow-webhook/problem
┌─────────────────────────────────────────────────────────────────┐
│                   Fix-It Webhook Handler                         │
│  1. Receive problem notification                                 │
│  2. Query Dynatrace MCP Server for Davis AI insights            │
│  3. Trigger autonomous Fix-It agent                              │
│  4. Send remediation events back to Dynatrace                    │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Prerequisites

1. **Dynatrace Environment** with Workflows feature enabled
2. **Dynatrace MCP Server** running (optional but recommended for enhanced Davis AI)
3. **Fix-It Agent** auto-started on your BizObs server
4. **Network connectivity** from Dynatrace to your server

### Starting MCP Server

```bash
# Set environment variables
export DT_ENVIRONMENT="https://your-env.live.dynatrace.com"
export DT_PLATFORM_TOKEN="dt0c01.ABC..."

# Start MCP server
npx -y @dynatrace-oss/dynatrace-mcp-server@latest --http -p 3000
```

The server will start on port 3000 and provide Davis AI capabilities.

## 📋 Step-by-Step Setup

### Step 1: Configure Server Environment

Set the MCP server URL (if using):

```bash
export MCP_SERVER_URL="http://localhost:3000"
```

### Step 2: Test Webhook Endpoint

Verify the webhook is accessible:

```bash
# Health check
curl http://localhost:8080/api/workflow-webhook/health

# Expected response:
{
  "status": "healthy",
  "service": "fix-it-workflow-webhook",
  "endpoints": {
    "problem": "/api/workflow-webhook/problem",
    "problem_with_davis": "/api/workflow-webhook/problem-with-davis"
  }
}

# Test webhook
curl -X POST http://localhost:8080/api/workflow-webhook/test \
  -H "Content-Type: application/json" \
  -d '{"test": "payload"}'
```

### Step 3: Create Dynatrace Workflow

1. **Navigate to Dynatrace**: Settings → Workflows → Create Workflow

2. **Configure Trigger**:
   - Type: `Problem`
   - Event type: `Problem opened` or `Problem updated`
   - Problem filter (optional): Target specific problem types

3. **Add HTTP Action**:
   - Name: `Trigger Fix-It Agent`
   - Method: `POST`
   - URL: `http://your-server-ip:8080/api/workflow-webhook/problem`
   - Authentication: None (or configure if needed)
   - Headers:
     ```
     Content-Type: application/json
     ```
   - Body (Jinja2 template):
     ```json
     {
       "event_type": "{{ event_type }}",
       "event_id": "{{ event_id }}",
       "title": "{{ event.title }}",
       "description": "{{ event.description | default('') }}",
       "problem_id": "{{ event.problemId | default('') }}",
       "entity_id": "{{ event.entity.id | default('') }}",
       "entity_name": "{{ event.entity.name | default('') }}",
       "severity": "{{ event.severity | default('') }}",
       "status": "{{ event.status | default('') }}",
       "start_time": {{ event.start_time | default(0) }},
       "end_time": {{ event.end_time | default(0) }},
       "affected_entities": {{ event.affected_entities | default([]) | tojson }},
       "root_cause_entity": {{ event.root_cause_entity | default({}) | tojson }}
     }
     ```

4. **Save and Activate** the workflow

### Step 4: Enhanced Setup with Davis AI (Optional)

For enhanced root cause analysis, add a **Davis AI Problem Analysis** action:

1. **Add Action**: `Davis AI → Analyze Problem`
   - Input: Current problem (`{{ event }}`)
   
2. **Modify HTTP Action Body** to include Davis insights:
   ```json
   {
     "event_type": "{{ event_type }}",
     "problem_id": "{{ event.problemId }}",
     "entity_id": "{{ event.entity.id }}",
     "entity_name": "{{ event.entity.name }}",
     "severity": "{{ event.severity }}",
     "davis_insights": {
       "root_cause": "{{ davis_result.rootCause | default('') }}",
       "confidence": {{ davis_result.confidence | default(0) }},
       "evidence": {{ davis_result.evidence | default([]) | tojson }},
       "related_problems": {{ davis_result.relatedProblems | default([]) | tojson }}
     }
   }
   ```

## 🔍 Workflow Execution Flow

When a problem is detected:

1. **Dynatrace Workflow Triggered**
   - Problem detection event fires
   - Workflow captures problem details

2. **Webhook Sent to Fix-It**
   - POST request to `/api/workflow-webhook/problem`
   - Payload includes problem ID, entity info, severity

3. **Fix-It Processing**
   - Webhook handler receives notification
   - Queries MCP server for Davis AI insights (if available)
   - Triggers autonomous Fix-It agent
   - Returns immediate response (5s timeout)

4. **Remediation Execution**
   - Fix-It diagnoses root cause (using Ollama + Davis insights)
   - Proposes and executes fixes (feature flags, circuit breakers)
   - Sends remediation events back to Dynatrace
   - Links events to original problem via correlation IDs

5. **Dynatrace Timeline**
   - Shows problem detection
   - Shows Fix-It acknowledgement event
   - Shows remediation event
   - Shows problem resolution (if successful)

## 📊 Webhook Payload Reference

### Standard Payload (minimum)

```json
{
  "event_type": "PROBLEM_OPENED",
  "problem_id": "123456789",
  "entity_id": "SERVICE-ABC123",
  "entity_name": "PaymentService",
  "severity": "ERROR",
  "title": "Increased error rate on PaymentService"
}
```

### Enhanced Payload (with Davis AI)

```json
{
  "event_type": "PROBLEM_OPENED",
  "problem_id": "123456789",
  "entity_id": "SERVICE-ABC123",
  "entity_name": "PaymentService",
  "severity": "ERROR",
  "title": "Increased error rate on PaymentService",
  "davis_insights": {
    "root_cause": "Database connection pool exhausted",
    "confidence": 0.87,
    "evidence": [
      "Connection timeout errors increased 300%",
      "Thread pool saturation detected",
      "Similar pattern observed in historical data"
    ],
    "related_problems": ["PROBLEM-987654"]
  }
}
```

## 🧪 Testing the Integration

### Test 1: Manual Webhook Trigger

```bash
curl -X POST http://localhost:8080/api/workflow-webhook/problem \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "PROBLEM_OPENED",
    "problem_id": "test-123",
    "entity_id": "SERVICE-TEST",
    "entity_name": "TestService",
    "severity": "ERROR",
    "title": "Test problem for workflow integration"
  }'
```

Expected response:
```json
{
  "success": true,
  "runId": "fixit-1708252123456",
  "problemId": "test-123",
  "message": "Fix-It agent started - remediation in progress"
}
```

### Test 2: Check Fix-It Logs

```bash
tail -f "/home/ec2-user/BizObs Generator/logs/server.log" | grep "workflow-webhook\|fixit"
```

Expected output:
```
[workflow-webhook] INFO: Received problem webhook from Dynatrace workflow {"problem_id":"test-123"}
[workflow-webhook] INFO: Triggering Fix-It agent for workflow problem {"problemId":"test-123"}
[fixit] INFO: 🔧 Fix-It Agent starting {"runId":"fixit-1708252123456"}
```

### Test 3: Verify Dynatrace Events

1. Go to Dynatrace → Problems → Your Problem
2. Check Events tab
3. Look for:
   - `🔧 Fix-It Agent: Problem received from workflow`
   - `🩹 Remediation: [action taken]`

## 🔧 Advanced Configuration

### Custom MCP Server URL

If your MCP server runs on a different host/port:

```bash
# In server environment
export MCP_SERVER_URL="http://mcp-server.example.com:3000"
```

### Workflow Filtering

Create separate workflows for different problem types:

**Workflow 1: High Severity Only**
- Trigger: Problem opened
- Filter: `{{ event.severity == "ERROR" or event.severity == "CRITICAL" }}`

**Workflow 2: Specific Services**
- Trigger: Problem opened
- Filter: `{{ "PaymentService" in event.entity.name or "CheckoutService" in event.entity.name }}`

### Multiple Endpoints

For different handling strategies:

- `/api/workflow-webhook/problem` - Standard processing
- `/api/workflow-webhook/problem-with-davis` - Requires Davis insights
- `/api/workflow-webhook/test` - Testing only

### Authentication (Production)

Add API key authentication:

```typescript
// In workflow-webhook.ts
router.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.WORKFLOW_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});
```

Dynatrace workflow header:
```
X-API-Key: your-secret-key
```

## 📚 API Reference

### POST /api/workflow-webhook/problem

Trigger Fix-It agent from Dynatrace workflow.

**Request Body:**
```typescript
{
  event_type: string;           // PROBLEM_OPENED, PROBLEM_UPDATED
  problem_id?: string;          // Dynatrace problem ID
  entity_id?: string;           // Affected entity ID
  entity_name?: string;         // Affected entity name
  severity?: string;            // ERROR, CRITICAL, WARNING
  title: string;                // Problem title
  description?: string;         // Problem description
  davis_insights?: {            // Optional Davis AI analysis
    root_cause: string;
    confidence: number;
    evidence: string[];
    related_problems: string[];
  }
}
```

**Response:**
```typescript
{
  success: boolean;
  runId: string;                // Fix-It run identifier
  problemId: string;            // Problem being addressed
  message: string;              // Status message
  result?: FixItRunResult;      // Full result if completed quickly
}
```

### GET /api/workflow-webhook/health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "fix-it-workflow-webhook",
  "timestamp": "2026-02-18T12:00:00.000Z"
}
```

## 🎯 Workflow Examples

### Example 1: Basic Auto-Remediation

```yaml
name: Auto-Fix Critical Problems
trigger:
  type: problem
  filters:
    - severity: [ERROR, CRITICAL]
actions:
  - type: http_request
    name: Trigger Fix-It Agent
    url: http://bizobs-server:8080/api/workflow-webhook/problem
    method: POST
    body: '{{ event | tojson }}'
```

### Example 2: Davis AI + Fix-It

```yaml
name: Davis-Enhanced Auto-Remediation
trigger:
  type: problem
actions:
  - type: davis_analysis
    name: Analyze with Davis AI
    input: '{{ event }}'
  - type: http_request
    name: Fix-It with Davis Insights
    url: http://bizobs-server:8080/api/workflow-webhook/problem-with-davis
    method: POST
    body: |
      {
        "problem_id": "{{ event.problemId }}",
        "entity_name": "{{ event.entity.name }}",
        "davis_insights": {{ davis_result | tojson }}
      }
```

### Example 3: Conditional Remediation

```yaml
name: Smart Auto-Remediation
trigger:
  type: problem
actions:
  - type: davis_analysis
    name: Get Root Cause
  - type: condition
    if: '{{ davis_result.confidence > 0.7 }}'
    then:
      - type: http_request
        name: Auto-Remediate (High Confidence)
        url: http://bizobs-server:8080/api/workflow-webhook/problem
    else:
      - type: notification
        message: "Manual intervention needed - Davis confidence too low"
```

## 🔍 Troubleshooting

### Webhook Not Receiving Requests

1. **Check network connectivity**:
   ```bash
   curl http://your-server-ip:8080/api/workflow-webhook/health
   ```

2. **Verify workflow is active**:
   - Dynatrace → Workflows → Check status

3. **Check firewall rules**:
   - Ensure port 8080 is accessible from Dynatrace

### Fix-It Not Starting

1. **Check agent status**:
   ```bash
   curl http://localhost:8080/api/autonomous/status
   ```

2. **Verify Ollama is running**:
   ```bash
   curl http://localhost:11434/api/tags
   ```

3. **Review logs**:
   ```bash
   grep "fixit" /home/ec2-user/BizObs\ Generator/logs/server.log
   ```

### MCP Server Connection Failed

1. **Verify MCP server is running**:
   ```bash
   curl http://localhost:3000/health
   ```

2. **Check MCP_SERVER_URL**:
   ```bash
   echo $MCP_SERVER_URL
   ```

3. **Fallback behavior**:
   - Fix-It continues without Davis insights if MCP fails
   - Uses Ollama-based diagnosis instead

## 🎉 Summary

You now have **Dynatrace Workflow → Fix-It Agent** integration:

✅ **Automatic Problem Detection** - Dynatrace workflows trigger on problems  
✅ **Davis AI Integration** - Enhanced root cause from MCP server  
✅ **Intelligent Remediation** - Fix-It agent uses AI + Davis insights  
✅ **Event Correlation** - All actions tracked in Dynatrace timeline  
✅ **Graceful Fallback** - Works with or without MCP server  

**What You Get:**
- Problems detected → Fix-It triggered automatically
- Davis AI provides deep root cause analysis
- Ollama enhances diagnosis with LLM reasoning
- Remediation happens within minutes
- Full observability in Dynatrace

**Next Steps:**
1. Test with manual webhook trigger
2. Create Dynatrace workflow with problem trigger
3. Inject chaos to trigger a real problem
4. Watch Fix-It remediate automatically
5. Review event correlation in Dynatrace timeline
