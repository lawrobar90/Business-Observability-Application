# Error Feature Flags & Dynatrace Workflow Remediation

## Overview
Enhanced error simulation with feature flags that Dynatrace workflows can detect and auto-remediate.

## Feature Flag Architecture

### 1. Error Configuration (UI)
```javascript
{
  "errorSimulation": {
    "enabled": true,
    "mode": "feature_flags", // or "random", "chaos"
    "featureFlags": {
      "payment_gateway_timeout": {
        "enabled": true,
        "affectedSteps": ["PaymentProcessing", "CheckoutService"],
        "errorRate": 0.15, // 15% error rate
        "errorType": "timeout",
        "httpStatus": 504,
        "remediation": {
          "type": "workflow",
          "action": "restart_payment_service",
          "slo_threshold": 0.10 // trigger if >10% errors
        }
      },
      "inventory_sync_failure": {
        "enabled": true,
        "affectedSteps": ["OrderFulfillment"],
        "errorRate": 0.08,
        "errorType": "service_unavailable",
        "httpStatus": 503,
        "remediation": {
          "type": "workflow",
          "action": "trigger_inventory_sync",
          "slo_threshold": 0.05
        }
      },
      "validation_error": {
        "enabled": false,
        "affectedSteps": ["CustomerDetails", "AccountVerification"],
        "errorRate": 0.05,
        "errorType": "validation_failed",
        "httpStatus": 400
      }
    }
  }
}
```

### 2. Bizevent Error Structure
```json
{
  "event.type": "bizevents.retail.checkout",
  "service_name": "CheckoutService",
  "status": "error",
  "error_occurred": true,
  "error": {
    "type": "timeout",
    "message": "Payment gateway timeout after 5000ms",
    "feature_flag": "payment_gateway_timeout",
    "http_status": 504,
    "recoverable": true,
    "retry_count": 0,
    "remediation_action": "restart_payment_service"
  },
  "step_name": "PaymentProcessing",
  "correlationId": "abc123",
  "timestamp": "2026-02-12T10:30:45.123Z"
}
```

### 3. Dynatrace DQL Queries

**Detect Active Error Feature Flags:**
```dql
fetch bizevents, from: now()-15m
| filter error_occurred == true
| filter isNotNull(error.feature_flag)
| summarize 
    error_count = count(),
    error_rate = (count() / toLong(countIf(true))) * 100,
    by: {error.feature_flag, error.remediation_action, service_name}
| filter error_rate > 10.0
```

**Monitor Error Trends:**
```dql
fetch bizevents, from: now()-1h
| filter event.type startsWith "bizevents."
| summarize 
    total = count(),
    errors = countIf(error_occurred == true),
    feature_flag_errors = countIf(isNotNull(error.feature_flag)),
    by: {bin(timestamp, 5m), service_name}
| fieldsAdd error_rate = (errors / total) * 100
```

### 4. Dynatrace Workflow Triggers

**Workflow 1: Payment Gateway Remediation**
```yaml
name: "Auto-Remediate Payment Gateway Timeout"
trigger:
  type: "davis_problem"
  filter: "error.feature_flag == 'payment_gateway_timeout' AND error_rate > 10"
actions:
  - type: "run_command"
    command: "curl -X POST http://your-server:8080/api/admin/remediate-feature-flag"
    body: |
      {
        "feature_flag": "payment_gateway_timeout",
        "action": "restart_payment_service",
        "severity": "high"
      }
  - type: "slack_notification"
    channel: "#incidents"
    message: "🚨 Payment gateway timeout detected ({{error_rate}}%). Auto-restarting service..."
```

**Workflow 2: Circuit Breaker**
```yaml
name: "Circuit Breaker - Disable Feature Flag"
trigger:
  type: "custom_threshold"
  metric: "bizevents.error_rate"
  condition: "> 25%"
actions:
  - type: "disable_feature_flag"
    flag: "{{error.feature_flag}}"
  - type: "create_jira_ticket"
    summary: "Feature flag {{error.feature_flag}} disabled - error rate {{error_rate}}%"
```

### 5. UI Enhancements

