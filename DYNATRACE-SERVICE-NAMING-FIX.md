# 🔧 Dynatrace Service Naming Fix

## Problem

All services appear as `business-observability-engine` in Dynatrace instead of their unique names (Dynamic-Step-Service-PaymentProcessing, etc.), even though they have different process groups.

## Root Cause

Environment variables like `DT_SERVICE_NAME` are set **after** the OneAgent has already started monitoring the process. OneAgent captures the service name during process startup.

## Solution Options

### Option 1: Custom Service Detection Rules (Recommended - No Code Changes)

Configure Dynatrace to detect services based on process group:

1. **Go to Dynatrace**: Settings → Processes and containers → Process group detection
2. **Add new rule**: "BizObs Dynamic Services"
3. **Configure**:
   ```
   Rule name: BizObs Dynamic Services
   Process group naming: Use custom metadata
   
   Conditions:
   - Process property: PROCESS_GROUP_NAME
   - Operator: contains
   - Value: Dynamic-Step-Service
   
   OR
   
   - Process property: PROCESS_GROUP_METADATA  
   - Operator: contains
   - Value: bizobs-service
   ```

4. **Service naming rule**:
   ```
   Go to: Settings → Server-side service monitoring → Service detection rules
   
   Add rule: "BizObs Service Detection"
   
   Conditions:
   - Process group name: contains "Dynamic-Step-Service"
   
   Define service name:
   - Use: {ProcessGroup:Environment:DT_SERVICE_NAME}
   
   OR extract from process group name:
   - Pattern: Dynamic-Step-Service-(.*)
   - Use captured group as service name
   ```

### Option 2: Process Group Metadata (Recommended - Works Automatically)

The code already sets `DT_PROCESS_GROUP_NAME` correctly. Verify in Dynatrace:

1. **Check Process Groups**:
   - Go to: Infrastructure → Processes
   - Each process should have unique Process Group name
   - Click on process → Properties

2. **Enable Process Group Detection**:
   ```
   Settings → Processes and containers → Process group detection
   
   Check: "Use process properties for grouping"
   Enable: "DT_PROCESS_GROUP_NAME environment variable"
   ```

3. **Create Service Detection from Process Groups**:
   ```
   Settings → Server-side service monitoring → Service detection rules
   
   Rule: "Detect from Process Group"
   Condition: Process group name matches pattern
   Pattern: ^Dynamic-Step-Service-(.*)$
   
   Service name: Use full process group name
   ```

### Option 3: Launch Script with Pre-Set Environment (Best for Production)

Create wrapper scripts that set environment before Node.js starts:

**File**: `services/launch-service.sh`
```bash
#!/bin/bash

SERVICE_NAME=$1
PORT=$2

export DT_SERVICE_NAME="$SERVICE_NAME"
export DT_PROCESS_GROUP_NAME="$SERVICE_NAME"
export DT_LOGICAL_SERVICE_NAME="$SERVICE_NAME"
export DT_APPLICATION_NAME="BizObs-CustomerJourney"

# Launch with custom process name
exec -a "$SERVICE_NAME" node dynamic-step-service.cjs "$SERVICE_NAME" "$PORT"
```

Usage in service spawning code:
```javascript
spawn('bash', ['services/launch-service.sh', serviceName, port], {
  env: {
    ...process.env,
    DT_SERVICE_NAME: serviceName,
    DT_PROCESS_GROUP_NAME: serviceName
  }
});
```

### Option 4: Command-Line Tagging (Quickest Test)

Use Node.js command line args that Dynatrace can detect:

Modify child-caller.cjs spawn:
```javascript
spawn('node', [
  '--title=' + serviceName,  // Sets process.title early
  servicePath,
  serviceName,
  port
], {
  env: {
    ...process.env,
    DT_SERVICE_NAME: serviceName,
    DT_PROCESS_GROUP_NAME: serviceName,
    NODE_OPTIONS: `--title=${serviceName}`  // Another way
  }
});
```

## Verification

After applying fixes, verify in Dynatrace:

### Check Services:
```
1. Go to: Services
2. You should see separate services:
   - Dynamic-Step-Service-PaymentProcessing
   - Dynamic-Step-Service-InventoryCheck
   - Dynamic-Step-Service-OrderConfirmation
   - etc.
```

### Check Process Groups:
```
1. Go to: Infrastructure → Processes
2. Each should have unique Process Group:
   - Process Group: Dynamic-Step-Service-PaymentProcessing
   - Service: Dynamic-Step-Service-PaymentProcessing (linked)
```

### DQL Query to Verify:
```dql
fetch dt.entity.service
| filter entity.name contains "Dynamic-Step-Service"
| fields entity.name, runs_on_process_group
```

Should show multiple unique services.

## Current Code Status

The code already sets these environment variables:
- ✅ `DT_SERVICE_NAME`
- ✅ `DT_PROCESS_GROUP_NAME`  
- ✅ `DT_LOGICAL_SERVICE_NAME`
- ✅ `process.title`
- ✅ `process.argv[0]`

**The issue is timing** - they're set after OneAgent starts monitoring.

## Recommended Implementation Order

1. **Start with Option 1** (Custom Service Detection Rules) - No code changes, works immediately
2. **If still issues**, add Option 2 (Process Group Metadata verification)
3. **For production**, implement Option 3 (Launch scripts)

## Quick Fix (5 Minutes)

**In Dynatrace UI:**
```
Settings → Server-side service monitoring → Service detection rules

Click: "Add detection rule"

Name: BizObs Dynamic Services

Detection conditions:
- Rule applies to: Process groups matching
- Process group name: contains "Dynamic-Step-Service"

Service name:
- Service name rule: Use process group name
  OR
- Extract from format: Dynamic-Step-Service-{ServiceName}
  
Save and restart affected processes (optional - can wait 5 minutes for auto-detection)
```

## Testing

After configuring, run a journey:

```bash
# 1. Generate a journey
# 2. Run simulation
# 3. Wait 2-3 minutes
# 4. Check Dynatrace Services

# You should see:
Services:
  ├─ Dynamic-Step-Service-CustomerVerification
  ├─ Dynamic-Step-Service-PaymentProcessing  
  ├─ Dynamic-Step-Service-InventoryCheck
  └─ Dynamic-Step-Service-OrderConfirmation
```

Each with separate metrics, requests, and business events!

---

**Need Help?**
- Check server logs: `tail -f logs/server.log | grep "Service identity"`
- Verify env vars: Add to service code: `console.log('DT_SERVICE_NAME:', process.env.DT_SERVICE_NAME)`
- Dynatrace debug: Enable OneAgent debug logging
