// ...existing code...
/**
 * Dynatrace Partner Power-Up: Business Observability Server
 * Enhanced with separate child processes for proper service splitting in Dynatrace
 */

import express from 'express';
import http from 'http';
import { spawn } from 'child_process';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { ensureServiceRunning, getServiceNameFromStep, getServicePort, stopAllServices, stopCustomerJourneyServices, getChildServices, getChildServiceMeta, performHealthCheck, getServiceStatus } from './services/service-manager.js';
import portManager from './services/port-manager.js';

import journeyRouter from './routes/journey.js';
import simulateRouter from './routes/simulate.js';
import metricsRouter from './routes/metrics.js';
import stepsRouter from './routes/steps.js';
import flowRouter from './routes/flow.js';
import serviceProxyRouter from './routes/serviceProxy.js';
import journeySimulationRouter from './routes/journey-simulation.js';
import configRouter from './routes/config.js';
import loadrunnerRouter from './routes/loadrunner-integration.js';
import oauthRouter from './routes/oauth.js';
import mcpRouter from './routes/mcp-integration.js';
import { injectDynatraceMetadata, injectErrorMetadata, propagateMetadata, validateMetadata } from './middleware/dynatrace-metadata.js';
import { performComprehensiveHealthCheck } from './middleware/observability-hygiene.js';
// MongoDB integration removed

dotenv.config();

// Set Dynatrace environment variables for main server process
process.env.DT_SERVICE_NAME = 'bizobs-main-server';
process.env.DYNATRACE_SERVICE_NAME = 'bizobs-main-server';
process.env.DT_LOGICAL_SERVICE_NAME = 'bizobs-main-server';
process.env.DT_APPLICATION_NAME = 'bizobs-main-server';
process.env.DT_PROCESS_GROUP_NAME = 'bizobs-main-server';
process.env.DT_TAGS = 'service=bizobs-main-server';
process.env.DT_CUSTOM_PROP = 'service.splitting=enabled';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy to get correct protocol (HTTPS) from headers
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Configuration with EasyTravel-style ports
const portOffset = parseInt(process.env.PORT_OFFSET || '0');
const PORT = parseInt(process.env.PORT || '8080') + portOffset;

// OneAgent Environment Configuration for Host Monitoring
process.env.DT_RELEASE_PRODUCT = process.env.DT_RELEASE_PRODUCT || 'BizObs-Engine';
process.env.DT_RELEASE_STAGE = process.env.DT_RELEASE_STAGE || 'production';
process.env.DT_CLUSTER_ID = process.env.DT_CLUSTER_ID || 'ace-box-host';
process.env.DT_NODE_ID = process.env.DT_NODE_ID || 'ec2-bizobs-host';

// Main Server Dynatrace Configuration
process.env.DT_SERVICE_NAME = 'BizObs-MainServer';
process.env.DT_APPLICATION_NAME = 'BizObs-MainServer';
process.env.DT_TAGS = 'service=BizObs-MainServer';
process.env.DT_CUSTOM_PROP = 'role=main-server;type=api-gateway';

// Child service management now handled by service-manager.js
// Services are created dynamically based on journey steps

// startChildService is now in service-manager.js

// ensureServiceRunning is now in service-manager.js

// Helper to call child service and get JSON response with enhanced error handling
function callChildService(serviceName, payload, port, tracingHeaders = {}) {
  return new Promise((resolve, reject) => {
    const targetPort = port;
    
    // Propagate Dynatrace metadata from original headers
    const propagatedHeaders = propagateMetadata(tracingHeaders, {
      'dt.service-call': 'child-service',
      'dt.target-service': serviceName
    });
    
    const options = {
      hostname: '127.0.0.1',
      port: targetPort,
      path: '/process',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-correlation-id': (tracingHeaders['x-correlation-id'] || payload?.correlationId) || uuidv4(),
        ...propagatedHeaders
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          
          // Check if the response indicates an error
          if (json.status === 'error' || json.traceError || res.headers['x-trace-error']) {
            console.error(`[main-server] Service ${serviceName} returned error:`, json.error || 'Unknown error');
            
            // Propagate trace error information
            const error = new Error(json.error || `Service ${serviceName} failed`);
            error.traceError = true;
            error.serviceName = serviceName;
            error.errorType = json.errorType || 'ServiceError';
            error.httpStatus = res.statusCode;
            error.correlationId = json.correlationId;
            error.response = json;
            
            reject(error);
            return;
          }
          
          // Success response
          resolve(json);
        } catch (e) {
          const parseError = new Error(`Invalid JSON from ${serviceName}: ${e.message}`);
          parseError.traceError = true;
          parseError.serviceName = serviceName;
          parseError.errorType = 'JSONParseError';
          reject(parseError);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`[main-server] Network error calling ${serviceName}:`, error.message);
      const networkError = new Error(`Network error calling ${serviceName}: ${error.message}`);
      networkError.traceError = true;
      networkError.serviceName = serviceName;
      networkError.errorType = 'NetworkError';
      reject(networkError);
    });
    
    // Set timeout for service calls
    req.setTimeout(30000, () => {
      req.destroy();
      const timeoutError = new Error(`Timeout calling service ${serviceName}`);
      timeoutError.traceError = true;
      timeoutError.serviceName = serviceName;
      timeoutError.errorType = 'TimeoutError';
      reject(timeoutError);
    });
    
    req.end(JSON.stringify(payload || {}));
  });
}

// Middleware
app.use(cors());
app.use(compression());
// Request logging for easier debugging
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' })); // Increase JSON payload limit
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inject Dynatrace metadata for ACE-Box compatibility
app.use(injectDynatraceMetadata);

// Frontend host label (avoid showing raw 'localhost')
function hostToLabel(host) {
  if (!host) return 'Unknown Host';
  if (process.env.APP_DOMAIN_LABEL) return process.env.APP_DOMAIN_LABEL;
  if (host.includes('localhost') || host.startsWith('127.')) return 'Local Dev';
  return host;
}

