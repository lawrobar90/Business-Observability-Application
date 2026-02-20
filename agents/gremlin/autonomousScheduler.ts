/**
 * Autonomous Gremlin Scheduler — random chaos injection using AI.
 * Runs on a configurable interval, selecting random services and chaos
 * types using LLM reasoning. Sends Dynatrace custom events for correlation.
 */

import { injectChaos, getActiveFaults, revertChaos } from './gremlinAgent.js';
import { chatJSON, isOllamaAvailable } from '../../utils/llmClient.js';
import { config } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';
import { ChaosType } from '../../tools/chaos/chaosRecipes.js';

const log = createLogger('gremlin-scheduler');

// ─── Configuration ────────────────────────────────────────────

export interface SchedulerConfig {
  enabled: boolean;
  intervalMs: number;              // How often to check for chaos opportunities
  chaosIntervalMs: number;         // Min time between chaos injections
  maxConcurrentFaults: number;     // Max faults at once
  meanTimeBetweenChaosMs: number;  // Average wait between chaos (for random distribution)
  allowedServices: string[];       // Services that can be targeted (empty = all)
  useAI: boolean;                  // Use AI to pick targets and types
  warmupMs: number;                // Wait time before first chaos (2 hours default)
  transactionThreshold: number;    // Min transactions before chaos eligible
  useVolumeTrigger: boolean;       // Use volume-based triggering
}

const defaultConfig: SchedulerConfig = {
  enabled: true,   // AUTO-START: Enabled by default, waits for warmup
  intervalMs: 60_000,              // Check every minute
  chaosIntervalMs: 300_000,        // Min 5 minutes between chaos
  maxConcurrentFaults: 2,
  meanTimeBetweenChaosMs: 600_000, // Average 10 min between events
  allowedServices: [],             // Empty = allow any
  useAI: true,
  warmupMs: 7_200_000,             // 2 hours before first chaos
  transactionThreshold: 1000,      // Min 1000 transactions before chaos
  useVolumeTrigger: true,          // Volume-based triggering enabled
};

let schedulerConfig: SchedulerConfig = { ...defaultConfig };
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastChaosTime = 0;
let isRunning = false;
let serverStartTime = 0;
let transactionCount = 0;
let lastTransactionCount = 0;

// ─── Core Scheduler ───────────────────────────────────────────

/**
 * Start the autonomous scheduler.
 */
export function startScheduler(customConfig?: Partial<SchedulerConfig>): void {
  if (schedulerInterval) {
    log.warn('Scheduler already running');
    return;
  }

  schedulerConfig = { ...defaultConfig, ...customConfig };
  isRunning = true;
  serverStartTime = Date.now();
  transactionCount = 0;
  lastTransactionCount = 0;

  const warmupMinutes = Math.round(schedulerConfig.warmupMs / 60_000);
  
  log.info('🤖 Autonomous Gremlin Scheduler starting', {
    intervalMs: schedulerConfig.intervalMs,
    maxFaults: schedulerConfig.maxConcurrentFaults,
    useAI: schedulerConfig.useAI,
    warmupMinutes: warmupMinutes,
    transactionThreshold: schedulerConfig.transactionThreshold,
    useVolumeTrigger: schedulerConfig.useVolumeTrigger,
  });

  schedulerInterval = setInterval(async () => {
    try {
      await schedulerTick();
    } catch (err) {
      log.error('Scheduler tick failed', { error: String(err) });
    }
  }, schedulerConfig.intervalMs);

  log.info(`✅ Gremlin Scheduler running (warmup: ${warmupMinutes} min, then chaos begins)`);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (!schedulerInterval) {
    log.warn('Scheduler not running');
    return;
  }

  clearInterval(schedulerInterval);
  schedulerInterval = null;
  isRunning = false;
  log.info('🛑 Gremlin Scheduler stopped');
}

/**
 * Record transaction activity (called externally from journey endpoints).
 */
export function recordTransaction(count: number = 1): void {
  transactionCount += count;
}

/**
 * Get current scheduler status including warmup and transaction metrics.
 */
export function getSchedulerStatus(): any {
  const now = Date.now();
  const uptimeMs = now - serverStartTime;
  const warmupRemainingMs = Math.max(0, schedulerConfig.warmupMs - uptimeMs);
  const transactionsSinceLastChaos = transactionCount - lastTransactionCount;
  
  return {
    running: isRunning,
    config: schedulerConfig,
    uptimeMs,
    warmupRemainingMs,
    inWarmup: uptimeMs < schedulerConfig.warmupMs,
    transactionCount,
    transactionsSinceLastChaos,
    lastChaosTime
  };
}

/**
 * Update scheduler configuration dynamically.
 */
