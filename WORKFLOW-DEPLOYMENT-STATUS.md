# ✅ Dynatrace Workflow Deployment Status

**Deployment Date**: February 12, 2026  
**Environment**: bko67471.sprint.apps.dynatracelabs.com  
**Method**: Dynatrace MCP (Model Context Protocol)

---

## 🎯 Created Workflow

**Workflow ID**: `6e77c7ac-7b6b-47c4-bd64-0e76c755518c`  
**Name**: `[MCP POC] Notify team BizObs-SelfHealing on problem of type error_rate_increase`  
**Status**: ✅ Public (Accessible to all users)  
**Problem Type**: `error_rate_increase`  
**Team**: `BizObs-SelfHealing`  
**Slack Channel**: `#bizobs-alerts`

**Direct Link**:  
🔗 https://bko67471.sprint.apps.dynatracelabs.com/ui/apps/dynatrace.automations/workflows/6e77c7ac-7b6b-47c4-bd64-0e76c755518c

---

## 📋 Current Workflow Configuration

### Trigger
- **Event Type**: Problem Open
- **Filter**: Problems of type `error_rate_increase`
- **Team**: `BizObs-SelfHealing`

### Actions
1. **Slack Notification** → `#bizobs-alerts` channel

---

## 🔧 Next Steps: Add Self-Healing Action

To complete the self-healing workflow, you need to add an HTTP PUT action:

### Manual Steps in Dynatrace UI:

1. **Open the workflow**:
   - Click the link above or go to Workflows → Search for "BizObs-SelfHealing"
   - Click **Edit**

2. **Add HTTP Request task BEFORE Slack notification**:
   - Click the "+" button between trigger and Slack task
   - Select **HTTP Request** action

3. **Configure HTTP PUT** (New RESTful API):
   ```
   Method: PUT
   URL: http://localhost:8080/api/feature_flag/errors_per_transaction
   Headers:
     Content-Type: application/json
   Body:
     {"value": 0}
   ```

4. **Important: Allow External Requests**:
   - Go to: Settings → General → External Requests
   - Add to allowlist: `http://localhost:8080`

5. **Reorder Tasks**:
   ```
   [Problem Trigger]
        ↓
   [HTTP PUT - Disable Errors]  ← Add this (value: 0)
        ↓
   [Slack Notification]  ← Already exists
   ```

6. **Test the Workflow**:
   - Click **Run** button
   - Verify HTTP request succeeds (200 OK)
   - Check server logs for: `⏸️ [Feature Flags API] errors_per_transaction: 0.1 → 0 (DISABLED - Self-healing active!)`

7. **Deploy**:
   - Click **Deploy** to activate

---

## 🚀 New Feature Flag API (Scalable & Future-Proof)

The API has been refactored to be RESTful and scalable:

### Quick Reference

| Action | Method | Endpoint | Body |
|--------|--------|----------|------|
| Get all flags | GET | `/api/feature_flag` | - |
| Get specific flag | GET | `/api/feature_flag/:flag_name` | - |
| Set flag value | PUT | `/api/feature_flag/:flag_name` | `{"value": X}` |
| Reset to default | DELETE | `/api/feature_flag/:flag_name` | - |

### Examples

```bash
# Disable errors (self-healing)
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'

# Reset to default after 1000 customers
curl -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction

# Set custom rate (5%)
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0.05}'

# Get current value
curl http://localhost:8080/api/feature_flag/errors_per_transaction

# Get all flags
curl http://localhost:8080/api/feature_flag
```

### Why This Design?

✅ **RESTful** - Standard HTTP methods (GET/PUT/DELETE)  
✅ **Scalable** - Add new flags to defaults, works immediately  
✅ **Intuitive** - `/api/feature_flag/:flag_name` pattern  
✅ **Reset-Friendly** - DELETE resets to default (perfect for batch processing)  
✅ **Future-Proof** - No endpoint changes needed for new flags  

---

## 🧪 Testing the Complete Flow

### Step 1: Generate Errors
```bash
cd "/home/ec2-user/BizObs Generator"
# Start server (if not running)
node server.js

# Generate a journey and run LoadRunner test
# Set errors_per_transaction = 0.1 (10%)
# Run for 10 minutes
```

### Step 2: Trigger Problem
- After ~20-30 errors, Dynatrace Davis AI creates a problem
- Problem type: "error_rate_increase"
- Workflow automatically triggers

### Step 3: Verify Self-Healing
Check server logs:
```bash
tail -f logs/server.log | grep -E "Error Config|Self-healing"
```

Expected output:
```
🔧 [Error Config API] POST request: {action: 'disable'}
⏸️  [Error Config API] Errors DISABLED via action command
⏸️  [Feature Flags] Errors disabled (errors_per_transaction=0) - Self-healing active!
```

