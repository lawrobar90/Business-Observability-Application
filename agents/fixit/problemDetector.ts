/**
 * Problem Detector — continuous monitoring loop for Fix-It Agent.
 * Polls Dynatrace for problems and automatically triggers diagnosis + remediation.
 * Links remediation events back to chaos events for problem correlation.
 */

import { autoFix, type FixItRunResult } from './fixitAgent.js';
import { getProblems } from '../../tools/dynatrace/dtTools.js';
import { createLogger } from '../../utils/logger.js';
import { sendDynatraceEvent } from '../../utils/dtEventHelper.js';

const log = createLogger('problem-detector');

// ─── Configuration ────────────────────────────────────────────

export interface DetectorConfig {
  enabled: boolean;
  pollIntervalMs: number;         // How often to check for problems
  autoRemediateEnabled: boolean;  // Actually run fixes (vs just detect)
  problemLookbackWindow: string;  // Dynatrace time window (e.g., "30m", "1h")
  ignoredProblemIds: Set<string>; // Problems to skip
  maxConcurrentFixes: number;     // Max fixes running at once
}

const defaultConfig: DetectorConfig = {
  enabled: true,   // AUTO-START: Enabled by default
  pollIntervalMs: 120_000,        // Check every 2 minutes
  autoRemediateEnabled: true,     // Auto-fix detected problems
  problemLookbackWindow: '30m',
  ignoredProblemIds: new Set(),
  maxConcurrentFixes: 2,
};

let detectorConfig: DetectorConfig = { ...defaultConfig };
let detectorInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let activeFixes = new Map<string, Promise<FixItRunResult>>();
let processedProblems = new Set<string>();  // Track problems we've already handled

// ─── Core Detector ────────────────────────────────────────────

/**
 * Start the problem detector loop.
 */
export function startDetector(customConfig?: Partial<DetectorConfig>): void {
  if (detectorInterval) {
    log.warn('Detector already running');
    return;
  }

  detectorConfig = { ...defaultConfig, ...customConfig };
  isRunning = true;

  log.info('🔍 Problem Detector starting', {
    pollIntervalMs: detectorConfig.pollIntervalMs,
    autoRemediate: detectorConfig.autoRemediateEnabled,
    lookbackWindow: detectorConfig.problemLookbackWindow,
  });

  detectorInterval = setInterval(async () => {
    try {
      await detectorTick();
    } catch (err) {
      log.error('Detector tick failed', { error: String(err) });
    }
  }, detectorConfig.pollIntervalMs);

  // Run initial check immediately
  detectorTick().catch(err => {
    log.error('Initial detector tick failed', { error: String(err) });
  });

  log.info('✅ Problem Detector running');
}

/**
 * Stop the detector.
 */
export function stopDetector(): void {
  if (!detectorInterval) {
    log.warn('Detector not running');
    return;
  }

  clearInterval(detectorInterval);
  detectorInterval = null;
  isRunning = false;
  log.info('🛑 Problem Detector stopped');
}

/**
 * Get detector status.
 */
export function getDetectorStatus() {
  return {
    running: isRunning,
    config: detectorConfig,
    activeFixes: activeFixes.size,
    processedProblemsCount: processedProblems.size,
  };
}

/**
 * Update detector configuration at runtime.
 */
export function updateDetectorConfig(updates: Partial<DetectorConfig>): void {
  detectorConfig = { ...detectorConfig, ...updates };
  log.info('Detector config updated', updates);

  // If enabling/disabling, restart detector
  if ('enabled' in updates) {
    if (updates.enabled && !detectorInterval) {
      startDetector();
    } else if (!updates.enabled && detectorInterval) {
      stopDetector();
    }
  }
}

/**
 * Clear the processed problems cache (useful after testing).
 */
export function clearProcessedProblems(): void {
  processedProblems.clear();
  log.info('Cleared processed problems cache');
}

// ─── Tick Logic ───────────────────────────────────────────────

