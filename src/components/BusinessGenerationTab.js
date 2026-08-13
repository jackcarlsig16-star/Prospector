import { useState, useEffect } from 'react';
import { getAccountsForBusiness } from '../utils/db';
import EmailSystemPage from './EmailGenerator';

// Static sequence/template library scoped to this business's own accounts.
// Known limitation: every template body is written around Plaid's fintech
// pitch (see the final report) - this wiring makes the tool reachable per
// business, it does not rewrite the copy. That's generalize-legacy-functions-v1.
export default function BusinessGenerationTab({ business }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAccountsForBusiness(business.id).then(accs => {
      if (cancelled) return;
      setAccounts(accs);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [business.id]);

  if (loading) {
    return <p style={{ fontFamily: 'monospace', fontSize: 13, color: '#888' }}>Loading…</p>;
  }

  return <EmailSystemPage accounts={accounts} pool={[]} />;
}