### Step 4: Check Slack
- Message appears in `#bizobs-alerts`
- Confirms workflow executed

### Step 5: Verify Problem Resolves
- After 2-3 minutes, no new errors
- Problem automatically closes
- Davis AI marks as "Resolved"

---

## 🔄 Optional: Add Recovery Workflow

Create a second workflow for automatic re-enabling:

### Workflow 2: Re-enable After Problem Closes

**Trigger**: Problem Close (same filter)

**Actions**:
1. **Wait** - 2 minutes (cool-down)
2. **HTTP POST**:
   ```
   URL: http://localhost:8080/api/error-config
   Body: {"action": "enable"}
   ```
3. **Slack Notification**: "✅ Errors re-enabled - Normal testing resumed"

### Create via MCP:
```bash
# Not yet available via MCP tool
# Create manually in Dynatrace UI following same pattern
```

---

## 📊 Workflow Verification

### Check if Workflow Exists:
```bash
# Via Dynatrace UI:
Workflows → Search "BizObs-SelfHealing"

# Via API (if configured):
curl -X GET "https://bko67471.sprint.apps.dynatracelabs.com/api/v2/workflows/6e77c7ac-7b6b-47c4-bd64-0e76c755518c" \
  -H "Authorization: Api-Token YOUR_TOKEN"
```

### Test HTTP Action Manually:
```bash
# Test from command line (new API):
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'

# Expected response:
{
  "success": true,
  "flag": "errors_per_transaction",
  "value": 0,
  "previous_value": 0.1,
  "message": "Feature flag 'errors_per_transaction' updated",
  "timestamp": "2026-02-12T..."
}

# Reset to default:
curl -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction

# Expected response:
{
  "success": true,
  "flag": "errors_per_transaction",
  "value": 0.1,
  "previous_value": 0,
  "message": "Feature flag 'errors_per_transaction' reset to default",
  "timestamp": "2026-02-12T..."
}
```

---

## 🚨 Troubleshooting

### Workflow Not Triggering?
- ✅ Check workflow is **enabled** and **deployed**
- ✅ Verify problem filter matches actual problem type
- ✅ Check problem appears in Problems app
- ✅ View workflow execution history

### HTTP Request Failing?
- ✅ Add `http://localhost:8080` to External Requests allowlist
- ✅ Verify BizObs server is running: `ps aux | grep "node server.js"`
- ✅ Check server is on port 8080: `netstat -tlnp | grep 8080`
- ✅ Test endpoint manually from command line

### Errors Not Stopping?
- ✅ Check server logs for API call: `tail -f logs/server.log`
- ✅ Verify `errors_per_transaction` set to 0
- ✅ Check global config: `curl http://localhost:8080/api/error-config`
- ✅ Look for "Self-healing active!" message in logs

---

## 📚 Related Documentation

- [DYNATRACE-SELF-HEALING-WORKFLOW.md](./DYNATRACE-SELF-HEALING-WORKFLOW.md) - Complete self-healing guide
- [services/dynamic-step-service.cjs](./services/dynamic-step-service.cjs) - Error injection logic
- [server.js](./server.js) - Error Control API (lines 403-470)

---

## 🎉 Success Criteria

✅ **Workflow Created**: ID `6e77c7ac-7b6b-47c4-bd64-0e76c755518c`  
✅ **Workflow Public**: Accessible to all team members  
⏳ **HTTP Action Added**: Manual step required (see above)  
⏳ **External Requests Allowed**: Add localhost to allowlist  
⏳ **End-to-End Test**: Run LoadRunner → Problem → Self-healing  

---

## 🚀 Quick Start Commands

```bash
# 1. Check server status
ps aux | grep "node server.js"

# 2. Get all feature flags
curl http://localhost:8080/api/feature_flag

# 3. Get specific flag value
curl http://localhost:8080/api/feature_flag/errors_per_transaction

# 4. Test disable (self-healing)
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'

# 5. Watch for self-healing
tail -f logs/server.log | grep "Feature Flags"

# 6. Reset to default (after 1000 customers)
curl -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction

# 7. Set custom error rate (5%)
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0.05}'
```

---

## 🔄 Backward Compatibility

The old `/api/error-config` API still works but logs warnings:

```bash
# Old API (deprecated but functional)
curl -X POST http://localhost:8080/api/error-config \
  -H "Content-Type: application/json" \
  -d '{"action": "disable"}'

# Logs: ⚠️ [Legacy API] /api/error-config POST called (use PUT /api/feature_flag/:flag_name instead)
```

**Migration:**
- `POST /api/error-config {"action": "disable"}` → `PUT /api/feature_flag/errors_per_transaction {"value": 0}`
- `POST /api/error-config {"action": "enable"}` → `DELETE /api/feature_flag/errors_per_transaction`

---

**Next Action**: Open the workflow in Dynatrace UI and add the HTTP PUT action as described above!