async function detectorTick(): Promise<void> {
  if (!detectorConfig.enabled) return;

  // Check concurrent fix limit
  if (activeFixes.size >= detectorConfig.maxConcurrentFixes) {
    log.debug('Max concurrent fixes reached, skipping detection');
    return;
  }

  try {
    // Poll Dynatrace for problems
    const problems = await getProblems(detectorConfig.problemLookbackWindow);

    if (problems.length === 0) {
      log.debug('No problems detected');
      return;
    }

    log.info(`🔍 Detected ${problems.length} problem(s)`);

    // Process each problem
    for (const problem of problems) {
      // Skip if already processed
      if (processedProblems.has(problem.problemId)) {
        log.debug(`Skipping already-processed problem: ${problem.problemId}`);
        continue;
      }

      // Skip if in ignore list
      if (detectorConfig.ignoredProblemIds.has(problem.problemId)) {
        log.debug(`Skipping ignored problem: ${problem.problemId}`);
        continue;
      }

      // Skip if already being fixed
      if (activeFixes.has(problem.problemId)) {
        log.debug(`Skipping problem already being fixed: ${problem.problemId}`);
        continue;
      }

      // Check concurrent limit again
      if (activeFixes.size >= detectorConfig.maxConcurrentFixes) {
        log.debug('Max concurrent fixes reached during processing');
        break;
      }

      log.info(`🚨 New problem detected: ${problem.problemId} — ${problem.title}`);

      if (detectorConfig.autoRemediateEnabled) {
        // Launch fix asynchronously
        const fixPromise = handleProblem(problem);
        activeFixes.set(problem.problemId, fixPromise);

        // Clean up when done
        fixPromise
          .then(() => {
            activeFixes.delete(problem.problemId);
          })
          .catch(err => {
            log.error(`Fix failed for ${problem.problemId}`, { error: String(err) });
            activeFixes.delete(problem.problemId);
          });
      } else {
        log.info(`Auto-remediation disabled — problem ${problem.problemId} detected but not fixed`);
        processedProblems.add(problem.problemId);
      }
    }
  } catch (err) {
    log.error('Problem detection failed', { error: String(err) });
  }
}

// ─── Problem Handler ──────────────────────────────────────────

async function handleProblem(problem: any): Promise<FixItRunResult> {
  const problemId = problem.problemId;
  const problemTitle = problem.title || 'Unknown Problem';

  log.info(`🔧 Starting autonomous remediation for: ${problemId}`);

  try {
    // Send "remediation starting" event to Dynatrace
    await sendRemediationStartEvent(problemId, problemTitle);

    // Run the fix-it agent
    const result = await autoFix(problemId);

    // Mark as processed
    processedProblems.add(problemId);

    // Send "remediation complete" event to Dynatrace
    await sendRemediationCompleteEvent(problemId, result);

    log.info(`✅ Autonomous remediation complete for ${problemId}`, {
      fixesExecuted: result.fixesExecuted.length,
      verified: result.verified,
      durationMs: result.totalDurationMs,
    });

    return result;

  } catch (err) {
    log.error(`❌ Autonomous remediation failed for ${problemId}`, { error: String(err) });

    // Send "remediation failed" event to Dynatrace
    await sendRemediationFailedEvent(problemId, String(err));

    // Mark as processed even if failed (to avoid infinite retries)
    processedProblems.add(problemId);

    throw err;
  }
}

// ─── Dynatrace Event Helpers ──────────────────────────────────

/**
 * Send "remediation starting" event to Dynatrace.
 * CRITICAL: Links to the problem for Davis correlation.
 */
async function sendRemediationStartEvent(problemId: string, problemTitle: string): Promise<void> {
  try {
    const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || process.env.DYNATRACE_URL;
    if (!DT_ENVIRONMENT) {
      log.warn('DT_ENVIRONMENT not set, skipping remediation event');
      return;
    }

    // Try to find related chaos event to link
    const chaosId = await findRelatedChaosEvent(problemId);

    await sendDynatraceEvent({
      eventType: 'CUSTOM_DEPLOYMENT',
      title: `🔧 Auto-Remediation Started: ${problemTitle}`,
      description: `Fix-It Agent detected problem ${problemId} and started autonomous remediation pipeline.`,
      source: 'fixit-agent',
      entitySelector: 'type(SERVICE)',  // Could be more specific if we know the service
      properties: {
        'dt.event.deployment.name': 'auto-remediation',
        'dt.event.deployment.version': '1.0.0',
        'change.type': 'auto-remediation',
        'triggered.by': 'fixit-agent',
        'problem.id': problemId,
        'problem.title': problemTitle,
        ...(chaosId && { 'chaos.id': chaosId, 'correlation.chaos': chaosId }),
      },
      keepOpen: false,  // This event can close
    });

    log.info('Sent remediation start event to Dynatrace', { problemId, chaosId });

  } catch (err) {
    log.error('Failed to send remediation start event', { error: String(err) });
  }
}

