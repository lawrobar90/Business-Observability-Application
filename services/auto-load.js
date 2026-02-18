/**
 * Auto-Load Generator — Automatically generates 30-60 journeys/min
 * for every company with running services. Stops when services stop.
 *
 * No UI interaction needed — load starts/stops with service lifecycle.
 */

import http from 'http';
import crypto from 'crypto';
import { getChildServiceMeta } from './service-manager.js';

const APP_PORT = process.env.PORT || 8080;

// Active auto-load intervals per company
const activeAutoLoads = new Map();

// Customer profiles for diversity
const CUSTOMER_PROFILES = [
  { name: 'Alice Thompson', tier: 'Gold', segment: 'Premium' },
  { name: 'Bob Martinez', tier: 'Silver', segment: 'Standard' },
  { name: 'Carol Chen', tier: 'Platinum', segment: 'VIP' },
  { name: 'David Kumar', tier: 'Bronze', segment: 'Basic' },
  { name: 'Emma Wilson', tier: 'Platinum', segment: 'VIP' },
  { name: 'Frank Rodriguez', tier: 'Silver', segment: 'Standard' },
  { name: 'Grace Park', tier: 'Gold', segment: 'Premium' },
  { name: 'Henry Lee', tier: 'Bronze', segment: 'Basic' },
  { name: 'Isabel Nguyen', tier: 'Gold', segment: 'Premium' },
  { name: 'James O\'Brien', tier: 'Silver', segment: 'Standard' }
];

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

/**
 * Build journey payload from running service metadata for a company
 */
function buildJourneyFromMeta(companyName, services) {
  const meta = Object.entries(services);
  if (meta.length === 0) return null;

  // Get first service's metadata for company-level info
  const firstMeta = meta[0][1];

  // Build steps array from running services (ordered by service name)
  const steps = meta.map(([serviceName, svcMeta], idx) => {
    // Extract step name from service name (remove "Service-Company" suffix)
    const baseName = serviceName.split('-')[0]; // e.g. "DigitalOnboardingService"
    const stepName = baseName.replace(/Service$/, '');

    return {
      stepIndex: idx + 1,
      stepName,
      serviceName: baseName,
      description: `${stepName} step for ${companyName}`,
      category: idx === 0 ? 'Acquisition' : idx === meta.length - 1 ? 'Revenue' : 'Fulfilment',
      estimatedDuration: Math.floor(Math.random() * 5) + 2,
      substeps: [
        { substepName: `${stepName}Step1`, duration: 2 },
        { substepName: `${stepName}Step2`, duration: 2 }
      ],
      hasError: false,
      errorSimulationConfig: {
        enabled: true,
        errorType: 'generic_error',
        httpStatus: 500,
        likelihood: 0.1,
        shouldSimulateError: false
      }
    };
  });

  return {
    companyName,
    domain: firstMeta.domain || `https://www.${companyName.toLowerCase().replace(/[^a-z]/g, '')}.com`,
    industryType: firstMeta.industryType || companyName,
    journeyType: firstMeta.journeyType || 'customer_journey',
    steps
  };
}

/**
 * Fire a single journey simulation request
 */
