# Dynatrace Service Name Splitting Issue

## Problem Statement

All child services (PackageSelectionService, EligibilityCheckService, etc.) appear in Dynatrace with the **same service name** (bizobs-generator or main server name) instead of their individual service names. They split correctly by **process group** names, but Dynatrace's newer releases can't use process groups for service splitting anymore.

## Technical Background

### How Dynatrace Detects Service Names

Dynatrace OneAgent uses multiple methods to detect service names, in order of priority:

1. **Environment Variables** (highest priority):
   - `DT_SERVICE_NAME`
   - `DYNATRACE_SERVICE_NAME`
   - `DT_LOGICAL_SERVICE_NAME`
   - `RUXIT_APPLICATION_ID` (legacy)

2. **Node.js Specific**:
   - `NODEJS_APP_NAME`
   - Package.json `name` field
   - Main script filename

3. **Process Detection**:
   - Process title (set via `--title=ServiceName`)
   - Command line arguments
   - Process group detection

4. **Automatic Detection** (lowest priority):
   - Port-based detection
   - Framework detection (Express.js, etc.)
   - Hostname/container name

### What Changed in Recent Dynatrace Versions

**Old Behavior (Pre-2025)**:
- Process groups could be used for service splitting
- Multiple processes with different `DT_PROCESS_GROUP_NAME` → Multiple services

**New Behavior (2025+)**:
- Process group splitting deprecated
- Service detection relies more heavily on `DT_SERVICE_NAME` and related variables
- Process groups used only for organization, not service identity

## Current Implementation

Our service-manager.js sets comprehensive Dynatrace variables for each child service:

```javascript
// From /home/ec2-user/BizObs Generator/services/service-manager.js
// Lines 222-257

const child = spawn('node', [`--title=${dynatraceServiceName}`, scriptPath, dynatraceServiceName], {
  env: { 
    ...process.env, 
    SERVICE_NAME: dynatraceServiceName,
    PORT: port,
    COMPANY_NAME: companyName,
    DOMAIN: domain,
    INDUSTRY_TYPE: industryType,
    
    // Dynatrace service identification
    DT_SERVICE_NAME: dynatraceServiceName,
    DYNATRACE_SERVICE_NAME: dynatraceServiceName,
    DT_LOGICAL_SERVICE_NAME: dynatraceServiceName,
    NODEJS_APP_NAME: dynatraceServiceName,
    
    // Process group identification
    DT_PROCESS_GROUP_NAME: dynatraceServiceName,
    DT_PROCESS_GROUP_INSTANCE: `${dynatraceServiceName}-${port}`,
    
    // Application context
    DT_APPLICATION_NAME: 'BizObs-CustomerJourney',
    DT_CLUSTER_ID: dynatraceServiceName,
    DT_NODE_ID: `${dynatraceServiceName}-node`,
    
    // Tags
    DT_TAGS: `company=${companyName} app=bizobs-journey service=${dynatraceServiceName}`,
    
    // Release information
    DT_RELEASE_PRODUCT: 'BizObs-Engine',
    DT_RELEASE_STAGE: 'production',
    
    // Legacy overrides
    RUXIT_APPLICATION_ID: dynatraceServiceName,
    RUXIT_APPLICATIONID: dynatraceServiceName,
    RUXIT_PROCESS_GROUP: dynatraceServiceName,
    DT_APPLICATIONID: dynatraceServiceName,
    DT_APPLICATION_ID: dynatraceServiceName,
    DT_WEB_APPLICATION_ID: dynatraceServiceName,
    DT_SERVICE_DETECTION_FULL_NAME: dynatraceServiceName,
    DT_SERVICE_DETECTION_RULE_NAME: dynatraceServiceName
  }
});
```

## Verification Steps

### 1. Check Environment Variables in Child Process

```bash
# Find a child service process
ps aux | grep PackageSelectionService | grep -v grep

# Check its environment (replace PID with actual)
cat /proc/<PID>/environ | tr '\0' '\n' | grep -E "DT_|DYNATRACE_|RUXIT_|NODEJS_"
```

**Expected Output:**
```
DT_SERVICE_NAME=PackageSelectionService
DYNATRACE_SERVICE_NAME=PackageSelectionService
DT_LOGICAL_SERVICE_NAME=PackageSelectionService
NODEJS_APP_NAME=PackageSelectionService
DT_PROCESS_GROUP_NAME=PackageSelectionService
```

### 2. Check OneAgent Service Detection

In Dynatrace:
1. Go to **Services**
2. Search for "PackageSelection" or "EligibilityCheck"
3. Check if separate services exist or all under one service

**Current State**: All services appear as single service (bizobs-generator)
**Desired State**: 6+ separate services (PackageSelectionService, EligibilityCheckService, etc.)

### 3. Check Process Groups

In Dynatrace:
1. Go to **Hosts** → Select your host
2. Go to **Process Groups** tab
3. Check if separate process groups exist

**Current State**: ✅ Separate process groups exist
**Issue**: Process groups no longer create separate services in new Dynatrace versions

## Potential Solutions

### Solution 1: Service Detection Rules (Dynatrace Settings)

**Location**: Settings → Server-side service monitoring → Service detection rules

**Create Rule**:
- **Detection type**: Process group detection
- **Process group name**: Contains "Service" (matches PackageSelectionService, etc.)
- **Service naming**: Use process property → `DT_SERVICE_NAME`