/**
 * Send "remediation complete" event to Dynatrace.
 */
async function sendRemediationCompleteEvent(problemId: string, result: FixItRunResult): Promise<void> {
  try {
    const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || process.env.DYNATRACE_URL;
    if (!DT_ENVIRONMENT) return;

    const chaosId = await findRelatedChaosEvent(problemId);

    const fixSummary = result.fixesExecuted
      .map(f => `${f.type}:${f.target} (${f.success ? '✅' : '❌'})`)
      .join(', ');

    await sendDynatraceEvent({
      eventType: 'CUSTOM_DEPLOYMENT',
      title: `✅ Auto-Remediation Complete: ${result.diagnosis.summary}`,
      description: `Fix-It Agent completed remediation for problem ${problemId}. Fixes executed: ${fixSummary || 'none'}. Verified: ${result.verified ? 'yes' : 'no'}. Root cause: ${result.diagnosis.rootCause}`,
      source: 'fixit-agent',
      entitySelector: 'type(SERVICE)',
      properties: {
        'dt.event.deployment.name': 'auto-remediation-complete',
        'dt.event.deployment.version': '1.0.0',
        'change.type': 'remediation',
        'triggered.by': 'fixit-agent',
        'problem.id': problemId,
        'root.cause': result.diagnosis.rootCause,
        'fixes.executed': result.fixesExecuted.length,
        'fixes.successful': result.fixesExecuted.filter(f => f.success).length,
        'verified': result.verified,
        'duration.ms': result.totalDurationMs,
        ...(chaosId && { 'chaos.id': chaosId, 'correlation.chaos': chaosId }),
      },
      keepOpen: false,
    });

    log.info('Sent remediation complete event to Dynatrace', { problemId, chaosId });

  } catch (err) {
    log.error('Failed to send remediation complete event', { error: String(err) });
  }
}

/**
 * Send "remediation failed" event to Dynatrace.
 */
async function sendRemediationFailedEvent(problemId: string, errorMessage: string): Promise<void> {
  try {
    const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || process.env.DYNATRACE_URL;
    if (!DT_ENVIRONMENT) return;

    const chaosId = await findRelatedChaosEvent(problemId);

    await sendDynatraceEvent({
      eventType: 'CUSTOM_DEPLOYMENT',
      title: `❌ Auto-Remediation Failed: ${problemId}`,
      description: `Fix-It Agent failed to remediate problem ${problemId}. Error: ${errorMessage}`,
      source: 'fixit-agent',
      entitySelector: 'type(SERVICE)',
      properties: {
        'dt.event.deployment.name': 'auto-remediation-failed',
        'dt.event.deployment.version': '1.0.0',
        'change.type': 'remediation-failed',
        'triggered.by': 'fixit-agent',
        'problem.id': problemId,
        'error': errorMessage,
        ...(chaosId && { 'chaos.id': chaosId, 'correlation.chaos': chaosId }),
      },
      keepOpen: false,
    });

    log.info('Sent remediation failed event to Dynatrace', { problemId, chaosId });

  } catch (err) {
    log.error('Failed to send remediation failed event', { error: String(err) });
  }
}

/**
 * Try to find a chaos event that triggered this problem.
 * Searches Librarian memory for recent chaos events.
 */
async function findRelatedChaosEvent(problemId: string): Promise<string | null> {
  try {
    const { searchSimilar } = await import('../librarian/librarianAgent.js');
    const results = await searchSimilar(`chaos problem ${problemId}`, 5);

    // Look for chaos events in recent memory
    for (const result of results.results) {
      // Extract chaos ID from text if present (format: "chaos-<timestamp>-<counter>")
      const match = result.text.match(/chaos-\d+-\d+/);
      if (match) {
        log.info(`Found related chaos event: ${match[0]}`);
        return match[0];
      }
    }

    return null;

  } catch (err) {
    log.warn('Failed to find related chaos event', { error: String(err) });
    return null;
  }
}

// ─── Exports ──────────────────────────────────────────────────

export default {
  startDetector,
  stopDetector,
  getDetectorStatus,
  updateDetectorConfig,
  clearProcessedProblems,
};