export function updateSchedulerConfig(updates: Partial<SchedulerConfig>): void {
  schedulerConfig = { ...schedulerConfig, ...updates };
  log.info('Scheduler configuration updated', updates);
}

/**
 * Scheduler tick - runs at configured interval to check for chaos opportunities.
 */
async function schedulerTick(): Promise<void> {
  const now = Date.now();
  const uptimeMs = now - serverStartTime;
  
  // WARMUP PERIOD: Wait 2 hours before first chaos
  if (uptimeMs < schedulerConfig.warmupMs) {
    const remainingMin = Math.round((schedulerConfig.warmupMs - uptimeMs) / 60_000);
    if (uptimeMs % 600_000 < schedulerConfig.intervalMs) {  // Log every 10 minutes
      log.info(`⏳ Warmup period: ${remainingMin} minutes until chaos begins`);
    }
    return;
  }

  // Check safety limits
  const activeFaults = getActiveFaults();
  if (activeFaults.length >= schedulerConfig.maxConcurrentFaults) {
    log.debug('Max concurrent faults reached, skipping chaos');
    return;
  }

  // Enforce minimum time between chaos
  const timeSinceLastChaos = now - lastChaosTime;
  if (lastChaosTime > 0 && timeSinceLastChaos < schedulerConfig.chaosIntervalMs) {
    log.debug(`Too soon for chaos (${Math.round(timeSinceLastChaos / 1000)}s < ${schedulerConfig.chaosIntervalMs / 1000}s)`);
    return;
  }

  // VOLUME-BASED TRIGGER: Check transaction threshold
  if (schedulerConfig.useVolumeTrigger) {
    const transactionsSinceLastChaos = transactionCount - lastTransactionCount;
    if (transactionsSinceLastChaos < schedulerConfig.transactionThreshold) {
      log.debug(`Insufficient transaction volume (${transactionsSinceLastChaos} < ${schedulerConfig.transactionThreshold})`);
      return;
    }
  }

  // Random chance based on exponential distribution (mean time between chaos)
  // This creates a more realistic "random failure" pattern
  const lambda = 1 / schedulerConfig.meanTimeBetweenChaosMs;
  const randomChance = 1 - Math.exp(-lambda * schedulerConfig.intervalMs);

  if (Math.random() > randomChance) {
    log.debug('Random chance: skipping chaos this tick');
    return;
  }

  log.info('🎲 Chaos opportunity detected — planning chaos injection...', {
    uptime: Math.round(uptimeMs / 60_000) + ' min',
    transactions: transactionCount,
    transactionsSinceLastChaos: transactionCount - lastTransactionCount,
  });

  try {
    await executeAutonomousChaos();
    lastChaosTime = now;
    lastTransactionCount = transactionCount;  // Reset transaction counter
  } catch (err) {
    log.error('Autonomous chaos failed', { error: String(err) });
  }
}

// ─── AI-Driven Chaos Selection ───────────────────────────────

async function executeAutonomousChaos(): Promise<void> {
  // Get available services from the app
  const services = await getAvailableServices();
  if (services.length === 0) {
    log.warn('No services available for chaos');
    return;
  }

  // Filter by allowed services if configured
  let candidateServices = services;
  if (schedulerConfig.allowedServices.length > 0) {
    candidateServices = services.filter((s: ServiceInfo) =>
      schedulerConfig.allowedServices.includes(s.name)
    );
  }

  if (candidateServices.length === 0) {
    log.warn('No allowed services available for chaos');
    return;
  }

  const activeFaults = getActiveFaults();
  const alreadyAffected = new Set(activeFaults.map(f => f.target));

  // Filter out services already under chaos
  candidateServices = candidateServices.filter((s: ServiceInfo) => !alreadyAffected.has(s.name));

  if (candidateServices.length === 0) {
    log.warn('All candidate services already have active chaos');
    return;
  }

  let chaosDecision: ChaosDecision;

  if (schedulerConfig.useAI) {
    const aiAvailable = await isOllamaAvailable();
    if (aiAvailable) {
      chaosDecision = await aiSelectChaos(candidateServices, activeFaults);
    } else {
      log.warn('AI not available, using random selection');
      chaosDecision = randomSelectChaos(candidateServices);
    }
  } else {
    chaosDecision = randomSelectChaos(candidateServices);
  }

  log.info('💥 Injecting autonomous chaos', {
    type: chaosDecision.type,
    target: chaosDecision.target,
    reasoning: chaosDecision.reasoning,
    intensity: chaosDecision.intensity,
    durationMs: chaosDecision.durationMs,
  });

  await injectChaos({
    type: chaosDecision.type,
    target: chaosDecision.target,
    intensity: chaosDecision.intensity,
    durationMs: chaosDecision.durationMs,
    details: {
      autonomous: true,
      reasoning: chaosDecision.reasoning,
      scheduledAt: new Date().toISOString(),
    },
    useLlm: false,  // We already did the AI selection
  });
}

