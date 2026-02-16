# Socket Hang Up Error - Root Cause Analysis & Fix

## Problem Summary
Journey simulations were failing with "socket hang up" errors for ALL services across both BT and Banking journeys. The error appeared as:

```json
{
  "status": "failed",
  "error": "Connection error to PackageSelection: socket hang up",
  "errorType": "connection_error",
  "httpStatus": 503
}
```

## Root Cause Analysis

### Discovery Process
1. **Initial Investigation**: Services appeared to be running (ps showed PIDs) and health checks succeeded (`curl localhost:8100/health` returned 200 OK)
2. **Attempted Direct Call**: Testing `/process` endpoint directly with curl **hung indefinitely** - the service never responded
3. **Log Analysis**: Services were crashing with `ReferenceError: flattenedData is not defined`
4. **Code Review**: Found two critical bugs in the service architecture

### Bug #1: Missing MAIN_SERVER_PORT Environment Variable
**Location**: [services/service-manager.js](services/service-manager.js)

**Problem**: 
- Child services need to call back to the main server at `/api/admin/ensure-service` to coordinate the next step in a journey chain
- Services were hardcoded to use port `4000` as default: `const adminPort = process.env.MAIN_SERVER_PORT || '4000';`
- Main server actually runs on port `8080`
- HTTP requests to wrong port would hang/timeout, causing service to never respond to original journey request

**Evidence**:
```javascript
// In dynamic-step-service.cjs line 418:
const adminPort = process.env.MAIN_SERVER_PORT || '4000';  // ❌ Wrong default port!
nextServicePort = await new Promise((resolve, reject) => {
  const req = http.request({ 
    hostname: '127.0.0.1', 
    port: adminPort,  // This was calling port 4000 instead of 8080!
    path: '/api/admin/ensure-service', 
    method: 'POST'
  }, ...);
});
```

**Fix Applied**:
Added `MAIN_SERVER_PORT = '8080'` to both:
1. Wrapper file generation (line 417 of service-manager.js)
2. Child process spawn environment (line 223 of service-manager.js)

```javascript
// In wrapper generation:
`process.env.PORT = ${JSON.stringify(String(allocatedPort))};\n` +
`process.env.MAIN_SERVER_PORT = '8080';\n` +  // ✅ Added this line

// In startChildService env vars:
CATEGORY: env.CATEGORY || 'general',
MAIN_SERVER_PORT: '8080',  // ✅ Added this line
```

### Bug #2: Undefined flattenedData Variable
**Location**: [services/dynamic-step-service.cjs](services/dynamic-step-service.cjs) line 33

**Problem**:
- `sendBusinessEvent()` function referenced undefined variable `flattenedData`
- Function received `data` parameter but never used it
- When service tried to generate business event, it crashed immediately with `ReferenceError`
- Crash prevented service from sending HTTP response, causing "socket hang up" on caller side

**Evidence**:
```javascript
// BEFORE (broken):
const sendBusinessEvent = (eventType, data) => {
  console.log('[dynatrace] Business event:', eventType, data);
  
  // Log flattened fields separately
  Object.keys(flattenedData).forEach(key => {  // ❌ flattenedData not defined!
    console.log(`[bizevent-field] ${key}=${flattenedData[key]}`);
  });
  ...
}
```

**Log Evidence**:
```
[PackageSelectionService][ERR] ReferenceError: flattenedData is not defined
[PackageSelectionService][ERR]     at sendBusinessEvent (/home/ec2-user/BizObs Generator/services/dynamic-step-service.cjs:33:15)
[PackageSelectionService][ERR]     at Timeout.finish [as _onTimeout] (/home/ec2-user/BizObs Generator/services/dynamic-step-service.cjs:339:9)
[journey-sim] Request error to PackageSelection on port 8097: socket hang up
[PackageSelectionService] exited with code 1
```

**Fix Applied**:
Added proper data flattening logic before using the variable:

