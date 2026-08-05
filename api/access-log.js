export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: 'Supabase not configured' });

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(supabaseUrl, serviceKey);

  // ── POST: log an event ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { event, code_partial } = req.body || {};
    const forwarded = req.headers['x-forwarded-for'] || '';
    const ip = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || '');
    const ua = (req.headers['user-agent'] || '').slice(0, 512);

    const { error } = await sb.from('access_log').insert({
      event:        ['success', 'session', 'attempt'].includes(event) ? event : 'attempt',
      code_partial: code_partial || null,
      ip_address:   ip || null,
      user_agent:   ua || null,
    });
    if (error) {
      console.error('[access-log] insert error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true });
  }

  // ── GET: return last 50 entries for admin view ──────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('access_log')
      .select('id, event, code_partial, ip_address, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: data || [] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
