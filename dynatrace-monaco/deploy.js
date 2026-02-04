#!/usr/bin/env node
/**
 * Automated Dynatrace Configuration Deployment
 * Deploys all required settings for BizObs Application via Dynatrace Settings API
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || process.env.DYNATRACE_URL;
const DT_API_TOKEN = process.env.DT_API_TOKEN || process.env.DYNATRACE_TOKEN;

if (!DT_ENVIRONMENT || !DT_API_TOKEN) {
    console.error('❌ Error: Required environment variables not set');
    console.error('   DT_ENVIRONMENT or DYNATRACE_URL: Your Dynatrace tenant URL');
    console.error('   DT_API_TOKEN or DYNATRACE_TOKEN: API token with settings.write scope');
    process.exit(1);
}

const DT_URL = DT_ENVIRONMENT.replace(/\/$/, '');
const CONFIG_DIR = path.join(__dirname, 'projects', 'bizobs-app');

console.log('🚀 BizObs Dynatrace Configuration Deployment');
console.log('==============================================');
console.log(`🌐 Environment: ${DT_URL}`);
console.log(`🔑 Token: ${DT_API_TOKEN.substring(0, 15)}...`);
console.log('');

/**
 * Make API request to Dynatrace
 */
function apiRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, DT_URL);
        const options = {
            method: method,
            headers: {
                'Authorization': `Api-Token ${DT_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(url, options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null });
                } else {
                    reject({ statusCode: res.statusCode, body: body, message: `API Error: ${res.statusCode}` });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

/**
 * Deploy a settings object
 */
async function deploySettings(schemaId, scopeType, scope, value) {
    const payload = {
        schemaId: schemaId,
        scope: scope,
        value: value
    };

    try {
        const response = await apiRequest('POST', '/api/v2/settings/objects', [payload]);
        return response;
    } catch (error) {
        throw error;
    }
}

/**
 * Main deployment function
 */
async function deploy() {
    const configs = [];

    // 1. Business Event Capture Rule
    console.log('1️⃣  Deploying Business Event Capture Rule...');
    try {
        const captureRule = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'capture-rule.json'), 'utf8'));
        await deploySettings('builtin:bizevents-processing-rules.rule', 'environment', 'environment', captureRule);
        console.log('   ✅ Capture rule deployed');
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message || error.body || error}`);
        console.error('      → You may need to configure this manually in Settings > Business Analytics > OneAgent');
    }

    // 2. Service Naming Rule
    console.log('\n2️⃣  Deploying Service Naming Rule...');
    try {
        const serviceNaming = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'service-naming.json'), 'utf8'));
        await deploySettings('builtin:service-naming', 'environment', 'environment', serviceNaming);
        console.log('   ✅ Service naming rule deployed');
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message || error.body || error}`);
        console.error('      → You may need to configure this manually in Settings > Service naming rules');
    }

    // 3. OpenPipeline Pipeline
    console.log('\n3️⃣  Deploying OpenPipeline Pipeline...');
    try {
        const pipeline = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'openpipeline-pipeline.json'), 'utf8'));
        await deploySettings('builtin:openpipeline-business-events-pipeline', 'environment', 'environment', pipeline);
        console.log('   ✅ Pipeline deployed');
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message || error.body || error}`);
        console.error('      → You may need to configure this manually in OpenPipeline > Business events > Pipelines');
    }

    // 4. Dynamic Routing
    console.log('\n4️⃣  Deploying Dynamic Routing...');
    try {
        const routing = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'openpipeline-routing.json'), 'utf8'));
        await deploySettings('builtin:openpipeline-business-events-routing', 'environment', 'environment', routing);
        console.log('   ✅ Dynamic routing deployed');
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message || error.body || error}`);
        console.error('      → You may need to configure this manually in OpenPipeline > Dynamic routing');
    }

    console.log('\n==============================================');
    console.log('🎉 Deployment Complete!');
    console.log('==============================================');
    console.log('\n📋 Manual Steps Still Required:');
    console.log('1. Enable OneAgent Features:');
    console.log('   Settings > Preferences > OneAgent Features');
    console.log('   → Enable "Node.js Business Events [Opt-in]"');
    console.log('\n2. Restart your Node.js application');
    console.log('\n3. Run test simulations through BizObs UI');
    console.log('\n4. Validate with queries in Notebooks');
    console.log('\n📚 See DynatraceConfig.md for validation queries');
    console.log('');
}

// Run deployment
deploy().catch(error => {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
});
