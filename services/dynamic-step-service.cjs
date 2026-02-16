/**
 * Dynamic Step Service - Creates services with proper Dynatrace identification
 * This service dynamically adapts its identity based on the step name provided
 */
const { createService } = require('./service-runner.cjs');
const { callService, getServiceNameFromStep, getServicePortFromStep } = require('./child-caller.cjs');
const { 
  TracedError, 
  withErrorTracking, 
  errorHandlingMiddleware,
  checkForStepError, 
  markSpanAsFailed, 
  reportError,
  sendErrorEvent,
  addCustomAttributes 
} = require('./dynatrace-error-helper.cjs');
const http = require('http');
const crypto = require('crypto');

// 🚦 FEATURE FLAG AUTO-REGENERATION TRACKER
let correlationIdCounter = 0;
let currentFeatureFlags = {};
let journeySteps = [];
let lastRegenerationCount = 0;

// Default error rate configuration (can be overridden via payload or global API)
const DEFAULT_ERROR_CONFIG = {
  errors_per_transaction: 0.1,  // 10% of transactions have errors
  errors_per_visit: 0.001,      // 0.1% of visits have errors (lower for journey-level)
  errors_per_minute: 0.5,       // 0.5 errors per minute baseline
  regenerate_every_n_transactions: 100  // Regenerate flags every 100 transactions
};

// Fetch global error config from main server (for Dynatrace workflow control)
async function fetchGlobalErrorConfig() {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: process.env.MAIN_SERVER_PORT || 8080,
      path: '/api/feature_flag',
      method: 'GET',
      timeout: 500
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.success && response.flags) {
            console.log('📥 [Feature Flags] Fetched from main server:', response.flags);
            resolve(response.flags);
          } else {
            resolve(DEFAULT_ERROR_CONFIG);
          }
        } catch (e) {
          resolve(DEFAULT_ERROR_CONFIG);
        }
      });
    });
    
    req.on('error', () => {
      // Silently fall back to defaults if main server not available
      resolve(DEFAULT_ERROR_CONFIG);
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve(DEFAULT_ERROR_CONFIG);
    });
    
    req.end();
  });
}

// Auto-regenerate feature flags based on volume
function checkAndRegenerateFeatureFlags(journeyData, errorConfig = DEFAULT_ERROR_CONFIG) {
  correlationIdCounter++;
  
  // Store journey steps for first request - check multiple payload shapes
  if (journeySteps.length === 0) {
    const steps = journeyData?.journey?.steps || journeyData?.steps || [];
    if (steps.length > 0) {
      journeySteps = steps;
      console.log(`📋 [Feature Flags] Captured ${journeySteps.length} journey steps for flag generation`);
    }
  }
  
  // Calculate if we should regenerate based on transaction volume
  const transactionsSinceRegen = correlationIdCounter - lastRegenerationCount;
  const shouldRegenerate = transactionsSinceRegen >= errorConfig.regenerate_every_n_transactions;
  
  // Generate initial flags on first request
  if (correlationIdCounter === 1 && journeySteps.length > 0) {
    console.log(`🎯 [Feature Flags] Initial generation (volume-based, regenerate every ${errorConfig.regenerate_every_n_transactions} transactions)`);
    currentFeatureFlags = autoGenerateFeatureFlagsServer(journeySteps, journeyData, errorConfig);
    console.log(`✅ [Feature Flags] Generated ${Object.keys(currentFeatureFlags).length} initial flags`);
    lastRegenerationCount = correlationIdCounter;
  }
  
  // Regenerate based on transaction volume
  if (shouldRegenerate && journeySteps.length > 0 && correlationIdCounter > 1) {
    console.log(`🔄 [Feature Flags] Regenerating after ${transactionsSinceRegen} transactions (correlationId: ${correlationIdCounter})`);
    currentFeatureFlags = autoGenerateFeatureFlagsServer(journeySteps, journeyData, errorConfig);
    console.log(`✅ [Feature Flags] Generated ${Object.keys(currentFeatureFlags).length} new flags`);
    lastRegenerationCount = correlationIdCounter;
  }
  
  return currentFeatureFlags;
}

