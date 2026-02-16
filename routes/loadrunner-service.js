import express from 'express';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
const router = express.Router();

// Feature flag config cache - refreshed periodically from the API
let _featureFlagCache = { regenerate_every_n_transactions: 100 };

function globalFeatureFlagConfig() {
  return _featureFlagCache;
}

// Refresh the feature flag cache every 30 seconds
setInterval(() => {
  const req = http.request({
    hostname: 'localhost',
    port: process.env.MAIN_SERVER_PORT || 8080,
    path: '/api/feature_flag',
    method: 'GET',
    timeout: 5000
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.flags) _featureFlagCache = parsed.flags;
      } catch (e) { /* ignore parse errors */ }
    });
  });
  req.on('error', () => { /* ignore */ });
  req.end();
}, 30000);

// Active load tests in memory
const activeLoadTests = new Map();

/**
 * Start a load test using journey data from UI
 * This replaces the old static test-config.json approach
 */
router.post('/start', (req, res) => {
  const { journey, ratePerMinute = 2, duration } = req.body;
  
  if (!journey || !journey.steps || journey.steps.length === 0) {
    return res.status(400).json({ 
      error: 'Invalid journey data. Must include journey.steps array.' 
    });
  }
  
  const loadTestId = `load_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const companyName = journey.companyName || 'Unknown';
  
  console.log(`[LoadRunner] Starting load test ${loadTestId} for ${companyName}`);
  console.log(`[LoadRunner] Rate: ${ratePerMinute} requests/minute`);
  console.log(`[LoadRunner] Journey: ${journey.steps.length} steps`);
  
  // Calculate interval in ms
  const intervalMs = Math.floor(60000 / ratePerMinute);
  
  // Customer profiles for diversity
  const customerProfiles = [
    { name: 'Alice Thompson', tier: 'Gold', segment: 'Premium' },
    { name: 'Bob Martinez', tier: 'Silver', segment: 'Standard' },
    { name: 'Carol Chen', tier: 'Platinum', segment: 'VIP' },
    { name: 'David Kumar', tier: 'Bronze', segment: 'Basic' },
    { name: 'Emma Wilson', tier: 'Platinum', segment: 'VIP' },
    { name: 'Frank Rodriguez', tier: 'Silver', segment: 'Standard' },
    { name: 'Grace Park', tier: 'Gold', segment: 'Premium' },
    { name: 'Henry Lee', tier: 'Bronze', segment: 'Basic' }
  ];
  
  // Priority levels for diversity
  const priorities = ['Critical', 'High', 'Medium', 'Low'];
  
  let iterationCount = 0;
  let successCount = 0;
  let errorCount = 0;
  
  // Track feature flag toggle for this test
  let errorsCurrentlyEnabled = true;
  
  // Main load generation loop
  const intervalId = setInterval(async () => {
    iterationCount++;
    
    // 🚦 Feature Flag Toggle: Every N transactions, flip the error injection
    const triggerThreshold = globalFeatureFlagConfig().regenerate_every_n_transactions || 100;
    if (iterationCount > 0 && iterationCount % triggerThreshold === 0) {
      errorsCurrentlyEnabled = !errorsCurrentlyEnabled;
      const flagAction = errorsCurrentlyEnabled ? 'enabled' : 'disabled';
      
      console.log(`\n🚦 [LoadRunner] ═══════════════════════════════════════════`);
      console.log(`🚦 [LoadRunner] FEATURE FLAG TOGGLE at iteration ${iterationCount}`);
      console.log(`🚦 [LoadRunner] Error injection now: ${flagAction.toUpperCase()}`);
      console.log(`🚦 [LoadRunner] Company: ${companyName}`);
      console.log(`🚦 [LoadRunner] ═══════════════════════════════════════════\n`);
      
      // Toggle the global feature flag
      try {
        const flagPayload = JSON.stringify({
          flags: { errors_per_transaction: errorsCurrentlyEnabled ? 0.1 : 0 }
        });
        
        const flagReq = http.request({
          hostname: 'localhost',
          port: process.env.MAIN_SERVER_PORT || 8080,
          path: '/api/feature_flag',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(flagPayload)
          }
        }, (flagRes) => {
          let data = '';
          flagRes.on('data', chunk => data += chunk);
          flagRes.on('end', () => {
            console.log(`🚦 [LoadRunner] Feature flag API response: ${flagRes.statusCode}`);
          });
        });
        flagReq.on('error', (err) => console.error(`🚦 [LoadRunner] Feature flag toggle error:`, err.message));
        flagReq.write(flagPayload);
        flagReq.end();
      } catch (err) {
        console.error(`🚦 [LoadRunner] Feature flag toggle failed:`, err.message);
      }
      
      // Send Dynatrace deployment event for the feature flag change
      try {
        const eventPayload = JSON.stringify({
          eventType: 'CUSTOM_DEPLOYMENT',
          title: `Feature Flag: error_injection ${flagAction}`,
          timeout: 15,
          properties: {
            'deployment.name': `Feature Flag: error_injection ${flagAction}`,
            'deployment.version': new Date().toISOString(),
            'deployment.source': 'LoadRunner',
            'feature.flag': 'error_injection',
            'feature.flag.value': flagAction,
            'triggered.by': 'LoadRunner',
            'trigger.reason': `Iteration threshold ${triggerThreshold} reached (iteration ${iterationCount})`,
            'company': companyName,
            'errors_per_transaction': errorsCurrentlyEnabled ? '0.1' : '0'
          }
        });
        
        const DT_ENV = process.env.DT_ENVIRONMENT || process.env.DYNATRACE_URL;
        const DT_TOKEN = process.env.DT_PLATFORM_TOKEN || process.env.DYNATRACE_TOKEN;
        
        if (DT_ENV && DT_TOKEN) {
          const dtUrl = new URL(`${DT_ENV}/api/v2/events/ingest`);
          const transport = dtUrl.protocol === 'https:' ? https : http;
          const dtReq = transport.request({
            hostname: dtUrl.hostname,
            port: dtUrl.port || (dtUrl.protocol === 'https:' ? 443 : 80),
            path: dtUrl.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Api-Token ${DT_TOKEN}`,
              'Content-Length': Buffer.byteLength(eventPayload)
            }
          }, (dtRes) => {
            console.log(`🚦 [LoadRunner] Dynatrace deployment event sent: ${dtRes.statusCode}`);
          });
          dtReq.on('error', (err) => console.error(`🚦 [LoadRunner] Dynatrace event error:`, err.message));
          dtReq.write(eventPayload);
          dtReq.end();
        } else {
          console.log(`🚦 [LoadRunner] No Dynatrace credentials - skipping deployment event`);
        }
      } catch (err) {
        console.error(`🚦 [LoadRunner] Dynatrace event failed:`, err.message);
      }
    }
    
    // Generate unique journey ID
    const journeyId = `lr_journey_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const correlationId = crypto.randomUUID();
    
    // Pick random customer and priority for diversity
    const customer = customerProfiles[Math.floor(Math.random() * customerProfiles.length)];
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    
    // Build payload matching UI's structure
    const payload = {
      journey: {
        ...journey,
        journeyId,
        correlationId,
        journeyStartTime: new Date().toISOString()
      },
      customerProfile: {
        userId: `user_${companyName.toLowerCase()}_${iterationCount}`,
        customerName: customer.name,
        email: `${customer.name.toLowerCase().replace(/\s+/g, '.')}@${journey.domain || 'example.com'}`,
        userSegment: customer.segment,
        loyaltyTier: customer.tier
      },
      traceMetadata: {
        correlationId,
        sessionId: `session_${companyName}_${Date.now()}`,
        businessContext: {
          campaignSource: 'LoadRunner',
          customerSegment: customer.segment,
          priority
        }
      },
      chained: false,  // Changed to false - orchestrator calls all steps sequentially, each generates bizevent
      thinkTimeMs: 250,
      errorSimulationEnabled: errorsCurrentlyEnabled,
      loadRunnerTest: true
    };
    
    // Make HTTP request to journey simulation
    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: process.env.MAIN_SERVER_PORT || 8080,
      path: '/api/journey-simulation/simulate-journey',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-loadrunner-test': 'true',
        'x-load-test-id': loadTestId,
        'x-correlation-id': correlationId
      },
      timeout: 60000
    };
    
    const req = http.request(options, (httpRes) => {
      let data = '';
      httpRes.on('data', chunk => data += chunk);
      httpRes.on('end', () => {
        if (httpRes.statusCode === 200) {
          successCount++;
          console.log(`[LoadRunner] ✅ ${journeyId} - ${customer.name} (${customer.tier}) - ${priority} - Success ${successCount}/${iterationCount}`);
        } else {
          errorCount++;
          console.error(`[LoadRunner] ❌ ${journeyId} - Error ${httpRes.statusCode}`);
        }
      });
    });
    
    req.on('error', (err) => {
      errorCount++;
      console.error(`[LoadRunner] ❌ ${journeyId} - Request error:`, err.message);
    });
    
    req.on('timeout', () => {
      errorCount++;
      console.error(`[LoadRunner] ⏱️ ${journeyId} - Timeout`);
      req.destroy();
    });
    
    req.write(postData);
    req.end();
    
  }, intervalMs);
  
  // Store load test info
  const loadTest = {
    id: loadTestId,
    journey,
    companyName,
    ratePerMinute,
    intervalMs,
    intervalId,
    startTime: new Date().toISOString(),
    duration,
    getStats: () => ({ iterationCount, successCount, errorCount })
  };
  
  activeLoadTests.set(loadTestId, loadTest);
  
  // Auto-stop after duration if specified
  if (duration) {
    setTimeout(() => {
      stopLoadTest(loadTestId);
    }, duration * 1000);
  }
  
  res.json({
    success: true,
    loadTestId,
    companyName,
    ratePerMinute,
    message: `Load test started for ${companyName}`,
    stepsCount: journey.steps.length
  });
});

/**
 * Stop a running load test
 */
router.post('/stop', (req, res) => {
  const { loadTestId } = req.body;
  
  if (!loadTestId) {
    return res.status(400).json({ error: 'loadTestId required' });
  }
  
  const stopped = stopLoadTest(loadTestId);
  
  if (stopped) {
    res.json({
      success: true,
      message: `Load test ${loadTestId} stopped`,
      stats: stopped.stats
    });
  } else {
    res.status(404).json({ error: 'Load test not found' });
  }
});

/**
 * Get status of all load tests
 */
router.get('/status', (req, res) => {
  const tests = [];
  
  for (const [id, test] of activeLoadTests.entries()) {
    const stats = test.getStats();
    const runtime = Math.floor((Date.now() - new Date(test.startTime).getTime()) / 1000);
    
    tests.push({
      id,
      companyName: test.companyName,
      ratePerMinute: test.ratePerMinute,
      startTime: test.startTime,
      runtime,
      stepsCount: test.journey.steps.length,
      iterations: stats.iterationCount,
      success: stats.successCount,
      errors: stats.errorCount,
      successRate: stats.iterationCount > 0 ? 
        ((stats.successCount / stats.iterationCount) * 100).toFixed(2) + '%' : 'N/A'
    });
  }
  
  res.json({
    activeTests: tests.length,
    tests
  });
});

/**
 * Stop all load tests
 */
router.post('/stop-all', (req, res) => {
  const stoppedCount = activeLoadTests.size;
  
  for (const loadTestId of activeLoadTests.keys()) {
    stopLoadTest(loadTestId);
  }
  
  res.json({
    success: true,
    message: `Stopped ${stoppedCount} load test(s)`
  });
});

// Helper function to stop a load test
function stopLoadTest(loadTestId) {
  const test = activeLoadTests.get(loadTestId);
  
  if (!test) {
    return null;
  }
  
  clearInterval(test.intervalId);
  activeLoadTests.delete(loadTestId);
  
  const stats = test.getStats();
  const runtime = Math.floor((Date.now() - new Date(test.startTime).getTime()) / 1000);
  
  console.log(`[LoadRunner] Stopped load test ${loadTestId} for ${test.companyName}`);
  console.log(`[LoadRunner] Runtime: ${runtime}s, Iterations: ${stats.iterationCount}, Success: ${stats.successCount}, Errors: ${stats.errorCount}`);
  
  return { test, stats };
}

export default router;
