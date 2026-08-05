export const config = { maxDuration: 55 };

// ── Field helpers ─────────────────────────────────────────────────────────────

// Parse "Name | Title | Company" or "Name | Email" pipe-delimited contact strings
function parseContacts(raw) {
  if (!raw) return [];
  return String(raw).split(/\n|;;/).map(line => {
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    return {
      name:    parts[0] || '',
      title:   parts[1] || '',
      company: parts[2] || '',
      email:   parts.find(p => p.includes('@')) || '',
    };
  }).filter(Boolean);
}

// Combine pain + situation + impact into painPoints array
function buildPainPoints(f) {
  const items = [];
  if (f.pain)      items.push({ topic: 'Pain',      detail: f.pain });
  if (f.situation) items.push({ topic: 'Situation',  detail: f.situation });
  if (f.impact)    items.push({ topic: 'Impact',     detail: f.impact });
  return items;
}

// Build the human-readable intel block shown in the Queue panel
function buildIntelText(f, ae) {
  const lines = [];
  if (f.usecase)     lines.push(`Use case: ${f.usecase}`);
  if (f.pain)        lines.push(`Pain: ${f.pain}`);
  if (f.situation)   lines.push(`Situation: ${f.situation}`);
  if (f.impact)      lines.push(`Impact: ${f.impact}`);
  if (f.priorities)  lines.push(`Priorities: ${f.priorities}`);
  if (f.products)    lines.push(`Products: ${f.products}`);
  if (f.timeline)    lines.push(`Timeline: ${f.timeline}`);
  if (f.wtp)         lines.push(`WTP / pricing notes: ${f.wtp}`);
  if (f.funding)     lines.push(`Funding: ${f.funding}`);
  if (f.why_flipped) lines.push(`Why now / why flipped: ${f.why_flipped}`);
  if (f.extra)       lines.push(`Extra: ${f.extra}`);
  if (f.notes)       lines.push(`\nNotes:\n${f.notes}`);
  if (ae.ae_segment) lines.push(`\nAE segment: ${ae.ae_segment}`);
  return lines.join('\n');
}

// ── Debrief extraction ────────────────────────────────────────────────────────