**Pros**: 
- No code changes needed
- Centralized configuration

**Cons**:
- Requires Dynatrace admin access
- Manual setup per environment

### Solution 2: Separate OneAgent Instances Per Service

**Approach**: Install separate OneAgent in each child process directory

**Implementation**:
```javascript
// In service spawn
env: {
  DT_HOME: `/opt/dynatrace/oneagent-${dynatraceServiceName}`,
  LD_PRELOAD: `/opt/dynatrace/oneagent-${dynatraceServiceName}/agent/lib64/liboneagentproc.so`
}
```

**Pros**: 
- Complete service isolation
- Guaranteed separate service detection

**Cons**:
- Complex setup
- Resource overhead (multiple OneAgent processes)
- Not practical for dynamic services

### Solution 3: Use package.json for Each Service

**Approach**: Create separate package.json in each service directory

**Implementation**:
```bash
# For each service
mkdir -p services/PackageSelectionService
cat > services/PackageSelectionService/package.json << EOF
{
  "name": "PackageSelectionService",
  "version": "1.0.0",
  "description": "Package Selection Service"
}
EOF
```

**Update spawn**:
```javascript
const child = spawn('node', [scriptPath], {
  cwd: `/path/to/services/${dynatraceServiceName}`,
  env: { ... }
});
```

**Pros**:
- OneAgent automatically reads package.json name
- Standard Node.js convention

**Cons**:
- Multiple package.json files to maintain
- Service scripts need to be in separate directories

### Solution 4: OneAgent API - Service Override

**Approach**: Use OneAgent SDK to programmatically set service name

**Implementation**:
```javascript
// Install OneAgent SDK
// npm install @dynatrace/oneagent-sdk

// In each service's main code
const sdk = require('@dynatrace/oneagent-sdk');
const api = sdk.createInstance();

api.setServiceName('PackageSelectionService');
```

**Pros**:
- Programmatic control
- No environment dependency

**Cons**:
- Requires SDK installation
- Code changes in each service
- SDK overhead

### Solution 5: HTTP Headers for Service Detection

**Approach**: Add custom headers that Dynatrace uses for service detection

**Implementation**:
```javascript
// In Express app setup for each service
app.use((req, res, next) => {
  res.setHeader('X-Dynatrace-Service-Name', process.env.DT_SERVICE_NAME);
  next();
});
```

**Pros**:
- Simple implementation
- No external dependencies

**Cons**:
- Only works for HTTP-based services
- May not be reliable for service naming

## Recommended Solution

**Primary: Solution 1 (Service Detection Rules)**
- Quickest to implement
- No code changes
- Leverages existing process group separation

**Backup: Solution 3 (Separate package.json)**
- Standards-compliant
- Works with default OneAgent behavior
- Future-proof

## Implementation Steps for Solution 1

### 1. Access Dynatrace Settings

```
https://YOUR_TENANT.apps.dynatrace.com/ui/settings/builtin:service-detection-full-web-request
```

### 2. Create Detection Rule

**Rule Name**: BizObs Child Services Detection

**Conditions**:
- Process group name → Contains → "Service"
- OR Process group name → Matches regex → `.*Service$`

**Service Name**:
- Use process property → `DT_SERVICE_NAME`
- Fallback: Use process group name

**Apply to**:
- Technology: Node.js
- Host group: (Your host group or "All")

### 3. Restart Services

```bash
cd "/home/ec2-user/BizObs Generator"
pkill -f "Service" # Kill child services
pkill -f "node server.js" # Kill main server
node server.js # Restart (child services restart automatically)
```

### 4. Verify in Dynatrace

Wait 5-10 minutes for Dynatrace to detect services, then check:
```
Services → Filter by "PackageSelection"
```

Expected: See separate services like:
- PackageSelectionService
- EligibilityCheckService
- OrderPlacementService
- etc.

## Alternative: Manual Service Naming Override

If automatic detection fails, use Dynatrace's manual service naming rules:

**Settings → Service naming rules**

**Rule**:
```
{dt.process_group_name}
```

This will use the process group name as the service name directly.

## Troubleshooting

### Issue: Services still appear as one
**Check**: 
```bash
# Verify DT_SERVICE_NAME is set correctly
ps aux | grep PackageSelectionService
cat /proc/<PID>/environ | tr '\0' '\n' | grep DT_SERVICE_NAME
```

### Issue: OneAgent not reading environment variables
**Fix**: Ensure OneAgent is installed and active:
```bash
sudo /opt/dynatrace/oneagent/agent/tools/lib64/oneagentctl --get-server-info
```

### Issue: Process groups correct but services not split
**Fix**: Apply Solution 1 (Service Detection Rules) in Dynatrace UI

## References

- [Dynatrace Service Detection Documentation](https://www.dynatrace.com/support/help/platform-modules/infrastructure-monitoring/process-groups/service-detection-rules)
- [OneAgent Environment Variables](https://www.dynatrace.com/support/help/setup-and-configuration/setup-on-cloud-platforms/google-cloud-platform/google-app-engine/deploy-oneagent-on-google-app-engine/oneagent-environment-variables)
- [Node.js Service Naming](https://www.dynatrace.com/support/help/technology-support/application-software/node-js/support/node-js-service-naming)

---

**Status**: ⚠️ In Progress - Services split by process group but not by service name
**Next Action**: Apply Service Detection Rule in Dynatrace UI
**Date**: February 11, 2026
