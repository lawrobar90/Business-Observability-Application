#!/usr/bin/env node

/**
 * LoadRunner Test Simulator
 * Executes continuous load based on LoadRunner scenario configuration
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const testDir = process.argv[2];
const scenario = process.argv[3];

if (!testDir || !scenario) {
  console.error('Usage: node loadrunner-simulator.js <testDir> <scenario>');
  process.exit(1);
}

// ============================================
// Stop-Flag Mechanism
// ============================================
// Before each loop iteration, we check for stop flag files.
// If a global STOP_ALL file or a company-specific STOP file exists,
// the simulator exits cleanly. This ensures processes die even if
// SIGKILL fails to reach detached processes.

const LOADRUNNER_BASE_DIR = path.dirname(testDir); // parent of company dir
const STOP_ALL_FLAG = path.join(LOADRUNNER_BASE_DIR, 'STOP_ALL');
const STOP_COMPANY_FLAG = path.join(testDir, 'STOP');

function shouldStop() {
  try {
    if (fs.existsSync(STOP_ALL_FLAG)) {
      console.log(`[LR-Simulator] 🛑 STOP_ALL flag detected — shutting down.`);
      return true;
    }
    if (fs.existsSync(STOP_COMPANY_FLAG)) {
      console.log(`[LR-Simulator] 🛑 STOP flag detected for company — shutting down.`);
      return true;
    }
  } catch (err) {
    // If we can't check, continue running
  }
  return false;
}

// Load test configuration
const testConfigPath = path.join(testDir, 'test-config.json');
const scenarioPath = path.join(path.dirname(testDir), 'scenarios', `${scenario}.json`);

let testConfig, scenarioConfig;

try {
  testConfig = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
  scenarioConfig = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
} catch (err) {
  console.error('[LR-Simulator] Error loading config:', err.message);
  console.error('[LR-Simulator] testConfigPath:', testConfigPath);
  console.error('[LR-Simulator] scenarioPath:', scenarioPath);
  process.exit(1);
}

const { companyName, domain, industryType, steps, journeyType } = testConfig;
const { loadrunner_config } = scenarioConfig;

const intervalMs = (loadrunner_config.journey_interval || 30) * 1000; // Convert to ms
const thinkTimeMs = loadrunner_config.think_time || 5000;

console.log(`[LR-Simulator] 🚀 Starting continuous load for ${companyName}`);
console.log(`[LR-Simulator] 📊 Rate: ${(60000 / intervalMs).toFixed(1)} requests/minute`);
console.log(`[LR-Simulator] 🔄 Journey steps: ${steps.length}`);

// Define diverse customer profiles for realistic load simulation
const loadTestCustomers = [
  {
    id: 1,
    customerName: "Alice Thompson",
    email: "alice.thompson@techcorp.com",
    phone: "+1-555-0101",
    location: "San Francisco, CA",
    accountAge: 24,
    loyaltyTier: "Gold"
  },
  {
    id: 2,
    customerName: "Bob Martinez",
    email: "bob.m@startup.io",
    phone: "+1-555-0202",
    location: "Austin, TX",
    accountAge: 6,
    loyaltyTier: "Silver"
  },
  {
    id: 3,
    customerName: "Carol Chen",
    email: "cchen@enterprise.com",
    phone: "+1-555-0303",
    location: "Seattle, WA",
    accountAge: 48,
    loyaltyTier: "Platinum"
  },
  {
    id: 4,
    customerName: "David Kumar",
    email: "dkumar@consulting.net",
    phone: "+1-555-0404",
    location: "Chicago, IL",
    accountAge: 12,
    loyaltyTier: "Gold"
  },
  {
    id: 5,
    customerName: "Emma Wilson",
    email: "e.wilson@finance.com",
    phone: "+1-555-0505",
    location: "New York, NY",
    accountAge: 36,
    loyaltyTier: "Platinum"
  },
  {
    id: 6,
    customerName: "Frank Rodriguez",
    email: "f.rodriguez@retail.com",
    phone: "+1-555-0606",
    location: "Los Angeles, CA",
    accountAge: 18,
    loyaltyTier: "Silver"
  },
  {
    id: 7,
    customerName: "Grace Park",
    email: "grace.park@healthcare.org",
    phone: "+1-555-0707",
    location: "Boston, MA",
    accountAge: 30,
    loyaltyTier: "Gold"
  },
  {
    id: 8,
    customerName: "Henry Lee",
    email: "hlee@manufacturing.com",
    phone: "+1-555-0808",
    location: "Detroit, MI",
    accountAge: 9,
    loyaltyTier: "Bronze"
  }
];

// Helper function to generate diverse product/service details
function generateDiverseDetails(customerProfile) {
  const products = [
    "Industrial Equipment A", "Machinery Model X", "Component Set B",
    "Service Package Premium", "Maintenance Plan Pro", "Extended Warranty Plus"
  ];
  
  const priorities = ["High", "Medium", "Low", "Critical"];
  const departments = ["Operations", "Maintenance", "Production", "Engineering", "Quality Assurance"];
  const transactionAmounts = [150, 350, 750, 1500, 2500, 5000, 10000];
  
  return {
    productId: `PROD-${Math.floor(Math.random() * 9000) + 1000}`,
    productName: products[Math.floor(Math.random() * products.length)],
    priority: priorities[Math.floor(Math.random() * priorities.length)],
    department: departments[Math.floor(Math.random() * departments.length)],
    transactionAmount: transactionAmounts[Math.floor(Math.random() * transactionAmounts.length)],
    requestType: customerProfile.loyaltyTier === "Platinum" ? "Express" : "Standard",
    urgencyLevel: Math.floor(Math.random() * 5) + 1
  };
}

// Function to execute a single journey
async function executeJourney() {
  // Randomly select a customer from the diverse pool
  const customer = loadTestCustomers[Math.floor(Math.random() * loadTestCustomers.length)];
  
  const journeyId = `lr_journey_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const customerId = `lr_customer_${customer.id}_${Math.floor(Math.random() * 1000)}`;
  const correlationId = crypto.randomUUID();
  
  // Generate diverse additional fields for this specific customer journey
  const diverseDetails = generateDiverseDetails(customer);

  const payload = {
    journeyId,
    customerId,
    correlationId,
    journey: {
      companyName,
      domain,
      industryType,
      steps: steps,
      journeyType: testConfig.journeyType || industryType || companyName,
      description: testConfig.description || `Automated journey for ${companyName}`
    },
    companyName,
    domain,
    industryType,
    steps: steps,  // TOP-LEVEL steps array for service chaining
    journeyType: testConfig.journeyType || industryType || companyName,
    description: testConfig.description || `Automated journey for ${companyName}`,
    // Use diverse customer-specific data instead of static testConfig data
    additionalFields: {
      ...(testConfig.additionalFields || {}),
      ...diverseDetails,
      sessionId: `session_${customer.id}_${Date.now()}`
    },
    customerProfile: {
      ...(testConfig.customerProfile || {}),
      customerId: customer.id,
      customerName: customer.customerName,
      email: customer.email,
      phone: customer.phone,
      location: customer.location,
      accountAge: customer.accountAge,
      loyaltyTier: customer.loyaltyTier,
      simulatedUser: true
    },
    traceMetadata: {
      ...(testConfig.traceMetadata || {}),
      LSN: scenarioConfig.dynatrace_tags.LSN,
      LTN: scenarioConfig.dynatrace_tags.LTN,
      loadTest: true,
      scenario: scenario,
      customerName: customer.customerName,
      customerId: customer.id
    },
    chained: true,
    thinkTimeMs: 250,
    errorSimulationEnabled: scenarioConfig.error_simulation?.enabled || false,
    loadRunnerTest: true
  };
  
  console.log(`[LR-Simulator] 👤 ${customer.customerName} (${customer.loyaltyTier}) - ${diverseDetails.productName} - Priority: ${diverseDetails.priority}`);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    
    const options = {
      hostname: 'localhost',
      port: process.env.BIZOBS_PORT || 8080,
      path: '/api/journey-simulation/simulate-journey',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(postData),
        'x-loadrunner-test': 'true',
        'x-correlation-id': correlationId
      },
      timeout: 60000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`[LR-Simulator] ✅ Journey ${journeyId} completed (${res.statusCode})`);
          resolve({ success: true, journeyId, status: res.statusCode });
        } else {
          console.error(`[LR-Simulator] ❌ Journey ${journeyId} failed (${res.statusCode})`);
          resolve({ success: false, journeyId, status: res.statusCode, error: data });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[LR-Simulator] ❌ Request error for ${journeyId}:`, err.message);
      resolve({ success: false, journeyId, error: err.message });
    });

    req.on('timeout', () => {
      console.error(`[LR-Simulator] ⏱️  Timeout for ${journeyId}`);
      req.destroy();
      resolve({ success: false, journeyId, error: 'timeout' });
    });

    req.write(postData);
    req.end();
  });
}

// ============================================
// Feature Flag Trigger After N Customers
// ============================================
// After a configurable number of customers (default 100), automatically enable
// error injection via the feature flag API. This creates a realistic
// "everything was fine → things start breaking" pattern for self-healing demos.

const FEATURE_FLAG_TRIGGER_AFTER = parseInt(process.env.FF_TRIGGER_AFTER || '0')
  || scenarioConfig.feature_flag_trigger?.after_customers
  || 100;
const FEATURE_FLAG_ERROR_RATE = parseFloat(process.env.FF_ERROR_RATE || '0')
  || scenarioConfig.feature_flag_trigger?.error_rate
  || 0.3;
const FEATURE_FLAG_REVERT_AFTER = parseInt(process.env.FF_REVERT_AFTER || '0')
  || scenarioConfig.feature_flag_trigger?.revert_after_customers
  || null;

let featureFlagTriggered = false;
let featureFlagReverted = false;

async function triggerFeatureFlag(action, errorRate) {
  return new Promise((resolve) => {
    const flagPayload = JSON.stringify({
      flags: {
        errors_per_transaction: errorRate
      }
    });

    const options = {
      hostname: 'localhost',
      port: process.env.BIZOBS_PORT || 8080,
      path: '/api/feature_flag',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(flagPayload)
      },
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true });
        } else {
          console.error(`[LR-Simulator] ⚠️  Feature flag API returned ${res.statusCode}`);
          resolve({ success: false, status: res.statusCode });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[LR-Simulator] ⚠️  Feature flag API error:`, err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(flagPayload);
    req.end();
  });
}

// Main execution loop
async function runLoadTest() {
  console.log(`[LR-Simulator] 🏃 Load test running for ${companyName}...`);
  console.log(`[LR-Simulator] 🎯 Feature flag trigger: after ${FEATURE_FLAG_TRIGGER_AFTER} customers (error_rate → ${FEATURE_FLAG_ERROR_RATE})`);
  if (FEATURE_FLAG_REVERT_AFTER) {
    console.log(`[LR-Simulator] 🔄 Feature flag revert: after ${FEATURE_FLAG_REVERT_AFTER} customers (self-healing simulation)`);
  }
  
  let customerCount = 0;
  
  while (true) {
    // Check stop flags before each iteration
    if (shouldStop()) {
      console.log(`[LR-Simulator] 🛑 Exiting load test for ${companyName} (stop flag).`);
      process.exit(0);
    }

    const startTime = Date.now();
    
    try {
      await executeJourney();
      customerCount++;

      // --- Trigger feature flag after N customers ---
      if (!featureFlagTriggered && customerCount >= FEATURE_FLAG_TRIGGER_AFTER) {
        featureFlagTriggered = true;
        console.log(`\n🚨🚨🚨 [LR-Simulator] FEATURE FLAG TRIGGER 🚨🚨🚨`);
        console.log(`[LR-Simulator] 💥 Customer #${customerCount} reached — enabling error injection (errors_per_transaction → ${FEATURE_FLAG_ERROR_RATE})`);
        console.log(`[LR-Simulator] 📊 This simulates a production degradation for self-healing demos\n`);
        
        const result = await triggerFeatureFlag('enable', FEATURE_FLAG_ERROR_RATE);
        if (result.success) {
          console.log(`[LR-Simulator] ✅ Feature flag SET — errors_per_transaction = ${FEATURE_FLAG_ERROR_RATE}`);
        } else {
          console.error(`[LR-Simulator] ❌ Feature flag trigger failed — errors NOT enabled`);
          featureFlagTriggered = false; // Retry next iteration
        }
      }

      // --- Optional: Revert feature flag after additional N customers ---
      if (FEATURE_FLAG_REVERT_AFTER && featureFlagTriggered && !featureFlagReverted 
          && customerCount >= FEATURE_FLAG_TRIGGER_AFTER + FEATURE_FLAG_REVERT_AFTER) {
        featureFlagReverted = true;
        console.log(`\n✅✅✅ [LR-Simulator] FEATURE FLAG REVERT (SELF-HEALING) ✅✅✅`);
        console.log(`[LR-Simulator] 🔧 Customer #${customerCount} — reverting error injection (errors_per_transaction → 0)`);
        console.log(`[LR-Simulator] 📊 This simulates a Dynatrace workflow auto-remediation\n`);
        
        const result = await triggerFeatureFlag('revert', 0);
        if (result.success) {
          console.log(`[LR-Simulator] ✅ Feature flag REVERTED — errors_per_transaction = 0 (self-healed!)`);
        }
      }

      // Log progress every 25 customers
      if (customerCount % 25 === 0) {
        const flagStatus = featureFlagReverted ? '🟢 reverted' : featureFlagTriggered ? '🔴 errors ON' : '🟢 clean';
        console.log(`[LR-Simulator] 📈 Progress: ${customerCount} customers processed | Flag: ${flagStatus}`);
      }
    } catch (err) {
      console.error(`[LR-Simulator] ❌ Execution error:`, err.message);
    }
    
    // Calculate next execution time
    const elapsed = Date.now() - startTime;
    const waitTime = Math.max(intervalMs - elapsed, 1000); // At least 1 second
    
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Check stop flags again after waiting
    if (shouldStop()) {
      console.log(`[LR-Simulator] 🛑 Exiting load test for ${companyName} (stop flag after wait).`);
      process.exit(0);
    }
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[LR-Simulator] 🛑 Received SIGTERM, shutting down...`);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(`[LR-Simulator] 🛑 Received SIGINT, shutting down...`);
  process.exit(0);
});

// Start the load test
runLoadTest().catch(err => {
  console.error('[LR-Simulator] Fatal error:', err);
  process.exit(1);
});