async function runDebrief(transcript, company, products, stage) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !transcript?.trim()) return null;

  const prompt = `Extract structured call intelligence from this transcript or call summary for ${company}.

TRANSCRIPT/SUMMARY:
${transcript.slice(0, 40000)}

ACCOUNT CONTEXT:
Stage: ${stage || 'Prospecting'} | Products: ${products || 'unknown'} | Call date: ${new Date().toISOString().slice(0, 10)}

Return ONLY valid JSON (no markdown, no explanation):
{
  "summary": "2-3 sentence call summary",
  "callQuality": "Strong | Neutral | Weak",
  "painPoints": [{"topic": "short label", "detail": "1-sentence context", "solution": "specific product or capability"}],
  "productsDiscussed": [{"product":"Auth","interestLevel":"High|Medium|Low|None"}],
  "decisionMaker": "name and title if identified, null if not",
  "timeline": "ordered deal milestones, comma-separated with timeframes. null if none.",
  "nextSteps": [{"text": "specific committed action item", "owner": "AE|prospect name", "dueDate": "YYYY-MM-DD"}],
  "blockers": [{"text": "one sentence stating what is missing or stuck"}],
  "openQuestions": ["discovery gap to clarify on a future call"],
  "suggestedStage": "Prospecting|Engaged|Qualified|Demo|Proposal|Negotiation|Closed Won|Closed Lost",
  "useCases": ["2-4 word use case label"],
  "keySignals": ["one signal per entry, max 4"],
  "medpiccUpdates": {
    "metrics": null,
    "economic_buyer": null,
    "decision_criteria": null,
    "decision_process": null,
    "identify_pain": null,
    "champion": null,
    "competition": null
  },
  "committedActions": [{"owner": "AE|Prospect", "action": "exact commitment", "dueDate": "YYYY-MM-DD or null", "category": "Production Request|Pricing|Security Review|Follow-up Call|Technical Review|Freeform", "suggestedAction": "playbook default"}]
}

Rules:
- painPoints: max 4. Group related issues. Do NOT include process issues — those are blockers.
- nextSteps: max 3. Concrete deliverables only. No sending emails, generic follow-ups.
- blockers: max 4. Things currently preventing the deal from moving — missing docs, stuck PRs, waiting on third parties.
- openQuestions: max 4. Discovery gaps only.
- medpiccUpdates: fill only fields with clear evidence. Use null for unknowns.
- keySignals: strongest positive indicators of product fit. Max 4.
- committedActions: explicit verbal commitments only. Max 5. Return [] if none.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(40000),
    });
    const data = await r.json();
    const text = data.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    console.error('[handoff] debrief error:', e.message);
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // AE context block
  const ae = {
    ae_segment:    body.ae_segment    || null,
    ae_meetingtime: body.ae_meetingtime || null,
    ae_linkedin:   body.ae_linkedin   || null,
    ae_phone:      body.ae_phone      || null,
    ae_website:    body.ae_website    || null,
    ae_calllink:   body.ae_calllink   || null,
    ae_discogong:  body.ae_discogong  || null,
    ae_sfdc:       body.ae_sfdc       || null,
  };

  // Contact + deal fields
  const f = {
    company:       body.company       || '',
    website:       body.website       || '',
    linkedin:      body.linkedin      || '',
    gong:          body.gong          || '',
    sflink:        body.sflink        || '',
    contacts:      body.contacts      || '',
    phone:         body.phone         || '',
    usecase:       body.usecase       || '',
    products:      body.products      || '',
    priorities:    body.priorities    || '',
    situation:     body.situation     || '',
    pain:          body.pain          || '',
    impact:        body.impact        || '',
    timeline:      body.timeline      || '',
    vol_count:     body.vol_count     || null,
    vol_apis:      body.vol_apis      || null,
    vol_scale:     body.vol_scale     || null,
    vol_alternative: body.vol_alternative || null,
    dev_employees: body.dev_employees || null,
    dev_devs:      body.dev_devs      || null,
    funding:       body.funding       || '',
    wtp:           body.wtp           || '',
    why_flipped:   body.why_flipped   || '',
    extra:         body.extra         || '',
  };

  // Free-form blocks (Disco Coach sends nba_notes/prospect_email/ae_slack as aliases)
  const transcript = body.transcript    || '';
  const notes      = body.notes         || body.nba_notes      || '';
  const email      = body.email         || body.prospect_email || '';
  const slack      = body.slack         || body.ae_slack        || '';

  const company = f.company.trim();
  if (!company) return res.status(400).json({ error: 'company is required' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: 'Supabase not configured' });

  // Run debrief extraction on transcript in parallel with DB write
  const debriefPromise = transcript.trim()
    ? runDebrief(transcript, company, f.products, null)
    : Promise.resolve(null);

  const contacts   = parseContacts(f.contacts);
  const painPoints = buildPainPoints(f);
  const intelText  = buildIntelText({ ...f, notes }, ae);

  // Stable synthetic event_id — deduplicated on company + ae_sfdc + date
  const { createHash } = await import('crypto');
  const hashBase = `${company.toLowerCase()}|${(ae.ae_sfdc || '').toLowerCase()}|${new Date().toISOString().slice(0, 10)}`;
  const syntheticId = `disco_${createHash('md5').update(hashBase).digest('hex').slice(0, 12)}`;

  // Resolve debrief before writing so it lands in the same row
  const debriefResult = await debriefPromise;

  const rawPayload = {
    ae, f,
    transcript: transcript ? `[${transcript.length} chars]` : null, // don't store full transcript in payload
    notes, email, slack,
  };

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(supabaseUrl, serviceKey);

    const row = {
      event_id:       syntheticId,
      company,
      meeting_date:   ae.ae_meetingtime ? ae.ae_meetingtime.slice(0, 10) : null,
      intel:          intelText,
      source:         'DiscoCoach',
      contact_name:   contacts[0]?.name  || null,
      contact_email:  contacts[0]?.email || null,
      updated_at:     new Date().toISOString(),
      // Extended columns (require migration — see README)
      ae_sfdc:        ae.ae_sfdc         || null,
      ae_segment:     ae.ae_segment      || null,
      ae_meeting_time: ae.ae_meetingtime || null,
      sfdc_link:      f.sflink           || null,
      contacts:       contacts.length ? contacts : null,
      pain_points:    painPoints.length  ? painPoints  : null,
      key_signals:    f.why_flipped      ? [f.why_flipped] : null,
      pricing_notes:  f.wtp              || null,
      raw_transcript: transcript         || null,
      debrief_result: debriefResult      || null,
      raw_payload,
    };

    const { error } = await sb.from('handoff_intel').upsert(row, { onConflict: 'event_id' });
    if (error) throw error;

    console.log(`[handoff] DiscoCoach write: ${company} | ${syntheticId}${debriefResult ? ' | debrief ✓' : ''}`);

    return res.json({
      ok: true,
      event_id: syntheticId,
      company,
      contacts_parsed: contacts.length,
      debrief_ran: !!debriefResult,
      debrief_summary: debriefResult?.summary || null,
    });
  } catch (e) {
    console.error('[handoff] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
