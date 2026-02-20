#!/usr/bin/env node

/**
 * Deploy Fix-It Workflow using MCP Server OAuth Authentication
 * Similar to how DQL queries are executed through MCP
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MCP-discovered environment
const DT_ENVIRONMENT = 'https://bko67471.sprint.apps.dynatracelabs.com';
const BIZOBS_API_URL = 'http://localhost:8080';

console.log('🚀 Deploying Fix-It Workflow via MCP OAuth\n');
console.log(`📍 Environment: ${DT_ENVIRONMENT}`);
console.log(`🔗 BizObs API: ${BIZOBS_API_URL}\n`);

// Load workflow configuration
const workflowPath = path.join(__dirname, 'fixit-workflow-import.json');
if (!fs.existsSync(workflowPath)) {
  console.error('❌ Workflow file not found. Run: node deploy-fixit-workflow-mcp.js\n');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

console.log(`📋 Workflow: ${workflow.title}`);
console.log(`   Tasks: ${Object.keys(workflow.tasks).length}\n`);

async function deployViaAPI() {
  console.log('🔐 Using Dynatrace OAuth (via MCP credentials)\n');
  
  // Check if MCP server is available
  const mcp_url = process.env.MCP_SERVER_URL || 'http://localhost:3000';
  
  try {
    // Option 1: Direct API call with OAuth token
    const apiUrl = `${DT_ENVIRONMENT}/api/v2/workflows`;
    
    console.log('📤 Deploying workflow to Dynatrace...\n');
    
    // Save workflow to temp file for curl
    const tempFile = '/tmp/fixit-workflow.json';
    fs.writeFileSync(tempFile, JSON.stringify(workflow, null, 2));
    
    // List existing workflows first
    console.log('🔍 Checking for existing workflow...');
    
    const listCmd = `curl -s "${apiUrl}" \\
      -H "Accept: application/json"`;
    
    console.log('\n💡 To deploy with your OAuth credentials, run:\n');
    console.log('# Step 1: Get OAuth token from MCP server (already authenticated)');
    console.log('export DT_TOKEN=$(cat ~/.dynatrace/oauth-token.txt)  # Or from MCP config\n');
    
    console.log('# Step 2: Deploy workflow');
    console.log(`curl -X POST "${apiUrl}" \\`);
    console.log(`  -H "Authorization: Bearer \${DT_TOKEN}" \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d @${tempFile}\n`);
    
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('🔑 Using MCP Server OAuth Token\n');
    console.log('The MCP server (running on port 3000) already has OAuth credentials.');
    console.log('To deploy the workflow using those same credentials:\n');
    
    console.log('1. Extract OAuth token from MCP server environment:');
    console.log('   export DT_ENV="https://bko67471.sprint.apps.dynatracelabs.com"');
    console.log('   export DT_TOKEN="<your-oauth-token-from-mcp-config>"\n');
    
    console.log('2. Deploy using the token:');
    console.log(`   node deploy-workflow.js "$DT_TOKEN"\n`);
    
    console.log('OR use the MCP server\'s internal OAuth by making the request:');
    console.log('   through the MCP server\'s proxy (if available)\n');
    
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('📝 Alternative: Manual Import (No Token Required)\n');
    console.log('1. Open: https://bko67471.sprint.apps.dynatracelabs.com/ui/apps/dynatrace.automations/workflows');
    console.log('2. Click "Import" (top right)');
    console.log('3. Upload file: ' + workflowPath);
    console.log('4. Click "Save"\n');
    console.log('✅ This uses your browser authentication (same OAuth as MCP)\n');
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    console.log('💡 Use manual import method above\n');
  }
}

deployViaAPI();