// Server-side auto-generation (mirrors client logic)
function autoGenerateFeatureFlagsServer(steps, journeyData, errorConfig = DEFAULT_ERROR_CONFIG) {
  const stepNames = steps.map(s => (s.stepName || s.name || '').toLowerCase());
  const allStepText = stepNames.join(' ');
  const possibleFlags = [];
  
  // Use errors_per_transaction as base error rate (default 0.1 = 10%)
  const baseErrorRate = errorConfig.errors_per_transaction || 0.1;
  
  // Payment/Financial patterns
  if (allStepText.includes('payment') || allStepText.includes('checkout') || allStepText.includes('transaction')) {
    possibleFlags.push({
      name: 'Payment Gateway Timeout',
      errorType: 'timeout',
      errorRate: baseErrorRate * (0.8 + Math.random() * 0.4), // 80%-120% of base rate
      affectedSteps: steps.filter(s => 
        (s.stepName || s.name || '').toLowerCase().match(/payment|checkout|transaction|billing/)
      ).map(s => s.stepName || s.name),
      severity: 'CRITICAL',
      remediation: 'restart_payment_gateway',
      enabled: true
    });
  }
  
  // Inventory/Fulfillment patterns
  if (allStepText.includes('inventory') || allStepText.includes('fulfil') || allStepText.includes('stock') || allStepText.includes('order')) {
    possibleFlags.push({
      name: 'Inventory Sync Failure',
      errorType: 'service_unavailable',
      errorRate: baseErrorRate * (0.5 + Math.random() * 0.3), // 50%-80% of base rate
      affectedSteps: steps.filter(s => 
        (s.stepName || s.name || '').toLowerCase().match(/inventory|fulfil|stock|order/)
      ).map(s => s.stepName || s.name),
      severity: 'WARNING',
      remediation: 'trigger_inventory_sync',
      enabled: true
    });
  }
  
  // Validation/Verification patterns
  if (allStepText.includes('verif') || allStepText.includes('valid') || allStepText.includes('check')) {
    possibleFlags.push({
      name: 'Validation Timeout',
      errorType: 'validation_failed',
      errorRate: baseErrorRate * (0.3 + Math.random() * 0.2), // 30%-50% of base rate
      affectedSteps: steps.filter(s => 
        (s.stepName || s.name || '').toLowerCase().match(/verif|valid|check|customer|account/)
      ).map(s => s.stepName || s.name),
      severity: 'LOW',
      remediation: 'retry_with_defaults',
      enabled: true
    });
  }
  
  // Manufacturing patterns
  if (allStepText.includes('weld') || allStepText.includes('assembl') || allStepText.includes('machine') || allStepText.includes('robot')) {
    possibleFlags.push({
      name: 'Robot Malfunction',
      errorType: 'internal_error',
      errorRate: baseErrorRate * (0.9 + Math.random() * 0.4), // 90%-130% of base rate
      affectedSteps: steps.filter(s => 
        (s.stepName || s.name || '').toLowerCase().match(/weld|assembl|machine|robot|fabricat/)
      ).map(s => s.stepName || s.name),
      severity: 'CRITICAL',
      remediation: 'restart_robot_controller',
      enabled: true
    });
  }
  
  // Filter and randomly select 1-3 flags
  const validFlags = possibleFlags.filter(f => f.affectedSteps && f.affectedSteps.length > 0);
  
  if (validFlags.length === 0) {
    // Generic fallback
    validFlags.push({
      name: 'Service Timeout',
      errorType: 'timeout',
      errorRate: baseErrorRate,
      affectedSteps: steps.slice(0, Math.ceil(steps.length / 2)).map(s => s.stepName || s.name),
      severity: 'WARNING',
      remediation: 'restart_service',
      enabled: true
    });
  }
  
  const numToEnable = Math.min(validFlags.length, Math.floor(Math.random() * 3) + 1);
  const shuffled = validFlags.sort(() => 0.5 - Math.random());
  const selectedFlags = shuffled.slice(0, numToEnable);
  
  const flags = {};
  selectedFlags.forEach(flag => {
    const flagId = flag.name.toLowerCase().replace(/\s+/g, '_');
    flags[flagId] = flag;
  });
  
  // Log configuration being used
  console.log(`📊 [Feature Flags] Using error config: errors_per_transaction=${errorConfig.errors_per_transaction}, regenerate_every=${errorConfig.regenerate_every_n_transactions}`);
  
  return flags;
}

// Enhanced Dynatrace helpers with error tracking
const withCustomSpan = (name, callback) => {
  console.log('[dynatrace] Custom span:', name);
  return withErrorTracking(name, callback)();
};

const sendBusinessEvent = (eventType, data) => {
  console.log('[dynatrace] Business event:', eventType, data);
  
  // Business events not needed - OneAgent captures flattened rqBody automatically
  console.log('[dynatrace] OneAgent will capture flattened request structure for:', eventType);
  
  // Simple flattening of data for logging (no arrays, just values)
  const flattenedData = {};
  const flatten = (obj, prefix = '') => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        flatten(value, newKey);
      } else if (value !== null && value !== undefined) {
        flattenedData[newKey] = String(value);
      }
    });
  };
  flatten(data);
  
  // Log flattened fields separately so they appear in logs as individual entries
  Object.keys(flattenedData).forEach(key => {
    if (key.startsWith('additional.') || key.startsWith('customer.') || key.startsWith('business.') || key.startsWith('trace.')) {
      console.log(`[bizevent-field] ${key}=${flattenedData[key]}`);
    }
  });
  
  // Make a lightweight HTTP call to an internal endpoint with flattened data as headers
  // This will be captured by OneAgent as a separate HTTP request with flattened fields
  try {
    const mainServerPort = process.env.MAIN_SERVER_PORT || '4000';
    const flattenedHeaders = {};
    
    // Add flattened fields as HTTP headers (OneAgent will capture these)
    Object.keys(flattenedData).forEach(key => {
      if (key.startsWith('additional.') || key.startsWith('customer.') || key.startsWith('business.') || key.startsWith('trace.')) {
        // HTTP headers can't have dots, so replace with dashes
        const headerKey = `x-biz-${key.replace(/\./g, '-')}`;
        const headerValue = String(flattenedData[key]).substring(0, 100); // Limit header length
        flattenedHeaders[headerKey] = headerValue;
      }
    });
    
    // Add core business event metadata
    flattenedHeaders['x-biz-event-type'] = eventType;
    flattenedHeaders['x-biz-correlation-id'] = flattenedData.correlationId || '';
    flattenedHeaders['x-biz-step-name'] = flattenedData.stepName || '';
    flattenedHeaders['x-biz-company'] = flattenedData.company || '';
    
    const postData = JSON.stringify(flattenedData);
    const options = {
      hostname: '127.0.0.1',
      port: mainServerPort,
      path: '/api/internal/bizevent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...flattenedHeaders
      },
      timeout: 1000
    };
    
    const req = http.request(options, (res) => {
      // Consume response to complete the request
      res.on('data', () => {});
      res.on('end', () => {
        console.log(`[dynatrace] Business event HTTP call completed: ${res.statusCode}`);
      });
    });
    
    req.on('error', (err) => {
      // Ignore errors - this is just for OneAgent capture
      console.log(`[dynatrace] Business event HTTP call failed (expected): ${err.message}`);
    });
    
    req.on('timeout', () => {
      req.destroy();
    });
    
    req.write(postData);
    req.end();
    
  } catch (err) {
    // Ignore errors in business event HTTP call
    console.log(`[dynatrace] Business event HTTP call error (expected): ${err.message}`);
  }
};

