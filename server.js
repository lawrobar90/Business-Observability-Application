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
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { ensureServiceRunning, getServiceNameFromStep, getServicePort, stopAllServices, stopCustomerJourneyServices, getChildServices, getChildServiceMeta, performHealthCheck, getServiceStatus } from './services/service-manager.js';

import journeyRouter from './routes/journey.js';
import simulateRouter from './routes/simulate.js';
import metricsRouter from './routes/metrics.js';
import stepsRouter from './routes/steps.js';
import flowRouter from './routes/flow.js';
import serviceProxyRouter from './routes/serviceProxy.js';
import journeySimulationRouter from './routes/journey-simulation.js';
import configRouter from './routes/config.js';
import loadrunnerRouter from './routes/loadrunner-integration.js';
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
app.post('/api/admin/reset-ports', (req, res) => {
  try {
    stopAllServices();
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
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  
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