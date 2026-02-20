/**
 * Dynatrace Event Helper — utility for sending custom events from agents.
 * Wraps the server's sendDynatraceEvent functionality for TypeScript agents.
 */

import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('dt-events');

// ─── Types ────────────────────────────────────────────────────

export interface DynatraceEventOptions {
  eventType: 'CUSTOM_DEPLOYMENT' | 'CUSTOM_CONFIGURATION' | 'CUSTOM_INFO' | 'CUSTOM_ANNOTATION';
  title: string;
  description?: string;
  source?: string;
  entitySelector?: string;
  properties?: Record<string, unknown>;
  keepOpen?: boolean;  // For chaos events that should stay open
}

export interface DynatraceEventResult {
  success: boolean;
  status?: number;
  body?: string;
  error?: string;
}

// ─── Core Function ────────────────────────────────────────────

/**
 * Send a custom event to Dynatrace Events API v2.
 * This is a lightweight wrapper around the Events API that matches
 * the server.js implementation but can be used from TypeScript agents.
 */
export async function sendDynatraceEvent(
  options: DynatraceEventOptions
): Promise<DynatraceEventResult> {
  const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || process.env.DYNATRACE_URL;
  const DT_TOKEN = process.env.DT_PLATFORM_TOKEN || process.env.DYNATRACE_TOKEN || process.env.DT_API_TOKEN;

  if (!DT_ENVIRONMENT || !DT_TOKEN) {
    log.warn('Dynatrace credentials not configured, skipping event');
    return { success: false, error: 'no_credentials' };
  }

  try {
    // Build event payload following Dynatrace Events API v2 schema
    const eventPayload: Record<string, unknown> = {
      eventType: options.eventType,
      title: options.title,
      properties: {
        'dt.event.description': options.description || options.title,
        'deployment.name': options.title,
        'deployment.version': new Date().toISOString(),
        'deployment.project': 'BizObs AI Agents',
        'deployment.source': options.source || 'ai-agent',
        'dt.event.is_rootcause_relevant': 'true',
        'dt.event.deployment.name': options.title,
        'dt.event.deployment.version': new Date().toISOString(),
        'dt.event.deployment.project': 'BizObs AI Agents',
        ...options.properties,
      },
    };

    // Add timeout unless keepOpen is true (for chaos events)
    if (!options.keepOpen) {
      eventPayload.timeout = 15;
    }

    // Add entitySelector if provided
    if (options.entitySelector) {
      eventPayload.entitySelector = options.entitySelector;
    }

    log.debug('Sending Dynatrace event', {
      type: options.eventType,
      title: options.title,
      keepOpen: options.keepOpen,
      entitySelector: options.entitySelector,
    });

    const baseUrl = DT_ENVIRONMENT.replace(/\/+$/, '').replace('.apps.dynatrace', '.dynatrace');
    const response = await fetch(`${baseUrl}/api/v2/events/ingest`, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Token ${DT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    });

    const body = await response.text();

    if (response.ok) {
      log.info('Dynatrace event sent successfully', {
        status: response.status,
        title: options.title,
      });
    } else {
      log.error('Dynatrace event failed', {
        status: response.status,
        body: body.substring(0, 200),
      });
    }

    return {
      success: response.ok,
      status: response.status,
      body,
    };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('Failed to send Dynatrace event', { error, title: options.title });
    return { success: false, error };
  }
}

/**
 * Send a chaos injection event (stays OPEN for problem correlation).
 */
export async function sendChaosEvent(
  chaosId: string,
  chaosType: string,
  target: string,
  details: Record<string, unknown>
): Promise<DynatraceEventResult> {
  return sendDynatraceEvent({
    eventType: 'CUSTOM_DEPLOYMENT',
    title: `💥 Chaos Injection: ${chaosType} on ${target}`,
    description: `Autonomous Gremlin Agent injected ${chaosType} on ${target}. Chaos ID: ${chaosId}. This event will stay open until chaos is reverted.`,
    source: 'gremlin-agent',
    entitySelector: 'type(SERVICE)',
    keepOpen: true,  // CRITICAL: keeps event open for problem correlation
    properties: {
      'change.type': 'chaos-injection',
      'chaos.id': chaosId,
      'chaos.type': chaosType,
      'chaos.target': target,
      'triggered.by': 'gremlin-agent',
      ...details,
    },
  });
}

/**
 * Send a chaos revert event (closes the chaos injection).
 */
export async function sendChaosRevertEvent(
  chaosId: string,
  chaosType: string,
  target: string
): Promise<DynatraceEventResult> {
  return sendDynatraceEvent({
    eventType: 'CUSTOM_DEPLOYMENT',
    title: `✅ Chaos Reverted: ${chaosType} on ${target}`,
    description: `Gremlin Agent reverted ${chaosType} on ${target}. Chaos ID: ${chaosId}.`,
    source: 'gremlin-agent',
    entitySelector: 'type(SERVICE)',
    keepOpen: false,
    properties: {
      'change.type': 'chaos-revert',
      'chaos.id': chaosId,
      'chaos.type': chaosType,
      'chaos.target': target,
      'triggered.by': 'gremlin-agent',
    },
  });
}

/**
 * Check if Dynatrace integration is configured.
 */
export function isDynatraceConfigured(): boolean {
  const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT || process.env.DYNATRACE_URL;
  const DT_TOKEN = process.env.DT_PLATFORM_TOKEN || process.env.DYNATRACE_TOKEN || process.env.DT_API_TOKEN;
  return !!(DT_ENVIRONMENT && DT_TOKEN);
}

export default {
  sendDynatraceEvent,
  sendChaosEvent,
  sendChaosRevertEvent,
  isDynatraceConfigured,
};
