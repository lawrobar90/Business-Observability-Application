#!/usr/bin/env node

/**
 * Deploy Fix-It Workflow to Dynatrace using Automation API
 * Uses MCP-discovered environment information
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MCP Server discovered environment
const DT_ENVIRONMENT = 'https://bko67471.sprint.apps.dynatracelabs.com';
const BIZOBS_API_URL = process.env.BIZOBS_API_URL || 'http://localhost:8080';

console.log('🚀 Deploying Fix-It AI Agent Workflow\n');
console.log(`📍 Environment: ${DT_ENVIRONMENT} (from MCP Server)`);
console.log(`🔗 BizObs API: ${BIZOBS_API_URL}\n`);

// Read deployed workflow configuration
const workflowPath = path.join(__dirname, 'fixit-workflow-import.json');
if (!fs.existsSync(workflowPath)) {
  console.error(`❌ Workflow file not found: ${workflowPath}`);
  console.error('Run: node deploy-fixit-workflow-mcp.js first\n');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

console.log(`📋 Workflow: ${workflow.title}`);
console.log(`   Tasks: ${Object.keys(workflow.tasks).length}`);
console.log(`   Trigger: Davis Problem (ERROR/SLOWDOWN/RESOURCE)\n`);

// Get API token from environment or command line
const DT_API_TOKEN = process.env.DT_API_TOKEN || process.env.DT_PLATFORM_TOKEN || process.argv[2];

if (!DT_API_TOKEN) {
  console.error('❌ No API token provided\n');
  console.error('Provide token via:');
  console.error('  1. Environment: export DT_API_TOKEN="dt0c01.***"');
  console.error('  2. Argument: node deploy-workflow.js "dt0c01.***"\n');
  console.error('Get a token with these scopes:');
  console.error('  • workflows.write');
  console.error('  • workflows.read\n');
  console.error(`🔗 ${DT_ENVIRONMENT}/ui/apps/dynatrace.classic.tokens/ui/access-tokens\n`);
  process.exit(1);
}

async function deployWorkflow() {
  const apiUrl = `${DT_ENVIRONMENT}/api/v2/workflows`;
  
  console.log('🔍 Checking existing workflows...');
  
  try {
    // List existing workflows
    const listRes = await fetch(apiUrl, {
      headers: {
        'Authorization': `Api-Token ${DT_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!listRes.ok) {
      throw new Error(`Failed to list workflows: ${listRes.status} ${await listRes.text()}`);
    }

    const { workflows: existing } = await listRes.json();
    const match = existing?.find(w => w.title === workflow.title);

    let method = 'POST';
    let url = apiUrl;
    let workflowId = null;

    if (match) {
      console.log(`   ✅ Found existing: ${match.id}`);
      workflowId = match.id;
      method = 'PUT';
      url = `${apiUrl}/${workflowId}`;
      console.log('\n🔄 Updating workflow...');
    } else {
      console.log('   ℹ️  No existing workflow');
      console.log('\n➕ Creating new workflow...');
    }

    // Deploy
    const deployRes = await fetch(url, {
      method,
      headers: {
        'Authorization': `Api-Token ${DT_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(workflow)
    });

    if (!deployRes.ok) {
      const error = await deployRes.text();
      throw new Error(`Deployment failed (${deployRes.status}): ${error}`);
    }

    const result = await deployRes.json();
    workflowId = result.id || workflowId;

    console.log('\n✅ Workflow deployed successfully!\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`📊 Workflow ID: ${workflowId}`);
    console.log(`📋 Title: ${workflow.title}`);
    console.log(`👤 Owner: ${workflow.owner}`);
    console.log(`🔧 Status: ${method === 'POST' ? 'Created' : 'Updated'}\n`);
    console.log('🔗 View in Dynatrace:');
    console.log(`   ${DT_ENVIRONMENT}/ui/apps/dynatrace.automations/workflows/${workflowId}\n`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('🎯 What happens when a problem opens:\n');
    console.log('   1. Problem detected (ERROR/SLOWDOWN/RESOURCE)');
    console.log('   2. Workflow fetches problem details');
    console.log('   3. Sends to Fix-It agent webhook:');
    console.log(`      ${BIZOBS_API_URL}/api/workflow-webhook/problem`);
    console.log('   4. Fix-It uses Ollama + Davis AI for diagnosis');
    console.log('   5. Executes remediation (feature flags, circuit breakers)');
    console.log('   6. Logs events + completion status to Dynatrace\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('🧪 Test autonomous remediation:\n');
    console.log(`   # Inject chaos to trigger a problem`);
    console.log(`   curl -X POST ${BIZOBS_API_URL}/api/gremlin/inject\n`);
    console.log(`   # Monitor Fix-It status`);
    console.log(`   curl ${BIZOBS_API_URL}/api/autonomous/status\n`);
    console.log(`   # Check Dynatrace timeline for remediation events`);
    console.log(`   ${DT_ENVIRONMENT}/ui/apps/dynatrace.classic.ui/ui/problems\n`);
    console.log('✨ Autonomous remediation is ACTIVE!\n');

  } catch (error) {
    console.error(`\n❌ Deployment failed: ${error.message}\n`);
    process.exit(1);
  }
}

deployWorkflow();
