import { MODELS } from '../config/models';

// Ideas ("Golden Nuggets") live only in this browser's localStorage
// (prospector_golden_nuggets, owned by App.js). Every writer builds the item
// here so the Ideas page and quick capture can't drift apart on shape.
export async function createNugget({ text, workflow = '', anonymous = false, myName }) {
  const body = text.trim();
  let category = 'Feature Request', priority = 'Medium', summary = body.slice(0, 120);
  try {
    const r = await fetch('/proxy/anthropic/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      model: MODELS.FAST, max_tokens: 120,
      messages: [{ role: 'user', content: `Categorize this product feedback in JSON only (no markdown):\n"${body.slice(0, 600)}"\n\nReturn: {"category":"Bug|Feature Request|UX|Performance|Data|Other","priority":"High|Medium|Low","summary":"one sentence under 100 chars"}` }],
    }) });
    const d = await r.json();
    const m = (d.content?.[0]?.text || '{}').match(/\{[\s\S]+\}/);
    if (m) { const parsed = JSON.parse(m[0]); category = parsed.category || category; priority = parsed.priority || priority; summary = parsed.summary || summary; }
  } catch { /* the defaults above */ }
  return {
    id: `ng_${Date.now()}`,
    text: body, workflow: workflow || null,
    category, priority, summary,
    submittedBy: anonymous ? 'Anonymous' : myName,
    realName: myName,
    anonymous,
    submittedAt: new Date().toISOString(),
    upvotes: [myName], downvotes: [],
    status: 'pending', adminNotes: '', releaseTag: '', shippedAt: null,
  };
}