function fireJourney(journey, companyName, iterationCount) {
  const customer = CUSTOMER_PROFILES[Math.floor(Math.random() * CUSTOMER_PROFILES.length)];
  const priority = PRIORITIES[Math.floor(Math.random() * PRIORITIES.length)];
  const journeyId = `auto_journey_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const correlationId = crypto.randomUUID();

  const payload = {
    journey: {
      ...journey,
      journeyId,
      correlationId,
      journeyStartTime: new Date().toISOString()
    },
    customerProfile: {
      userId: `user_${companyName.toLowerCase().replace(/\s+/g, '_')}_${iterationCount}`,
      customerName: customer.name,
      email: `${customer.name.toLowerCase().replace(/\s+/g, '.')}@${journey.domain || 'example.com'}`,
      userSegment: customer.segment,
      loyaltyTier: customer.tier
    },
    traceMetadata: {
      correlationId,
      sessionId: `session_${companyName}_${Date.now()}`,
      businessContext: {
        campaignSource: 'AutoLoad',
        customerSegment: customer.segment,
        priority
      }
    },
    chained: false,
    thinkTimeMs: 250,
    errorSimulationEnabled: true,
    loadRunnerTest: true
  };

  const postData = JSON.stringify(payload);

  const req = http.request({
    hostname: '127.0.0.1',
    port: APP_PORT,
    path: '/api/journey-simulation/simulate-journey',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'x-auto-load': 'true',
      'x-correlation-id': correlationId
    },
    timeout: 60000
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const info = activeAutoLoads.get(companyName);
      if (info) {
        if (res.statusCode === 200) info.successCount++;
        else info.errorCount++;
      }
    });
  });

  req.on('error', () => {
    const info = activeAutoLoads.get(companyName);
    if (info) info.errorCount++;
  });

  req.on('timeout', () => req.destroy());
  req.write(postData);
  req.end();
}

/**
 * Start auto-load for a company
 */
function startAutoLoad(companyName, services) {
  if (activeAutoLoads.has(companyName)) return; // Already running

  const journey = buildJourneyFromMeta(companyName, services);
  if (!journey || journey.steps.length === 0) return;

  // Random rate between 30-60 per minute
  const ratePerMinute = Math.floor(Math.random() * 31) + 30; // 30-60
  const intervalMs = Math.floor(60000 / ratePerMinute);

  let iterationCount = 0;
  let successCount = 0;
  let errorCount = 0;

  const intervalId = setInterval(() => {
    // Double-check services are still running before firing
    const meta = getChildServiceMeta();
    const stillRunning = Object.values(meta).some(m => m.companyName === companyName);
    if (!stillRunning) {
      stopAutoLoad(companyName);
      return;
    }

    iterationCount++;
    fireJourney(journey, companyName, iterationCount);
  }, intervalMs);

  const info = {
    companyName,
    ratePerMinute,
    intervalMs,
    intervalId,
    startTime: new Date().toISOString(),
    stepsCount: journey.steps.length,
    get iterationCount() { return iterationCount; },
    successCount: 0,
    errorCount: 0,
    get successCount() { return successCount; },
    set successCount(v) { successCount = v; },
    get errorCount() { return errorCount; },
    set errorCount(v) { errorCount = v; }
  };

  activeAutoLoads.set(companyName, info);
  console.log(`⚡ [Auto-Load] Started for ${companyName}: ${ratePerMinute} journeys/min (${journey.steps.length} steps, interval ${intervalMs}ms)`);
}

/**
 * Stop auto-load for a company
 */
function stopAutoLoad(companyName) {
  const info = activeAutoLoads.get(companyName);
  if (!info) return;

  clearInterval(info.intervalId);
  activeAutoLoads.delete(companyName);
  console.log(`🛑 [Auto-Load] Stopped for ${companyName} (ran ${info.iterationCount} iterations, ${info.successCount} success, ${info.errorCount} errors)`);
}

/**
 * Stop all auto-loads
 */
export function stopAllAutoLoads() {
  for (const companyName of [...activeAutoLoads.keys()]) {
    stopAutoLoad(companyName);
  }
}

/**
 * Get status of all auto-loads
 */
export function getAutoLoadStatus() {
  const tests = [];
  for (const [companyName, info] of activeAutoLoads.entries()) {
    const runtime = Math.floor((Date.now() - new Date(info.startTime).getTime()) / 1000);
    tests.push({
      companyName,
      ratePerMinute: info.ratePerMinute,
      startTime: info.startTime,
      runtime,
      stepsCount: info.stepsCount,
      iterations: info.iterationCount,
      success: info.successCount,
      errors: info.errorCount
    });
  }
  return { activeTests: tests.length, tests };
}

// ──────────────────────────────────────────────
// Service Watcher — polls childServiceMeta every 10s
// Starts load when new companies appear, stops when they disappear
// ──────────────────────────────────────────────

let watcherInterval = null;
let previousCompanies = new Set();

/**
 * Start the service watcher that auto-manages load generation
 */
export function startAutoLoadWatcher() {
  if (watcherInterval) return;

  console.log('👁️  [Auto-Load] Service watcher started — will auto-generate 30-60 journeys/min per company');

  watcherInterval = setInterval(() => {
    try {
      const meta = getChildServiceMeta();

      // Group services by company
      const companiesNow = new Map();
      for (const [serviceName, svcMeta] of Object.entries(meta)) {
        const company = svcMeta.companyName;
        if (!company) continue;
        if (!companiesNow.has(company)) companiesNow.set(company, {});
        companiesNow.get(company)[serviceName] = svcMeta;
      }

      const currentCompanyNames = new Set(companiesNow.keys());

      // Start auto-load for NEW companies
      for (const [company, services] of companiesNow.entries()) {
        if (!activeAutoLoads.has(company)) {
          // Small delay to let all services for this company spin up
          setTimeout(() => {
            // Re-check it still exists
            const freshMeta = getChildServiceMeta();
            const freshServices = {};
            for (const [sn, sm] of Object.entries(freshMeta)) {
              if (sm.companyName === company) freshServices[sn] = sm;
            }
            if (Object.keys(freshServices).length > 0) {
              startAutoLoad(company, freshServices);
            }
          }, 5000);
        }
      }

      // Stop auto-load for companies whose services disappeared
      for (const company of activeAutoLoads.keys()) {
        if (!currentCompanyNames.has(company)) {
          stopAutoLoad(company);
        }
      }

      previousCompanies = currentCompanyNames;
    } catch (e) {
      // Ignore transient errors
    }
  }, 10000); // Check every 10 seconds
}

/**
 * Stop the service watcher and all auto-loads
 */
export function stopAutoLoadWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
  stopAllAutoLoads();
  console.log('👁️  [Auto-Load] Service watcher stopped');
}

export default {
  startAutoLoadWatcher,
  stopAutoLoadWatcher,
  stopAllAutoLoads,
  getAutoLoadStatus
};
