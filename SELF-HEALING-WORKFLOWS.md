# 🔧 Self-Healing with Dynatrace Workflows

This guide shows how to implement automated self-healing using Dynatrace Workflows that toggle feature flags and send events to your BizObs application.

## 📋 Overview

**Flow:**
```
Problem Detected (High Error Rate)
  ↓
Dynatrace Workflow Triggered
  ↓
POST to BizObs /api/remediation/feature-flag
  ↓
Feature Flag Changed (errorInjectionEnabled = false)
  ↓
Event Sent to Dynatrace Events API
  ↓
Errors Stop / System Recovers
  ↓
Problem Resolves
```

## 🎯 Feature Flags Available

| Flag | Description | Default | Use Case |
|------|-------------|---------|----------|
| `errorInjectionEnabled` | Enable/disable error simulation | `true` | Disable during real incidents |
| `slowResponsesEnabled` | Enable/disable slow response simulation | `true` | Speed up during high load |
| `circuitBreakerEnabled` | Enable circuit breaker pattern | `false` | Protect downstream services |
| `rateLimitingEnabled` | Enable rate limiting | `false` | Control traffic spikes |
| `cacheEnabled` | Enable response caching | `true` | Improve performance |

## 🚀 Quick Test

### 1. Check Current Flags
```bash
curl http://localhost:8080/api/remediation/feature-flags
```

### 2. Toggle a Flag Manually
```bash
curl -X POST http://localhost:8080/api/remediation/feature-flag \
  -H "Content-Type: application/json" \
  -d '{
    "flag": "errorInjectionEnabled",
    "value": false,
    "reason": "Manual test - disabling errors",
    "triggeredBy": "manual"
  }'
```

### 3. Verify Event in Dynatrace
Go to: **Dynatrace → Events → Custom Configuration**

You should see: `Feature Flag Changed: errorInjectionEnabled`

## 📝 Dynatrace Workflow Configuration

### Workflow 1: Disable Error Injection on High Error Rate

**Trigger**: Problem opened - Error rate > 5%

**Actions**:

#### Action 1: Disable Error Injection
```yaml
Type: HTTP Request
Method: POST
URL: http://your-bizobs-server:8080/api/remediation/feature-flag
Headers:
  Content-Type: application/json
Body:
  {
    "flag": "errorInjectionEnabled",
    "value": false,
    "reason": "Automated remediation - High error rate detected",
    "problemId": "{{ event()['display_id'] }}",
    "triggeredBy": "dynatrace_workflow"
  }
```

#### Action 2: Add Comment to Problem
```yaml
Type: DQL Task
Query: |
  "Remediation Action: Disabled error injection"
```

#### Action 3: Wait for Recovery (5 minutes)
```yaml
Type: Delay
Duration: 5 minutes
```

#### Action 4: Re-enable Error Injection (Optional)
```yaml
Type: HTTP Request
Method: POST
URL: http://your-bizobs-server:8080/api/remediation/feature-flag
Body:
  {
    "flag": "errorInjectionEnabled",
    "value": true,
    "reason": "Automated recovery - Re-enabling after cooldown",
    "problemId": "{{ event()['display_id'] }}",
    "triggeredBy": "dynatrace_workflow_recovery"
  }
```

---

### Workflow 2: Bulk Flag Toggle for Complex Scenarios

**Trigger**: Problem opened - Multiple services failing

**Action**: Bulk Toggle
```yaml
Type: HTTP Request
Method: POST
URL: http://your-bizobs-server:8080/api/remediation/feature-flags/bulk
Headers:
  Content-Type: application/json
Body:
  {
    "flags": {
      "errorInjectionEnabled": false,
      "slowResponsesEnabled": false,
      "circuitBreakerEnabled": true
    },
    "reason": "Complex failure - Enabling defensive mode",
    "problemId": "{{ event()['display_id'] }}",
    "triggeredBy": "dynatrace_workflow"
  }
```

---

### Workflow 3: Auto-Recovery When Problem Closes

**Trigger**: Problem closed

**Action**: Re-enable All Features
```yaml
Type: HTTP Request
Method: POST
URL: http://your-bizobs-server:8080/api/remediation/feature-flags/bulk
Body:
  {
    "flags": {
      "errorInjectionEnabled": true,
      "slowResponsesEnabled": true,
      "circuitBreakerEnabled": false
    },
    "reason": "Problem resolved - Restoring normal operation",
    "problemId": "{{ event()['display_id'] }}",
    "triggeredBy": "dynatrace_workflow_recovery"
  }
```

---

## 🔧 Detailed Workflow Setup in Dynatrace

### Step-by-Step Creation:

1. **Go to**: Dynatrace → Workflows → **Create workflow**

2. **Name**: `BizObs Self-Healing - Disable Error Injection`

3. **Add Trigger**:
   - Type: **Event**
   - Event Type: **Problem opened**
   - Filter: `event.kind == "DAVIS_PROBLEM" AND affected_entity_types CONTAINS "PROCESS_GROUP_INSTANCE"`
   - Additional Filter: `error_rate > 5` (or your threshold)

