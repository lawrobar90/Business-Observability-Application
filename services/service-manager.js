import { spawn, execSync } from 'child_process';
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

// Enhanced metrics tracking per service
const serviceMetrics = {
  // serviceName: { requests: 0, lastRequest: null, startTime: Date.now(), errors: 0, lastHealth: 'unknown' }
};

/**
 * Kill orphaned service processes from previous server sessions.
 * These zombie processes hold ports in the 8081-8120 range and prevent
 * new services from starting (port exhaustion).
 * Called on server startup to ensure a clean port range.
 */
export function cleanupOrphanedServiceProcesses() {
  const myPid = process.pid;
  console.log(`🧹 [service-manager] Cleaning up orphaned service processes (server PID: ${myPid})...`);
  
  try {
    // Find all node processes running .dynamic-runners wrapper scripts
    // These are child service processes; only keep ones parented by THIS server
    const psOutput = execSync(
      `ps -eo pid,ppid,args --no-headers 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    
    const myChildren = new Set();
    const orphanPids = [];
    
    for (const line of psOutput.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) continue;
      
      const [, pidStr, ppidStr, args] = match;
      const pid = parseInt(pidStr);
      const ppid = parseInt(ppidStr);
      
      // Skip self
      if (pid === myPid) continue;
      
      // Track our own children
      if (ppid === myPid) {
        myChildren.add(pid);
        continue;
      }
      
      // Match service processes: node processes running .dynamic-runners wrappers
      // or processes with Service-style names (e.g. "BasketCreationService")
      const isServiceProcess = (
        args.includes('.dynamic-runners') ||
        args.includes('dynamic-step-service.cjs') ||
        args.includes('service-runner.cjs') ||
        /^(node\s+.*)?[A-Z][a-zA-Z]+Service\s*$/.test(args.trim()) ||
        /^[A-Z][a-zA-Z]+Service$/.test(args.trim())
      );
      
      if (isServiceProcess && ppid !== myPid) {
        orphanPids.push({ pid, args: args.trim().substring(0, 60) });
      }
    }
    
    if (orphanPids.length === 0) {
      console.log(`✅ [service-manager] No orphaned service processes found`);
      return 0;
    }
    
    console.log(`⚠️ [service-manager] Found ${orphanPids.length} orphaned service processes, killing them...`);
    let killed = 0;
    
    for (const { pid, args } of orphanPids) {
      try {
        process.kill(pid, 'SIGTERM');
        killed++;
        console.log(`  🔪 Killed orphan PID ${pid}: ${args}`);
      } catch (e) {
        // Process already dead or permission denied
        if (e.code !== 'ESRCH') {
          console.warn(`  ⚠️ Failed to kill PID ${pid}: ${e.message}`);
        }
      }
    }
    
    console.log(`🧹 [service-manager] Cleaned up ${killed}/${orphanPids.length} orphaned processes`);
    return killed;
    
  } catch (error) {
    console.error(`⚠️ [service-manager] Orphan cleanup failed: ${error.message}`);
    return 0;
  }
}

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
export async function getServicePort(stepName, companyName = null) {
  if (!companyName) {
    console.warn('[service-manager] ⚠️ getServicePort called without companyName - this should not happen in production');
    return null;
  }
  
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
export async function startChildService(internalServiceName, scriptPath, portParam = null, env = {}) {
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
    // Use provided port if available, otherwise allocate new one
    if (portParam) {
      port = portParam;
      console.log(`[service-manager] Using pre-allocated port ${port} for ${dynatraceServiceName}`);
    } else {
      port = await getServicePort(stepName, companyName);
      console.log(`[service-manager] Allocated new port ${port} for ${dynatraceServiceName}`);
    }
    console.log(`🚀 Starting child service: ${dynatraceServiceName} (${internalServiceName}) on port ${port} for company: ${companyName} (domain: ${domain}, industry: ${industryType})`);
    
    // cwd: If a service-specific directory is provided (with its own package.json),
    // spawn the process there so OneAgent reads THAT package.json name instead of the parent's
    const spawnCwd = env._SERVICE_CWD || undefined;
    
    const child = spawn('node', [`--title=${dynatraceServiceName}`, scriptPath, dynatraceServiceName], {
      cwd: spawnCwd,
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
        MAIN_SERVER_PORT: '8080',
        // ═══════════════════════════════════════════════════════════════
        // DYNATRACE ONEAGENT - OFFICIAL ENVIRONMENT VARIABLES
        // These are the REAL variables that OneAgent reads for service detection
        // ═══════════════════════════════════════════════════════════════
        
        // 🔑 DT_APPLICATION_ID: Overrides package.json name for Web application id
        // This is what OneAgent uses for service detection/naming
        DT_APPLICATION_ID: dynatraceServiceName,
        
        // 🔑 DT_CUSTOM_PROP: Adds custom metadata properties to the service
        DT_CUSTOM_PROP: `dtServiceName=${dynatraceServiceName} companyName=${companyName} domain=${domain} industryType=${industryType} stepName=${stepName || 'unknown'}`,
        
        // 🏷️ DT_TAGS: Space-separated key=value pairs for Dynatrace tags
        DT_TAGS: `company=${companyName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()} service=${dynatraceServiceName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()} app=bizobs-journey environment=ace-box industry=${industryType.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()} journey-detail=${(env.JOURNEY_DETAIL || stepName || 'unknown_journey').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
        
        // 📦 DT_RELEASE_*: Release tracking metadata
        DT_RELEASE_PRODUCT: 'BizObs-Engine',
        DT_RELEASE_STAGE: 'production',
        DT_RELEASE_VERSION: '1.0.0',
        
        // 🔗 DT_CLUSTER_ID / DT_NODE_ID: Cluster and node identification
        DT_CLUSTER_ID: dynatraceServiceName,
        DT_NODE_ID: `${dynatraceServiceName}-node`,
        
        // 🔑 DT_APPLICATION_ID: Overrides package.json name for Web application id
        DT_APPLICATION_ID: dynatraceServiceName,
        
        // 📋 Internal env vars for app-level code (NOT read by OneAgent)
        DT_SERVICE_NAME: dynatraceServiceName,
        DYNATRACE_SERVICE_NAME: dynatraceServiceName,
        
        // Override inherited parent values that would confuse OneAgent
        DT_LOGICAL_SERVICE_NAME: dynatraceServiceName,
        DT_APPLICATION_NAME: dynatraceServiceName,
        DT_PROCESS_GROUP_NAME: dynatraceServiceName,
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
      port,
      stepName: stepName,  // Include step name for UI display
      baseServiceName: dynatraceServiceName
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
    baseServiceName,
    stepName: stepEnvName  // Include step name for UI display
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
    try {
      // Check if specific service exists
      if (fs.existsSync(specificServicePath)) {
        console.log(`[service-manager] Starting specific service: ${specificServicePath}`);
        const child = await startChildService(internalServiceName, specificServicePath, null, { 
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
        // ALLOCATE PORT BEFORE CREATING WRAPPER so we can include it in the wrapper
        const allocatedPort = await getServicePort(stepEnvName, companyName);
        if (!allocatedPort) {
          throw new Error(`Failed to allocate port for ${dynatraceServiceName}`);
        }
        console.log(`[service-manager] Pre-allocated port ${allocatedPort} for ${dynatraceServiceName}`);
        
        // Create/overwrite wrapper with service-specific entrypoint
        // Each service gets its own subdirectory with a package.json so OneAgent
        // detects a unique "Web application id" instead of using the parent's package.json name
        const serviceDir = path.join(runnersDir, dynatraceServiceName);
        if (!fs.existsSync(serviceDir)) {
          fs.mkdirSync(serviceDir, { recursive: true });
        }
        // Write a per-service package.json — OneAgent reads this for Web application id
        const servicePkgJson = JSON.stringify({
          name: dynatraceServiceName.toLowerCase(),
          version: "1.0.0",
          private: true
        }, null, 2);
        fs.writeFileSync(path.join(serviceDir, 'package.json'), servicePkgJson, 'utf-8');
        
        const wrapperPath = path.join(serviceDir, 'index.cjs');
        const wrapperSource = `// Auto-generated wrapper for ${dynatraceServiceName}\n` +
`process.env.SERVICE_NAME = ${JSON.stringify(dynatraceServiceName)};\n` +
`process.env.FULL_SERVICE_NAME = ${JSON.stringify(dynatraceServiceName)};\n` +
`process.env.STEP_NAME = ${JSON.stringify(stepEnvName)};\n` +
`process.env.COMPANY_NAME = ${JSON.stringify(companyName)};\n` +
`process.env.DOMAIN = ${JSON.stringify(domain)};\n` +
`process.env.INDUSTRY_TYPE = ${JSON.stringify(industryType)};\n` +
`process.env.CATEGORY = ${JSON.stringify(category)};\n` +
`process.env.PORT = ${JSON.stringify(String(allocatedPort))};\n` +
`process.env.MAIN_SERVER_PORT = '8080';\n` +
`process.title = process.env.SERVICE_NAME;\n` +
`// Override argv[0] for Dynatrace process detection\n` +
`if (process.argv && process.argv.length > 0) process.argv[0] = process.env.SERVICE_NAME;\n` +
`\n` +
`// ════════════════════════════════════════════════════════════\n` +
`// DYNATRACE ONEAGENT - OFFICIAL ENVIRONMENT VARIABLES\n` +
`// ════════════════════════════════════════════════════════════\n` +
`\n` +
`// 🔑 DT_APPLICATION_ID: Overrides package.json name for Web application id\n` +
`// This is what OneAgent uses for service detection/naming (Web application id)\n` +
`process.env.DT_APPLICATION_ID = process.env.SERVICE_NAME;\n` +
`\n` +
`// 🔑 DT_CUSTOM_PROP: Adds custom metadata properties to the service\n` +
`process.env.DT_CUSTOM_PROP = 'dtServiceName=' + process.env.SERVICE_NAME + ' companyName=' + process.env.COMPANY_NAME + ' domain=' + process.env.DOMAIN + ' industryType=' + process.env.INDUSTRY_TYPE + ' stepName=' + process.env.STEP_NAME;\n` +
`\n` +
`// 🏷️ DT_TAGS: Space-separated key=value pairs for Dynatrace tags\n` +
`process.env.DT_TAGS = 'company=' + process.env.COMPANY_NAME.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + ' service=' + process.env.SERVICE_NAME.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + ' app=bizobs-journey environment=ace-box industry=' + process.env.INDUSTRY_TYPE.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + ' journey-detail=' + (process.env.STEP_NAME || 'unknown_journey').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();\n` +
`\n` +
`// 📦 DT_RELEASE_*: Release tracking\n` +
`process.env.DT_RELEASE_PRODUCT = 'BizObs-Engine';\n` +
`process.env.DT_RELEASE_STAGE = 'production';\n` +
`process.env.DT_RELEASE_VERSION = '1.0.0';\n` +
`\n` +
`// 🔗 DT_CLUSTER_ID / DT_NODE_ID: Cluster and node identification\n` +
`process.env.DT_CLUSTER_ID = process.env.SERVICE_NAME;\n` +
`process.env.DT_NODE_ID = process.env.SERVICE_NAME + '-node';\n` +
`\n` +
`// Internal env vars for app-level code (NOT read by OneAgent)\n` +
`process.env.DT_SERVICE_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DYNATRACE_SERVICE_NAME = process.env.SERVICE_NAME;\n` +
`\n` +
`// Override inherited parent values that would confuse OneAgent\n` +
`process.env.DT_LOGICAL_SERVICE_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DT_APPLICATION_NAME = process.env.SERVICE_NAME;\n` +
`process.env.DT_PROCESS_GROUP_NAME = process.env.SERVICE_NAME;\n` +
`\n` +
`console.log('[wrapper] DT_APPLICATION_ID=' + process.env.DT_APPLICATION_ID);\n` +
`console.log('[wrapper] DT_CUSTOM_PROP=' + process.env.DT_CUSTOM_PROP);\n` +
`require(${JSON.stringify(dynamicServicePath)}).createStepService(process.env.SERVICE_NAME, process.env.STEP_NAME);\n`;
        fs.writeFileSync(wrapperPath, wrapperSource, 'utf-8');
        console.log(`[service-manager] Starting dynamic service via wrapper: ${wrapperPath}`);
        const child = await startChildService(internalServiceName, wrapperPath, allocatedPort, { 
          STEP_NAME: stepEnvName,
          COMPANY_NAME: companyName,
          DOMAIN: domain,
          INDUSTRY_TYPE: industryType,
          CATEGORY: category,
          BASE_SERVICE_NAME: baseServiceName,
          DYNATRACE_SERVICE_NAME: dynatraceServiceName,
          JOURNEY_DETAIL: companyContext.journeyDetail || stepName || 'Unknown_Journey',
          _SERVICE_CWD: serviceDir
        });
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

/**
 * Initialize metrics for a service
 */
function initServiceMetrics(serviceName) {
  if (!serviceMetrics[serviceName]) {
    serviceMetrics[serviceName] = {
      requests: 0,
      errors: 0,
      lastRequest: null,
      startTime: Date.now(),
      lastHealthCheck: null,
      healthStatus: 'unknown',
      responseTime: []
    };
  }
  return serviceMetrics[serviceName];
}

/**
 * Record a request to a service
 */
export function recordServiceRequest(serviceName, responseTime, isError = false) {
  const metrics = initServiceMetrics(serviceName);
  metrics.requests++;
  metrics.lastRequest = Date.now();
  if (isError) metrics.errors++;
  if (responseTime) {
    metrics.responseTime.push(responseTime);
    // Keep only last 100 response times
    if (metrics.responseTime.length > 100) {
      metrics.responseTime.shift();
    }
  }
}

/**
 * Get services grouped by company with detailed metrics
 */
export async function getServicesGroupedByCompany() {
  const byCompany = {};
  
  for (const [serviceName, child] of Object.entries(childServices)) {
    const meta = childServiceMeta[serviceName] || {};
    const companyName = meta.companyName || 'Unknown';
    
    if (!byCompany[companyName]) {
      byCompany[companyName] = {
        companyName,
        services: [],
        totalServices: 0,
        runningServices: 0,
        totalRequests: 0,
        totalErrors: 0
      };
    }
    
    const metrics = initServiceMetrics(serviceName);
    const port = meta.port || 'unknown';
    const uptime = meta.startTime ? Date.now() - meta.startTime : 0;
    const isAlive = !child.killed && child.exitCode === null;
    
    // Check service health
    let healthStatus = 'unknown';
    if (isAlive && port !== 'unknown') {
      try {
        const isHealthy = await isServiceReady(port, 1000);
        healthStatus = isHealthy ? 'healthy' : 'unhealthy';
        metrics.lastHealthCheck = Date.now();
        metrics.healthStatus = healthStatus;
      } catch (e) {
        healthStatus = 'error';
      }
    } else {
      healthStatus = 'stopped';
    }
    
    // Calculate average response time
    const avgResponseTime = metrics.responseTime.length > 0
      ? metrics.responseTime.reduce((a, b) => a + b, 0) / metrics.responseTime.length
      : 0;
    
    const serviceInfo = {
      serviceName,
      displayName: meta.stepName || serviceName.replace('Service-' + companyName, ''),
      port,
      pid: child.pid,
      status: isAlive ? 'running' : 'stopped',
      healthStatus,
      uptime,
      uptimeFormatted: formatUptime(uptime),
      startTime: meta.startTime || null,
      requests: metrics.requests,
      errors: metrics.errors,
      errorRate: metrics.requests > 0 ? (metrics.errors / metrics.requests * 100).toFixed(2) : 0,
      lastRequest: metrics.lastRequest,
      lastRequestAgo: metrics.lastRequest ? Date.now() - metrics.lastRequest : null,
      avgResponseTime: avgResponseTime.toFixed(2),
      lastHealthCheck: metrics.lastHealthCheck
    };
    
    byCompany[companyName].services.push(serviceInfo);
    byCompany[companyName].totalServices++;
    if (isAlive) byCompany[companyName].runningServices++;
    byCompany[companyName].totalRequests += metrics.requests;
    byCompany[companyName].totalErrors += metrics.errors;
  }
  
  // Sort companies by name
  const sorted = Object.values(byCompany).sort((a, b) => a.companyName.localeCompare(b.companyName));
  
  return {
    companies: sorted,
    totalCompanies: sorted.length,
    totalServices: Object.keys(childServices).length,
    totalRunningServices: Object.values(childServices).filter(c => !c.killed && c.exitCode === null).length
  };
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Stop all services and free all ports
export async function stopAllServices() {
  // First kill tracked services
  Object.values(childServices).forEach(child => {
    child.kill('SIGKILL');
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
  
  // NUCLEAR OPTION: Kill ALL journey services by name, including zombies from previous server restarts
  console.log('[service-manager] 💣 Killing ALL journey services by name (including zombies)...');
  const { execSync } = await import('child_process');
  try {
    // Kill all journey service processes by name pattern
    execSync('pkill -9 -f "Service$"', { stdio: 'ignore' });
    console.log('[service-manager] ✅ All journey services killed by name pattern');
  } catch (e) {
    // pkill returns exit code 1 if no processes found, which is fine
    console.log('[service-manager] No additional journey services found to kill');
  }
  
  // Clean up any stale port allocations (services that died but weren't properly cleaned up)
  const cleaned = await portManager.cleanupStaleAllocations();
  console.log(`[service-manager] All services stopped and ports freed from port manager (${cleaned} stale allocations cleaned)`);
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

/**
 * Stop services for a specific company only
 * Keeps other companies' services running (multi-tenant)
 */
export async function stopServicesForCompany(companyName) {
  if (!companyName) {
    console.warn('[service-manager] ⚠️ No companyName provided to stopServicesForCompany');
    return 0;
  }

  console.log(`[service-manager] 🎯 Stopping services for company: ${companyName}`);
  
  let stoppedCount = 0;
  const servicesToStop = [];

  // Find all services for this company
  Object.keys(childServices).forEach(serviceName => {
    const meta = childServiceMeta[serviceName];
    if (meta && meta.companyName === companyName) {
      servicesToStop.push({ serviceName, meta });
    }
  });

  // Stop each service
  for (const { serviceName, meta } of servicesToStop) {
    const child = childServices[serviceName];
    if (child) {
      try {
        child.kill('SIGKILL');
        stoppedCount++;
        console.log(`[service-manager] 🛑 Killed service: ${serviceName} for ${companyName}`);
      } catch (e) {
        console.warn(`[service-manager] ⚠️ Error killing ${serviceName}: ${e.message}`);
      }
    }

    // Release port
    if (meta.port) {
      portManager.releasePort(meta.port, serviceName);
    }

    // Clean up tracking
    delete childServices[serviceName];
    delete childServiceMeta[serviceName];
  }

  // Also kill any zombie services for this company using pkill
  try {
    const { execSync } = await import('child_process');
    // This will kill services matching the company name pattern
    const killCommand = `pkill -9 -f "${companyName}.*Service$"`;
    execSync(killCommand, { stdio: 'ignore' });
    console.log(`[service-manager] ✅ Killed zombie services for ${companyName} using pkill`);
  } catch (e) {
    // pkill returns exit code 1 if no processes found
    console.log(`[service-manager] No zombie services found for ${companyName}`);
  }

  // Release all ports for this company
  const portsReleased = portManager.releasePortsForCompany(companyName);

  console.log(`[service-manager] ✅ Stopped ${stoppedCount} services for ${companyName} (${portsReleased} ports released)`);
  return stoppedCount;
}

/**
 * Stop a single service by name
 */
export async function stopService(serviceName) {
  if (!serviceName) {
    throw new Error('serviceName required');
  }

  const child = childServices[serviceName];
  if (!child) {
    throw new Error(`Service ${serviceName} not found`);
  }

  console.log(`[service-manager] 🛑 Stopping service: ${serviceName}`);

  try {
    child.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise(resolve => {
      const timeout = setTimeout(() => {
        if (!child.killed) {
          console.log(`[service-manager] ⚠️ Forcing kill of ${serviceName}`);
          child.kill('SIGKILL');
        }
        resolve();
      }, 3000);
      
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    console.log(`[service-manager] ✅ Stopped service: ${serviceName}`);
  } catch (e) {
    console.warn(`[service-manager] ⚠️ Error stopping ${serviceName}: ${e.message}`);
  }

  // Release port
  const meta = childServiceMeta[serviceName];
  if (meta && meta.port) {
    portManager.releasePort(meta.port, serviceName);
  }

  // Clean up tracking
  delete childServices[serviceName];
  delete childServiceMeta[serviceName];
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