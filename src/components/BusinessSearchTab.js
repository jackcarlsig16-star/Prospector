import { useState, useEffect } from 'react';
import { getAccountsForBusiness } from '../utils/db';
import ScoutCommandBar from './ScoutCommandBar';

// Scout scoped to one business's own accounts/deals/tasks - not the global
// cross-business list. A business with zero accounts still gets a working
// Scout bar; buildScoutContext handles an empty account list without erroring.
export default function BusinessSearchTab({ business, userEmail }) {
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

  return (
    <ScoutCommandBar
      accounts={accounts}
      onNav={() => {}}
      activeUser={{ name: userEmail, email: userEmail, role: 'Owner' }}
    />
  );
}