4. **Add Task - HTTP Request**:
   - **Connection**: Choose or create HTTP connection
   - **Method**: POST
   - **URL**: `http://your-bizobs-server:8080/api/remediation/feature-flag`
   - **Headers**:
     ```json
     {
       "Content-Type": "application/json"
     }
     ```
   - **Body**:
     ```json
     {
       "flag": "errorInjectionEnabled",
       "value": false,
       "reason": "Automated remediation - Error rate threshold exceeded",
       "problemId": "{{ event()['display_id'] }}",
       "triggeredBy": "dynatrace_workflow"
     }
     ```

5. **Add Task - Create Event** (Optional):
   ```json
   {
     "eventType": "CUSTOM_ANNOTATION",
     "title": "Self-Healing: Disabled Error Injection",
     "entitySelector": "type(PROCESS_GROUP_INSTANCE),entityName.equals(\"BizObs-MainServer\")",
     "properties": {
       "remediation": "error_injection_disabled",
       "problem_id": "{{ event()['display_id'] }}",
       "automated": "true"
     }
   }
   ```

6. **Save and Enable** workflow

---

## 🧪 Testing the Workflow

### Scenario 1: Simulate High Error Rate

1. **Start a journey** in BizObs with error-prone customer (e.g., "Umbrella Corporation")
2. **Wait for errors** to accumulate
3. **Create a custom problem** or wait for Davis to detect
4. **Workflow triggers** automatically
5. **Check BizObs logs**:
   ```bash
   tail -f /tmp/bizobs.log | grep Remediation
   ```
6. **Verify in Dynatrace**:
   - Events → Look for "Feature Flag Changed"
   - Problems → Check for workflow comment
7. **Test journey again** - Errors should stop!

### Scenario 2: Manual Workflow Execution

1. Go to: **Workflows → Your Workflow → Run**
2. Provide test problem data
3. Monitor execution steps
4. Verify flag changed and event sent

---

## 📊 Monitoring Self-Healing Actions

### DQL Query - Recent Feature Flag Changes
```dql
fetch events
| filter event.type == "CUSTOM_CONFIGURATION"
| filter event.status == "OPEN"
| filter event.name == "Feature Flag Changed: errorInjectionEnabled"
| fields timestamp, event.name, triggered.by, new.value, change.reason
| sort timestamp desc
```

### DQL Query - Remediation Effectiveness
```dql
fetch events, from: now()-1h
| filter event.type == "CUSTOM_CONFIGURATION"
| filter triggered.by == "dynatrace_workflow"
| summarize count(), by: {feature.flag, new.value}
```

### DQL Query - Correlation with Problems
```dql
fetch events, from: now()-2h
| filter event.type == "CUSTOM_CONFIGURATION" 
  OR event.kind == "DAVIS_PROBLEM"
| fields timestamp, event.type, event.name, feature.flag
| sort timestamp asc
```

---

## 🎯 Advanced Patterns

### Pattern 1: Gradual Feature Rollback
Instead of instant disable, gradually reduce error rate:
```javascript
// Custom endpoint for gradual change
POST /api/remediation/error-rate
{
  "targetRate": 0.02,  // Reduce from 12% to 2%
  "duration": 300      // Over 5 minutes
}
```

### Pattern 2: Circuit Breaker Pattern
```javascript
// Enable circuit breaker when downstream fails
POST /api/remediation/feature-flag
{
  "flag": "circuitBreakerEnabled",
  "value": true,
  "reason": "Downstream service failure detected"
}
```

### Pattern 3: Canary Release Control
```javascript
// Reduce traffic to new version
POST /api/remediation/feature-flag
{
  "flag": "canaryTrafficPercent",
  "value": 10,
  "reason": "Increased error rate in canary deployment"
}
```

---

## 🔐 Security Considerations

1. **Authentication**: Add API key authentication to remediation endpoints
2. **Authorization**: Restrict which workflows can call remediation APIs
3. **Audit Trail**: All changes logged to Dynatrace Events
4. **Rate Limiting**: Prevent workflow loops
5. **Rollback Safety**: Auto-revert after timeout

---

## 📚 Next Steps

1. ✅ Test manual flag toggle
2. ✅ Verify events appear in Dynatrace
3. ✅ Create your first workflow
4. ✅ Simulate a problem and watch auto-remediation
5. ✅ Monitor effectiveness with DQL queries
6. ✅ Expand to more feature flags and scenarios

---

## 🆘 Troubleshooting

### Events not appearing in Dynatrace?
- Check `DT_ENVIRONMENT` and `DT_PLATFORM_TOKEN` are set
- Verify token has `events.ingest` scope
- Check BizObs logs: `grep "Event API" /tmp/bizobs.log`

### Workflow not triggering?
- Verify trigger conditions match your problem
- Check workflow is **enabled**
- Test with manual execution first

### Flag changes not taking effect?
- Check global.featureFlags is accessible
- Restart BizObs app after server.js changes
- Verify `/api/remediation/feature-flags` returns current state

---

**🎉 You now have automated self-healing in your BizObs application!**
