/**
 * Fix-It Agent routes — problem diagnosis and feature-flag remediation.
 */

import { Router, Request, Response } from 'express';
import { autoFix, diagnose, agenticDiagnose } from '../agents/fixit/fixitAgent.js';

const router = Router();

/* POST /auto — full autonomous pipeline: detect → diagnose → fix → verify */
router.post('/auto', async (req: Request, res: Response): Promise<void> => {
  try {
    const { problemId } = req.body;
    const result = await autoFix(problemId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /diagnose — diagnose a specific problem */
router.post('/diagnose', async (req: Request, res: Response): Promise<void> => {
  try {
    const { problemId } = req.body;
    if (!problemId) { res.status(400).json({ error: 'problemId is required' }); return; }
    const result = await diagnose(problemId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /agentic — full LLM agent loop with tool use */
router.post('/agentic', async (req: Request, res: Response): Promise<void> => {
  try {
    const { problem } = req.body;
    if (!problem) { res.status(400).json({ error: 'problem description is required' }); return; }
    const result = await agenticDiagnose(problem);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
