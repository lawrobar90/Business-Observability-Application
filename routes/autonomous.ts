/**
 * Autonomous Agents Routes — control and monitor autonomous chaos and remediation.
 */

import { Router, Request, Response } from 'express';
import {
  startScheduler, stopScheduler, getSchedulerStatus, updateSchedulerConfig,
} from '../agents/gremlin/autonomousScheduler.js';
import {
  startDetector, stopDetector, getDetectorStatus, updateDetectorConfig, clearProcessedProblems,
} from '../agents/fixit/problemDetector.js';

const router = Router();

// ─── Gremlin Scheduler ────────────────────────────────────────

/**
 * POST /autonomous/gremlin/start — Start autonomous chaos scheduler
 */
router.post('/gremlin/start', (req: Request, res: Response): void => {
  try {
    const config = req.body.config || {};
    startScheduler(config);
    res.json({ success: true, message: 'Gremlin scheduler started', status: getSchedulerStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /autonomous/gremlin/stop — Stop autonomous chaos scheduler
 */
router.post('/gremlin/stop', (_req: Request, res: Response): void => {
  try {
    stopScheduler();
    res.json({ success: true, message: 'Gremlin scheduler stopped', status: getSchedulerStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /autonomous/gremlin/status — Get scheduler status
 */
router.get('/gremlin/status', (_req: Request, res: Response): void => {
  res.json(getSchedulerStatus());
});

/**
 * PUT /autonomous/gremlin/config — Update scheduler configuration
 */
router.put('/gremlin/config', (req: Request, res: Response): void => {
  try {
    const updates = req.body;
    updateSchedulerConfig(updates);
    res.json({ success: true, message: 'Scheduler config updated', status: getSchedulerStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Fix-It Detector ──────────────────────────────────────────

/**
 * POST /autonomous/fixit/start — Start autonomous problem detector
 */
router.post('/fixit/start', (req: Request, res: Response): void => {
  try {
    const config = req.body.config || {};
    startDetector(config);
    res.json({ success: true, message: 'Fix-It detector started', status: getDetectorStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /autonomous/fixit/stop — Stop autonomous problem detector
 */
router.post('/fixit/stop', (_req: Request, res: Response): void => {
  try {
    stopDetector();
    res.json({ success: true, message: 'Fix-It detector stopped', status: getDetectorStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /autonomous/fixit/status — Get detector status
 */
router.get('/fixit/status', (_req: Request, res: Response): void => {
  res.json(getDetectorStatus());
});

/**
 * PUT /autonomous/fixit/config — Update detector configuration
 */
router.put('/fixit/config', (req: Request, res: Response): void => {
  try {
    const updates = req.body;
    updateDetectorConfig(updates);
    res.json({ success: true, message: 'Detector config updated', status: getDetectorStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /autonomous/fixit/clear-cache — Clear processed problems cache
 */
router.post('/fixit/clear-cache', (_req: Request, res: Response): void => {
  try {
    clearProcessedProblems();
    res.json({ success: true, message: 'Processed problems cache cleared' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Combined Status ──────────────────────────────────────────

/**
 * GET /autonomous/status — Get overall autonomous agent status
 */
router.get('/status', (_req: Request, res: Response): void => {
  res.json({
    gremlin: getSchedulerStatus(),
    fixit: getDetectorStatus(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /autonomous/start-all — Start both autonomous systems
 */
router.post('/start-all', (req: Request, res: Response): void => {
  try {
    const gremlinConfig = req.body.gremlinConfig || { enabled: true };
    const fixitConfig = req.body.fixitConfig || { enabled: true };

    startScheduler(gremlinConfig);
    startDetector(fixitConfig);

    res.json({
      success: true,
      message: 'All autonomous agents started',
      gremlin: getSchedulerStatus(),
      fixit: getDetectorStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /autonomous/stop-all — Stop both autonomous systems
 */
router.post('/stop-all', (_req: Request, res: Response): void => {
  try {
    stopScheduler();
    stopDetector();

    res.json({
      success: true,
      message: 'All autonomous agents stopped',
      gremlin: getSchedulerStatus(),
      fixit: getDetectorStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
