# 🔧 Dynatrace Self-Healing Workflow - Feature Flag Control

## Overview

Dynatrace workflows can automatically control feature flags (including error injection) by calling the BizObs Feature Flag API. This simulates **self-healing** and automatic remediation.

## 🚀 New Feature Flag API (RESTful & Scalable)

**Base URL**: `http://your-server:8080/api/feature_flag`

This API is designed to be **future-proof** - you can add new feature flags without modifying the endpoint code!

### GET All Feature Flags

```bash
curl http://localhost:8080/api/feature_flag
```

**Response:**
```json
{
  "success": true,
  "flags": {
    "errors_per_transaction": 0.1,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "defaults": {
    "errors_per_transaction": 0.1,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "timestamp": "2026-02-12T10:30:00.000Z"
}
```

### GET Specific Feature Flag

```bash
curl http://localhost:8080/api/feature_flag/errors_per_transaction
```

**Response:**
```json
{
  "success": true,
  "flag": "errors_per_transaction",
  "value": 0.1,
  "default": 0.1,
  "timestamp": "2026-02-12T10:30:00.000Z"
}
```

### PUT - Set Feature Flag Value (Self-Healing)

**Disable Errors (Set to 0):**
```bash
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'
```

**Response:**
```json
{
  "success": true,
  "flag": "errors_per_transaction",
  "value": 0,
  "previous_value": 0.1,
  "message": "Feature flag 'errors_per_transaction' updated",
  "timestamp": "2026-02-12T10:31:00.000Z"
}
```

**Set Custom Error Rate:**
```bash
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0.05}'
```

**Adjust Regeneration Interval:**
```bash
curl -X PUT http://localhost:8080/api/feature_flag/regenerate_every_n_transactions \
  -H "Content-Type: application/json" \
  -d '{"value": 500}'
```

### DELETE - Reset to Default

**Reset Error Rate to Default (0.1):**
```bash
curl -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction
```

**Response:**
```json
{
  "success": true,
  "flag": "errors_per_transaction",
  "value": 0.1,
  "previous_value": 0,
  "message": "Feature flag 'errors_per_transaction' reset to default",
  "timestamp": "2026-02-12T10:35:00.000Z"
}
```

**Reset After 1000 Customers:**
```bash
# After processing 1000 customers, reset all flags for next batch
curl -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction
curl -X DELETE http://localhost:8080/api/feature_flag/regenerate_every_n_transactions
```

## Dynatrace Workflow Configuration

### Workflow 1: Stop Errors on Problem Detection

**Trigger:**
- Event type: `PROBLEM_OPEN`
- Problem filters:
  - Problem title contains: "error rate"
  - Affected entity: Service name contains "Dynamic-Step-Service"

**Actions:**

1. **HTTP Request - Disable Errors**
   ```
   Method: PUT
   URL: http://{{SERVER_HOST}}:8080/api/feature_flag/errors_per_transaction
   Headers:
     Content-Type: application/json
   Body:
     {
       "value": 0
     }
   ```

2. **Send Slack Notification** (Optional)
   ```
   Message: 
   🛡️ Self-Healing Activated!
   Problem: {{event.title}}
   Action: Disabled error injection via Feature Flag API
   Service: {{event.affectedEntities[0].name}}
   ```

3. **Create Custom Event**
   ```
   Event Type: CUSTOM_INFO
   Title: Self-Healing Applied - Errors Disabled
   Description: Feature flag 'errors_per_transaction' set to 0 for problem {{event.id}}
   ```

### Workflow 2: Reset After Problem Closes

**Trigger:**
- Event type: `PROBLEM_CLOSE`
- Problem filters: Same as above

**Actions:**

1. **Wait** - 2 minutes (cool-down period)

2. **HTTP Request - Reset to Default**
   ```
   Method: DELETE
   URL: http://{{SERVER_HOST}}:8080/api/feature_flag/errors_per_transaction
   ```
   *Note: DELETE resets to default value (0.1) without needing to specify the value*

3. **Send Notification**
   ```
   ✅ Normal Operations Resumed
   Errors re-enabled at default rate (10%)
   Ready for next 1000 customers
   ```

### Workflow 3: Reset After Customer Batch (Scheduled)

**Trigger:** 
- Schedule: Every hour (or after your customer batch completes)
- Or: Custom event from LoadRunner test completion

**Actions:**

1. **HTTP Request - Reset All Flags**
   ```
   Method: DELETE
   URL: http://{{SERVER_HOST}}:8080/api/feature_flag/errors_per_transaction
   ```

2. **HTTP Request - Reset Regeneration Interval**
   ```
   Method: DELETE
   URL: http://{{SERVER_HOST}}:8080/api/feature_flag/regenerate_every_n_transactions
   ```

3. **Log Event**: "Feature flags reset for next customer batch"

### Workflow 4: Gradual Recovery (Advanced)

**Trigger:** Problem closes

**Actions:**

1. **Wait** - 2 minutes

2. **Set Low Error Rate** (2%)
   ```
   Method: PUT
   URL: http://{{SERVER_HOST}}:8080/api/feature_flag/errors_per_transaction
   Body: {"value": 0.02}
   ```

