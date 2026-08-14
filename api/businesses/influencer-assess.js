export const config = { maxDuration: 30 };
import { getSupabase, assessInfluencerAccount } from './shared.js';

// Synthesizes a niche assessment from a human-pasted bio (Instagram fetch
// is confirmed blocked - see shared.js's assessInfluencerAccount comment).
// Never touches last_touched_by/last_touched_at (influencer-accounts-v1).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { accountId, bioText, followerCount } = req.body || {};
  if (!accountId || !bioText?.trim()) return res.status(400).json({ error: 'accountId and bioText are required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const detail = await assessInfluencerAccount(supabase, accountId, bioText.trim(), Number(followerCount) || null);
    res.status(200).json({ detail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