```javascript
// AFTER (fixed):
const sendBusinessEvent = (eventType, data) => {
  console.log('[dynatrace] Business event:', eventType, data);
  
  // Simple flattening of data for logging
  const flattenedData = {};  // ✅ Now properly defined
  const flatten = (obj, prefix = '') => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        flatten(value, newKey);
      } else if (value !== null && value !== undefined) {
        flattenedData[newKey] = String(value);
      }
    });
  };
  flatten(data);  // ✅ Flatten the input data
  
  // Now safe to use flattenedData
  Object.keys(flattenedData).forEach(key => {
    if (key.startsWith('additional.') || key.startsWith('customer.') || ...) {
      console.log(`[bizevent-field] ${key}=${flattenedData[key]}`);
    }
  });
  ...
}
```

## Impact Chain

```
Missing MAIN_SERVER_PORT → Service calls port 4000 → Connection hangs
                         ↘
                          Service never responds to /process
                         ↗                              ↓
Undefined flattenedData → Service crashes           Journey-sim times out
                                                         ↓
                                                   "socket hang up" error
```

## Verification

### Before Fix:
```bash
$ curl -s -X POST http://localhost:8080/api/journey-simulation/simulate-journey \
  -H "Content-Type: application/json" \
  -d '{"journey":{"companyName":"TestCo","steps":[{"stepName":"PackageSelection"}]}}' 

# Response:
{
  "journey": {
    "steps": [{
      "status": "failed",
      "error": "Connection error to PackageSelection: socket hang up",
      "errorType": "connection_error"
    }]
  }
}
```

### After Fix:
```bash
$ curl -s -X POST http://localhost:8080/api/journey-simulation/simulate-journey \
  -H "Content-Type: application/json" \
  -d '{"journey":{"companyName":"TestCo","steps":[{"stepName":"PackageSelection"}]}}' 

# Response:
{
  "journey": {
    "status": "completed",
    "steps": [{
      "stepName": "PackageSelection",
      "status": "completed",
      "httpStatus": 200,
      "processingTime": 189,
      "service": "PackageSelectionService"
    }]
  }
}
```

## Files Modified

1. **[services/service-manager.js](services/service-manager.js)**
   - Line 417: Added `MAIN_SERVER_PORT` to wrapper generation
   - Line 223: Added `MAIN_SERVER_PORT` to child process environment

2. **[services/dynamic-step-service.cjs](services/dynamic-step-service.cjs)**
   - Lines 26-44: Fixed `sendBusinessEvent()` function with proper data flattening

## Testing Performed

1. ✅ Single-step journey simulation (TestCo)
2. ✅ Multi-step journey simulation (BT with 2-3 steps)
3. ✅ Service health checks continue to work
4. ✅ Service /process endpoint now responds without hanging
5. ✅ Business events generate without crashing services

## Next Steps

With journey simulations now working:
1. **LoadRunner Service** can now be tested - it depends on successful journey simulations
2. **Bizevent generation** should be verified for all 6 journey steps
3. **Dynatrace service naming** still requires Dynatrace UI configuration (separate issue documented in DYNATRACE-SERVICE-NAMING-ISSUE.md)
4. **Dashboard generation** may need testing after successful journeys

## Related Issues

- **Circuit Breaker False Positives**: The circuit breaker was triggering because of these underlying bugs. With fixes in place, circuit breaker threshold can be returned to normal (5) from temporary debug value (1000).
- **Service Naming in Dynatrace**: Still shows as single service instead of split by company. Requires Service Detection Rules in Dynatrace UI (see DYNATRACE-SERVICE-NAMING-ISSUE.md).

## Lessons Learned

1. **Port Configuration**: Always ensure child services know the main server port, especially when they need to call back
2. **Error Masking**: "Socket hang up" errors can mask underlying service crashes - always check service logs directly
3. **Variable Scope**: Referencing undefined variables in Node.js causes immediate crashes, not graceful errors
4. **Debugging Strategy**: When health checks pass but actual endpoints hang, the issue is often in the endpoint handler logic, not the network/ports