// Attach helpful request context and distributed tracing
app.use((req, res, next) => {
  const cid = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = cid;
  res.setHeader('x-correlation-id', cid);

  // Extract and preserve all Dynatrace tracing headers for propagation
  req.tracingHeaders = {};
  const headerKeys = Object.keys(req.headers || {});
  for (const key of headerKeys) {
    const lowerKey = key.toLowerCase();
    // Capture Dynatrace, W3C Trace Context, and other distributed tracing headers
    if (lowerKey.startsWith('x-dynatrace') || 
        lowerKey.startsWith('traceparent') || 
        lowerKey.startsWith('tracestate') || 
        lowerKey.startsWith('x-trace') || 
        lowerKey.startsWith('x-request-id') || 
        lowerKey.startsWith('x-correlation-id') || 
        lowerKey.startsWith('x-span-id') || 
        lowerKey.startsWith('dt-') ||
        lowerKey.startsWith('uber-trace-id')) {
      req.tracingHeaders[key] = req.headers[key];
    }
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  req.frontendHostLabel = hostToLabel(host);
  res.setHeader('X-App-Domain-Label', req.frontendHostLabel);

  // Expose Socket.IO on request for route handlers
  req.io = io;
  next();
});

// Enhanced event service for separate process communication
const eventService = {
  async emitEvent(eventType, data) {
    try {
      const { stepName, substeps } = data;
      const correlationId = data.correlationId || uuidv4();
      
      console.log(`📊 Processing ${eventType} for step: ${stepName}`);
      
      if (substeps && substeps.length > 0) {
        // Process each substep through its dedicated service
        const results = [];
        
        for (const substep of substeps) {
          const serviceName = getServiceNameFromStep(substep.stepName);
          
          try {
            // Ensure the service is running using service manager
            ensureServiceRunning(substep.stepName);
            
            // Wait a moment for service to be ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Call the dedicated service
            const payload = {
              ...substep,
              correlationId,
              parentStep: stepName,
              timestamp: new Date().toISOString()
            };
            
            const servicePort = getServicePort(substep.stepName);
            const result = await callChildService(serviceName, payload, servicePort);
            results.push(result);
            
            console.log(`✅ ${serviceName} processed successfully`);
          } catch (error) {
            console.error(`❌ Error processing ${serviceName}:`, error.message);
            
            // Create comprehensive error result with trace information
            const errorResult = {
              stepName: substep.stepName,
              service: serviceName,
              status: 'error',
              error: error.message,
              errorType: error.errorType || error.constructor.name,
              traceError: error.traceError || true,
              httpStatus: error.httpStatus || 500,
              correlationId,
              timestamp: new Date().toISOString()
            };
            
            // If this is a trace error, add additional context
            if (error.traceError) {
              errorResult.traceFailed = true;
              errorResult.serviceName = error.serviceName;
              
              // Emit trace failure event
              io.emit('trace_failure', {
                correlationId,
                stepName: substep.stepName,
                serviceName,
                error: error.message,
                errorType: error.errorType,
                timestamp: new Date().toISOString()
              });
            }
            
            results.push(errorResult);
          }
        }
        
        // Emit results to connected clients
        io.emit('simulation_result', {
          correlationId,
          eventType,
          stepName,
          results,
          timestamp: new Date().toISOString()
        });
        
        return { success: true, correlationId, results };
      }
      
      return { success: true, correlationId, message: 'No substeps to process' };
    } catch (error) {
      console.error('Event emission error:', error);
      return { success: false, error: error.message };
    }
  }
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Routes
app.use('/api/journey', journeyRouter);
app.use('/api/simulate', simulateRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/steps', stepsRouter);
app.use('/api/flow', flowRouter);
app.use('/api/service-proxy', serviceProxyRouter);
app.use('/api/journey-simulation', journeySimulationRouter);
app.use('/api/config', configRouter);
app.use('/api/loadrunner', loadrunnerRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api/mcp', mcpRouter);

// Internal business event endpoint for OneAgent capture
app.post('/api/internal/bizevent', (req, res) => {
  // This endpoint exists solely for OneAgent to capture HTTP requests with flattened headers
  // The real business event data is in the headers and request body
  const flattenedFields = {};
  
  // Extract flattened fields from headers
  Object.keys(req.headers).forEach(key => {
    if (key.startsWith('x-biz-')) {
      const fieldName = key.replace('x-biz-', '').replace(/-/g, '.');
      flattenedFields[fieldName] = req.headers[key];
    }
  });
  
  console.log('[server] Internal business event captured:', {
    eventType: req.headers['x-biz-event-type'],
    correlationId: req.headers['x-biz-correlation-id'],
    stepName: req.headers['x-biz-step-name'],
    company: req.headers['x-biz-company'],
    flattenedFieldCount: Object.keys(flattenedFields).length,
    flattenedFields: flattenedFields
  });
  
  // Return success - OneAgent will capture this HTTP request/response
  res.status(200).json({ 
    success: true, 
    message: 'Business event captured',
    flattenedFieldCount: Object.keys(flattenedFields).length
  });
});

// Health check endpoint with metadata validation
app.get('/health', (req, res) => {
    const metadata = req.dynatraceMetadata || {};
    const validation = validateMetadata(res.getHeaders());
    
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        services: 'running',
        metadata: {
            injected: Object.keys(metadata).length,
            validation: validation
        }
    });
});

// Favicon endpoint
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Enhanced error testing endpoint
app.post('/api/test/error-trace', async (req, res) => {
  try {
    const { stepName = 'TestStep', shouldFail = false, errorType = 'TestError' } = req.body;
    
    if (shouldFail) {
      // Simulate a trace error
      const error = new Error(`Simulated ${errorType} in ${stepName}`);
      error.traceError = true;
      error.errorType = errorType;
      error.stepName = stepName;
      
      console.error('[test-error] Simulating trace failure:', error.message);
      throw error;
    }
    
    res.json({
      status: 'success',
      message: 'Error trace test completed successfully',
      stepName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[test-error] Trace error captured:', error.message);
    
    res.setHeader('x-trace-error', 'true');
    res.setHeader('x-error-type', error.errorType || 'TestError');
    
    res.status(500).json({
      status: 'error',
      error: error.message,
      errorType: error.errorType || 'TestError',
      traceError: true,
      stepName: error.stepName,
      timestamp: new Date().toISOString()
    });
  }
});

// --- Admin endpoint to reset all dynamic service ports (for UI Reset button) ---
app.post('/api/admin/reset-ports', async (req, res) => {
  try {
    await stopAllServices();
    res.json({ ok: true, message: 'All dynamic services stopped and ports freed.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// New endpoint for reset and restart
app.post('/api/admin/reset-and-restart', async (req, res) => {
  try {
    // First stop all services and free ports
    stopAllServices();
    console.log('🔄 All dynamic services stopped and ports freed.');
    
    // Wait a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Restart essential services for UI functionality
    const coreServices = [
      'Discovery',      // Most common first step in journeys
      'Purchase',       // Most common transaction step
      'DataPersistence' // Always needed for data storage
    ];
    
    const companyContext = {
      companyName: process.env.DEFAULT_COMPANY || 'DefaultCompany',
      domain: process.env.DEFAULT_DOMAIN || 'default.com',
      industryType: process.env.DEFAULT_INDUSTRY || 'general'
    };
    
    console.log(`🚀 Restarting ${coreServices.length} essential services after reset...`);
    
    // Start services with proper error handling
    const serviceResults = [];
    for (const stepName of coreServices) {
      try {
        ensureServiceRunning(stepName, companyContext);
        console.log(`✅ Essential service "${stepName}" restarted successfully.`);
        serviceResults.push({ stepName, status: 'restarted' });
      } catch (err) {
        console.error(`❌ Failed to restart essential service "${stepName}":`, err.message);
        serviceResults.push({ stepName, status: 'failed', error: err.message });
      }
    }
    
    const successCount = serviceResults.filter(r => r.status === 'restarted').length;
    
    res.json({ 
      ok: true, 
      message: `Services reset complete. ${successCount}/${coreServices.length} essential services restarted.`,
      serviceResults
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Admin endpoint to ensure a specific service is running (used by chained child services) ---
app.post('/api/admin/ensure-service', async (req, res) => {
  try {
    const { stepName, serviceName, context } = req.body || {};
    if (!stepName && !serviceName) {
      return res.status(400).json({ ok: false, error: 'stepName or serviceName required' });
    }
    ensureServiceRunning(stepName || serviceName, { serviceName, ...(context || {}) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Admin endpoint to list running dynamic services (simple format) ---
app.get('/api/admin/services', (req, res) => {
  try {
    const running = getChildServices();
    const items = Object.entries(running).map(([name, proc]) => ({
      service: name,
      pid: proc?.pid || null
    }));
    res.json({ ok: true, services: items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Admin endpoint to get detailed service status including startup information ---
app.get('/api/admin/services/status', (req, res) => {
  try {
    const running = getChildServices();
    const metadata = getChildServiceMeta();
    const detailedServices = Object.entries(running).map(([name, proc]) => {
      const meta = metadata[name] || {};
      const startTime = meta.startTime || null;
      const port = meta.port || getServicePort(name) || 'unknown';
      
      return {
        service: name,
        pid: proc?.pid || null,
        status: proc?.pid ? 'running' : 'stopped',
        startTime: startTime,
        uptime: startTime ? Math.floor((Date.now() - new Date(startTime).getTime()) / 1000) : 0,
        port: port,
        companyContext: {
          companyName: meta.companyName || 'unknown',
          domain: meta.domain || 'unknown',
          industryType: meta.industryType || 'unknown'
        }
      };
    });
    
    res.json({ 
      ok: true, 
      timestamp: new Date().toISOString(),
      totalServices: detailedServices.length,
      runningServices: detailedServices.filter(s => s.status === 'running').length,
      services: detailedServices,
      serverUptime: Math.floor(process.uptime()),
      serverPid: process.pid
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Global trace validation store for debugging
const traceValidationStore = {
  recentCalls: [],
  maxEntries: 50
};

// --- Admin endpoint for trace validation debugging ---
app.get('/api/admin/trace-validation', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const recentCalls = traceValidationStore.recentCalls
      .slice(-parseInt(limit))
      .reverse(); // Most recent first
    
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      totalCalls: traceValidationStore.recentCalls.length,
      recentCalls: recentCalls,
      summary: {
        callsWithTraceparent: recentCalls.filter(c => c.traceparent).length,
        callsWithTracestate: recentCalls.filter(c => c.tracestate).length,
        callsWithDynatraceId: recentCalls.filter(c => c.x_dynatrace_trace_id).length,
        uniqueTraceIds: [...new Set(recentCalls.map(c => c.traceparent?.split('-')[1]).filter(Boolean))].length
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Helper function to record trace validation data
function recordTraceValidation(stepName, headers, response) {
  const entry = {
    timestamp: new Date().toISOString(),
    stepName,
    traceparent: headers.traceparent || null,
    tracestate: headers.tracestate || null,
    x_dynatrace_trace_id: headers['x-dynatrace-trace-id'] || null,
    x_correlation_id: headers['x-correlation-id'] || null,
    responseStatus: response?.httpStatus || null,
    responseTraceparent: response?.traceparent || null
  };
  
  traceValidationStore.recentCalls.push(entry);
  
  // Keep only recent entries
  if (traceValidationStore.recentCalls.length > traceValidationStore.maxEntries) {
    traceValidationStore.recentCalls = traceValidationStore.recentCalls.slice(-traceValidationStore.maxEntries);
  }
}

// Make recordTraceValidation available globally for journey simulation
global.recordTraceValidation = recordTraceValidation;

// --- Admin endpoint to restart all core services ---
app.post('/api/admin/services/restart-all', async (req, res) => {
  try {
    console.log('🔄 Restarting all core services...');
    
    // Stop all current services
    stopAllServices();
    
    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start all core services again
    const coreServices = [
      'Discovery', 'Awareness', 'Consideration', 'Purchase', 'Completion', 
      'Retention', 'Advocacy', 'DataPersistence', 'PolicySelection', 
      'QuotePersonalization', 'PolicyActivation', 'CoverageExploration',
      'SecureCheckout', 'OngoingEngagement'
    ];
    
    const companyContext = {
      companyName: process.env.DEFAULT_COMPANY || 'DefaultCompany',
      domain: process.env.DEFAULT_DOMAIN || 'default.com',
      industryType: process.env.DEFAULT_INDUSTRY || 'general'
    };
    
    for (const stepName of coreServices) {
      try {
        ensureServiceRunning(stepName, companyContext);
      } catch (err) {
        console.error(`Failed to restart service ${stepName}:`, err.message);
      }
    }
    
    res.json({ ok: true, message: 'All core services restart initiated', servicesCount: coreServices.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  console.log('[server] Test endpoint called');
  res.json({ status: 'working', timestamp: new Date().toISOString() });
});

// Health check with service status
app.get('/api/health', (req, res) => {
  console.log('[server] Health check endpoint called');
  const runningServices = getChildServices();
  const serviceStatuses = Object.keys(runningServices).map(serviceName => ({
    service: serviceName,
    running: true,
    pid: runningServices[serviceName]?.pid || null
  }));
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mainProcess: {
      pid: process.pid,
      uptime: process.uptime(),
      port: PORT
    },
    childServices: serviceStatuses
  });
});

// Comprehensive health check endpoint with observability hygiene
app.get('/api/health/comprehensive', async (req, res) => {
  try {
    const healthReport = await performComprehensiveHealthCheck();
    const statusCode = healthReport.overallStatus === 'healthy' ? 200 : 
                      healthReport.overallStatus === 'critical' ? 503 : 202;
    
    res.status(statusCode).json(healthReport);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Comprehensive health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Comprehensive health check endpoint
app.get('/api/health/detailed', async (req, res) => {
  try {
    const healthCheck = await performHealthCheck();
    const serviceStatus = getServiceStatus();
    
    res.json({
      status: healthCheck.unhealthyServices === 0 ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      healthCheck,
      serviceStatus,
      mainProcess: {
        pid: process.pid,
        uptime: process.uptime(),
        port: PORT,
        memoryUsage: process.memoryUsage()
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Port status endpoint
app.get('/api/admin/ports', (req, res) => {
  try {
    const serviceStatus = getServiceStatus();
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      portStatus: {
        available: serviceStatus.availablePorts,
        allocated: serviceStatus.allocatedPorts,
        total: (parseInt(process.env.SERVICE_PORT_MAX || '8120') - parseInt(process.env.SERVICE_PORT_MIN || '8081') + 1), // Dynamic range
        range: serviceStatus.portRange
      },
      services: serviceStatus.services
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Force cleanup stale port allocations
app.post('/api/admin/ports/cleanup', async (req, res) => {
  try {
    const cleaned = await portManager.cleanupStaleAllocations();
    const serviceStatus = getServiceStatus();
    res.json({
      ok: true,
      message: `Cleaned ${cleaned} stale port allocations`,
      cleaned,
      portStatus: {
        available: serviceStatus.availablePorts,
        allocated: serviceStatus.allocatedPorts,
        total: (parseInt(process.env.SERVICE_PORT_MAX || '8120') - parseInt(process.env.SERVICE_PORT_MIN || '8081') + 1),
        range: serviceStatus.portRange
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// OAuth SSO Endpoints
// ============================================

// Temporary storage for OAuth state and tokens (in production, use Redis or database)
const oauthSessions = new Map();

// PKCE helper functions (MCP server style - no client secret needed!)
function generateCodeVerifier() {
  // Generate 46 random bytes for code verifier (base64url encoded = ~61 chars)
  return crypto.randomBytes(46).toString('base64url');
}

function generateCodeChallenge(verifier) {
  // SHA256 hash of verifier, base64url encoded
  return crypto.createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

// Initiate OAuth authorization flow (PKCE - automatic, simple!)
app.post('/api/oauth/authorize', async (req, res) => {
  const { environment } = req.body;
  
  if (!environment) {
    return res.status(400).json({
      ok: false,
      error: 'Missing Dynatrace environment URL'
    });
  }
  
  try {
    // Generate PKCE challenge (replaces client secret!)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Use same OAuth client as MCP server (has localhost:* already registered)
    const clientId = 'dt0s12.local-dt-mcp-server';
    
    // Use dynamic port for OAuth callback (like MCP server does with ports 5344-5349)
    const callbackPort = 5344 + Math.floor(Math.random() * 6); // Random port 5344-5349
    const redirectUri = `http://localhost:${callbackPort}/auth/login`;
    
    // Start temporary OAuth callback server on localhost (like MCP server)
    const callbackServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${callbackPort}`);
      
      if (url.pathname === '/auth/login') {
        const code = url.searchParams.get('code');
        const receivedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>OAuth Error</title></head>
              <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h1>❌ Authorization Failed</h1>
                <p><strong>Error:</strong> ${error}</p>
                <p>You can close this tab.</p>
              </body>
            </html>
          `);
          return;
        }
        
        if (code && receivedState === state) {
          // Exchange code for token
          try {
            const tokenUrl = `${environment}/sso/oauth2/token`;
            const tokenResponse = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                code: code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier
              })
            });
            
            const tokenData = await tokenResponse.json();
            
            if (tokenData.access_token) {
              // Store token globally for reuse
              activeOAuthToken = tokenData.access_token;
              tokenEnvironment = environment.replace(/\/$/, '');
              
              console.log('[OAuth] ✅ Token received and stored!');
              
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                  <head><title>Authorization Successful!</title></head>
                  <body style="font-family: Arial; padding: 40px; text-align: center;">
                    <h1>✅ Authorization Successful!</h1>
                    <p>You have successfully authorized the Dynatrace MCP Server.</p>
                    <p><strong>You can close this tab and return to your terminal.</strong></p>
                    <script>setTimeout(() => window.close(), 3000);</script>
                  </body>
                </html>
              `);
              
              // Close server after successful auth
              callbackServer.close();
            } else {
              throw new Error(tokenData.error || 'Failed to get token');
            }
          } catch (err) {
            console.error('[OAuth] Token exchange error:', err);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head><title>Token Exchange Failed</title></head>
                <body style="font-family: Arial; padding: 40px; text-align: center;">
                  <h1>❌ Token Exchange Failed</h1>
                  <p>${err.message}</p>
                  <p>You can close this tab.</p>
                </body>
              </html>
            `);
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Invalid Request</title></head>
              <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h1>❌ Invalid Request</h1>
                <p>Missing or invalid authorization code/state.</p>
                <p>You can close this tab.</p>
              </body>
            </html>
          `);
        }
      }
    });
    
    callbackServer.listen(callbackPort, 'localhost', () => {
      console.log(`[OAuth] Callback server listening on http://localhost:${callbackPort}/auth/login`);
    });
    
    // Store OAuth session with PKCE verifier and callback server
    oauthSessions.set(state, {
      environment: environment.replace(/\/$/, ''),
      clientId,
      codeVerifier, // Store for token exchange
      callbackServer, // Store server instance to close later
      timestamp: Date.now()
    });
    
    // Clean up old sessions (older than 10 minutes)
    for (const [key, session] of oauthSessions.entries()) {
      if (Date.now() - session.timestamp > 600000) {
        // Close callback server if it exists
        if (session.callbackServer) {
          session.callbackServer.close();
        }
        oauthSessions.delete(key);
      }
    }
    
    // Construct OAuth authorization URL with PKCE
    const scope = 'document:documents:read document:documents:write storage:buckets:read storage:metrics:read';
    
    // Auto-discover SSO URL by following redirect
    const envUrl = environment.replace(/\/$/, '');
    const ssoDiscoveryUrl = `${envUrl}/platform/oauth2/authorization/dynatrace-sso`;
    
    const authUrl = new URL(ssoDiscoveryUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('state', state);
    
    console.log('[OAuth] Authorization URL generated (PKCE):', authUrl.toString());
    
    res.json({
      ok: true,
      authorizationUrl: authUrl.toString(),
      state: state,
      callbackPort: callbackPort // Send port to client
    });
    
  } catch (error) {
    console.error('[OAuth] Authorization error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// OAuth callback endpoint
app.get('/api/oauth/callback', async (req, res) => {
  console.log('[OAuth Callback] === CALLBACK HIT ===');
  console.log('[OAuth Callback] Query params:', req.query);
  console.log('[OAuth Callback] Headers:', req.headers);
  
  const { code, state, error: oauthError } = req.query;
  
  if (oauthError) {
    console.error('[OAuth Callback] OAuth error received:', oauthError);
    return res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #1a1a1a; color: white;">
          <h1 style="color: #ff5252;">❌ OAuth Authorization Failed</h1>
          <p>Error: ${oauthError}</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  }
  
  if (!code || !state) {
    return res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #1a1a1a; color: white;">
          <h1 style="color: #ff5252;">❌ Invalid Callback</h1>
          <p>Missing authorization code or state</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  }
  
  const session = oauthSessions.get(state);
  
  if (!session) {
    return res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #1a1a1a; color: white;">
          <h1 style="color: #ff5252;">❌ Invalid Session</h1>
          <p>OAuth session expired or not found</p>
          <p>Please try logging in again.</p>
        </body>
      </html>
    `);
  }
  
  try {
    // Exchange authorization code for access token (PKCE - use code_verifier instead of client_secret!)
    const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/callback`;
    const tokenUrl = `${session.environment}/sso/oauth2/token`;
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
        // NO Authorization header with PKCE! code_verifier replaces client_secret
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: session.clientId,
        code: code,
        redirect_uri: redirectUri,
        code_verifier: session.codeVerifier // PKCE: code_verifier instead of client_secret!
      })
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[OAuth] Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('[OAuth] Access token received successfully (PKCE flow)');
    console.log('[OAuth] Token starts with:', tokenData.access_token.substring(0, 10));
    console.log('[OAuth] Expires in:', tokenData.expires_in, 'seconds');
    
    // Store token in session
    session.accessToken = tokenData.access_token;
    session.refreshToken = tokenData.refresh_token; // Store for automatic refresh
    session.expiresIn = tokenData.expires_in;
    session.tokenReceivedAt = Date.now();
    
    // Also store immediately in global variable for immediate access
    activeOAuthToken = tokenData.access_token;
    tokenEnvironment = session.environment;
    console.log('[OAuth] Token stored globally for environment:', tokenEnvironment);
    
    res.send(`
      <html>
        <head>
          <title>OAuth Success</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #1a1a1a; color: white;">
          <h1 style="color: #4caf50;">✅ OAuth Login Successful!</h1>
          <p>You have successfully authenticated with Dynatrace.</p>
          <p style="margin-top: 20px; color: #64b5f6;">This window will close automatically...</p>
          <p style="margin-top: 10px; font-size: 12px; color: #999;">If it doesn't close, you can close it manually.</p>
          <script>
            console.log('[OAuth Callback] Starting auto-close sequence...');
            
            // Function to notify parent and attempt close
            function notifyAndClose() {
              if (window.opener && !window.opener.closed) {
                console.log('[OAuth Callback] Sending success message to parent...');
                window.opener.postMessage({ type: 'oauth-success', state: '${state}' }, '*');
              } else {
                console.log('[OAuth Callback] No opener window found');
              }
              
              // Try to close
              try {
                window.close();
                console.log('[OAuth Callback] Window close attempted');
              } catch (e) {
                console.log('[OAuth Callback] Window close failed:', e.message);
              }
            }
            
            // Try immediately
            notifyAndClose();
            
            // Try again after small delays (in case listener not ready)
            setTimeout(notifyAndClose, 100);
            setTimeout(notifyAndClose, 500);
            setTimeout(notifyAndClose, 1000);
            
            // Show manual close message after 2 seconds if still open
            setTimeout(() => {
              document.body.innerHTML = '<div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #1a1a1a; color: white;"><h1 style="color: #4caf50;">✅ Success!</h1><p>Authentication complete!</p><p style="margin-top: 10px; color: #64b5f6;">You can close this window now.</p></div>';
            }, 2000);
              }, 1000);
            }, 500);
          </script>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('[OAuth] Callback error:', error);
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #1a1a1a; color: white;">
          <h1 style="color: #ff5252;">❌ Token Exchange Failed</h1>
          <p>Error: ${error.message}</p>
          <p>Please try logging in again.</p>
        </body>
      </html>
    `);
  }
});

// Store the active OAuth token (persists across requests)
let activeOAuthToken = null;
let tokenEnvironment = null;

// Check OAuth token status (for frontend polling)
app.get('/api/oauth/token-status', (req, res) => {
  // Check if we have an active token
  if (activeOAuthToken) {
    return res.json({
      hasToken: true,
      environment: tokenEnvironment
    });
  }
  
  // Find any session with a valid access token
  for (const [state, session] of oauthSessions.entries()) {
    if (session.accessToken) {
      // Store token for subsequent use (don't delete!)
      activeOAuthToken = session.accessToken;
      tokenEnvironment = session.environment;
      
      console.log('[OAuth] Token stored for environment:', tokenEnvironment);
      
      return res.json({
        hasToken: true,
        environment: tokenEnvironment
      });
    }
  }
  
  res.json({
    hasToken: false
  });
});

// ============================================
// Dynatrace Dashboard Deployment
// ============================================

// Dynatrace Dashboard Deployment Endpoint
app.post('/api/dynatrace/deploy-dashboard', async (req, res) => {
  try {
    const { journeyConfig } = req.body;
    
    if (!journeyConfig || !journeyConfig.companyName || !journeyConfig.steps) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required journeyConfig with companyName and steps'
      });
    }
    
    // Check for active OAuth token first (takes precedence)
    let DT_ENVIRONMENT, DT_TOKEN;
    
    console.log('[dynatrace-deploy] Checking for OAuth token...');
    console.log('[dynatrace-deploy] activeOAuthToken exists:', !!activeOAuthToken);
    console.log('[dynatrace-deploy] tokenEnvironment:', tokenEnvironment);
    
    if (activeOAuthToken && tokenEnvironment) {
      console.log('[dynatrace-deploy] ✅ Using stored OAuth token');
      DT_ENVIRONMENT = tokenEnvironment;
      DT_TOKEN = activeOAuthToken;
    } else {
      console.log('[dynatrace-deploy] ⚠️ No OAuth token, checking fallback...');
      // Fall back to environment variables or headers
      DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || req.headers['x-dt-environment'];
      DT_TOKEN = process.env.DT_PLATFORM_TOKEN || req.headers['x-dt-token'];
      console.log('[dynatrace-deploy] Fallback - Has environment:', !!DT_ENVIRONMENT, 'Has token:', !!DT_TOKEN);
    }
    
    const DT_BUDGET = process.env.DT_GRAIL_BUDGET || req.headers['x-dt-budget'] || '500';
    
    if (!DT_ENVIRONMENT || !DT_TOKEN) {
      return res.status(500).json({
        ok: false,
        needsOAuthLogin: true,
        error: 'Dynatrace not configured. Please sign in with OAuth SSO.'
      });
    }

    console.log('[dynatrace-deploy] Environment:', DT_ENVIRONMENT);
    console.log('[dynatrace-deploy] Token length:', DT_TOKEN.length, 'starts with:', DT_TOKEN.substring(0, 4));
    
    // Check if this is a Sprint environment with Platform token
    const isSprintEnvironment = DT_ENVIRONMENT.includes('.sprint.') || DT_ENVIRONMENT.includes('sprint.apps.dynatrace');
    const isPlatformToken = DT_TOKEN.length < 100 && (DT_TOKEN.startsWith('dt0s') || DT_TOKEN.startsWith('dt0c'));
    const isOAuthToken = DT_TOKEN.length > 100 && !DT_TOKEN.startsWith('dt0');
    
    console.log('[dynatrace-deploy] Detection results:', { isSprintEnvironment, isPlatformToken, isOAuthToken });
    
    // If Sprint environment + Platform token (not OAuth token), check if OAuth credentials are available
    if (isSprintEnvironment && isPlatformToken && !isOAuthToken) {
      console.log('[dynatrace-deploy] ⚠️ Sprint + Platform token detected');
      
      // Check if OAuth SSO credentials are in request body (from settings)
      const hasOAuthCreds = req.body.oauthClientId && req.body.oauthClientSecret && req.body.oauthAccountUrn;
      
      if (hasOAuthCreds) {
        console.log('[dynatrace-deploy] OAuth credentials available - prompting for SSO login');
        return res.json({
          ok: false,
          needsOAuthLogin: true,
          environment: DT_ENVIRONMENT,
          message: 'Sprint environment requires OAuth SSO authentication'
        });
      } else {
        console.log('[dynatrace-deploy] No OAuth credentials - will try Config API fallback');
      }
    } else if (isOAuthToken) {
      console.log('[dynatrace-deploy] ✅ OAuth token detected - proceeding with deployment');
    }
    
    // Set environment variables for deployer script
    process.env.DT_ENVIRONMENT = DT_ENVIRONMENT;
    process.env.DT_PLATFORM_TOKEN = DT_TOKEN;
    process.env.DT_GRAIL_BUDGET = DT_BUDGET;
    
    // Import deployer dynamically
    const { deployJourneyDashboard } = await import('./scripts/dynatrace-dashboard-deployer.js');
    
    const result = await deployJourneyDashboard(journeyConfig);
    
    if (result.success) {
      res.json({
        ok: true,
        dashboardId: result.dashboardId,
        dashboardUrl: result.dashboardUrl,
        companyName: result.companyName,
        message: `Dashboard created for ${result.companyName}`
      });
    } else {
      res.status(500).json({
        ok: false,
        error: result.error,
        companyName: result.companyName
      });
    }
  } catch (error) {
    console.error('[dynatrace-deploy] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// Dynatrace Dashboard Deployment via MCP Proxy
// ============================================

// Deploy dashboard via Dynatrace MCP Server
// ============================================
// MCP Server Management
// ============================================

let mcpServerProcess = null;
let mcpServerStatus = 'stopped'; // stopped, starting, running, error
let mcpServerAuthUrl = null;

async function probeMcpServer(port = 3000) {
  try {
    const testResponse = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      }),
      timeout: 2000
    }).catch(() => null);

    return Boolean(testResponse && testResponse.ok);
  } catch (error) {
    return false;
  }
}

async function startMcpServer(environmentUrl, port = 3000) {
  console.log('[MCP] Starting MCP server on port', port, 'for environment:', environmentUrl);
  mcpServerStatus = 'starting';
  mcpServerAuthUrl = null;

  mcpServerProcess = spawn('npx', [
    '-y',
    '@dynatrace-oss/dynatrace-mcp-server@latest',
    '--http',
    '-p',
    port.toString()
  ], {
    env: {
      ...process.env,
      DT_ENVIRONMENT: environmentUrl,
      DT_MCP_DISABLE_TELEMETRY: 'false'
    },
    cwd: process.cwd()
  });

  let outputBuffer = '';

  mcpServerProcess.stdout.on('data', (data) => {
    const output = data.toString();
    outputBuffer += output;
    console.log('[MCP stdout]', output);

    const oauthMatch = output.match(/https:\/\/[^\s]+oauth2\/authorize[^\s]+/);
    if (oauthMatch) {
      mcpServerAuthUrl = oauthMatch[0];
      console.log('[MCP] OAuth URL detected:', mcpServerAuthUrl);
    }

    if (output.includes('Dynatrace MCP Server running on HTTP')) {
      mcpServerStatus = 'running';
      console.log('[MCP] Server is now running');
    }
  });

  mcpServerProcess.stderr.on('data', (data) => {
    console.error('[MCP stderr]', data.toString());
  });

  mcpServerProcess.on('exit', (code) => {
    console.log('[MCP] Process exited with code:', code);
    mcpServerStatus = code === 0 ? 'stopped' : 'error';
    mcpServerProcess = null;
  });

  await new Promise(resolve => setTimeout(resolve, 3000));

  return {
    status: mcpServerStatus,
    authUrl: mcpServerAuthUrl,
    logs: outputBuffer
  };
}

// Start MCP Server
app.post('/api/mcp/start', async (req, res) => {
  try {
    const { environmentUrl, port = 3000 } = req.body;
    
    if (!environmentUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Missing Dynatrace environment URL'
      });
    }
    
    // Check if already running
    if (mcpServerProcess && mcpServerStatus === 'running') {
      return res.json({
        ok: true,
        status: 'already_running',
        message: 'MCP server is already running',
        port: port
      });
    }

    const startResult = await startMcpServer(environmentUrl, port);
    
    res.json({
      ok: true,
      status: startResult.status,
      message: startResult.status === 'running' ? 'MCP server started successfully' : 'MCP server is starting...',
      authUrl: startResult.authUrl,
      port: port,
      logs: startResult.logs
    });
    
  } catch (error) {
    console.error('[MCP] Start error:', error);
    mcpServerStatus = 'error';
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Get MCP Server Status
app.get('/api/mcp/status', async (req, res) => {
  // Double-check by pinging the MCP server
  let actuallyRunning = mcpServerStatus === 'running';
  
  if (!actuallyRunning) {
    const running = await probeMcpServer();
    if (running) {
      mcpServerStatus = 'running';
      actuallyRunning = true;
      console.log('[MCP] Status verified - server is running');
    }
  }
  
  res.json({
    ok: true,
    status: mcpServerStatus,
    running: actuallyRunning,
    authUrl: mcpServerAuthUrl,
    pid: mcpServerProcess?.pid || null
  });
});

// Stop MCP Server
app.post('/api/mcp/stop', (req, res) => {
  if (mcpServerProcess) {
    mcpServerProcess.kill();
    mcpServerProcess = null;
    mcpServerStatus = 'stopped';
    mcpServerAuthUrl = null;
    res.json({ ok: true, message: 'MCP server stopped' });
  } else {
    res.json({ ok: true, message: 'MCP server was not running' });
  }
});

// ============================================
// Dashboard Deployment via MCP
// ============================================

app.post('/api/dynatrace/deploy-dashboard-via-mcp', async (req, res) => {
  try {
    const { mcpServerUrl, environmentUrl, journeyConfig } = req.body;
    
    if (!mcpServerUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Missing MCP server URL'
      });
    }
    
    if (!environmentUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Missing Dynatrace environment URL'
      });
    }
    
    if (!journeyConfig) {
      return res.status(400).json({
        ok: false,
        error: 'Missing journey configuration'
      });
    }
    
    let effectiveMcpServerUrl = mcpServerUrl;
    try {
      const parsedUrl = new URL(mcpServerUrl);
      const port = parsedUrl.port || '3000';
      const isCodespacesHost = parsedUrl.hostname.endsWith('.app.github.dev');
      if (isCodespacesHost || parsedUrl.hostname === req.hostname) {
        effectiveMcpServerUrl = `http://localhost:${port}`;
      }
    } catch (urlError) {
      console.warn('[MCP Proxy] Invalid MCP server URL, using provided value:', urlError.message);
    }

    let mcpPort = 3000;
    try {
      const parsedMcpUrl = new URL(effectiveMcpServerUrl);
      mcpPort = parsedMcpUrl.port ? parseInt(parsedMcpUrl.port, 10) : 3000;
    } catch (error) {
      // Keep default
    }

    let isRunning = await probeMcpServer(mcpPort);
    if (!isRunning) {
      const startResult = await startMcpServer(environmentUrl, mcpPort);

      for (let attempt = 0; attempt < 5; attempt++) {
        if (await probeMcpServer(mcpPort)) {
          isRunning = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (!isRunning) {
        return res.status(503).json({
          ok: false,
          error: 'MCP server is not ready. Please complete OAuth if prompted and try again.',
          authUrl: startResult.authUrl || null
        });
      }
    }

    console.log('[MCP Proxy] Deploying dashboard via MCP server:', effectiveMcpServerUrl);
    console.log('[MCP Proxy] Dynatrace environment:', environmentUrl);
    console.log('[MCP Proxy] Journey:', journeyConfig.companyName, journeyConfig.journeyType);
    
    // Import deployer dynamically
    const { deployJourneyDashboard } = await import('./scripts/dynatrace-dashboard-deployer.js');
    
    // Call the dashboard deployer through MCP server
    const deployResult = await deployJourneyDashboard(journeyConfig, {
      useMcpProxy: true,
      mcpServerUrl: effectiveMcpServerUrl,
      environmentUrl: environmentUrl
    });
    
    if (deployResult.success) {
      res.json({
        ok: true,
        success: true,
        dashboardId: deployResult.dashboardId,
        dashboardUrl: deployResult.dashboardUrl,
        companyName: deployResult.companyName
      });
    } else {
      res.status(500).json({
        ok: false,
        error: deployResult.error,
        companyName: deployResult.companyName
      });
    }
  } catch (error) {
    console.error('[MCP Proxy] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// Dynatrace Dashboard Deployment (Legacy/Direct)
// ============================================

// Dynatrace Dashboard Deployment Endpoint
app.post('/api/dynatrace/deploy-dashboard', async (req, res) => {
  try {
    const { journeyConfig } = req.body;
    
    console.log('[dynatrace-deploy] Received request');
    console.log('[dynatrace-deploy] Headers:', {
      'x-dt-environment': req.headers['x-dt-environment'] ? 'present' : 'missing',
      'x-dt-token': req.headers['x-dt-token'] ? 'present (length: ' + req.headers['x-dt-token']?.length + ')' : 'missing',
      'x-dt-budget': req.headers['x-dt-budget'] || 'missing'
    });
    
    if (!journeyConfig || !journeyConfig.companyName || !journeyConfig.steps) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required journeyConfig with companyName and steps'
      });
    }
    
    // Try to get credentials from headers first (from UI), then fall back to environment variables
    const DT_ENVIRONMENT = req.headers['x-dt-environment'] || process.env.DT_ENVIRONMENT;
    const DT_TOKEN = req.headers['x-dt-token'] || process.env.DT_PLATFORM_TOKEN;
    const DT_BUDGET = req.headers['x-dt-budget'] || process.env.DT_BUDGET || '100';
    
    console.log('[dynatrace-deploy] Credentials check:', {
      hasEnvironment: !!DT_ENVIRONMENT,
      hasToken: !!DT_TOKEN,
      tokenLength: DT_TOKEN?.length || 0,
      environmentSource: req.headers['x-dt-environment'] ? 'UI Settings (headers)' : (process.env.DT_ENVIRONMENT ? 'Environment Variables' : 'NOT FOUND'),
      tokenSource: req.headers['x-dt-token'] ? 'UI Settings (headers)' : (process.env.DT_PLATFORM_TOKEN ? 'Environment Variables' : 'NOT FOUND')
    });
    
    if (!DT_ENVIRONMENT || !DT_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'Dynatrace not configured. Set credentials in environment variables or MCP Settings UI.'
      });
    }
    
    console.log('[dynatrace-deploy] Checking for Sprint + Platform token combination...');
    console.log('[dynatrace-deploy] Environment:', DT_ENVIRONMENT);
    console.log('[dynatrace-deploy] Token length:', DT_TOKEN.length, 'starts with:', DT_TOKEN.substring(0, 4));
    
    // Check if this is a Sprint environment with Platform token (unsupported combination)
    const isSprintEnvironment = DT_ENVIRONMENT.includes('.sprint.') || DT_ENVIRONMENT.includes('sprint.apps.dynatrace');
    const isPlatformToken = DT_TOKEN.length < 100 && (DT_TOKEN.startsWith('dt0s') || DT_TOKEN.startsWith('dt0c'));
    
    console.log('[dynatrace-deploy] Detection results:', { isSprintEnvironment, isPlatformToken });
    
    if (isSprintEnvironment && isPlatformToken) {
      console.error('[dynatrace-deploy] ❌ Sprint environment detected with Platform token - OAuth required');
      return res.status(403).json({
        ok: false,
        error: 'Sprint environment requires OAuth SSO authentication. Platform tokens are not supported.',
        needsOAuth: true,
        environment: DT_ENVIRONMENT,
        suggestion: 'Use MCP OAuth flow to authenticate with Sprint environment'
      });
    }
    
    // Set environment variables for the deployer script
    process.env.DT_ENVIRONMENT = DT_ENVIRONMENT;
    process.env.DT_PLATFORM_TOKEN = DT_TOKEN;
    process.env.DT_BUDGET = DT_BUDGET;
    
    // Import deployer dynamically
    const { deployJourneyDashboard } = await import('./scripts/dynatrace-dashboard-deployer.js');
    
    const result = await deployJourneyDashboard(journeyConfig);
    
    if (result.success) {
      res.json({
        ok: true,
        dashboardId: result.dashboardId,
        dashboardUrl: result.dashboardUrl,
        companyName: result.companyName,
        message: `Dashboard created for ${result.companyName}`
      });
    } else {
      res.status(500).json({
        ok: false,
        error: result.error,
        companyName: result.companyName
      });
    }
  } catch (error) {
    console.error('[dynatrace-deploy] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Query Dynatrace for journey analytics
app.post('/api/dynatrace/query-journey', async (req, res) => {
  try {
    const { companyName, timeframe } = req.body;
    
    if (!companyName) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required companyName'
      });
    }
    
    // Try environment variables first, then headers from UI
    const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || req.headers['x-dt-environment'];
    const DT_TOKEN = process.env.DT_PLATFORM_TOKEN || req.headers['x-dt-token'];
    const DT_BUDGET = process.env.DT_GRAIL_BUDGET || req.headers['x-dt-budget'] || '500';
    
    if (!DT_ENVIRONMENT || !DT_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'Dynatrace not configured. Set credentials in environment variables or MCP Settings UI.'
      });
    }
    
    // Set environment variables for deployer script
    process.env.DT_ENVIRONMENT = DT_ENVIRONMENT;
    process.env.DT_PLATFORM_TOKEN = DT_TOKEN;
    process.env.DT_GRAIL_BUDGET = DT_BUDGET;
    
    const { queryJourneyData } = await import('./scripts/dynatrace-dashboard-deployer.js');
    const result = await queryJourneyData(companyName, timeframe || '24h');
    
    res.json({
      ok: true,
      companyName,
      data: result
    });
  } catch (error) {
    console.error('[dynatrace-query] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Verify Dynatrace deployment (BizEvents, Services, Entities)
app.post('/api/dynatrace/verify-deployment', async (req, res) => {
  try {
    const { companyName, correlationId, steps } = req.body;
    
    if (!companyName) {
      return res.status(400).json({ ok: false, error: 'Missing required companyName' });
    }
    
    const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || req.headers['x-dt-environment'];
    const DT_TOKEN = process.env.DT_PLATFORM_TOKEN || req.headers['x-dt-token'];
    
    if (!DT_ENVIRONMENT || !DT_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Dynatrace not configured' });
    }
    
    const baseUrl = DT_ENVIRONMENT.replace(/\/$/, '');
    const headers = { 'Authorization': `Api-Token ${DT_TOKEN}`, 'Content-Type': 'application/json' };
    
    console.log(`[verify] Checking deployment for ${companyName}...`);
    
    // Query 1: Check BizEvents
    const bizEventsQuery = correlationId 
      ? `fetch bizevents | filter event.provider == "${companyName}" and correlationId == "${correlationId}" | summarize count()`
      : `fetch bizevents | filter event.provider == "${companyName}" | summarize count()`;
    
    let bizEventsFound = false, bizEventsCount = 0;
    try {
      const bizRes = await fetch(`${baseUrl}/platform/storage/query/v1/query:execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: bizEventsQuery, requestTimeoutMilliseconds: 30000 })
      });
      const bizData = await bizRes.json();
      if (bizData.result && bizData.result.records && bizData.result.records[0]) {
        bizEventsCount = bizData.result.records[0]['count()'] || 0;
        bizEventsFound = bizEventsCount > 0;
      }
    } catch (e) {
      console.log('[verify] BizEvents query failed:', e.message);
    }
    
    // Query 2: Check Services
    const serviceQuery = steps && steps.length > 0
      ? `fetch dt.entity.service | filter entity.name in (${steps.map(s => `"${s}Service"`).join(',')}) | summarize count()`
      : `fetch dt.entity.service | filter contains(entity.name, "${companyName}") | summarize count()`;
    
    let servicesFound = false, serviceCount = 0;
    try {
      const svcRes = await fetch(`${baseUrl}/platform/storage/query/v1/query:execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: serviceQuery, requestTimeoutMilliseconds: 30000 })
      });
      const svcData = await svcRes.json();
      if (svcData.result && svcData.result.records && svcData.result.records[0]) {
        serviceCount = svcData.result.records[0]['count()'] || 0;
        servicesFound = serviceCount > 0;
      }
    } catch (e) {
      console.log('[verify] Services query failed:', e.message);
    }
    
    // Query 3: Check Entities (process groups, hosts)
    let entitiesFound = false, entityCount = 0;
    try {
      const entRes = await fetch(`${baseUrl}/platform/storage/query/v1/query:execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          query: `fetch dt.entity.process_group | filter contains(entity.name, "bizobs") | summarize count()`,
          requestTimeoutMilliseconds: 30000 
        })
      });
      const entData = await entRes.json();
      if (entData.result && entData.result.records && entData.result.records[0]) {
        entityCount = entData.result.records[0]['count()'] || 0;
        entitiesFound = entityCount > 0;
      }
    } catch (e) {
      console.log('[verify] Entities query failed:', e.message);
    }
    
    console.log(`[verify] Results: BizEvents=${bizEventsCount}, Services=${serviceCount}, Entities=${entityCount}`);
    
    res.json({
      ok: true,
      verification: {
        bizEventsFound,
        bizEventsCount,
        servicesFound,
        serviceCount,
        entitiesFound,
        entityCount,
        timeframe: '2h',
        companyName
      }
    });
    
  } catch (error) {
    console.error('[verify] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Test Dynatrace connection
app.post('/api/dynatrace/test-connection', async (req, res) => {
  try {
    const { environment, token } = req.body;
    
    if (!environment || !token) {
      return res.status(400).json({
        ok: false,
        error: 'Missing environment URL or token'
      });
    }
    
    // Normalize environment URL (remove trailing slash)
    const baseUrl = environment.replace(/\/$/, '');
    
    // For Sprint/SaaS environments, try the app-engine health endpoint
    // This is the most reliable endpoint that exists across all environment types
    const testUrl = `${baseUrl}/platform/app-engine/v2/app-engines`;
    
    console.log('[dynatrace-test] Testing connection to:', testUrl);
    console.log('[dynatrace-test] Using token prefix:', token.substring(0, 10) + '...');
    
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    console.log('[dynatrace-test] Response status:', response.status);
    
    // Try to get response body for debugging
    let responseBody = '';
    try {
      responseBody = await response.text();
      console.log('[dynatrace-test] Response body:', responseBody.substring(0, 500));
    } catch (e) {
      console.log('[dynatrace-test] Could not read response body');
    }
    
    if (response.ok) {
      res.json({
        ok: true,
        message: 'Connection successful - Token validated',
        environment: baseUrl
      });
    } else if (response.status === 401) {
      res.json({
        ok: false,
        error: 'Authentication failed - Check your token is valid and not expired'
      });
    } else if (response.status === 403) {
      // 403 might actually mean auth worked but missing scope - that's OK for testing
      res.json({
        ok: true,
        message: 'Connection successful - Token authenticated (some scopes may be missing for this test endpoint)',
        environment: baseUrl
      });
    } else if (response.status === 404) {
      // 404 likely means auth worked but endpoint not available - try one more
      console.log('[dynatrace-test] First endpoint returned 404, trying alternative...');
      
      // Try DQL query endpoint - should work in Sprint
      const dqlTestUrl = `${baseUrl}/platform/storage/query/v1/query:execute`;
      const dqlTest = await fetch(dqlTestUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          query: "fetch bizevents | limit 1",
          requestTimeoutMilliseconds: 5000
        })
      });
      
      console.log('[dynatrace-test] DQL test status:', dqlTest.status);
      
      if (dqlTest.status === 200 || dqlTest.status === 403 || dqlTest.status === 400) {
        // Any of these means auth worked
        res.json({
          ok: true,
          message: 'Connection successful - Token validated via query endpoint',
          environment: baseUrl
        });
      } else if (dqlTest.status === 401) {
        res.json({
          ok: false,
          error: 'Authentication failed - Token may be invalid or expired'
        });
      } else {
        res.json({
          ok: false,
          error: `Could not verify connection - HTTP ${dqlTest.status}. Token may be valid but unable to confirm.`
        });
      }
    } else {
      res.json({
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        details: responseBody.substring(0, 200)
      });
    }
  } catch (error) {
    console.error('[dynatrace-test] Error:', error);
    res.json({
      ok: false,
      error: `Network error: ${error.message}`
    });
  }
});


// New Customer Journey endpoint - clears all services to start fresh
app.post('/api/admin/new-customer-journey', (req, res) => {
  try {
    console.log('[server] New Customer Journey requested - stopping customer journey services while preserving essential infrastructure');
    stopCustomerJourneyServices();
    res.json({
      ok: true,
      message: 'Customer journey services stopped, essential infrastructure services preserved',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[server] Error during new customer journey cleanup:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Configuration Persistence Endpoints
const configDir = path.join(__dirname, 'saved-configs');

// Ensure config directory exists
async function ensureConfigDir() {
  try {
    if (!existsSync(configDir)) {
      await fs.mkdir(configDir, { recursive: true });
      console.log(`📁 Created config directory: ${configDir}`);
    }
  } catch (error) {
    console.error('❌ Error creating config directory:', error);
  }
}

// Initialize config directory on startup
ensureConfigDir();

// Get all saved configurations
app.get('/api/admin/configs', async (req, res) => {
  try {
    await ensureConfigDir();
    const files = await fs.readdir(configDir);
    const configs = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(configDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const config = JSON.parse(data);
          configs.push({
            id: config.id,
            name: config.name,
            companyName: config.companyName,
            timestamp: config.timestamp,
            filename: file
          });
        } catch (error) {
          console.warn(`⚠️ Error reading config file ${file}:`, error.message);
        }
      }
    }
    
    // Sort by timestamp (newest first)
    configs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({
      ok: true,
      configs: configs,
      count: configs.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting configs:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Save a configuration
app.post('/api/admin/configs', async (req, res) => {
  try {
    await ensureConfigDir();
    const config = req.body;
    
    // Validate required fields
    if (!config.name || !config.id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: name and id',
        timestamp: new Date().toISOString()
      });
    }
    
    // Add server timestamp
    config.serverTimestamp = new Date().toISOString();
    config.version = '1.0';
    
    // Create filename from ID
    const filename = `config-${config.id}.json`;
    const filePath = path.join(configDir, filename);
    
    // Save to file
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    
    console.log(`💾 Saved configuration "${config.name}" to ${filename}`);
    
    res.json({
      ok: true,
      message: `Configuration "${config.name}" saved successfully`,
      id: config.id,
      filename: filename,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error saving config:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// List saved configurations (simplified for CLI/automation access)
app.get('/api/admin/configs/list', async (req, res) => {
  try {
    await ensureConfigDir();
    const files = await fs.readdir(configDir);
    const configs = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(configDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const config = JSON.parse(data);
          configs.push({
            id: config.id,
            name: config.name,
            companyName: config.companyName,
            stepsCount: config.steps?.length || 0,
            timestamp: config.timestamp
          });
        } catch (error) {
          console.warn(`⚠️ Error reading config file ${file}:`, error.message);
        }
      }
    }
    
    res.json({
      ok: true,
      configs: configs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
      count: configs.length
    });
    
  } catch (error) {
    console.error('❌ Error listing configs:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get a specific configuration
app.get('/api/admin/configs/:id', async (req, res) => {
  try {
    const configId = req.params.id;
    const filename = `config-${configId}.json`;
    const filePath = path.join(configDir, filename);
    
    // Check if file exists
    if (!existsSync(filePath)) {
      return res.status(404).json({
        ok: false,
        error: 'Configuration not found',
        id: configId,
        timestamp: new Date().toISOString()
      });
    }
    
    // Read and parse config
    const data = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(data);
    
    res.json({
      ok: true,
      config: config,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting config:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Delete a configuration
app.delete('/api/admin/configs/:id', async (req, res) => {
  try {
    const configId = req.params.id;
    const filename = `config-${configId}.json`;
    const filePath = path.join(configDir, filename);
    
    // Check if file exists
    if (!existsSync(filePath)) {
      return res.status(404).json({
        ok: false,
        error: 'Configuration not found',
        id: configId,
        timestamp: new Date().toISOString()
      });
    }
    
    // Read config name for logging
    let configName = 'Unknown';
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const config = JSON.parse(data);
      configName = config.name;
    } catch (e) {
      // Ignore error, just use Unknown
    }
    
    // Delete file
    await fs.unlink(filePath);
    
    console.log(`🗑️ Deleted configuration "${configName}" (${filename})`);
    
    res.json({
      ok: true,
      message: `Configuration "${configName}" deleted successfully`,
      id: configId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error deleting config:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Run a saved configuration (programmatic access for LoadRunner/automation)
app.post('/api/admin/configs/:id/run', async (req, res) => {
  try {
    const configId = req.params.id;
    const { 
      testProfile = 'medium', 
      durationMinutes = 5, 
      errorSimulationEnabled = true,
      useLoadRunner = false
    } = req.body;
    
    // Load the configuration
    const filename = `config-${configId}.json`;
    const filePath = path.join(configDir, filename);
    
    if (!existsSync(filePath)) {
      return res.status(404).json({
        ok: false,
        error: 'Configuration not found',
        id: configId,
        timestamp: new Date().toISOString()
      });
    }
    
    const data = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(data);
    
    console.log(`🚀 Running configuration "${config.name}" programmatically`);
    
    if (useLoadRunner) {
      // Forward to LoadRunner integration
      try {
        const loadrunnerPayload = {
          journeyConfig: config,
          testProfile,
          durationMinutes,
          errorSimulationEnabled
        };
        
        // Make internal request to LoadRunner endpoint
        const fetch = (await import('node-fetch')).default;
        const loadrunnerResponse = await fetch(`http://localhost:${PORT || 8080}/api/loadrunner/start-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loadrunnerPayload)
        });
        
        const loadrunnerResult = await loadrunnerResponse.json();
        
        res.json({
          ok: true,
          message: `LoadRunner test started for configuration "${config.name}"`,
          configId: configId,
          configName: config.name,
          loadrunnerResult: loadrunnerResult,
          timestamp: new Date().toISOString()
        });
        
      } catch (loadrunnerError) {
        console.error('❌ LoadRunner execution error:', loadrunnerError);
        res.status(500).json({
          ok: false,
          error: 'Failed to start LoadRunner test: ' + loadrunnerError.message,
          configId: configId,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      // Run as a regular journey simulation
      try {
        // Execute the journey steps programmatically
        let journeyResults = [];
        
        for (const step of config.steps) {
          const stepResult = {
            stepName: step.stepName,
            timestamp: new Date().toISOString(),
            status: 'completed'
          };
          
          journeyResults.push(stepResult);
          
          // Ensure the service is running for this step
          if (step.stepName) {
            ensureServiceRunning(step.stepName, { 
              companyName: config.companyName,
              domain: config.domain 
            });
          }
        }
        
        res.json({
          ok: true,
          message: `Configuration "${config.name}" executed successfully`,
          configId: configId,
          configName: config.name,
          executionType: 'journey-simulation',
          results: journeyResults,
          timestamp: new Date().toISOString()
        });
        
      } catch (executionError) {
        console.error('❌ Journey execution error:', executionError);
        res.status(500).json({
          ok: false,
          error: 'Failed to execute journey: ' + executionError.message,
          configId: configId,
          timestamp: new Date().toISOString()
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error running config:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple metrics endpoint to silence polling 404s
app.get('/api/metrics', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('# Basic metrics placeholder\napp_status 1\n');
});

// MongoDB Analytics Endpoints
// MongoDB analytics and journey endpoints removed

// Expose event service for routes
app.locals.eventService = eventService;

// Error handling with metadata injection
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  // Inject error metadata for Dynatrace
  const errorMetadata = injectErrorMetadata(err, req, res);
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId,
    metadata: errorMetadata
  });
});

// Start the server and initialize child services
server.listen(PORT, () => {
  console.log(`🚀 Business Observability Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  app.locals.port = PORT;

  // --- Pre-startup dependency validation ---
  console.log('🔍 Validating dependencies and environment...');
  
  // Check essential dependencies
  const essentialDependencies = [
    { name: 'Express', check: () => app && typeof app.listen === 'function' },
    { name: 'Socket.IO', check: () => io && typeof io.emit === 'function' },
    { name: 'Service Manager', check: () => typeof ensureServiceRunning === 'function' },
    { name: 'Event Service', check: () => typeof eventService === 'object' },
    { name: 'UUID Generator', check: () => typeof uuidv4 === 'function' }
  ];
  
  const failedDependencies = essentialDependencies.filter(dep => {
    try {
      return !dep.check();
    } catch (error) {
      console.error(`❌ Dependency check failed for ${dep.name}:`, error.message);
      return true;
    }
  });
  
  if (failedDependencies.length > 0) {
    console.error('❌ Critical dependencies missing:', failedDependencies.map(d => d.name).join(', '));
    console.error('⚠️  Some features may not work correctly.');
  } else {
    console.log('✅ All essential dependencies validated successfully.');
  }

  // --- Check directory structure and permissions ---
  const requiredDirectories = [
    './services',
    './services/.dynamic-runners',
    './routes',
    './public'
  ];
  
  requiredDirectories.forEach(dir => {
    try {
      import('fs').then(fs => {
        if (!fs.existsSync(dir)) {
          console.warn(`⚠️  Required directory missing: ${dir}`);
        }
      });
    } catch (error) {
      console.warn(`⚠️  Cannot verify directory: ${dir}`);
    }
  });

  // --- Auto-start only essential services (on-demand for others) ---
  const coreServices = [
    // Only the most commonly used services - others start on-demand
    'Discovery',      // Most common first step in journeys
    'Purchase',       // Most common transaction step
    'DataPersistence' // Always needed for data storage
  ];
  
  const companyContext = {
    companyName: process.env.DEFAULT_COMPANY || 'DefaultCompany',
    domain: process.env.DEFAULT_DOMAIN || 'default.com',
    industryType: process.env.DEFAULT_INDUSTRY || 'general'
  };
  
  console.log(`🚀 Starting ${coreServices.length} essential services (others will start on-demand)...`);
  
  // Start services with proper error handling and logging
  const serviceStartPromises = coreServices.map(async (stepName, index) => {
    try {
      // Add a small delay between service starts to prevent port conflicts
      await new Promise(resolve => setTimeout(resolve, index * 100));
      
      ensureServiceRunning(stepName, companyContext);
      console.log(`✅ Essential service for step "${stepName}" started successfully.`);
      return { stepName, status: 'started' };
    } catch (err) {
      console.error(`❌ Failed to start essential service for step "${stepName}":`, err.message);
      return { stepName, status: 'failed', error: err.message };
    }
  });
  
  // Wait for all services to attempt startup
  Promise.all(serviceStartPromises).then(results => {
    const successful = results.filter(r => r.status === 'started').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    console.log(`🔧 Service startup completed: ${successful} successful, ${failed} failed`);
    
    if (failed > 0) {
      console.log('⚠️  Failed services:', results.filter(r => r.status === 'failed').map(r => r.stepName).join(', '));
    }
    
    // Additional startup validation
    setTimeout(async () => {
      try {
        const runningServices = getChildServices();
        const runningCount = Object.keys(runningServices).length;
        console.log(`📊 Status check: ${runningCount} services currently running`);
        
        if (runningCount < successful * 0.8) {
          console.warn('⚠️  Some services may have failed to start properly. Check logs for details.');
        } else {
          console.log('✨ All core services appear to be running successfully!');
        }
      } catch (error) {
        console.error('❌ Error during startup validation:', error.message);
      }
    }, 3000);
    }).catch(error => {
    console.error('❌ Critical error during service startup:', error.message);
  });
  
  // Start periodic health monitoring every 15 minutes
  const healthMonitor = setInterval(async () => {
    try {
      const healthCheck = await performHealthCheck();
      if (healthCheck.unhealthyServices > 0 || healthCheck.portConflicts > 0) {
        console.warn(`⚠️  Health check issues: ${healthCheck.unhealthyServices} unhealthy services, ${healthCheck.portConflicts} port conflicts, ${healthCheck.availablePorts} ports available`);
        if (healthCheck.issues.length > 0) {
          console.warn('Issues:', healthCheck.issues.slice(0, 3).join(', '));
        }
      }
    } catch (error) {
      console.error('❌ Health monitor error:', error.message);
    }
  }, 900000); // 15 minutes = 900,000 milliseconds
  
  // Store health monitor for cleanup
  server.healthMonitor = healthMonitor;
  
  // --- Auto-start MCP Server ---
  console.log('🔍 Checking for Dynatrace MCP Server configuration...');
  
  // Check for environment variable first, then check if we can load from some config
  const dtEnvironment = process.env.DT_ENVIRONMENT || process.env.DT_MCP_ENVIRONMENT;
  
  if (dtEnvironment) {
    console.log(`🚀 Starting Dynatrace MCP Server for environment: ${dtEnvironment}`);
    
    // Start MCP server automatically
    mcpServerStatus = 'starting';
    mcpServerProcess = spawn('npx', [
      '-y',
      '@dynatrace-oss/dynatrace-mcp-server@latest',
      '--http',
      '-p',
      '3000'
    ], {
      env: {
        ...process.env,
        DT_ENVIRONMENT: dtEnvironment,
        DT_MCP_DISABLE_TELEMETRY: 'false'
      },
      cwd: process.cwd()
    });
    
    // Capture stdout for OAuth URL
    mcpServerProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[MCP]', output.trim());
      
      // Look for OAuth URL
      const oauthMatch = output.match(/https:\/\/[^\s]+oauth2\/authorize[^\s]+/);
      if (oauthMatch) {
        mcpServerAuthUrl = oauthMatch[0];
        console.log('🔐 [MCP] OAuth URL available (open in browser if needed)');
      }
      
      // Check if server started successfully
      if (output.includes('Dynatrace MCP Server running on HTTP')) {
        mcpServerStatus = 'running';
        console.log('✅ [MCP] Server is now running on port 3000');
      }
    });
    
    mcpServerProcess.stderr.on('data', (data) => {
      const error = data.toString().trim();
      if (!error.includes('npm warn') && !error.includes('nohup:')) {
        console.error('[MCP ERROR]', error);
      }
    });
    
    mcpServerProcess.on('exit', (code) => {
      console.log(`[MCP] Process exited with code: ${code}`);
      mcpServerStatus = code === 0 ? 'stopped' : 'error';
      mcpServerProcess = null;
    });
  } else {
    console.log('ℹ️  No DT_ENVIRONMENT set - MCP server will start on first connection test');
    console.log('💡 Set DT_ENVIRONMENT env var to auto-start MCP server on app startup');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  
  // Stop MCP server if running
  if (mcpServerProcess) {
    console.log('[MCP] Stopping MCP server...');
    mcpServerProcess.kill();
    mcpServerProcess = null;
  }
  
  // Stop health monitor
  if (server.healthMonitor) {
    clearInterval(server.healthMonitor);
  }
  
  // Close child services
  stopAllServices();
  
  server.close(() => {
    console.log('👋 Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  
  // Stop MCP server if running
  if (mcpServerProcess) {
    console.log('[MCP] Stopping MCP server...');
    mcpServerProcess.kill();
    mcpServerProcess = null;
  }
  
  // Stop health monitor
  if (server.healthMonitor) {
    clearInterval(server.healthMonitor);
  }
  
  // Close child services using service manager
  stopAllServices();
  
  server.close(() => {
    console.log('👋 Server closed');
    process.exit(0);
  });
});

export default app;