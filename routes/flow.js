import express from 'express';

const router = express.Router();

async function callStep(baseUrl, path, body, correlationId) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    let text;
    try { text = await res.text(); } catch {}
    throw new Error(`Failed ${path}: ${res.status} ${res.statusText} url=${url} body=${text || ''}`);
  }
  return res.json();
}

router.post('/runFlow', async (req, res) => {
  const correlationId = req.correlationId;
  try {
    const { payload = {}, port } = req.body || {};
    const PORT = port || process.env.PORT || 8080;
  const baseUrl = `http://127.0.0.1:${PORT}/api/steps`;
    // Default: use child-service chaining across the service flow (Service A -> B -> C ...)
    if (!payload.forceLegacy) {
      const chainRes = await callStep(
        baseUrl,
        '/step1-chained',
        { 
          journeyId: payload?.id, 
          domain: payload?.domain, 
          thinkTimeMs: payload?.thinkTimeMs,
          steps: payload?.steps  // Pass steps configuration for dynamic mapping
        },
        correlationId
      );
      return res.json({ ok: true, correlationId, chained: true, result: chainRes });
    }
    const results = [];
    const journeyId = payload?.id;
    const domain = payload?.domain;
    for (let i=1; i<=6; i++) {
      // Attach a high-level journey step name if present
      const ps = { ...payload };
      // Prefer structured step data from payload.steps
      if (Array.isArray(payload.steps) && payload.steps[i-1]) {
        const step = payload.steps[i-1];
        ps.journeyStep = step.stepName || step.name || `Step${i}`;
        ps.stepName = ps.journeyStep; // explicit for downstream
        if (Array.isArray(step.substeps)) {
          ps.substeps = step.substeps;
        }
      } else if (typeof payload.journeyStep === 'string') {
        ps.journeyStep = payload.journeyStep;
        ps.stepName = payload.journeyStep;
      } else {
        ps.journeyStep = `Step${i}`;
        ps.stepName = ps.journeyStep;
      }
      ps.stepIndex = i - 1;
      if (journeyId) ps.journeyId = journeyId;
      if (domain) ps.domain = domain;
      const r = await callStep(baseUrl, `/step${i}`, ps, correlationId);
      results.push(r);
    }
    res.json({ ok: true, correlationId, results });
  } catch (e) {
    console.error('runFlow error', e);
    res.status(500).json({ ok: false, error: e.message, correlationId });
  }
});

export default router;
