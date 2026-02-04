#!/usr/bin/env node

/**
 * Continuous Journey Generator
 * Automatically generates journey data for BizObs without manual intervention
 * Runs in the background and simulates realistic customer journeys
 */

import fetch from 'node-fetch';

const BIZOBS_API = process.env.BIZOBS_API_URL || 'http://localhost:8080';
const INTERVAL_MS = parseInt(process.env.JOURNEY_INTERVAL_MS || '30000'); // 30 seconds default
const BATCH_SIZE = parseInt(process.env.JOURNEY_BATCH_SIZE || '5'); // 5 customers per batch

// Sample journey configurations
const journeyTemplates = [
  {
    name: 'E-Commerce Journey',
    customers: ['Alice Johnson', 'Bob Smith', 'Carol Williams'],
    steps: [
      { stepName: 'Browse Products', serviceName: 'ProductCatalog' },
      { stepName: 'Add to Cart', serviceName: 'ShoppingCart' },
      { stepName: 'Checkout', serviceName: 'CheckoutService' },
      { stepName: 'Payment', serviceName: 'PaymentProcessor' },
      { stepName: 'Order Confirmation', serviceName: 'OrderService' }
    ]
  },
  {
    name: 'Banking Journey',
    customers: ['Wayne Enterprises', 'Stark Industries', 'Umbrella Corporation'],
    steps: [
      { stepName: 'Login', serviceName: 'AuthService' },
      { stepName: 'Account Overview', serviceName: 'AccountService' },
      { stepName: 'Transfer Funds', serviceName: 'TransferService' },
      { stepName: 'Transaction History', serviceName: 'HistoryService' },
      { stepName: 'Logout', serviceName: 'AuthService' }
    ]
  }
];

let isRunning = false;
let journeyCount = 0;
let errorCount = 0;

async function simulateJourney(template, customer) {
  try {
    const response = await fetch(`${BIZOBS_API}/api/journey-simulation/simulate-journey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        journeyId: `continuous_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        customerId: customer.replace(/\s+/g, '_').toLowerCase(),
        customerName: customer,
        journey: {
          name: template.name,
          steps: template.steps
        },
        chained: true,
        thinkTimeMs: 250,
        errorSimulationEnabled: true
      })
    });

    if (response.ok) {
      const result = await response.json();
      journeyCount++;
      console.log(`✅ [${journeyCount}] Journey completed: ${customer} - ${template.name}`);
      return result;
    } else {
      errorCount++;
      console.error(`❌ Journey failed: ${customer} - ${response.status}`);
      return null;
    }
  } catch (error) {
    errorCount++;
    console.error(`❌ Journey error: ${customer} - ${error.message}`);
    return null;
  }
}

async function runBatch() {
  if (!isRunning) return;

  console.log(`\n🔄 Running batch at ${new Date().toISOString()}`);
  
  const promises = [];
  
  // Pick random template and customers
  for (let i = 0; i < BATCH_SIZE; i++) {
    const template = journeyTemplates[Math.floor(Math.random() * journeyTemplates.length)];
    const customer = template.customers[Math.floor(Math.random() * template.customers.length)];
    
    promises.push(simulateJourney(template, customer));
  }
  
  await Promise.all(promises);
  
  console.log(`📊 Stats - Total: ${journeyCount}, Errors: ${errorCount}, Success Rate: ${((journeyCount / (journeyCount + errorCount)) * 100).toFixed(1)}%`);
}

async function start() {
  console.log('🚀 Starting Continuous Journey Generator');
  console.log(`   API: ${BIZOBS_API}`);
  console.log(`   Interval: ${INTERVAL_MS}ms`);
  console.log(`   Batch Size: ${BATCH_SIZE}`);
  
  // Test connection
  try {
    const response = await fetch(`${BIZOBS_API}/health`);
    if (!response.ok) {
      throw new Error(`API health check failed: ${response.status}`);
    }
    console.log('✅ Connected to BizObs API');
  } catch (error) {
    console.error('❌ Failed to connect to BizObs API:', error.message);
    console.error('   Retrying in 10 seconds...');
    setTimeout(start, 10000);
    return;
  }
  
  isRunning = true;
  
  // Run first batch immediately
  await runBatch();
  
  // Schedule recurring batches
  const interval = setInterval(async () => {
    if (isRunning) {
      await runBatch();
    } else {
      clearInterval(interval);
    }
  }, INTERVAL_MS);
  
  console.log('✅ Continuous journey generation started\n');
}

function stop() {
  console.log('\n🛑 Stopping continuous journey generator');
  isRunning = false;
  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Start the generator
start().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