**New Error Configuration Panel:**
```html
<div class="p-6 rounded-2xl bg-dtcard border border-dtborder">
  <h3 class="text-xl font-bold text-dtcyan mb-4">🚦 Error Feature Flags</h3>
  
  <!-- Global Toggle -->
  <div class="flex items-center justify-between mb-6 p-3 bg-dtgray rounded-lg">
    <div>
      <span class="text-white font-medium">Error Simulation</span>
      <span id="errorToggleStatus" class="ml-2 px-2 py-1 rounded bg-red-600 text-white">OFF</span>
    </div>
    <label class="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" id="errorSimulationToggle" class="sr-only peer">
      <div class="w-11 h-6 bg-gray-200 peer-checked:bg-dtcyan rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
    </label>
  </div>
  
  <!-- Feature Flag List -->
  <div class="space-y-3">
    <!-- Payment Gateway Timeout -->
    <div class="p-4 bg-dtgray rounded-lg border border-dtborder">
      <div class="flex items-start justify-between mb-2">
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span class="text-white font-semibold">💳 Payment Gateway Timeout</span>
            <span class="px-2 py-0.5 rounded bg-red-600 text-white text-xs">CRITICAL</span>
          </div>
          <p class="text-xs text-gray-400 mt-1">Simulates payment service timeouts (504)</p>
        </div>
        <input type="checkbox" id="flag-payment-timeout" class="feature-flag-toggle" data-flag="payment_gateway_timeout">
      </div>
      <div class="grid grid-cols-3 gap-3 mt-3 text-xs">
        <div>
          <span class="text-gray-400">Error Rate:</span>
          <input type="range" min="0" max="100" value="15" class="w-full" data-flag="payment_gateway_timeout">
          <span class="text-dtcyan font-bold">15%</span>
        </div>
        <div>
          <span class="text-gray-400">Affected Steps:</span>
          <span class="text-white">PaymentProcessing</span>
        </div>
        <div>
          <span class="text-gray-400">Remediation:</span>
          <span class="text-dtgreen">restart_service</span>
        </div>
      </div>
    </div>
    
    <!-- Inventory Sync Failure -->
    <div class="p-4 bg-dtgray rounded-lg border border-dtborder">
      <div class="flex items-start justify-between mb-2">
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span class="text-white font-semibold">📦 Inventory Sync Failure</span>
            <span class="px-2 py-0.5 rounded bg-yellow-600 text-white text-xs">WARNING</span>
          </div>
          <p class="text-xs text-gray-400 mt-1">Simulates inventory service unavailable (503)</p>
        </div>
        <input type="checkbox" id="flag-inventory-sync" class="feature-flag-toggle" data-flag="inventory_sync_failure">
      </div>
      <div class="grid grid-cols-3 gap-3 mt-3 text-xs">
        <div>
          <span class="text-gray-400">Error Rate:</span>
          <input type="range" min="0" max="100" value="8" class="w-full">
          <span class="text-dtcyan font-bold">8%</span>
        </div>
        <div>
          <span class="text-gray-400">Affected Steps:</span>
          <span class="text-white">OrderFulfillment</span>
        </div>
        <div>
          <span class="text-gray-400">Remediation:</span>
          <span class="text-dtgreen">trigger_sync</span>
        </div>
      </div>
    </div>
    
    <!-- Add Feature Flag Button -->
    <button class="w-full p-3 border-2 border-dashed border-dtcyan rounded-lg text-dtcyan hover:bg-dtcyan hover:text-black transition-all">
      ➕ Add Custom Feature Flag
    </button>
  </div>
</div>
```

## Implementation Steps

1. **Backend API** (`/api/feature-flags`)
   - GET `/api/feature-flags` - List all flags
   - POST `/api/feature-flags` - Create/update flag
   - POST `/api/feature-flags/:id/toggle` - Enable/disable flag
   - POST `/api/admin/remediate-feature-flag` - Remediation endpoint for workflows

2. **Service Error Injection** (dynamic-step-service.cjs)
   - Check active feature flags for current step
   - Apply error rate probability
   - Generate detailed error metadata
   - Include remediation actions in response

3. **Dynatrace Integration**
   - Create Davis detection rules for feature flag errors
   - Setup auto-remediation workflows
   - Dashboard tiles for error tracking
   - Alerting profiles for SLO breaches

4. **Testing Scenarios**
   - Gradually increase error rate → observe Davis detection
   - Trigger workflow → verify remediation
   - Disable feature flag → confirm error stops
   - Monitor SLO impact

## Benefits

✅ **Realistic Error Testing**: Industry-specific failure scenarios  
✅ **Auto-Remediation**: Dynatrace workflows fix issues automatically  
✅ **SLO Monitoring**: Track impact of errors on business objectives  
✅ **Chaos Engineering**: Controlled failure injection for resilience testing  
✅ **Traceability**: Every error linked to feature flag for easy debugging  
✅ **Business Impact**: See how errors affect revenue, conversions, NPS  

## Example Workflow Remediation

**Scenario**: Payment gateway timeout hits 15% error rate

1. **Detection**: Dynatrace Davis detects spike in `payment_gateway_timeout` errors
2. **Workflow Trigger**: Error rate exceeds 10% SLO threshold
3. **Action 1**: POST to `/api/admin/remediate-feature-flag` → restarts payment service
4. **Action 2**: Slack notification to #incidents channel
5. **Action 3**: Disable feature flag if error persists >5 minutes
6. **Result**: Service recovers, bizevents show error_rate dropping

**DQL to verify remediation:**
```dql
fetch bizevents, from: now()-30m
| filter error.feature_flag == "payment_gateway_timeout"
| summarize error_rate = (countIf(error_occurred == true) / count()) * 100, by: {bin(timestamp, 1m)}
| sort timestamp asc
```