// ─── AI Selection ─────────────────────────────────────────────

interface ServiceInfo {
  name: string;
  status: string;
  uptime?: number;
  company?: string;
}

interface ChaosDecision {
  type: ChaosType;
  target: string;
  intensity: number;
  durationMs: number;
  reasoning: string;
}

async function aiSelectChaos(
  services: ServiceInfo[],
  activeFaults: any[]
): Promise<ChaosDecision> {
  const availableTypes: ChaosType[] = [
    'enable_errors',
    'increase_error_rate',
    'slow_responses',
    'disable_circuit_breaker',
    'disable_cache',
  ];

  const systemState = `
Current System State:
- ${services.length} running services: ${services.map(s => s.name).join(', ')}
- ${activeFaults.length} active chaos faults: ${activeFaults.map(f => `${f.type} on ${f.target}`).join(', ')}

Available Chaos Types:
${availableTypes.map(t => `- ${t}`).join('\n')}

Guidelines:
- Choose realistic failure scenarios that test system resilience
- Vary chaos types to cover different failure modes
- Consider recent chaos patterns to avoid repetition
- Balance between disruptive (high intensity, short duration) and subtle (low intensity, long duration)
- Prefer targeting specific services over global chaos
`;

  const decision = await chatJSON<ChaosDecision>([
    {
      role: 'system',
      content: `You are an autonomous chaos engineering agent for the BizObs app. Your goal is to randomly inject realistic failures to test system resilience and observability.

${systemState}

Choose the next chaos experiment. Respond with JSON:
{
  "type": "<chaos_type>",
  "target": "<service_name>",
  "intensity": 1-10,
  "durationMs": <milliseconds>,
  "reasoning": "<why this choice>"
}

Examples:
- Target a payment service with intermittent errors (intensity 3-5, duration 5-10min)
- Slow down a high-traffic service to test timeouts (intensity 4-6, duration 3-5min)
- Disable circuit breaker on a dependency-heavy service (intensity 8, duration 2min)`,
    },
    {
      role: 'user',
      content: 'Select the next autonomous chaos experiment.',
    },
  ], { temperature: 0.7 });  // Higher temperature for more varied decisions

  // Validate and constrain the decision
  decision.intensity = Math.min(Math.max(decision.intensity, 1), 10);
  decision.durationMs = Math.min(Math.max(decision.durationMs, 60_000), 600_000);  // 1-10 min

  return decision;
}

// ─── Random Selection (Fallback) ──────────────────────────────

function randomSelectChaos(services: ServiceInfo[]): ChaosDecision {
  const types: ChaosType[] = [
    'enable_errors',
    'increase_error_rate',
    'slow_responses',
    'disable_circuit_breaker',
    'disable_cache',
  ];

  const service = services[Math.floor(Math.random() * services.length)];
  const type = types[Math.floor(Math.random() * types.length)];
  const intensity = Math.floor(Math.random() * 6) + 3;  // 3-8
  const durationMs = (Math.floor(Math.random() * 5) + 3) * 60_000;  // 3-7 minutes

  return {
    type,
    target: service.name,
    intensity,
    durationMs,
    reasoning: 'Random selection (AI not available)',
  };
}

// ─── Service Discovery ────────────────────────────────────────

async function getAvailableServices(): Promise<ServiceInfo[]> {
  try {
    const APP_BASE = `http://localhost:${process.env.PORT || 8080}`;
    const res = await fetch(`${APP_BASE}/api/admin/services/status`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      log.warn('Failed to fetch service status', { status: res.status });
      return [];
    }

    const data = (await res.json()) as any;
    const services: ServiceInfo[] = [];

    // Extract service names from status response
    // The API returns services grouped by company
    if (data.byCompany) {
      for (const [company, svcList] of Object.entries(data.byCompany as Record<string, any[]>)) {
        for (const svc of svcList) {
          services.push({
            name: svc.baseServiceName || svc.serviceName,
            status: svc.alive ? 'running' : 'stopped',
            company: company,
          });
        }
      }
    }

    // Deduplicate by service name (ignore company variants)
    const uniqueServices = Array.from(
      new Map(services.map(s => [s.name, s])).values()
    );

    log.debug(`Discovered ${uniqueServices.length} services for chaos targeting`);
    return uniqueServices;

  } catch (err) {
    log.error('Service discovery failed', { error: String(err) });
    return [];
  }
}

// ─── Exports ──────────────────────────────────────────────────

export default {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  updateSchedulerConfig,
};
