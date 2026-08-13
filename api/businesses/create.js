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
  const { name, website_url, tagline, color, owner_email } = req.body || {};
  if (!name || !website_url || !owner_email) {
    return res.status(400).json({ error: 'name, website_url, and owner_email are required' });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const { data: business, error } = await supabase
    .from('businesses')
    .insert({
      name,
      website_url,
      tagline: tagline || null,
      color,
      owner_email: owner_email.toLowerCase(),
      access_code: generateAccessCode(),
      research_status: 'pending',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(200).json({ business });

  runResearch(supabase, business).catch(e => console.error('[businesses] background research crashed:', e));
}
