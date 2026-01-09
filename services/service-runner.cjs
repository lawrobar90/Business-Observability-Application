/**
 * Generic service runner for Dynatrace Business Observability
 * Isolated Node.js processes that Dynatrace can track as separate services
 */
const express = require('express');
const http = require('http');
const crypto = require('crypto');

// Load enhanced error handling if available
let errorHandlingMiddleware;
try {
  const errorHelper = require('./dynatrace-error-helper.cjs');
  errorHandlingMiddleware = errorHelper.errorHandlingMiddleware;
} catch (e) {
  // Fallback if error helper is not available
  errorHandlingMiddleware = (serviceName) => (error, req, res, next) => {
    console.error(`[${serviceName}] Unhandled error:`, error.message);
    res.status(500).json({ 
      status: 'error', 
      error: error.message,
      service: serviceName,
      traceError: true
    });
  };
}

// Extract company context from environment (exact field names for Dynatrace filtering)
const companyName = process.env.COMPANY_NAME || 'DefaultCompany';
const domain = process.env.DOMAIN || 'default.com';
const industryType = process.env.INDUSTRY_TYPE || 'general';
const stepNameEnv = process.env.STEP_NAME || 'UnknownStep';

// Set Dynatrace environment variables for OneAgent
const serviceName = process.argv[2] || 'UnknownService';

// Set process title for OneAgent detection
process.title = serviceName;

// Minimal OneAgent service detection
process.env.DT_SERVICE_NAME = serviceName;
process.env.DT_APPLICATION_NAME = 'BizObs-CustomerJourney';
process.env.DT_CLUSTER_ID = serviceName;
process.env.DT_NODE_ID = `${serviceName}-node`;

// Override process group name for Dynatrace
process.env.DT_PROCESS_GROUP_NAME = serviceName;

function createService(serviceName, mountFn) {
  // CRITICAL: Set process identity for Dynatrace detection immediately
  try { 
    // Set process title - this is what Dynatrace sees as the service name
    process.title = serviceName; 
    
    // Set environment variables for Dynatrace service detection
    process.env.DT_APPLICATION_ID = serviceName;
    process.env.DT_SERVICE_NAME = serviceName;
    process.env.DYNATRACE_SERVICE_NAME = serviceName;
    process.env.DT_LOGICAL_SERVICE_NAME = serviceName;
    // OneAgent RUXIT variables for service naming
    process.env.RUXIT_APPLICATION_ID = serviceName;
    process.env.RUXIT_APPLICATIONID = serviceName;
    
    // CRITICAL: Set process argv[0] to help with service detection
    // This changes what 'ps' shows as the command name
    if (process.argv && process.argv.length > 0) {
      process.argv[0] = serviceName;
    }
    
    console.log(`[service-runner] Service identity set to: ${serviceName} (PID: ${process.pid})`);
  } catch (e) {
    console.error(`[service-runner] Failed to set service identity: ${e.message}`);
  }
  
  const app = express();
  
  // CRITICAL: Add body parsing middleware for JSON payloads
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  
  // Add error handling middleware
  app.use(errorHandlingMiddleware(serviceName));
  app.use((req, res, next) => {
    // Capture inbound W3C Trace Context and custom correlation
    const inboundTraceparent = req.headers['traceparent'];
    const inboundTracestate = req.headers['tracestate'];
    const inboundCorrelation = req.headers['x-correlation-id'];
    const payload = req.body || {};
    // Always use the actual service name for Dynatrace tracing
    const dynatraceServiceName = process.env.SERVICE_NAME || serviceName;
    const stepName = payload.stepName || process.env.STEP_NAME || serviceName.replace('Service', '').replace('-service', '');

    // Essential headers only (company/service info now in DT_TAGS)
    res.setHeader('X-Service-Name', dynatraceServiceName);
    res.setHeader('x-journey-step', stepName);
    if (payload.journeyId) {
      res.setHeader('x-journey-id', payload.journeyId);
    }

    // Add/propagate correlation ID
    req.correlationId = inboundCorrelation || crypto.randomBytes(8).toString('hex');
    req.dynatraceHeaders = {};
    if (inboundTraceparent) req.dynatraceHeaders.traceparent = inboundTraceparent;
    if (inboundTracestate) req.dynatraceHeaders.tracestate = inboundTracestate;
    req.serviceName = dynatraceServiceName; // Use the actual service name

  // Add minimal context headers (company context now in DT_TAGS to avoid duplicates)
  res.setHeader('x-service-type', 'bizobs-microservice');
  res.setHeader('x-version', '1.0.0');

  // Log service identification for debugging
    console.log(`[${dynatraceServiceName}] Service identified with PID ${process.pid}, handling ${req.method} ${req.path}`);

    next();
  });
  
  // Health check endpoint with error status
  app.get('/health', (req, res) => {
    try {
      res.json({ 
        status: 'ok', 
        service: serviceName,
        pid: process.pid,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
        traceSupport: true,
        errorHandling: true
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        service: serviceName,
        error: error.message,
        traceError: true
      });
    }
  });

  // Mount service-specific routes
  mountFn(app);

  const server = http.createServer(app);
  const port = process.env.PORT || 0; // Dynamic port assignment
  
  server.listen(port, () => {
    const address = server.address();
    const actualPort = typeof address === 'string' ? address : address.port;
    console.log(`[${serviceName}] Service running on port ${actualPort} with PID ${process.pid}`);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log(`[${serviceName}] Received SIGTERM, shutting down...`);
    server.close(() => {
      process.exit(0);
    });
  });
  
  process.on('SIGINT', () => {
    console.log(`[${serviceName}] Received SIGINT, shutting down...`);
    server.close(() => {
      process.exit(0);
    });
  });
}

module.exports = { createService };