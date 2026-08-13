import { useState, useEffect, useCallback } from 'react';
import { ROLE_PERMS } from '../constants/appConfig';
import { getAccountsForBusiness, saveAccountsForBusiness } from '../utils/db';
import AccountsPage from './AccountsPage';
import DealSummaryModal from './AccountCardPricingSummary';

// Business-scoped accounts - independent list per business, no SFDC sync or
// compliance workflow (those are Plaid-specific, out of scope until
// generalize-legacy-functions-v1). A brand-new business starts with zero
// accounts; nothing seeds or copies data across businesses.
export default function BusinessAccountsTab({ business, userEmail }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [dealSummaryAccId, setDealSummaryAccId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAccountsForBusiness(business.id).then(accs => {
      if (cancelled) return;
      setAccounts(accs);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [business.id]);

  const persist = useCallback((next) => {
    setAccounts(next);
    saveAccountsForBusiness(business.id, userEmail, next);
  }, [business.id, userEmail]);

  const perms = ROLE_PERMS.Owner;

  if (loading) {
    return <p style={{ fontFamily: 'monospace', fontSize: 13, color: '#888' }}>Loading accounts…</p>;
  }

  return (
    <>
      <AccountsPage
        accounts={accounts}
        onSave={persist}
        onAddAccount={acc => persist([acc, ...accounts])}
        onRemoveAccount={id => persist(accounts.filter(a => a.id !== id))}
        perms={perms}
        activeRole="Owner"
        activeUser={{ name: userEmail, email: userEmail, role: 'Owner' }}
        onOpenDealSummary={id => setDealSummaryAccId(id)}
        onCreateTask={task => setTasks(ts => [task, ...ts])}
        onUpdateTask={(id, patch) => setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t))}
        tasks={tasks}
      />
      {dealSummaryAccId && (
        <DealSummaryModal accId={dealSummaryAccId} accounts={accounts} onClose={() => setDealSummaryAccId(null)} />
      )}
    </>
  );
}