// Old flattening function removed - using ultra-simple flattening in request processing instead

// Feature Flag Error Helpers
function getHttpStatusForErrorType(errorType) {
  const statusMap = {
    'timeout': 504,
    'service_unavailable': 503,
    'validation_failed': 400,
    'payment_declined': 402,
    'authentication_failed': 401,
    'rate_limit_exceeded': 429,
    'internal_error': 500
  };
  return statusMap[errorType] || 500;
}

function getErrorMessageForType(errorType, stepName) {
  const messages = {
    'timeout': `${stepName} service timeout after 5000ms`,
    'service_unavailable': `${stepName} service temporarily unavailable`,
    'validation_failed': `${stepName} validation failed - invalid data format`,
    'payment_declined': `Payment declined by ${stepName} processor`,
    'authentication_failed': `Authentication failed in ${stepName}`,
    'rate_limit_exceeded': `Rate limit exceeded for ${stepName}`,
    'internal_error': `Internal error in ${stepName} processing`
  };
  return messages[errorType] || `Unknown error in ${stepName}`;
}

function getRemediationAction(flagName) {
  const actions = {
    'payment_gateway_timeout': 'restart_payment_service',
    'inventory_sync_failure': 'trigger_inventory_sync',
    'validation_error': 'retry_with_defaults',
    'authentication_timeout': 'refresh_auth_tokens',
    'rate_limit_breach': 'enable_circuit_breaker'
  };
  return actions[flagName] || 'manual_intervention';
}

// Wait for a service health endpoint to respond on the given port
function waitForServiceReady(port, timeout = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 1000 }, (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start < timeout) setTimeout(check, 150); else resolve(false);
      });
      req.on('timeout', () => { req.destroy(); if (Date.now() - start < timeout) setTimeout(check, 150); else resolve(false); });
      req.end();
    }
    check();
  });
}

// Get service name from command line arguments or environment
const serviceNameArg = process.argv.find((arg, index) => process.argv[index - 1] === '--service-name');
const serviceName = serviceNameArg || process.env.SERVICE_NAME;
const stepName = process.env.STEP_NAME;

// CRITICAL: Set process title immediately for Dynatrace detection
// This is what Dynatrace uses to identify the service
if (serviceName) {
  try {
    process.title = serviceName;
    // Also set argv[0] to the service name - this is crucial for Dynatrace
    if (process.argv && process.argv.length > 0) {
      process.argv[0] = serviceName;
    }
    // 🔑 DT_APPLICATION_ID: Overrides package.json name for Web application id
    // This is what OneAgent uses for service detection/naming
    process.env.DT_APPLICATION_ID = serviceName;
    
    // 🔑 DT_CUSTOM_PROP: Adds custom metadata properties to the service
    process.env.DT_CUSTOM_PROP = `dtServiceName=${serviceName} companyName=${process.env.COMPANY_NAME || 'unknown'} domain=${process.env.DOMAIN || 'unknown'} industryType=${process.env.INDUSTRY_TYPE || 'unknown'}`;
    
    // Internal env vars for app-level code
    process.env.DT_SERVICE_NAME = serviceName;
    process.env.DYNATRACE_SERVICE_NAME = serviceName;
    process.env.DT_CLUSTER_ID = serviceName;
    process.env.DT_NODE_ID = `${serviceName}-node`;
    console.log(`[dynamic-step-service] Set process identity to: ${serviceName}`);
  } catch (e) {
    console.error(`[dynamic-step-service] Failed to set process identity: ${e.message}`);
  }
}

