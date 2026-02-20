/**
 * Dynatrace Workflow Webhook Integration
 * Receives problem notifications from Dynatrace workflows and triggers Fix-It agent
 * with enhanced root cause analysis from Davis AI via MCP server.
 */

import { Router, Request, Response } from 'express';
import { autoFix, type FixItRunResult } from '../agents/fixit/fixitAgent.js';
import { createLogger } from '../utils/logger.js';
import { sendDynatraceEvent } from '../utils/dtEventHelper.js';

const log = createLogger('workflow-webhook');
const router = Router();

// ─── Types ────────────────────────────────────────────────────

interface DynatraceWorkflowPayload {
  event_type: string;
  event_id: string;
  title: string;
  description?: string;
  problem_id?: string;
  entity_id?: string;
  entity_name?: string;
  severity?: string;
  status?: string;
  start_time?: number;
  end_time?: number;
  affected_entities?: Array<{
    entity_id: string;
    entity_name: string;
    entity_type: string;
  }>;
  root_cause_entity?: {
    entity_id: string;
    entity_name: string;
    entity_type: string;
  };
  // Davis AI insights (from MCP server)
  davis_insights?: {
    root_cause: string;
    confidence: number;
    evidence: string[];
    related_problems: string[];
  };
}

interface FixItWebhookResponse {
  success: boolean;
  runId: string;
  problemId: string;
  message: string;
  result?: FixItRunResult;
  error?: string;
}

// ─── MCP Server Integration ───────────────────────────────────

/**
 * Query Dynatrace MCP server for enhanced Davis AI root cause analysis.
 * Falls back gracefully if MCP server is not available.
 */
async function getDavisRootCause(problemId: string): Promise<any> {
  try {
    const mcpServerUrl = process.env.MCP_SERVER_URL || 'http://localhost:3000';
    
    log.info('Querying Davis AI via MCP server', { problemId, mcpServerUrl });

    // Call MCP server's problem analysis endpoint
    const response = await fetch(`${mcpServerUrl}/mcp/dynatrace/problems/${problemId}/root-cause`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.warn('MCP server root cause query failed', { status: response.status });
      return null;
    }

    const davisAnalysis = await response.json();
    log.info('Davis AI root cause received', { confidence: davisAnalysis.confidence });
    
    return davisAnalysis;
  } catch (err) {
    log.warn('Failed to query Davis AI via MCP server', { error: String(err) });
    return null;
  }
}

/**
 * Enrich problem data with Davis AI insights from MCP server.
 */
async function enrichProblemWithDavis(payload: DynatraceWorkflowPayload): Promise<DynatraceWorkflowPayload> {
  if (!payload.problem_id) {
    return payload;
  }

  const davisInsights = await getDavisRootCause(payload.problem_id);
  
  if (davisInsights) {
    return {
      ...payload,
      davis_insights: {
        root_cause: davisInsights.root_cause || davisInsights.rootCause,
        confidence: davisInsights.confidence || 0,
        evidence: davisInsights.evidence || [],
        related_problems: davisInsights.related_problems || davisInsights.relatedProblems || [],
      },
    };
  }

  return payload;
}

// ─── Webhook Endpoints ────────────────────────────────────────

/**
 * POST /workflow-webhook/problem
 * Primary webhook endpoint for Dynatrace workflow problem notifications.
 * 
 * Dynatrace Workflow Configuration:
 * 1. Trigger: Problem detection (opened/updated)
 * 2. Action: HTTP request
 *    - Method: POST
 *    - URL: http://your-server:8080/api/workflow-webhook/problem
 *    - Body: {{ event | toJson }}
 */
