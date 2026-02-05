#!/usr/bin/env node

/**
 * Quick test of dashboard JSON generation
 * Tests the generateDashboardJson() function without needing full server
 */

import { generateDashboardJson } from './dynatrace-dashboard-deployer.js';

console.log('🧪 Testing Dashboard JSON Generation...\n');

// Test journey config
const testJourney = {
  companyName: 'Test Company',
  domain: 'test.com',
  industryType: 'E-Commerce',
  journeyType: 'purchase',
  steps: [
    { name: 'Login', duration: 2.5, service: 'auth-service' },
    { name: 'Browse', duration: 5.0, service: 'catalog-service' },
    { name: 'Checkout', duration: 3.2, service: 'checkout-service' }
  ]
};

try {
  const dashboard = generateDashboardJson(testJourney);
  
  console.log('✅ Dashboard generated successfully!\n');
  console.log('📊 Dashboard Properties:');
  console.log(`   - Version: ${dashboard.version}`);
  console.log(`   - Tiles: ${Object.keys(dashboard.tiles).length}`);
  console.log(`   - Layouts: ${Object.keys(dashboard.layouts).length}`);
  
  // Verify structure
  const requiredFields = ['version', 'variables', 'tiles', 'layouts', 'settings'];
  const hasAllFields = requiredFields.every(field => dashboard.hasOwnProperty(field));
  
  if (!hasAllFields) {
    console.error('\n❌ Missing required fields!');
    process.exit(1);
  }
  
  // Check first tile (should be header)
  const firstTile = dashboard.tiles[0];
  if (firstTile.type !== 'markdown') {
    console.error('\n❌ First tile should be markdown header!');
    process.exit(1);
  }
  
  console.log('\n✅ All validations passed!');
  console.log('\n📄 Sample Dashboard Structure:');
  console.log(JSON.stringify(dashboard, null, 2).substring(0, 500) + '...\n');
  
  console.log('🎉 Test completed successfully!\n');
  
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
