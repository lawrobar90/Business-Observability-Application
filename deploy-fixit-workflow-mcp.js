#!/usr/bin/env node

/**
 * Deploy Fix-It AI Agent Workflow to Dynatrace via MCP Server
 * Generates workflow configuration that can be imported through Dynatrace UI
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Fix-It AI Agent Workflow Configuration Generator\n');

// Configuration
const BIZOBS_API_URL = process.env.BIZOBS_API_URL || 'http://localhost:8080';
const SERVER_IP = process.env.SERVER_IP || 'localhost';
const DT_ENVIRONMENT = 'https://bko67471.sprint.apps.dynatracelabs.com';

console.log(`📍 Target Environment: ${DT_ENVIRONMENT}`);
console.log(`🔗 BizObs API URL: ${BIZOBS_API_URL}`);
console.log(`🖥️  Server IP: ${SERVER_IP}\n`);

// Load workflow template with Davis Intelligence
const workflowTemplatePath = path.join(__dirname, 'monaco', 'bizobs-automation', 'workflow-fixit-davis-intelligence.json');

if (!fs.existsSync(workflowTemplatePath)) {
  console.error(`❌ Error: Workflow template not found: ${workflowTemplatePath}`);
  process.exit(1);
}

const templateContent = fs.readFileSync(workflowTemplatePath, 'utf8');

// Process template with actual values - only replace Monaco build-time variables
let workflowConfig = templateContent
  // Replace Monaco/Go template variables (build-time)
  .replace(/\{\{ \.name \}\}/g, 'BizObs Fix-It AI Agent - Autonomous Remediation')
  .replace(/\{\{ \.Env\.DT_WORKFLOW_OWNER \| default \\?"bizobs-automation\\?" \}\}/g, 'bizobs-automation')
  .replace(/\{\{ \.Env\.BIZOBS_API_URL \| default \\?"http:\/\/localhost:8080\\?" \}\}/g, BIZOBS_API_URL)
  .replace(/\{\{ \.Env\.DT_ENVIRONMENT \}\}/g, DT_ENVIRONMENT)
  // Keep Dynatrace workflow runtime variables - these execute when workflow runs
  .replace(/\{\{ \.Env\.DT_API_TOKEN \}\}/g, '{{ _.DT_API_TOKEN }}');

const workflow = JSON.parse(workflowConfig);

// Generate output file
const outputPath = path.join(__dirname, 'fixit-workflow-import.json');
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));

console.log('✅ Workflow configuration generated successfully!\n');
console.log(`📄 Output file: ${outputPath}\n`);

console.log('📋 Workflow Details:');
console.log(`   Title: ${workflow.title}`);
console.log(`   Description: ${workflow.description}`);
console.log(`   Owner: ${workflow.owner}`);
console.log(`   Trigger: Problem Opened (ERROR, SLOWDOWN, RESOURCE)`);
console.log(`   Tasks: ${Object.keys(workflow.tasks).length}\n`);

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('📥 IMPORT WORKFLOW TO DYNATRACE\n');
console.log('Option 1: Using Dynatrace UI (Recommended)\n');
console.log('1. Open Dynatrace:');
console.log(`   ${DT_ENVIRONMENT}/ui/apps/dynatrace.automations/workflows\n`);
console.log('2. Click "Import" button (top right)');
console.log('3. Upload or paste the content from:');
console.log(`   ${outputPath}\n`);
console.log('4. Click "Save"\n');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Option 2: Using curl command\n');
console.log('Run this command (replace YOUR_TOKEN with actual token):\n');

const curlCommand = `curl -X POST "${DT_ENVIRONMENT}/api/v2/workflows" \\
  -H "Authorization: Api-Token YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d @${outputPath}`;

console.log(curlCommand);
console.log('\n═══════════════════════════════════════════════════════════════\n');

console.log('📝 Required API Token Scopes:\n');
console.log('   • workflows.write');
console.log('   • workflows.read');
console.log('   • DataExport\n');

console.log('🔗 Create token here:');
console.log(`   ${DT_ENVIRONMENT}/ui/apps/dynatrace.classic.tokens/ui/access-tokens\n`);

console.log('═══════════════════════════════════════════════════════════════\n');

console.log('🎯 What this workflow does:\n');
console.log('   1. Triggers on problem OPEN events (ERROR/SLOWDOWN/RESOURCE)');
console.log('   2. Fetches problem details from Dynatrace API');
console.log('   3. Sends problem to Fix-It agent webhook:');
console.log(`      ${BIZOBS_API_URL}/api/workflow-webhook/problem`);
console.log('   4. Fix-It agent uses Ollama + Davis AI for diagnosis');
console.log('   5. Executes autonomous remediation (feature flags, etc.)');
console.log('   6. Logs remediation events back to Dynatrace');
console.log('   7. Waits 60s for completion and logs final status\n');

console.log('✨ Test the integration:\n');
console.log(`   curl -X POST ${BIZOBS_API_URL}/api/gremlin/inject`);
console.log('   → Chaos injected → Problem opens → Workflow triggers → Fix-It remediates\n');

console.log('📊 Monitor remediation:\n');
console.log(`   curl ${BIZOBS_API_URL}/api/autonomous/status\n`);

console.log('═══════════════════════════════════════════════════════════════\n');