// Generic step service that can handle any step name dynamically
function createStepService(serviceName, stepName) {
  // Convert stepName to proper service format if needed
  const properServiceName = getServiceNameFromStep(stepName || serviceName);
  
  createService(properServiceName, (app) => {
    // Add error handling middleware
    app.use(errorHandlingMiddleware(properServiceName));
    
    app.post('/process', async (req, res) => {
      const payload = req.body || {};
      const correlationId = req.correlationId;
      const thinkTimeMs = Number(payload.thinkTimeMs || 200);
      const currentStepName = payload.stepName || stepName;
      
      // Process payload to ensure single values for arrays (no flattening, just array simplification)
      const processedPayload = { ...payload };
      
      console.log(`[${properServiceName}] Processing payload with ${Object.keys(processedPayload).length} fields`);
      
      // The payload should already be simplified from journey-simulation.js
      // We'll just ensure any remaining arrays are converted to single values
      function simplifyArraysInObject(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        
        const simplified = {};
        Object.keys(obj).forEach(key => {
          const value = obj[key];
          if (Array.isArray(value) && value.length > 0) {
            // Pick ONE random item from any array
            const randomIndex = Math.floor(Math.random() * value.length);
            simplified[key] = value[randomIndex];
          } else if (typeof value === 'object' && value !== null) {
            // Recursively simplify nested objects
            simplified[key] = simplifyArraysInObject(value);
          } else {
            simplified[key] = value;
          }
        });
        return simplified;
      }
      
      // Simplify any remaining arrays in nested objects
      if (processedPayload.additionalFields) {
        processedPayload.additionalFields = simplifyArraysInObject(processedPayload.additionalFields);
        console.log(`[${properServiceName}] Simplified arrays in additionalFields`);
      }
      
      if (processedPayload.customerProfile) {
        processedPayload.customerProfile = simplifyArraysInObject(processedPayload.customerProfile);
        console.log(`[${properServiceName}] Simplified arrays in customerProfile`);
      }
      
      if (processedPayload.traceMetadata) {
        processedPayload.traceMetadata = simplifyArraysInObject(processedPayload.traceMetadata);
        console.log(`[${properServiceName}] Simplified arrays in traceMetadata`);
      }
      
      // Update the request body with the processed payload
      // hasError is already inside additionalFields from journey-simulation.js
      req.body = processedPayload;
      
      try {
        // Check for step errors first (both explicit and simulated)
        const stepError = checkForStepError(payload, null); // You can pass error profile here
        if (stepError) {
          console.error(`[${properServiceName}] Step error detected:`, stepError.message);
          throw stepError;
        }
        
        // Extract trace context from incoming request headers
        const incomingTraceParent = req.headers['traceparent'];
        const incomingTraceState = req.headers['tracestate'];
        const dynatraceTraceId = req.headers['x-dynatrace-trace-id'];
        
        // Generate trace IDs for distributed tracing
        function generateUUID() {
          return crypto.randomUUID();
        }
        
        let traceId, parentSpanId;
        
        if (incomingTraceParent) {
          // Parse W3C traceparent: 00-trace_id-parent_id-flags
          const parts = incomingTraceParent.split('-');
          if (parts.length === 4) {
            traceId = parts[1];
            parentSpanId = parts[2];
            console.log(`[${properServiceName}] Using incoming trace context: ${traceId.substring(0,8)}...`);
          }
        } else if (dynatraceTraceId) {
          traceId = dynatraceTraceId;
          parentSpanId = req.headers['x-dynatrace-parent-span-id'];
          console.log(`[${properServiceName}] Using Dynatrace trace context: ${traceId.substring(0,8)}...`);
        }
        
        // Fallback to payload or generate new
        if (!traceId) {
          traceId = payload.traceId || generateUUID().replace(/-/g, '');
          parentSpanId = payload.spanId || null;
        }
        
        const spanId = generateUUID().slice(0, 16).replace(/-/g, '');
        
        console.log(`[${properServiceName}] Trace context: traceId=${traceId.substring(0,8)}..., spanId=${spanId.substring(0,8)}..., parentSpanId=${parentSpanId ? parentSpanId.substring(0,8) + '...' : 'none'}`);
        
        // --- OneAgent Distributed Tracing Integration ---
        // Let OneAgent handle trace/span propagation automatically
        // Store journey context for business observability
        const journeyTrace = Array.isArray(payload.journeyTrace) ? [...payload.journeyTrace] : [];
        const stepEntry = {
          stepName: currentStepName,
          serviceName: properServiceName,
          timestamp: new Date().toISOString(),
          correlationId,
          success: true, // Will be updated if error occurs
          traceId: traceId.substring(0,8) + '...',
          spanId: spanId.substring(0,8) + '...'
        };
        journeyTrace.push(stepEntry);

      // Look up current step's data from the journey steps array for chained execution
      let currentStepData = null;
      if (payload.steps && Array.isArray(payload.steps)) {
        console.log(`[${properServiceName}] Looking for step data for: ${currentStepName}, Available steps:`, payload.steps.map(s => s.stepName || s.name));
        currentStepData = payload.steps.find(step => 
          step.stepName === currentStepName || 
          step.name === currentStepName ||
          step.serviceName === properServiceName
        );
        console.log(`[${properServiceName}] Found step data:`, currentStepData ? 'YES' : 'NO');
        if (currentStepData) {
          console.log(`[${properServiceName}] Step data details:`, JSON.stringify(currentStepData, null, 2));
        }
      } else {
        console.log(`[${properServiceName}] No steps array in payload`);
      }
      
      // Use step-specific data if found, otherwise use payload defaults
      const stepDescription = currentStepData?.description || payload.stepDescription || '';
      const stepCategory = currentStepData?.category || payload.stepCategory || '';
      const estimatedDuration = currentStepData?.estimatedDuration || payload.estimatedDuration;
      const businessRationale = currentStepData?.businessRationale || payload.businessRationale;
      const substeps = currentStepData?.substeps || payload.substeps;

      // Log service processing with step-specific details
      console.log(`[${properServiceName}] Processing step with payload:`, JSON.stringify({
        stepName: payload.stepName,
        stepIndex: payload.stepIndex,
        totalSteps: payload.totalSteps,
        stepDescription: stepDescription,
        stepCategory: stepCategory,
        subSteps: payload.subSteps,
        hasError: payload.hasError,
        errorType: payload.errorType,
        companyName: payload.companyName,
        domain: payload.domain,
        industryType: payload.industryType,
        correlationId: payload.correlationId,
        // Include Copilot duration fields for OneAgent capture (step-specific)
        estimatedDuration: estimatedDuration,
        businessRationale: businessRationale,
        category: stepCategory,
        substeps: substeps,
        estimatedDurationMs: payload.estimatedDurationMs
      }, null, 2));
      console.log(`[${properServiceName}] Current step name: ${currentStepName}`);
      console.log(`[${properServiceName}] Step-specific substeps:`, payload.subSteps || []);
      console.log(`[${properServiceName}] Journey trace so far:`, JSON.stringify(journeyTrace));

      // 🚦 Feature Flag Error Injection with Auto-Regeneration
      let errorInjected = null;
      
      // Fetch global error config (allows Dynatrace workflows to control errors)
      const globalConfig = await fetchGlobalErrorConfig();
      
      // Extract error configuration from payload (allows override) or use global
      const errorConfig = {
        errors_per_transaction: payload.errorConfig?.errors_per_transaction ?? globalConfig.errors_per_transaction,
        errors_per_visit: payload.errorConfig?.errors_per_visit ?? globalConfig.errors_per_visit,
        errors_per_minute: payload.errorConfig?.errors_per_minute ?? globalConfig.errors_per_minute,
        regenerate_every_n_transactions: payload.errorConfig?.regenerate_every_n_transactions ?? globalConfig.regenerate_every_n_transactions
      };
      
      // Log if global config is being used (indicates Dynatrace control)
      if (!payload.errorConfig && globalConfig.errors_per_transaction !== DEFAULT_ERROR_CONFIG.errors_per_transaction) {
        console.log(`🌐 [Error Config] Using global config from API (Dynatrace controlled): ${globalConfig.errors_per_transaction}`);
      }
      
      // Check if errors are disabled (errors_per_transaction = 0)
      if (errorConfig.errors_per_transaction === 0) {
        console.log(`⏸️  [Feature Flags] Errors disabled (errors_per_transaction=0) - Self-healing active!`);
        featureFlags = {};
      } else {
        // Check and regenerate feature flags every N transactions
        let featureFlags = payload.featureFlags || {};
        if (Object.keys(featureFlags).length === 0) {
          // Use auto-generated flags if none provided
          featureFlags = checkAndRegenerateFeatureFlags(payload, errorConfig);
        } else {
          // Still track and potentially regenerate even with provided flags
          const regeneratedFlags = checkAndRegenerateFeatureFlags(payload, errorConfig);
          if (Object.keys(regeneratedFlags).length > 0) {
            featureFlags = regeneratedFlags;
            console.log(`🔄 [Feature Flags] Using regenerated flags (transaction: ${correlationIdCounter})`);
          }
        }
        
        if (featureFlags && typeof featureFlags === 'object') {
        
        // Check each active feature flag to see if this step is affected
        for (const [flagName, flagConfig] of Object.entries(featureFlags)) {
          if (flagConfig.enabled && flagConfig.affectedSteps) {
            const isAffectedStep = flagConfig.affectedSteps.some(step => 
              currentStepName.toLowerCase().includes(step.toLowerCase()) ||
              step.toLowerCase().includes(currentStepName.toLowerCase())
            );
            
            if (isAffectedStep) {
              // Apply error rate probability
              const shouldError = Math.random() < flagConfig.errorRate;
              
              if (shouldError) {
                errorInjected = {
                  feature_flag: flagName,
                  error_type: flagConfig.errorType || 'unknown',
                  http_status: getHttpStatusForErrorType(flagConfig.errorType),
                  message: getErrorMessageForType(flagConfig.errorType, currentStepName),
                  remediation_action: flagConfig.remediationAction || getRemediationAction(flagName),
                  recoverable: true,
                  retry_count: 0,
                  injected_at: new Date().toISOString()
                };
                
                console.log(`🚦 Feature flag triggered: ${flagName} on step ${currentStepName}`);
                console.log(`🚨 Injecting error:`, JSON.stringify(errorInjected, null, 2));
                break; // Only inject one error per request
              }
            }
          }
        }
        } // end if (featureFlags && typeof featureFlags === 'object')
      } // end else (errors enabled)

      // Simulate processing with realistic timing (add delay if error)
      const processingTime = errorInjected ? 
        Math.floor(Math.random() * 2000) + 3000 : // 3-5s for errors
        Math.floor(Math.random() * 200) + 100;    // 100-300ms normal

      // 🚨 If error injected by feature flag, THROW a real exception so Dynatrace captures it
      // This produces a real HTTP 5xx/4xx + exception in the Purepath (not just metadata)
      if (errorInjected) {
        setTimeout(() => {
          const httpStatus = errorInjected.http_status || 500;
          const errorMessage = errorInjected.message || `Feature flag error in ${currentStepName}`;
          
          // Create a real Error that OneAgent will capture as an exception
          const realError = new Error(errorMessage);
          realError.name = `FeatureFlagError_${errorInjected.error_type}`;
          realError.status = httpStatus;
          realError.httpStatus = httpStatus;
          
          // Add rich context so it shows up in Dynatrace exception details
          console.error(`🚨 [${properServiceName}] FEATURE FLAG EXCEPTION: ${errorMessage}`);
          console.error(`🚨 [${properServiceName}] Error Type: ${errorInjected.error_type} | HTTP ${httpStatus} | Flag: ${errorInjected.feature_flag}`);
          
          // Add custom attributes BEFORE the error response so OneAgent captures them on the span
          addCustomAttributes({
            'journey.step': currentStepName,
            'journey.service': properServiceName,
            'journey.correlationId': correlationId,
            'journey.company': processedPayload.companyName || 'unknown',
            'journey.domain': processedPayload.domain || 'unknown',
            'journey.industryType': processedPayload.industryType || 'unknown',
            'journey.processingTime': processingTime,
            'error.occurred': true,
            'error.feature_flag': errorInjected.feature_flag,
            'error.type': errorInjected.error_type,
            'error.http_status': httpStatus,
            'error.remediation_action': errorInjected.remediation_action || 'unknown'
          });
          
          // Report as a real Dynatrace exception
          reportError(realError, {
            'journey.step': currentStepName,
            'service.name': properServiceName,
            'correlation.id': correlationId,
            'http.status': httpStatus,
            'error.category': 'feature_flag_injection',
            'error.feature_flag': errorInjected.feature_flag,
            'error.type': errorInjected.error_type
          });
          
          // Mark the span as failed
          markSpanAsFailed(realError, {
            'journey.step': currentStepName,
            'service.name': properServiceName,
            'correlation.id': correlationId,
            'http.status': httpStatus,
            'error.category': 'feature_flag_injection'
          });
          
          // Send error business event
          sendErrorEvent('feature_flag_error', realError, {
            stepName: currentStepName,
            serviceName: properServiceName,
            correlationId,
            httpStatus,
            featureFlag: errorInjected.feature_flag,
            errorType: errorInjected.error_type,
            remediationAction: errorInjected.remediation_action
          });
          
          // Set error headers for trace propagation
          res.setHeader('x-trace-error', 'true');
          res.setHeader('x-error-type', realError.name);
          res.setHeader('x-journey-failed', 'true');
          res.setHeader('x-http-status', httpStatus.toString());
          res.setHeader('x-correlation-id', correlationId);
          res.setHeader('x-dynatrace-trace-id', traceId);
          res.setHeader('x-dynatrace-span-id', spanId);
          const traceId32 = traceId.substring(0, 32).padEnd(32, '0');
          const spanId16 = spanId.substring(0, 16).padEnd(16, '0');
          res.setHeader('traceparent', `00-${traceId32}-${spanId16}-01`);
          
          // Return REAL HTTP error status code (not 200!)
          res.status(httpStatus).json({
            ...processedPayload,
            stepName: currentStepName,
            service: properServiceName,
            status: 'error',
            correlationId,
            processingTime,
            pid: process.pid,
            timestamp: new Date().toISOString(),
            error_occurred: true,
            error: errorInjected,
            journeyTrace,
            traceError: true,
            httpStatus,
            _traceInfo: {
              failed: true,
              errorMessage,
              errorType: realError.name,
              httpStatus,
              featureFlag: errorInjected.feature_flag,
              requestCorrelationId: correlationId
            }
          });
        }, processingTime);
        return; // Don't fall through to the normal success path
      }

      const finish = async () => {
        // Generate dynamic metadata based on step name
        const metadata = generateStepMetadata(currentStepName);

        // Add custom attributes to OneAgent span (simplified)
        const customAttributes = {
          'journey.step': currentStepName,
          'journey.service': properServiceName,
          'journey.correlationId': correlationId,
          'journey.company': processedPayload.companyName || 'unknown',
          'journey.domain': processedPayload.domain || 'unknown',
          'journey.industryType': processedPayload.industryType || 'unknown',
          'journey.processingTime': processingTime
        };
        
        addCustomAttributes(customAttributes);

        // ✅ OneAgent automatically captures this /process request as a bizevent via capture rules
        // No manual sendBusinessEvent() needed - the request payload itself becomes the bizevent
        console.log(`[${properServiceName}] Processing step ${currentStepName} - OneAgent will capture as bizevent`);

        let response = {
          // Include the clean processed payload without duplication
          ...processedPayload,
          stepName: currentStepName,
          service: properServiceName,
          status: 'completed',
          correlationId,
          processingTime,
          pid: process.pid,
          timestamp: new Date().toISOString(),
          // Include step-specific duration fields from the current step data
          stepDescription: stepDescription,
          stepCategory: stepCategory,
          estimatedDuration: estimatedDuration,
          businessRationale: businessRationale,
          duration: processedPayload.duration,
          substeps: substeps,
          metadata,
          journeyTrace,
          error_occurred: false
        };

        // No flattened fields duplication - the processedPayload already contains clean data

        // Include incoming trace headers in the response for validation (non-invasive)
        try {
          response.traceparent = incomingTraceParent || null;
          response.tracestate = incomingTraceState || null;
          response.x_dynatrace_trace_id = dynatraceTraceId || null;
          response.x_dynatrace_parent_span_id = req.headers['x-dynatrace-parent-span-id'] || null;
        } catch (e) {}


        // --- Chaining logic ---
        let nextStepName = null;
        let nextServiceName = undefined;
        
        console.log(`[${properServiceName}] 🔗 CHAINING LOGIC: Checking for next step...`);
        console.log(`[${properServiceName}] 🔗 Current step: ${currentStepName}`);
        console.log(`[${properServiceName}] 🔗 Has steps array: ${!!(payload.steps && Array.isArray(payload.steps))}`);
        if (payload.steps && Array.isArray(payload.steps)) {
          console.log(`[${properServiceName}] 🔗 Steps array length: ${payload.steps.length}`);
          console.log(`[${properServiceName}] 🔗 Steps array contents:`, JSON.stringify(payload.steps.map(s => ({ stepName: s.stepName, serviceName: s.serviceName })), null, 2));
          
          const currentIndex = payload.steps.findIndex(s =>
            (s.stepName === currentStepName) ||
            (s.name === currentStepName) ||
            (s.serviceName === properServiceName)
          );
          console.log(`[${properServiceName}] 🔗 Current step index: ${currentIndex} of ${payload.steps.length - 1}`);
          
          if (currentIndex >= 0 && currentIndex < payload.steps.length - 1) {
            const nextStep = payload.steps[currentIndex + 1];
            nextStepName = nextStep ? (nextStep.stepName || nextStep.name) : null;
            nextServiceName = nextStep && nextStep.serviceName ? nextStep.serviceName : (nextStepName ? getServiceNameFromStep(nextStepName) : undefined);
            console.log(`[${properServiceName}] 🔗 FOUND NEXT STEP: ${nextStepName} (service: ${nextServiceName})`);
          } else {
            console.log(`[${properServiceName}] 🔗 NO NEXT STEP: End of journey (current index: ${currentIndex})`);
            nextStepName = null;
            nextServiceName = undefined;
          }
        } else {
          console.log(`[${properServiceName}] 🔗 NO STEPS ARRAY in payload - cannot chain!`);
        }

        if (nextStepName && nextServiceName) {
          try {
            await new Promise(r => setTimeout(r, thinkTimeMs));
            // Ask main server to ensure next service is running and get its port
            let nextServicePort = null;
            try {
              const adminPort = process.env.MAIN_SERVER_PORT || '4000';
              nextServicePort = await new Promise((resolve, reject) => {
                const req = http.request({ hostname: '127.0.0.1', port: adminPort, path: '/api/admin/ensure-service', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { 
                  let data = '';
                  res.on('data', chunk => data += chunk);
                  res.on('end', () => {
                    try {
                      const parsed = JSON.parse(data);
                      resolve(parsed.port || null);
                    } catch {
                      resolve(null);
                    }
                  });
                });
                req.on('error', () => resolve(null));
                req.end(JSON.stringify({ 
                  stepName: nextStepName, 
                  serviceName: nextServiceName,
                  context: {
                    companyName: payload.companyName,
                    domain: payload.domain,
                    industryType: payload.industryType,
                    stepName: nextStepName
                  }
                }));
              });
              console.log(`[${properServiceName}] Next service ${nextServiceName} allocated on port ${nextServicePort}`);
            } catch (e) {
              console.error(`[${properServiceName}] Failed to get next service port:`, e.message);
            }
            // Look up next step's specific data
            let nextStepData = null;
            if (payload.steps && Array.isArray(payload.steps)) {
              nextStepData = payload.steps.find(step => 
                step.stepName === nextStepName || 
                step.name === nextStepName ||
                step.serviceName === nextServiceName
              );
            }

            const nextPayload = {
              ...processedPayload,  // Use flattened payload instead of original
              stepName: nextStepName,
              serviceName: nextServiceName,
              // Add step-specific fields for the next step
              stepDescription: nextStepData?.description || '',
              stepCategory: nextStepData?.category || '',
              estimatedDuration: nextStepData?.estimatedDuration,
              businessRationale: nextStepData?.businessRationale,
              substeps: nextStepData?.substeps,
              estimatedDurationMs: nextStepData?.estimatedDuration ? nextStepData.estimatedDuration * 60 * 1000 : null,
              action: 'auto_chained',
              parentStep: currentStepName,
              correlationId,
              journeyId: payload.journeyId,
              domain: payload.domain,
              companyName: payload.companyName,
              thinkTimeMs,
              steps: payload.steps,
              traceId,
              spanId, // pass as parentSpanId to next
              journeyTrace
            };
            
            // Build proper trace headers for service-to-service call
            const traceHeaders = { 
              'x-correlation-id': correlationId,
              // W3C Trace Context format
              'traceparent': `00-${traceId.padEnd(32, '0')}-${spanId.padEnd(16, '0')}-01`,
              // Dynatrace specific headers
              'x-dynatrace-trace-id': traceId,
              'x-dynatrace-parent-span-id': spanId
            };
            
            // Pass through any incoming trace state
            if (incomingTraceState) {
              traceHeaders['tracestate'] = incomingTraceState;
            }
            
            console.log(`[${properServiceName}] Propagating trace to ${nextServiceName}: traceparent=${traceHeaders['traceparent']}`);
            
            // Use the port returned from ensure-service API (actual allocated port)
            const nextPort = nextServicePort || getServicePortFromStep(nextServiceName);
            console.log(`[${properServiceName}] Calling ${nextServiceName} on port ${nextPort}`);
            // Ensure next service is listening before calling
            await waitForServiceReady(nextPort, 5000);
            const next = await callService(nextServiceName, nextPayload, traceHeaders, nextPort);
            // Bubble up the full downstream trace to the current response; ensure our own span is included once
            if (next && Array.isArray(next.trace)) {
              const last = next.trace[next.trace.length - 1];
              // If our span isn't the last, append ours before adopting
              const hasCurrent = next.trace.some(s => s.spanId === spanId);
              response.trace = hasCurrent ? next.trace : [...next.trace, { traceId, spanId, parentSpanId, stepName: currentStepName }];
            }
            response.next = next;
          } catch (e) {
            response.nextError = e.message;
            console.error(`[${properServiceName}] Error calling next service:`, e.message);
          }
        }

        // Send trace context headers back in response for Dynatrace distributed tracing
        res.setHeader('x-dynatrace-trace-id', traceId);
        res.setHeader('x-dynatrace-span-id', spanId);
        if (parentSpanId) {
          res.setHeader('x-dynatrace-parent-span-id', parentSpanId);
        }
        // W3C Trace Context response header
        const traceId32 = traceId.substring(0, 32).padEnd(32, '0');
        const spanId16 = spanId.substring(0, 16).padEnd(16, '0');
        res.setHeader('traceparent', `00-${traceId32}-${spanId16}-01`);
        res.setHeader('x-correlation-id', correlationId);
        
        res.json(response);
      };

      setTimeout(finish, processingTime);
      
    } catch (error) {
      // Handle any errors that occur during step processing
      console.error(`[${properServiceName}] Step processing error:`, error.message);
      
      // Ensure proper HTTP status code is set
      const httpStatus = error.status || error.httpStatus || 500;
      
      // Report the error to Dynatrace as a trace exception
      reportError(error, {
        'journey.step': currentStepName,
        'service.name': properServiceName,
        'correlation.id': correlationId,
        'http.status': httpStatus,
        'error.category': 'journey_step_failure'
      });
      
      // Mark trace as failed with comprehensive context
      markSpanAsFailed(error, {
        'journey.step': currentStepName,
        'service.name': properServiceName,
        'correlation.id': correlationId,
        'http.status': httpStatus,
        'error.category': 'journey_step_failure',
        'journey.company': processedPayload.companyName || 'unknown',
        'journey.domain': processedPayload.domain || 'unknown'
      });
      
      // Update journey trace to mark this step as failed
      const journeyTrace = Array.isArray(payload.journeyTrace) ? [...payload.journeyTrace] : [];
      const failedStepEntry = {
        stepName: currentStepName,
        serviceName: properServiceName,
        timestamp: new Date().toISOString(),
        correlationId,
        success: false,
        error: error.message,
        errorType: error.constructor.name,
        httpStatus: httpStatus
      };
      journeyTrace.push(failedStepEntry);
      
      // Send error business event with enhanced context
      sendErrorEvent('journey_step_failed', error, {
        stepName: currentStepName,
        serviceName: properServiceName,
        correlationId,
        httpStatus: httpStatus,
        company: processedPayload.companyName || 'unknown',
        domain: processedPayload.domain || 'unknown'
      });
      
      // OneAgent captures the bizevent from the /process request body natively
      // additionalFields.hasError was set in the request payload by journey-simulation.js
      
      // Build comprehensive error response
      const errorResponse = {
        ...processedPayload,  // Include flattened fields for consistency
        status: 'error',
        error: error.message,
        errorType: error.constructor.name,
        stepName: currentStepName,
        service: properServiceName,
        correlationId,
        timestamp: new Date().toISOString(),
        journeyTrace,
        traceError: true,
        pid: process.pid,
        httpStatus: httpStatus,
        // Add OneAgent-friendly trace failure markers
        _traceInfo: {
          failed: true,
          errorMessage: error.message,
          errorType: error.constructor.name,
          httpStatus: httpStatus,
          requestCorrelationId: correlationId
        }
      };
      
      // Set comprehensive error headers for trace propagation
      res.setHeader('x-trace-error', 'true');
      res.setHeader('x-error-type', error.constructor.name);
      res.setHeader('x-journey-failed', 'true');
      res.setHeader('x-http-status', httpStatus.toString());
      res.setHeader('x-correlation-id', correlationId);
      
      // Return with appropriate HTTP status code
      console.log(`[${properServiceName}] Returning error response with HTTP ${httpStatus}`);
      res.status(httpStatus).json(errorResponse);
    }
    });
  });
}

// Generate dynamic metadata based on step name
function generateStepMetadata(stepName) {
  const lowerStep = stepName.toLowerCase();
  
  // Discovery/Exploration type steps
  if (lowerStep.includes('discover') || lowerStep.includes('explor')) {
    return {
      itemsDiscovered: Math.floor(Math.random() * 100) + 50,
      touchpointsAnalyzed: Math.floor(Math.random() * 20) + 10,
      dataSourcesConnected: Math.floor(Math.random() * 5) + 3
    };
  }
  
  // Awareness/Marketing type steps
  if (lowerStep.includes('aware') || lowerStep.includes('market')) {
    return {
      impressionsGenerated: Math.floor(Math.random() * 10000) + 5000,
      channelsActivated: Math.floor(Math.random() * 8) + 4,
      audienceReach: Math.floor(Math.random() * 50000) + 25000
    };
  }
  
  // Consideration/Selection type steps
  if (lowerStep.includes('consider') || lowerStep.includes('select') || lowerStep.includes('evaluat')) {
    return {
      optionsEvaluated: Math.floor(Math.random() * 15) + 5,
      comparisonsMade: Math.floor(Math.random() * 8) + 3,
      criteriaAnalyzed: Math.floor(Math.random() * 20) + 10
    };
  }
  
  // Purchase/Process/Transaction type steps
  if (lowerStep.includes('purchase') || lowerStep.includes('process') || lowerStep.includes('transaction') || lowerStep.includes('start')) {
    return {
      transactionValue: Math.floor(Math.random() * 1000) + 100,
      processingMethod: ['automated', 'manual', 'hybrid'][Math.floor(Math.random() * 3)],
      conversionRate: (Math.random() * 0.05 + 0.02).toFixed(3)
    };
  }
  
  // Completion/Retention type steps
  if (lowerStep.includes('complet') || lowerStep.includes('retain') || lowerStep.includes('finish')) {
    return {
      completionRate: (Math.random() * 0.3 + 0.6).toFixed(3),
      satisfactionScore: (Math.random() * 2 + 8).toFixed(1),
      issuesResolved: Math.floor(Math.random() * 5)
    };
  }
  
  // PostProcess/Advocacy type steps
  if (lowerStep.includes('post') || lowerStep.includes('advocacy') || lowerStep.includes('follow')) {
    return {
      followUpActions: Math.floor(Math.random() * 10) + 2,
      referralsGenerated: Math.floor(Math.random() * 8) + 1,
      engagementScore: Math.floor(Math.random() * 4) + 7
    };
  }
  
  // Data Persistence/Storage type steps (MongoDB integration)
  if (lowerStep.includes('persist') || lowerStep.includes('storage') || lowerStep.includes('data') || 
      lowerStep.includes('archive') || lowerStep.includes('record') || lowerStep.includes('save')) {
    return {
      recordsStored: Math.floor(Math.random() * 50) + 10,
      dataIntegrityScore: (Math.random() * 0.05 + 0.95).toFixed(3),
      storageEfficiency: (Math.random() * 0.1 + 0.85).toFixed(3),
      backupStatus: 'completed',
      indexingTime: Math.floor(Math.random() * 100) + 50
    };
  }
  
  // Generic fallback
  return {
    itemsProcessed: Math.floor(Math.random() * 50) + 20,
    processingEfficiency: (Math.random() * 0.2 + 0.8).toFixed(3),
    qualityScore: (Math.random() * 2 + 8).toFixed(1)
  };
}

module.exports = { createStepService };

// Auto-start the service when this file is run directly
if (require.main === module) {
  // Get service name from command line arguments or environment
  const serviceNameArg = process.argv.find((arg, index) => process.argv[index - 1] === '--service-name');
  const serviceName = serviceNameArg || process.env.SERVICE_NAME || 'DynamicService';
  const stepName = process.env.STEP_NAME || 'DefaultStep';
  
  // Set process title and DT_CUSTOM_PROP immediately for Dynatrace detection
  try {
    process.title = serviceName;
    // 🔑 DT_APPLICATION_ID: Overrides package.json name for Web application id
    process.env.DT_APPLICATION_ID = serviceName;
    
    // 🔑 DT_CUSTOM_PROP: Adds custom metadata properties
    if (!process.env.DT_CUSTOM_PROP || !process.env.DT_CUSTOM_PROP.includes('dtServiceName=')) {
      process.env.DT_CUSTOM_PROP = `dtServiceName=${serviceName} companyName=${process.env.COMPANY_NAME || 'unknown'} domain=${process.env.DOMAIN || 'unknown'} industryType=${process.env.INDUSTRY_TYPE || 'unknown'}`;
    }
    console.log(`[dynamic-step-service] Set process title to: ${serviceName}`);
    console.log(`[dynamic-step-service] DT_CUSTOM_PROP: ${process.env.DT_CUSTOM_PROP}`);
  } catch (e) {
    console.error(`[dynamic-step-service] Failed to set process title: ${e.message}`);
  }
  
  console.log(`[dynamic-step-service] Starting service: ${serviceName} for step: ${stepName}`);
  createStepService(serviceName, stepName);
}
