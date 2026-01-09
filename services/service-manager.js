import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import portManager from './port-manager.js';
import { propagateMetadata } from '../middleware/dynatrace-metadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track running child services and their context
const childServices = {};
const childServiceMeta = {};

// Check if a service port is ready to accept connections
export async function isServiceReady(port, timeout = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    
    function checkPort() {
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/health',
        method: 'GET',
        timeout: 1000
      }, (res) => {
        resolve(true);
      });
      
      req.on('error', () => {
        if (Date.now() - start < timeout) {
          setTimeout(checkPort, 200);
        } else {
          resolve(false);
        }
      });
      
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start < timeout) {
          setTimeout(checkPort, 200);
        } else {
          resolve(false);
        }
      });
      
      req.end();
    }
    
    checkPort();
  });
}

// Convert step name to service format with enhanced dynamic generation
export function getServiceNameFromStep(stepName, context = {}) {
  if (!stepName) return null;
  
  // If already a proper service name, keep it
  if (/Service$|API$|Processor$|Manager$|Gateway$/.test(String(stepName))) {
    return String(stepName);
  }
  
  // Extract context information for more intelligent naming
  const description = context.description || '';
  const category = context.category || context.type || '';
  
  // Determine service suffix based on context
  let serviceSuffix = 'Service'; // default
  
  if (description.toLowerCase().includes('api') || context.endpoint) {
    serviceSuffix = 'API';
  } else if (description.toLowerCase().includes('process') || description.toLowerCase().includes('handle')) {
    serviceSuffix = 'Processor';
  } else if (description.toLowerCase().includes('manage') || description.toLowerCase().includes('control')) {
    serviceSuffix = 'Manager';
  } else if (description.toLowerCase().includes('gateway') || description.toLowerCase().includes('proxy')) {
    serviceSuffix = 'Gateway';
  } else if (category && !category.toLowerCase().includes('step')) {
    // Use category as suffix if it's meaningful
    serviceSuffix = category.charAt(0).toUpperCase() + category.slice(1) + 'Service';
  }
  
  // Clean service naming: remove redundant words and normalize format
  const cleaned = String(stepName)
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .replace(/\b(service|step|process|handler)\b/gi, '') // Remove redundant service-related words
    .trim();
    
  // Split camelCase and normalize spacing
  const spaced = cleaned
    .replace(/[\-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
    
  // Create clean service base name
  const serviceBase = spaced
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  
  // Avoid double "Service" suffix and keep names concise  
  const baseName = serviceBase.replace(/Service$/, '');
  let serviceName = `${baseName}${serviceSuffix}`;
  
  // Additional cleanup: remove redundant words that make names too long
  serviceName = serviceName.replace(/ProcessService$/, 'Service');
  serviceName = serviceName.replace(/HandlerService$/, 'Service'); 
  serviceName = serviceName.replace(/StepService$/, 'Service');
  
  console.log(`[service-manager] Converting step "${stepName}" to clean service "${serviceName}"`);
  return serviceName;
}

// Get port for service using robust port manager
export async function getServicePort(stepName, companyName = 'DefaultCompany') {
  const baseServiceName = getServiceNameFromStep(stepName);
  if (!baseServiceName) return null;
  
  // Create compound service name for internal tracking and port allocation
  const internalServiceName = `${baseServiceName}-${companyName.replace(/[^a-zA-Z0-9]/g, '')}`;
  // Use clean service name for Dynatrace service identification (per user request)
  const dynatraceServiceName = baseServiceName;
  
  try {
    // Check if service already has a port allocated using the compound name
    const existingPort = portManager.getServicePort(internalServiceName, companyName);
    if (existingPort) {
      console.log(`[service-manager] Service "${baseServiceName}" for ${companyName} already allocated to port ${existingPort}`);
      return existingPort;
    }
    
    // Allocate new port using robust port manager with compound name
    const port = await portManager.allocatePort(internalServiceName, companyName);
    console.log(`[service-manager] Service "${baseServiceName}" for ${companyName} allocated port ${port}`);
    return port;
    
  } catch (error) {
    console.error(`[service-manager] Failed to allocate port for ${baseServiceName}: ${error.message}`);
    throw error;
  }
}

// Cleanup dead services using port manager
function cleanupDeadServices() {
  const deadServices = [];
  
  for (const [serviceName, child] of Object.entries(childServices)) {
    if (child.killed || child.exitCode !== null) {
      deadServices.push(serviceName);
    }
  }
  
  deadServices.forEach(serviceName => {
    console.log(`[service-manager] Cleaning up dead service: ${serviceName}`);
    delete childServices[serviceName];
    delete childServiceMeta[serviceName];
    
    // Free the port using port manager
    const meta = childServiceMeta[serviceName];
    if (meta && meta.port) {
      portManager.releasePort(meta.port, serviceName);
    }
  });
  
  console.log(`[service-manager] Cleanup completed: ${deadServices.length} dead services removed`);
}

// Start child service process
export async function startChildService(internalServiceName, scriptPath, env = {}) {
  // Use the original step name from env, not derived from service name
  const stepName = env.STEP_NAME;
  if (!stepName) {
    console.error(`[service-manager] No STEP_NAME provided for service ${internalServiceName}`);
    return null;
  }
  
  // Extract company context for tagging
  const companyName = env.COMPANY_NAME || 'DefaultCompany';
  const domain = env.DOMAIN || 'default.com';
  const industryType = env.INDUSTRY_TYPE || 'general';
  
  // Get Dynatrace service name (clean name without company suffix)
  const dynatraceServiceName = env.DYNATRACE_SERVICE_NAME || env.BASE_SERVICE_NAME || internalServiceName.replace(/-[^-]*$/, '');
  
  let port; // Declare port outside try block for error handling
  try {
    port = await getServicePort(stepName, companyName);
    console.log(`🚀 Starting child service: ${dynatraceServiceName} (${internalServiceName}) on port ${port} for company: ${companyName} (domain: ${domain}, industry: ${industryType})`);
    
    const child = spawn('node', [`--title=${dynatraceServiceName}`, scriptPath, dynatraceServiceName], {
      env: { 
        ...process.env, 
        SERVICE_NAME: dynatraceServiceName, 
        FULL_SERVICE_NAME: internalServiceName,
        PORT: port,
        MAIN_SERVER_PORT: process.env.PORT || '8080',
        // Company context for business observability
        COMPANY_NAME: companyName,
        DOMAIN: domain,
        INDUSTRY_TYPE: industryType,
        CATEGORY: env.CATEGORY || 'general',
        // Dynatrace service identification (OneAgent recognizes these) - use clean service name
        DT_SERVICE_NAME: dynatraceServiceName,
        DYNATRACE_SERVICE_NAME: dynatraceServiceName,
        DT_LOGICAL_SERVICE_NAME: dynatraceServiceName,
        // Node.js specific environment variables that OneAgent reads
        NODEJS_APP_NAME: dynatraceServiceName,
        // Process group identification
        DT_PROCESS_GROUP_NAME: dynatraceServiceName,
        DT_PROCESS_GROUP_INSTANCE: `${dynatraceServiceName}-${port}`,
        // Application context - use consistent app name like old working version
        DT_APPLICATION_NAME: 'BizObs-CustomerJourney',
        DT_CLUSTER_ID: dynatraceServiceName,
        DT_NODE_ID: `${dynatraceServiceName}-node`,
        // Dynatrace tags - comprehensive metadata for business observability (all lowercase, clean format)
        DT_TAGS: `company=${companyName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()} app=bizobs-journey service=${dynatraceServiceName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()} release-stage=production owner=ace-box-demo customer-id=${companyName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}-demo environment=ace-box product=dynatrace domain=${domain.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()} industry=${industryType.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()} industry-type=${industryType.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()} journey-detail=${(env.JOURNEY_DETAIL || stepName || 'unknown_journey').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
        // Release information
        DT_RELEASE_PRODUCT: 'BizObs-Engine',
        DT_RELEASE_STAGE: 'production',
        // Override OneAgent service naming (critical for service detection) - use clean service name
        RUXIT_APPLICATION_ID: dynatraceServiceName,
        RUXIT_APPLICATIONID: dynatraceServiceName,
        RUXIT_PROCESS_GROUP: dynatraceServiceName,
        // Force OneAgent to use environment for service naming
        DT_APPLICATIONID: dynatraceServiceName,
        DT_APPLICATION_ID: dynatraceServiceName,
        // Node.js web application override (prevents package.json name from being used)
        DT_WEB_APPLICATION_ID: dynatraceServiceName,
        DT_APPLICATION_BUILD_VERSION: dynatraceServiceName,
        // Additional service detection overrides
        DT_SERVICE_DETECTION_FULL_NAME: dynatraceServiceName,
        DT_SERVICE_DETECTION_RULE_NAME: dynatraceServiceName,
        ...env 
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    child.stdout.on('data', d => console.log(`[${dynatraceServiceName}] ${d.toString().trim()}`));
    child.stderr.on('data', d => console.error(`[${dynatraceServiceName}][ERR] ${d.toString().trim()}`));
    child.on('exit', code => {
      console.log(`[${dynatraceServiceName}] exited with code ${code}`);
      delete childServices[internalServiceName];
      delete childServiceMeta[internalServiceName];
      // Free up the port using port manager
      portManager.releasePort(port, internalServiceName);
    });
    
    // Track startup time and metadata
    child.startTime = new Date().toISOString();
    childServices[internalServiceName] = child;
    // Record metadata for future context checks
    childServiceMeta[internalServiceName] = { 
      companyName, 
      domain, 
      industryType, 
      startTime: child.startTime,
      port 
    };
    return child;
    
  } catch (error) {
    console.error(`[service-manager] Failed to start service ${dynatraceServiceName}: ${error.message}`);
    // Release port if allocation succeeded but service start failed
    if (port) {
      portManager.releasePort(port, internalServiceName);
    }
    throw error;
  }
}// Function to start services dynamically based on journey steps
export async function ensureServiceRunning(stepName, companyContext = {}) {
  console.log(`[service-manager] ensureServiceRunning called for step: ${stepName}`);
  
  // Use exact serviceName from payload if provided, otherwise auto-generate with context
  const stepContext = {
    description: companyContext.description || '',
    category: companyContext.category || companyContext.type || '',
    endpoint: companyContext.endpoint
  };
  
  const baseServiceName = companyContext.serviceName || getServiceNameFromStep(stepName, stepContext);
  
  // Extract company context with defaults
  const companyName = companyContext.companyName || 'DefaultCompany';
  const domain = companyContext.domain || 'default.com';
  const industryType = companyContext.industryType || 'general';
  const stepEnvName = companyContext.stepName || stepName;
  const category = stepContext.category || 'general';
  
  // Create a unique service key per company to allow service reuse within same company
  const internalServiceName = `${baseServiceName}-${companyName.replace(/[^a-zA-Z0-9]/g, '')}`;
  // Use clean service name for Dynatrace service identification (per user request)
  const dynatraceServiceName = baseServiceName;
  console.log(`[service-manager] Company-specific service name: ${internalServiceName} (base: ${baseServiceName}, company: ${companyName})`);
  
  const desiredMeta = {
    companyName,
    domain,
    industryType,
    baseServiceName
  };

  const existing = childServices[internalServiceName];
  const existingMeta = childServiceMeta[internalServiceName];

  // Check for company context mismatch FIRST - now we only care about domain/industry since company is in service name
  const metaMismatch = existingMeta && (
    existingMeta.domain !== desiredMeta.domain ||
    existingMeta.industryType !== desiredMeta.industryType
  );

  console.log(`[service-manager] DEBUG: Service ${internalServiceName}, existing: ${!!existing}, meta: ${!!existingMeta}`);
  if (existingMeta) {
    console.log(`[service-manager] DEBUG: Existing meta:`, JSON.stringify(existingMeta));
    console.log(`[service-manager] DEBUG: Desired meta:`, JSON.stringify(desiredMeta));
    console.log(`[service-manager] DEBUG: Meta mismatch: ${metaMismatch}`);
  }

  // If service exists and is still running AND context matches, return it immediately
  if (existing && !existing.killed && existing.exitCode === null && !metaMismatch) {
    console.log(`[service-manager] Service ${internalServiceName} already running (PID: ${existing.pid}), reusing existing instance for ${companyName}`);
    // Return the port number
    return existingMeta?.port;
  }

  if (!existing || metaMismatch) {
    if (existing && metaMismatch) {
      console.log(`[service-manager] Context change detected for ${internalServiceName}. Restarting service to apply new tags:`, JSON.stringify({ from: existingMeta, to: desiredMeta }));
      try { existing.kill('SIGTERM'); } catch {}
      delete childServices[internalServiceName];
      delete childServiceMeta[internalServiceName];
      // Free up the port using port manager
      const meta = childServiceMeta[internalServiceName];
      if (meta && meta.port) {
        portManager.releasePort(meta.port, internalServiceName);
      }
    }
    console.log(`[service-manager] Service ${internalServiceName} not running, starting it for company: ${companyName}...`);
    // Try to start with existing service file, fallback to dynamic service
    const specificServicePath = path.join(__dirname, `${internalServiceName}.cjs`);
    const dynamicServicePath = path.join(__dirname, 'dynamic-step-service.cjs');
    // Create a per-service wrapper so the Node entrypoint filename matches the service name
    const runnersDir = path.join(__dirname, '.dynamic-runners');
    const wrapperPath = path.join(runnersDir, `${internalServiceName}.cjs`);
    try {
      // Check if specific service exists
      if (fs.existsSync(specificServicePath)) {
        console.log(`[service-manager] Starting specific service: ${specificServicePath}`);
        const child = await startChildService(internalServiceName, specificServicePath, { 
          STEP_NAME: stepEnvName,
          COMPANY_NAME: companyName,
          DOMAIN: domain,
          INDUSTRY_TYPE: industryType,
          CATEGORY: category,
          BASE_SERVICE_NAME: baseServiceName,
          DYNATRACE_SERVICE_NAME: dynatraceServiceName
        });
        const meta = childServiceMeta[internalServiceName];
        const allocatedPort = meta?.port;
        // Wait for service health endpoint to be ready before returning port
        if (allocatedPort) {
          const ready = await isServiceReady(allocatedPort, 5000);
          if (!ready) {
            console.error(`[service-manager] Service ${dynatraceServiceName} started but did not become ready on port ${allocatedPort}`);
            throw new Error(`Service ${dynatraceServiceName} not responding on port ${allocatedPort}`);
          }
        }
        return allocatedPort;
      } else {
        // Ensure runners directory exists
        if (!fs.existsSync(runnersDir)) {
          fs.mkdirSync(runnersDir, { recursive: true });
        }
        // Create/overwrite wrapper with service-specific entrypoint
        const wrapperSource = `// Auto-generated wrapper for ${dynatraceServiceName}\n` +
`process.env.SERVICE_NAME = ${JSON.stringify(dynatraceServiceName)};\n` +
`process.env.FULL_SERVICE_NAME = ${JSON.stringify(dynatraceServiceName)};\n` +
`process.env.STEP_NAME = ${JSON.stringify(stepEnvName)};\n` +
`process.env.COMPANY_NAME = ${JSON.stringify(companyName)};\n` +
`process.env.DOMAIN = ${JSON.stringify(domain)};\n` +
`process.env.INDUSTRY_TYPE = ${JSON.stringify(industryType)};\n` +
`process.env.CATEGORY = ${JSON.stringify(category)};\n` +
`process.title = process.env.SERVICE_NAME;\n` +
`// Plain env tags often picked as [Environment] in Dynatrace\n` +
`process.env.company = process.env.COMPANY_NAME;\n` +
`process.env.app = 'BizObs-CustomerJourney';\n` +
`process.env.service = process.env.SERVICE_NAME;\n` +
`// Dynatrace service detection\n` +
`process.env.DT_SERVICE_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DYNATRACE_SERVICE_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DT_LOGICAL_SERVICE_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DT_PROCESS_GROUP_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DT_PROCESS_GROUP_INSTANCE = process.env.SERVICE_NAME + '-' + (process.env.PORT || '');\n` +
`process.env.DT_APPLICATION_NAME = 'BizObs-CustomerJourney';\n` +
`process.env.DT_CLUSTER_ID = process.env.SERVICE_NAME;\n` +
`process.env.DT_NODE_ID = process.env.SERVICE_NAME + '-node';\n` +
`// Dynatrace comprehensive tags for business observability (all lowercase, clean format)\n` +
`process.env.DT_TAGS = 'company=' + process.env.COMPANY_NAME.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + ' app=bizobs-journey service=' + process.env.SERVICE_NAME.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + ' release-stage=production owner=ace-box-demo customer-id=' + process.env.COMPANY_NAME.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + '-demo environment=ace-box product=dynatrace domain=' + process.env.DOMAIN.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + ' industry=' + process.env.INDUSTRY_TYPE.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + ' industry-type=' + process.env.INDUSTRY_TYPE.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + ' journey-detail=' + (process.env.JOURNEY_DETAIL || process.env.STEP_NAME || 'unknown_journey').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();\n` +
`// Node.js web application override (prevents package.json name from being used)\n` +
`process.env.DT_WEB_APPLICATION_ID = process.env.SERVICE_NAME;\n` +
`process.env.DT_APPLICATION_BUILD_VERSION = process.env.SERVICE_NAME;\n` +
`process.env.DT_SERVICE_DETECTION_FULL_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DT_SERVICE_DETECTION_RULE_NAME = process.env.SERVICE_NAME;\n` +
`// Override argv[0] for Dynatrace process detection\n` +
`if (process.argv && process.argv.length > 0) process.argv[0] = process.env.SERVICE_NAME;\n` +
`require(${JSON.stringify(dynamicServicePath)}).createStepService(process.env.SERVICE_NAME, process.env.STEP_NAME);\n`;
        fs.writeFileSync(wrapperPath, wrapperSource, 'utf-8');
        console.log(`[service-manager] Starting dynamic service via wrapper: ${wrapperPath}`);
        const child = await startChildService(internalServiceName, wrapperPath, { 
          STEP_NAME: stepEnvName,
          COMPANY_NAME: companyName,
          DOMAIN: domain,
          INDUSTRY_TYPE: industryType,
          CATEGORY: category,
          BASE_SERVICE_NAME: baseServiceName,
          DYNATRACE_SERVICE_NAME: dynatraceServiceName,
          JOURNEY_DETAIL: companyContext.journeyDetail || stepName || 'Unknown_Journey'
        });
        const meta = childServiceMeta[internalServiceName];
        const allocatedPort = meta?.port;
        // Wait for service health endpoint to be ready before returning port
        if (allocatedPort) {
          const ready = await isServiceReady(allocatedPort, 5000);
          if (!ready) {
            console.error(`[service-manager] Service ${dynatraceServiceName} started but did not become ready on port ${allocatedPort}`);
            throw new Error(`Service ${dynatraceServiceName} not responding on port ${allocatedPort}`);
          }
        }
        return allocatedPort;
      }
    } catch (e) {
      console.error(`[service-manager] Failed to start service for step ${stepName}:`, e.message);
    }
  } else {
    console.log(`[service-manager] Service ${internalServiceName} already running`);
    // Verify the service is actually responsive
    const meta = childServiceMeta[internalServiceName];
    if (meta && meta.port) {
      const isReady = await isServiceReady(meta.port, 1000);
      if (!isReady) {
        console.log(`[service-manager] Service ${internalServiceName} not responding, restarting...`);
        try { existing.kill('SIGTERM'); } catch {}
        delete childServices[internalServiceName];
        delete childServiceMeta[internalServiceName];
        // Free the port allocation and return to pool
        if (portAllocations.has(internalServiceName)) {
          const port = portAllocations.get(internalServiceName);
          portAllocations.delete(internalServiceName);
          portPool.add(port);
          console.log(`[service-manager] Freed port ${port} for unresponsive service ${internalServiceName}`);
        }
        // Restart the service
        return ensureServiceRunning(stepName, companyContext);
      }
    }
  }
  
  // Return port number
  const meta = childServiceMeta[internalServiceName];
  return meta?.port;
}

// Get all running services
export function getChildServices() {
  return childServices;
}

// Get service metadata
export function getChildServiceMeta() {
  return childServiceMeta;
}

// Stop all services and free all ports
export function stopAllServices() {
  Object.values(childServices).forEach(child => {
    child.kill('SIGTERM');
  });
  
  // Clear all port allocations using port manager
  Object.keys(childServices).forEach(serviceName => {
    const meta = childServiceMeta[serviceName];
    if (meta && meta.port) {
      portManager.releasePort(meta.port, serviceName);
    }
    delete childServices[serviceName];
    delete childServiceMeta[serviceName];
  });
  console.log(`[service-manager] All services stopped and ports freed from port manager`);
}

// Stop only customer journey services, preserve essential infrastructure services
export function stopCustomerJourneyServices() {
  const essentialServices = [
    'DiscoveryService-Dynatrace',
    'PurchaseService-Dynatrace', 
    'DataPersistenceService-Dynatrace'
  ];
  
  let stoppedCount = 0;
  Object.keys(childServices).forEach(serviceName => {
    // Preserve essential infrastructure services
    if (essentialServices.includes(serviceName)) {
      console.log(`[service-manager] Preserving essential service: ${serviceName}`);
      return;
    }
    
    // Stop customer journey services
    const child = childServices[serviceName];
    if (child) {
      child.kill('SIGTERM');
      stoppedCount++;
    }
    
    // Clear port allocation for stopped service
    const meta = childServiceMeta[serviceName];
    if (meta && meta.port) {
      portManager.releasePort(meta.port, serviceName);
    }
    delete childServices[serviceName];
    delete childServiceMeta[serviceName];
  });
  
  console.log(`[service-manager] Stopped ${stoppedCount} customer journey services, preserved ${essentialServices.length} essential services`);
}

// Convenience helper: ensure a service is started and ready (health endpoint responding)
export async function ensureServiceReadyForStep(stepName, companyContext = {}, timeoutMs = 8000) {
  // Start if not running
  ensureServiceRunning(stepName, companyContext);
  const port = getServicePort(stepName);
  const start = Date.now();
  while (true) {
    const ready = await isServiceReady(port, 1000);
    if (ready) return port;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Service for step ${stepName} not ready on port ${port} within ${timeoutMs}ms`);
    }
    // Nudge start in case child crashed
    ensureServiceRunning(stepName, companyContext);
  }
}

// Health monitoring function to detect and resolve port conflicts
export async function performHealthCheck() {
  const portStatus = portManager.getStatus();
  const healthResults = {
    totalServices: Object.keys(childServices).length,
    healthyServices: 0,
    unhealthyServices: 0,
    portConflicts: 0,
    availablePorts: portStatus.availablePorts,
    issues: []
  };
  
  for (const [serviceName, child] of Object.entries(childServices)) {
    const meta = childServiceMeta[serviceName];
    if (!meta || !meta.port) {
      healthResults.issues.push(`Service ${serviceName} has no port metadata`);
      continue;
    }
    
    try {
      const isHealthy = await isServiceReady(meta.port, 2000);
      if (isHealthy) {
        healthResults.healthyServices++;
      } else {
        healthResults.unhealthyServices++;
        healthResults.issues.push(`Service ${serviceName} not responding on port ${meta.port}`);
        
        // Try to restart unresponsive service
        console.log(`[service-manager] Health check: restarting unresponsive service ${serviceName}`);
        try {
          child.kill('SIGTERM');
          delete childServices[serviceName];
          delete childServiceMeta[serviceName];
          
          // Free the port using port manager
          if (meta && meta.port) {
            portManager.releasePort(meta.port, serviceName);
          }
          
          // Allow some time for cleanup
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          healthResults.issues.push(`Failed to restart service ${serviceName}: ${error.message}`);
        }
      }
    } catch (error) {
      healthResults.unhealthyServices++;
      healthResults.issues.push(`Health check failed for ${serviceName}: ${error.message}`);
    }
  }
  
  // Check for port conflicts using port manager status
  const pmStatus = portManager.getStatus();
  if (pmStatus.pendingAllocations > 0) {
    healthResults.issues.push(`${pmStatus.pendingAllocations} pending port allocations detected`);
  }
  
  return healthResults;
}

// Get comprehensive service status
export function getServiceStatus() {
  const portStatus = portManager.getStatus();
  return {
    activeServices: Object.keys(childServices).length,
    availablePorts: portStatus.availablePorts,
    allocatedPorts: portStatus.allocatedPorts,
  portRange: `${portManager.minPort || 8081}-${portManager.maxPort || 8120}`,
    services: Object.entries(childServices).map(([name, child]) => ({
      name,
      pid: child.pid,
      port: childServiceMeta[name]?.port || 'unknown',
      company: childServiceMeta[name]?.companyName || 'unknown',
      startTime: childServiceMeta[name]?.startTime || 'unknown',
      alive: !child.killed && child.exitCode === null
    }))
  };
}