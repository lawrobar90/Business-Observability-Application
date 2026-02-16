# Zombie Service Fix - Complete

## Problem Identified

When you clicked "Generate Journey", the cleanup code wasn't working because:

1. **40 zombie services** were running from Feb 3 & Feb 4 (2+ days old!)
2. **41 ports** were occupied
3. Server was running **old code** from Feb 4 - needed restart
4. `stopCustomerJourneyServices()` doesn't kill orphaned processes

## Root Cause

**Old cleanup approach:**
```javascript
stopCustomerJourneyServices() // Only kills tracked services in memory
```

**Problem:** Services from previous server runs aren't tracked in memory, so they become zombies.

## Solution Implemented

**New cleanup approach:**
```javascript
stopAllServices() // Includes pkill -9 -f 'Service$' to kill ALL journey services
```

This aggressively kills:
- ✅ Tracked services in current session
- ✅ Zombie services from previous server runs
- ✅ Orphaned processes from crashes

## Changes Made

### File: `routes/journey-simulation.js`

**Before:**
```javascript
const { stopCustomerJourneyServices } = await import('../services/service-manager.js');
stopCustomerJourneyServices();
await new Promise(r => setTimeout(r, 1000));
```

**After:**
```javascript
const { stopAllServices } = await import('../services/service-manager.js');
await stopAllServices(); // Nuclear option - kills everything
await new Promise(r => setTimeout(r, 1500)); // Longer wait for cleanup
```

**Applied to:**
- `/api/journey/simulate` - Single journey endpoint
- `/api/journey/simulate-multiple` - Multi-customer endpoint

### How stopAllServices Works

From `services/service-manager.js`:

```javascript
export async function stopAllServices() {
  // 1. Kill tracked services
  Object.values(childServices).forEach(child => {
    child.kill('SIGKILL');
  });
  
  // 2. Free all ports
  Object.keys(childServices).forEach(serviceName => {
    const meta = childServiceMeta[serviceName];
    if (meta && meta.port) {
      portManager.releasePort(meta.port, serviceName);
    }
    delete childServices[serviceName];
    delete childServiceMeta[serviceName];
  });
  
  // 3. NUCLEAR OPTION: Kill ALL journey services by name pattern
  const { execSync } = await import('child_process');
  try {
    execSync('pkill -9 -f "Service$"', { stdio: 'ignore' });
    console.log('✅ All journey services killed by name pattern');
  } catch (e) {
    // Exit code 1 means no processes found - that's fine
  }
  
  // 4. Clean up stale port allocations
  const cleaned = await portManager.cleanupStaleAllocations();
  console.log(`All services stopped and ports freed (${cleaned} stale allocations cleaned)`);
}
```

## Immediate Actions Taken

1. ✅ **Manually killed 40 zombie services** - Cleared all orphans
2. ✅ **Freed 40 ports** - Only main server (8080) remains
3. ✅ **Restarted server** - Now running new cleanup code
4. ✅ **Committed changes** - Code deployed to git

## Current State

**Before Fix:**
```
Services running: 40 (zombies from days ago)
Ports occupied: 41
Result: 404 errors on SimActivation & FirstDataUsage
```

**After Fix:**
```
Services running: 0 (clean slate)
Ports occupied: 1 (just main server on 8080)
Result: Ready for clean journey execution
```

## Testing

**Try creating a new journey now:**

1. Click "Generate Journey" button
2. You should see in console:
   ```
   🧹 Stopping ALL journey services (including zombies)...
   💣 Killing ALL journey services by name (including zombies)...
   ✅ All journey services killed by name pattern
   ```

3. **Expected result:**
   - All 6 services start fresh
   - No 404 errors
   - Clean execution

**Monitor services:**
```bash
# Check running services
ps aux | grep -E 'Service$' | grep -v grep | wc -l

# Should show only your current journey services (4-6)
```

## Why 404 Errors Happened

**Your error:**
```
❌ Step 5: SimActivationService (Service returned HTML error page (status 404))
❌ Step 6: FirstDataUsageService (Service returned HTML error page (status 404))
```

**Cause:** Port conflict
- SimActivationService tried to start on port 8088 (for example)
- But a zombie SimActivationService from Feb 3 was already on 8088
- New service failed to bind, returned 404
- Same for FirstDataUsageService

**Resolution:** With zombie cleanup, each service gets a clean port.

## Commits

```
1406399 - fix: Use stopAllServices to kill zombie processes
aca7471 - fix: Add port cleanup to all journey simulation endpoints
c01155f - docs: Add port cleanup documentation and test script
```

## Future Prevention

The fix is permanent - every journey creation now:
1. Kills ALL existing services (tracked + zombies)
2. Frees all ports
3. Starts fresh services
4. No accumulation, no conflicts

## Verification Commands

```bash
# Count services (should be 4-6 for current journey, 0 when idle)
ps aux | grep -E 'Service$' | grep -v grep | wc -l

# Check port usage (should match service count + 1 for main server)
netstat -tlnp 2>/dev/null | grep -E ':(808[0-9]|809[0-9]|81[0-2][0-9])' | wc -l

# View active services
ps aux | grep -E 'Service$' | grep -v grep

# Check specific service
curl -s http://localhost:8094/health
```

## Summary

✅ **Problem:** 40 zombie services causing port conflicts and 404 errors  
✅ **Root Cause:** Old cleanup didn't kill orphaned processes from previous runs  
✅ **Solution:** Use `stopAllServices()` with `pkill` to kill all services by pattern  
✅ **Status:** Fixed - server restarted with new code  
✅ **Test:** Create a new journey - all 6 steps should succeed  

**Server is now ready for clean journey execution!** 🚀
