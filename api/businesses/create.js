export const config = { maxDuration: 30 };
import { getSupabase, runResearch } from './shared.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, matches invites.js
function generateAccessCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name, website_url, tagline, color } = req.body || {};
  if (!name || !website_url) {
    return res.status(400).json({ error: 'name and website_url are required' });
  }
  const creator = req.auth.user;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const { data: business, error } = await supabase
    .from('businesses')
    .insert({
      name,
      website_url,
      tagline: tagline || null,
      color,
      owner_email: creator.email,
      access_code: generateAccessCode(),
      research_status: 'pending',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const { error: mErr } = await supabase.from('business_members').insert({
    business_id: business.id, email: creator.email, name: creator.name, user_id: creator.id, role: 'owner',
  });
  if (mErr) return res.status(500).json({ error: `Workspace created, but making you its Owner failed: ${mErr.message}` });

  res.status(200).json({ business });

  runResearch(supabase, business).catch(e => console.error('[businesses] background research crashed:', e));
}
