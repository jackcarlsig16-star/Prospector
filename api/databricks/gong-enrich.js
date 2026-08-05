// Runs a Claude Haiku pass over Gong call briefings to extract:
// - MEDPICC signals for empty fields
// - Unclosed next steps not already in existingNextSteps
// - Close probability signals

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const MEDPICC_FIELDS = [
  'metrics', 'economic_buyer', 'decision_criteria',
  'decision_process', 'identify_pain', 'champion', 'competition',
];

const MEDPICC_LABELS = {
  metrics:           'Metrics',
  economic_buyer:    'Economic Buyer',
  decision_criteria: 'Decision Criteria',
  decision_process:  'Decision Process',
  identify_pain:     'Identify Pain',
  champion:          'Champion',
  competition:       'Competition',
};

export default async function handler(req, res) {
  const { calls = [], currentMedpicc = {}, existingNextSteps = [] } = req.body || {};

  if (!calls.length) {
    return res.json({ medpiccSuggestions: {}, unclosedNextSteps: [], signals: [] });
  }
  if (!ANTHROPIC_KEY) {
    return res.status(503).json({ error: 'Anthropic not configured' });
  }

  const emptyFields = MEDPICC_FIELDS.filter(f => !(currentMedpicc[f] || '').trim());

  // Top 5 most recent calls, condense for token efficiency
  const topCalls = calls.slice(0, 5);
  const callsText = topCalls.map((c, i) => {
    const parts = [`Call ${i + 1}: ${c.subject || 'Untitled'} (${c.date || 'unknown date'})`];
    if (c.summary) parts.push(`Summary: ${c.summary}`);
    if (c.keyPoints?.length) parts.push(`Key Points:\n${c.keyPoints.map(p => `- ${p}`).join('\n')}`);
    if (c.nextSteps?.length) parts.push(`Next Steps:\n${c.nextSteps.map(s => `- ${s}`).join('\n')}`);
    return parts.join('\n');
  }).join('\n\n---\n\n');

  const existingText = existingNextSteps
    .map(s => `- ${typeof s === 'string' ? s : s.text || ''}`)
    .filter(s => s !== '- ')
    .join('\n') || '(none)';

  const medpiccBlock = emptyFields.length
    ? `Extract evidence for these empty MEDPICC fields: ${emptyFields.map(f => MEDPICC_LABELS[f]).join(', ')}.\nOnly populate a field if you find clear, specific evidence. Be concise (1-2 sentences). Set to null if no clear evidence.`
    : `All MEDPICC fields are filled — leave "medpicc" as an empty object {}`;

  const prompt = `You are analyzing Gong call briefings for a sales deal.

CALL BRIEFINGS (${topCalls.length} most recent):
${callsText}

CURRENTLY TRACKED NEXT STEPS:
${existingText}

TASKS:
1. ${medpiccBlock}
2. Unclosed next steps: find concrete action items mentioned in the calls that do NOT already appear in the tracked next steps list. Omit vague items like "follow up" or "send info". Max 5 items.
3. List up to 3 close probability signals — specific positive or negative indicators from the calls.

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "medpicc": {${emptyFields.map(f => `\n    "${f}": null`).join(',')}
  },
  "unclosedNextSteps": [],
  "signals": []
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await r.json();
    const text = data.content?.[0]?.text || '';

    let parsed = {};
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch (e) {
      console.error('[gong-enrich] JSON parse error:', e.message, text.slice(0, 200));
    }

    const medpiccSuggestions = {};
    for (const f of emptyFields) {
      const val = parsed.medpicc?.[f];
      if (val && typeof val === 'string' && val.trim()) {
        medpiccSuggestions[f] = val.trim();
      }
    }

    res.json({
      medpiccSuggestions,
      unclosedNextSteps: (parsed.unclosedNextSteps || []).filter(s => typeof s === 'string' && s.trim()),
      signals: (parsed.signals || []).filter(s => typeof s === 'string' && s.trim()),
    });
  } catch (err) {
    console.error('[gong-enrich] error:', err);
    res.status(500).json({ error: err.message });
  }
}