3. **Wait** - 5 minutes

4. **Check for New Problems** (Condition)
   - If no problems: Continue
   - If problems: Stop and disable again

5. **Reset to Default** (10%)
   ```
   Method: DELETE
   URL: http://{{SERVER_HOST}}:8080/api/feature_flag/errors_per_transaction
   ```

## 🎯 Benefits of New API Design

✅ **RESTful** - Standard HTTP methods (GET/PUT/DELETE)  
✅ **Scalable** - Add new flags without code changes  
✅ **Intuitive** - Clear endpoint pattern `/api/feature_flag/:flag_name`  
✅ **Type-Safe** - Each flag has its own endpoint  
✅ **Self-Documenting** - GET returns available flags  
✅ **Reset-Friendly** - DELETE resets to defaults (perfect for batch processing)  

### Adding New Feature Flags (Future)

When you add new flags to `DEFAULT_FEATURE_FLAGS`, they automatically work:

```javascript
// In server.js - just add to defaults!
const DEFAULT_FEATURE_FLAGS = {
  errors_per_transaction: 0.1,
  errors_per_visit: 0.001,
  errors_per_minute: 0.5,
  regenerate_every_n_transactions: 100,
  // NEW FLAGS - automatically available via API!
  slow_response_enabled: false,
  cache_miss_rate: 0.05,
  database_timeout_rate: 0.02
};
```

Now you can immediately use:
```bash
# No endpoint code changes needed!
curl -X PUT http://localhost:8080/api/feature_flag/slow_response_enabled \
  -H "Content-Type: application/json" \
  -d '{"value": true}'

curl -X DELETE http://localhost:8080/api/feature_flag/cache_miss_rate
```

## Testing the Workflow

### Manual Test

1. **Check current status:**
   ```bash
   curl http://localhost:8080/api/feature_flag/errors_per_transaction
   ```

2. **Run journey simulation** (errors should inject at 10% rate)

3. **Manually trigger self-healing:**
   ```bash
   curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
     -H "Content-Type: application/json" \
     -d '{"value": 0}'
   ```

4. **Verify errors stop** - Check server logs:
   ```bash
   tail -f logs/server.log | grep "Feature Flags"
   ```
   
   You should see:
   ```
   ⏸️  [Feature Flags API] errors_per_transaction: 0.1 → 0 (DISABLED - Self-healing active!)
   ```

5. **Reset to default:**
   ```bash
   curl -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction
   ```

### Test All Flag Operations

```bash
# Get all flags
curl http://localhost:8080/api/feature_flag

# Get specific flag
curl http://localhost:8080/api/feature_flag/errors_per_transaction

# Set custom value
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0.05}'

# Reset to default
curl -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction

# Adjust regeneration interval
curl -X PUT http://localhost:8080/api/feature_flag/regenerate_every_n_transactions \
  -H "Content-Type: application/json" \
  -d '{"value": 500}'
```

### Full Demo Scenario

**Step 1: Start Load Test**
- Generate a journey
- Start LoadRunner test (10 minutes, default 10% error rate)
- Errors inject automatically every 100 transactions

**Step 2: Dynatrace Detects Problem**
- After ~20-30 errors: Davis AI creates problem
- Problem title: "High error rate detected"
- Affected service: Dynamic-Step-Service-PaymentProcessing

**Step 3: Workflow Triggers (Automatic)**
- Workflow calls: `PUT /api/feature_flag/errors_per_transaction {"value": 0}`
- Errors stop immediately
- Slack notification sent

**Step 4: Problem Resolves (Automatic)**
- After 2-3 minutes: Problem closes (no new errors)
- Davis AI marks as resolved

**Step 5: Recovery Workflow (Automatic)**
- Wait 2 minutes
- Workflow calls: `DELETE /api/feature_flag/errors_per_transaction`
- Errors resume at default rate (10%)
- System continues testing

**Step 6: Batch Reset (After 1000 Customers)**
- LoadRunner test completes
- Workflow calls: `DELETE /api/feature_flag/errors_per_transaction`
- Ready for next customer batch with clean defaults

## 🔄 Backward Compatibility

The old `/api/error-config` endpoints still work for existing integrations:

```bash
# Old API (still works, logs warning)
curl -X POST http://localhost:8080/api/error-config \
  -H "Content-Type: application/json" \
  -d '{"action": "disable"}'

# Logs: ⚠️ [Legacy API] /api/error-config POST called (use PUT /api/feature_flag/:flag_name instead)
```

**Migration Guide:**

| Old API | New API |
|---------|---------|
| `POST /api/error-config {"action": "disable"}` | `PUT /api/feature_flag/errors_per_transaction {"value": 0}` |
| `POST /api/error-config {"action": "enable"}` | `DELETE /api/feature_flag/errors_per_transaction` |
| `POST /api/error-config {"errors_per_transaction": 0.05}` | `PUT /api/feature_flag/errors_per_transaction {"value": 0.05}` |
| `GET /api/error-config` | `GET /api/feature_flag` |

