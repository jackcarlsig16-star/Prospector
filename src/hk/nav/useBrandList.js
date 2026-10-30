import { useCallback, useEffect, useRef, useState } from 'react';
import { hkGet } from '../hkApi';
import { brandRequest } from './filterState';

export const PAGE = 100; // REVISABLE (spec N11)

// grow-nav-filters-v1 N11 - the Brands space's one list read: page 1 with facets on every filter / owner change, more
// pages on scroll. The latest request wins (a stale answer is dropped); the old rows stay up, dimmed, until the new
// ones arrive, so the list never flashes empty. `enabled` false = no reads (another space is open).
export default function useBrandList(businessId, state, owner, enabled) {
  const [data, setData] = useState({ rows: null, total: 0, facets: null, next: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const more = useRef(false);
  const key = JSON.stringify(brandRequest(state, owner));

  const load = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true); setError('');
    try {
      const r = await hkGet(businessId, '/brands', brandRequest(state, owner, { limit: PAGE, facets: true }));
      if (n !== seq.current) return;
      setData({ rows: r.rows, total: r.total, facets: r.facets, next: r.next_page });
    } catch (e) { if (n === seq.current) { setError(e.message); setData(d => ({ ...d, rows: d.rows || [] })); } }
    finally { if (n === seq.current) setLoading(false); }
  }, [businessId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const loadMore = useCallback(async () => {
    if (!data.next || more.current || loading) return;
    more.current = true;
    const n = seq.current;
    try {
      const r = await hkGet(businessId, '/brands', brandRequest(state, owner, { page: data.next, limit: PAGE }));
      if (n !== seq.current) return;
      setData(d => ({ ...d, rows: [...d.rows, ...r.rows.filter(x => !d.rows.some(y => y.id === x.id))], next: r.next_page }));
    } catch (e) { if (n === seq.current) setError(e.message); }
    finally { more.current = false; }
  }, [businessId, data.next, loading, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...data, loading, error, loadMore, reload: load };
}