router.post('/problem', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  
  try {
    const payload = req.body as DynatraceWorkflowPayload;
    
    log.info('Received problem webhook from Dynatrace workflow', {
      event_type: payload.event_type,
      problem_id: payload.problem_id,
      entity_name: payload.entity_name,
      severity: payload.severity,
    });

    // Validate payload
    if (!payload.problem_id && !payload.entity_id) {
      res.status(400).json({
        success: false,
        message: 'Missing problem_id or entity_id in webhook payload',
      });
      return;
    }

    const problemId = payload.problem_id || `entity-${payload.entity_id}`;

    // Send acknowledgement event to Dynatrace
    await sendDynatraceEvent({
      eventType: 'CUSTOM_INFO',
      title: '🔧 Fix-It Agent: Problem received from workflow',
      properties: {
        'fixit.source': 'dynatrace_workflow',
        'fixit.problem_id': problemId,
        'fixit.severity': payload.severity || 'unknown',
      },
      entitySelector: payload.entity_id ? `entityId("${payload.entity_id}")` : undefined,
    });

    // Enrich with Davis AI insights from MCP server
    const enrichedPayload = await enrichProblemWithDavis(payload);

    // Trigger autonomous Fix-It agent
    log.info('Triggering Fix-It agent for workflow problem', { problemId });
    
    // Run asynchronously but wait for initial diagnosis
    const fixPromise = autoFix(problemId);
    
    // Give it 5 seconds to start, then respond
    const quickResult = await Promise.race([
      fixPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    if (quickResult) {
      // Fix completed within 5 seconds
      const response: FixItWebhookResponse = {
        success: true,
        runId: quickResult.runId,
        problemId: quickResult.problemId,
        message: 'Fix-It agent completed remediation',
        result: quickResult,
      };
      
      res.json(response);
    } else {
      // Still running, respond with run ID
      const response: FixItWebhookResponse = {
        success: true,
        runId: `fixit-${startTime}`,
        problemId,
        message: 'Fix-It agent started - remediation in progress',
      };
      
      res.json(response);
      
      // Continue processing in background
      fixPromise.then((result) => {
        log.info('Workflow-triggered fix completed', {
          runId: result.runId,
          verified: result.verified,
          durationMs: result.totalDurationMs,
        });
      }).catch((err) => {
        log.error('Workflow-triggered fix failed', { error: String(err) });
      });
    }

  } catch (err) {
    log.error('Webhook processing failed', { error: String(err) });
    
    const response: FixItWebhookResponse = {
      success: false,
      runId: `error-${startTime}`,
      problemId: 'unknown',
      message: 'Failed to process webhook',
      error: String(err),
    };
    
    res.status(500).json(response);
  }
});

/**
 * POST /workflow-webhook/problem-with-davis
 * Enhanced endpoint that requires Davis AI analysis in the payload.
 * Use this when Dynatrace workflow includes Davis AI problem analysis.
 */
router.post('/problem-with-davis', async (req: Request, res: Response): Promise<void> => {
  const payload = req.body as DynatraceWorkflowPayload;
  
  log.info('Received problem with Davis insights', {
    problem_id: payload.problem_id,
    has_davis_insights: !!payload.davis_insights,
  });

  // Reuse main problem handler logic
  const startTime = Date.now();
  
  try {
    if (!payload.problem_id && !payload.entity_id) {
      res.status(400).json({
        success: false,
        message: 'Missing problem_id or entity_id in webhook payload',
      });
      return;
    }

    const problemId = payload.problem_id || `entity-${payload.entity_id}`;

    // Send acknowledgement event
    await sendDynatraceEvent({
      eventType: 'CUSTOM_INFO',
      title: '🔧 Fix-It Agent: Davis-enhanced problem received',
      properties: {
        'fixit.source': 'dynatrace_workflow_davis',
        'fixit.problem_id': problemId,
        'fixit.davis_confidence': String(payload.davis_insights?.confidence || 0),
      },
      entitySelector: payload.entity_id ? `entityId("${payload.entity_id}")` : undefined,
    });

    // Trigger Fix-It agent
    const fixPromise = autoFix(problemId);
    
    const quickResult = await Promise.race([
      fixPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    if (quickResult) {
      res.json({
        success: true,
        runId: quickResult.runId,
        problemId: quickResult.problemId,
        message: 'Fix-It agent completed remediation',
        result: quickResult,
      });
    } else {
      res.json({
        success: true,
        runId: `fixit-${startTime}`,
        problemId,
        message: 'Fix-It agent started - remediation in progress',
      });
      
      fixPromise.catch((err) => {
        log.error('Davis-enhanced fix failed', { error: String(err) });
      });
    }
  } catch (err) {
    log.error('Davis-enhanced webhook failed', { error: String(err) });
    res.status(500).json({
      success: false,
      runId: `error-${startTime}`,
      problemId: 'unknown',
      message: 'Failed to process Davis-enhanced webhook',
      error: String(err),
    });
  }
});

/**
 * GET /workflow-webhook/health
 * Health check endpoint for Dynatrace workflow validation.
 */
router.get('/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'healthy',
    service: 'fix-it-workflow-webhook',
    timestamp: new Date().toISOString(),
    endpoints: {
      problem: '/api/workflow-webhook/problem',
      problem_with_davis: '/api/workflow-webhook/problem-with-davis',
    },
  });
});

/**
 * POST /workflow-webhook/test
 * Test endpoint for validating Dynatrace workflow integration.
 */
router.post('/test', async (req: Request, res: Response): Promise<void> => {
  log.info('Test webhook received', { body: req.body });
  
  res.json({
    success: true,
    message: 'Webhook test successful',
    received_payload: req.body,
    timestamp: new Date().toISOString(),
  });
});

export default router;