## DQL Queries

### Monitor Self-Healing Events

```dql
fetch logs
| filter contains(content, "Self-healing active")
| fields timestamp, content
| sort timestamp desc
```

### Correlation with Problems

```dql
fetch events
| filter event.type == "CUSTOM_INFO"
| filter event.title contains "Self-Healing"
| fields timestamp, event.title, affected_entity
| sort timestamp desc
```

### Error Rate Timeline

```dql
fetch bizevents, from: now()-1h
| filter error_occurred == true
| makeTimeseries count(), by: 5m
```

Should show clear drop when self-healing activates!

## Advanced: Dynamic Error Rates

### Workflow with Intelligent Adjustment

Instead of disable/enable, gradually reduce errors:

```javascript
// Workflow JavaScript task
const currentFlag = await fetch('http://localhost:8080/api/feature_flag/errors_per_transaction');
const { value } = await currentFlag.json();
const newRate = Math.max(0, value - 0.02);

await fetch('http://localhost:8080/api/feature_flag/errors_per_transaction', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: newRate })
});

console.log(`Reduced error rate: ${value} → ${newRate}`);
```

**Benefits:**
- Graceful degradation
- Tests system under various error rates
- More realistic production simulation

## Configuration Variables in Dynatrace

Create workflow variables:

```
SERVER_HOST = your-server-hostname
ERROR_RATE_DISABLED = 0
ERROR_RATE_LOW = 0.02
ERROR_RATE_MEDIUM = 0.05
ERROR_RATE_HIGH = 0.1
```

Use in workflow:
```json
{
  "value": {{ERROR_RATE_DISABLED}}
}
```

## Troubleshooting

### Workflow not triggering?

**Check:**
1. Problem filters match your service names
2. Workflow is enabled and published
3. Server is accessible from Dynatrace
4. API endpoint returns 200 OK

**Test manually:**
```bash
curl -v -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'
```

### Errors not stopping?

**Check server logs:**
```bash
tail -f logs/server.log | grep -E "Feature Flags|Self-healing"
```

Should see:
```
🎛️  [Feature Flags API] errors_per_transaction: 0.1 → 0
⏸️  [Feature Flags API] errors_per_transaction: 0.1 → 0 (DISABLED - Self-healing active!)
📥 [Feature Flags] Fetched from main server: {errors_per_transaction: 0, ...}
⏸️  [Feature Flags] Errors disabled (errors_per_transaction=0) - Self-healing active!
```

### Flag not found error?

Check available flags:
```bash
curl http://localhost:8080/api/feature_flag
```

### Errors resume too quickly?

Add longer wait in workflow (5-10 minutes) before resetting flags.

## Example Workflow JSON

<details>
<summary>Click to expand full workflow configuration</summary>

```json
{
  "title": "Self-Healing - Disable Errors on Problem",
  "description": "Automatically stops error injection when problems detected",
  "actor": "dt.system",
  "trigger": {
    "eventTrigger": {
      "filterQuery": "event.type == \"PROBLEM_OPEN\" AND matchesPhrase(event.title, \"error rate\") AND matchesPhrase(affectedEntityNames, \"Dynamic-Step-Service\")",
      "triggerConfiguration": {
        "type": "event",
        "value": {
          "query": "event.type == \"PROBLEM_OPEN\"",
          "eventType": "events"
        }
      }
    }
  },
  "tasks": {
    "disable_errors": {
      "name": "disable_errors",
      "action": "dynatrace.http.request:1",
      "description": "Call BizObs API to disable errors",
      "input": {
        "method": "PUT",
        "url": "http://localhost:8080/api/feature_flag/errors_per_transaction",
        "headers": {
          "Content-Type": "application/json"
        },
        "payload": "{\"value\": 0}"
      },
      "position": {
        "x": 0,
        "y": 1
      }
    },
    "send_notification": {
      "name": "send_notification",
      "action": "dynatrace.slack:1",
      "description": "Notify team",
      "input": {
        "channel": "#bizobs-alerts",
        "message": "🛡️ Self-Healing Activated! Disabled error injection.\nProblem: {{ event.title }}"
      },
      "position": {
        "x": 0,
        "y": 2
      },
      "predecessors": ["disable_errors"]
    }
  }
}
```

</details>

## Benefits

✅ **Automatic Remediation** - No manual intervention  
✅ **Realistic Testing** - Problems come and go  
✅ **Workflow Validation** - Proves automation works  
✅ **Davis AI Training** - Learns correlation patterns  
✅ **Demo-Ready** - Shows self-healing in action  
✅ **RESTful Design** - Standard HTTP methods  
✅ **Future-Proof** - Add new flags without code changes  
✅ **Batch-Friendly** - DELETE resets for next 1000 customers  

---

**Quick Start:**
1. Start LoadRunner test
2. Wait for problem
3. Workflow disables errors automatically (PUT value: 0)
4. Problem resolves
5. Workflow resets errors (DELETE)
6. After 1000 customers: DELETE all flags for clean reset
7. Cycle repeats! 🔄
