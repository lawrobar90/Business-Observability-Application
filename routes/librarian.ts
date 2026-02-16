/**
 * Librarian Agent routes — operational memory, incident history, flag-change audit trail.
 */

import { Router, Request, Response } from 'express';
import {
  recordChaosEvent, recordChaosRevert,
  recordProblem, recordDiagnosis, recordFix, recordFlagChange,
  searchSimilar, getIncidentTimeline, getRecentHistory,
  getStats, generateLearning,
} from '../agents/librarian/librarianAgent.js';

const router = Router();

/* GET /history — recent history entries */
router.get('/history', (_req: Request, res: Response): void => {
  const limit = parseInt((_req.query.limit as string) || '50', 10);
  res.json(getRecentHistory(limit));
});

/* GET /stats — memory statistics */
router.get('/stats', (_req: Request, res: Response): void => {
  res.json(getStats());
});

/* GET /timeline/:problemId — full incident timeline */
router.get('/timeline/:problemId', (_req: Request, res: Response): void => {
  res.json(getIncidentTimeline(_req.params.problemId as string));
});

/* POST /search — semantic search across recorded events */
router.post('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, k } = req.body;
    if (!query) { res.status(400).json({ error: 'query is required' }); return; }
    const results = await searchSimilar(query, k || 5);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /learn — generate a learning document for an incident */
router.post('/learn', async (req: Request, res: Response): Promise<void> => {
  try {
    const { problemId } = req.body;
    if (!problemId) { res.status(400).json({ error: 'problemId is required' }); return; }
    const learning = await generateLearning(problemId);
    res.json({ learning });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /record/chaos — manually record a chaos event */
router.post('/record/chaos', async (req: Request, res: Response): Promise<void> => {
  try {
    await recordChaosEvent(req.body);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /record/revert — manually record a chaos revert */
router.post('/record/revert', async (req: Request, res: Response): Promise<void> => {
  try {
    await recordChaosRevert(req.body);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /record/problem — record a problem */
router.post('/record/problem', async (req: Request, res: Response): Promise<void> => {
  try {
    await recordProblem(req.body);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /record/diagnosis — record a diagnosis */
router.post('/record/diagnosis', async (req: Request, res: Response): Promise<void> => {
  try {
    await recordDiagnosis(req.body);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /record/fix — record a fix */
router.post('/record/fix', async (req: Request, res: Response): Promise<void> => {
  try {
    await recordFix(req.body);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* POST /record/flag-change — record a feature flag change (audit trail) */
router.post('/record/flag-change', async (req: Request, res: Response): Promise<void> => {
  try {
    await recordFlagChange(req.body);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
