/**
 * Gremlin Agent routes — chaos injection via feature flags.
 */

import { Router, Request, Response } from 'express';
import {
  injectChaos, revertChaos, revertAll,
  getActiveFaults, getAvailableRecipes, smartChaos,
} from '../agents/gremlin/gremlinAgent.js';
import { ChaosType } from '../tools/chaos/chaosRecipes.js';

const router = Router();

/* POST /inject — inject chaos by manipulating feature flags */
router.post('/inject', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, target, intensity, duration, company } = req.body;
    if (!type) { res.status(400).json({ error: 'type is required' }); return; }

    const result = await injectChaos({
      type: type as ChaosType,
      target: target || 'default',
      intensity: intensity ?? 5,
      durationMs: (duration ?? 60) * 1000,
      details: company ? { company } : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /revert/:faultId — revert a specific fault */
router.post('/revert/:faultId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ok = await revertChaos(req.params.faultId as string);
    res.json({ success: ok, faultId: req.params.faultId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /revert-all — revert everything */
router.post('/revert-all', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await revertAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* GET /active — list all active faults */
router.get('/active', (_req: Request, res: Response): void => {
  res.json(getActiveFaults());
});

/* GET /recipes — list available chaos recipes */
router.get('/recipes', (_req: Request, res: Response): void => {
  res.json(getAvailableRecipes());
});

/* POST /smart — LLM-driven chaos selection */
router.post('/smart', async (req: Request, res: Response): Promise<void> => {
  try {
    const { goal } = req.body;
    if (!goal) { res.status(400).json({ error: 'goal is required' }); return; }
    const result = await smartChaos(goal);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
