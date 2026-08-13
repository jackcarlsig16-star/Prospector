import { useState, useEffect, useCallback, useMemo } from 'react';
import { ROLE_PERMS } from '../constants/appConfig';
import { C, mono } from '../constants/colors';
import { getAccountsForBusiness, saveAccountsForBusiness, getListsForBusiness, getMembersForBusiness, getPermissionsForMembers } from '../utils/db';
import AccountsPage from './AccountsPage';
import DealSummaryModal from './AccountCardPricingSummary';

// Every capability false - a member with only view access on the lists in
// scope gets a real read-only UI, not just a role label (business-lists-and-permissions-v1).
// This is app-level enforcement only, same posture as every other permission
// check in this app - RLS on `accounts` is permissive, so a member could still
// write directly via the anon key; real enforcement lands with Supabase Auth.
const VIEW_ONLY_PERMS = { canUpload:false, canStealth:false, canReassay:false, canRemove:false, canEditStage:false, canAdmin:false, canFlagRemoval:false, canClaim:false };

// Business-scoped accounts - independent list per business, no SFDC sync or
// compliance workflow (those are Plaid-specific, out of scope until
// generalize-legacy-functions-v1). A brand-new business starts with zero
// accounts; nothing seeds or copies data across businesses.
export default function BusinessAccountsTab({ business, userEmail }) {
  const [accounts, setAccounts] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [dealSummaryAccId, setDealSummaryAccId] = useState(null);
  const [selectedListId, setSelectedListId] = useState(null); // null = all accessible lists
  const [accessibleListIds, setAccessibleListIds] = useState(null); // null = owner, no restriction
  const [editableListIds, setEditableListIds] = useState(null);

  const isOwner = (business.owner_email || '').toLowerCase() === (userEmail || '').toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getAccountsForBusiness(business.id),
      getListsForBusiness(business.id),
      isOwner ? Promise.resolve(null) : getMembersForBusiness(business.id),
    ]).then(async ([accs, listRows, memberRows]) => {
      if (cancelled) return;
      setAccounts(accs);
      setLists(listRows);
      if (!isOwner) {
        const me = (memberRows || []).find(m => m.email.toLowerCase() === (userEmail || '').toLowerCase());
        const perms = me ? await getPermissionsForMembers([me.id]) : [];
        if (cancelled) return;
        setAccessibleListIds(new Set(perms.filter(p => p.can_view).map(p => p.list_id)));
        setEditableListIds(new Set(perms.filter(p => p.can_edit).map(p => p.list_id)));
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [business.id, isOwner, userEmail]);

  const persist = useCallback((next) => {
    setAccounts(next);
    saveAccountsForBusiness(business.id, userEmail, next);
  }, [business.id, userEmail]);

  // Owner sees everything, unfiltered by list access. A member only ever sees
  // accounts on lists they've been granted at least view on - unassigned
  // accounts (no list yet) are excluded for members, since there's no list to
  // have been granted access to.
  const visibleAccounts = useMemo(() => {
    let list = accounts;
    if (!isOwner && accessibleListIds) list = list.filter(a => a.listId && accessibleListIds.has(a.listId));
    if (selectedListId) list = list.filter(a => a.listId === selectedListId);
    return list;
  }, [accounts, isOwner, accessibleListIds, selectedListId]);

  // Whether the current view is fully editable. Owner: always. Member on a
  // specific list: that list's own edit grant. Member on "All accessible"
  // (a mixed set): only if every accessible list is also editable - a single
  // view-only list mixed in defaults the whole view to read-only rather than
  // risk exposing edit actions on an account the member can't actually edit.
  const canEditCurrentView = isOwner || (editableListIds && (
    selectedListId ? editableListIds.has(selectedListId)
      : accessibleListIds && accessibleListIds.size > 0 && [...accessibleListIds].every(id => editableListIds.has(id))
  ));

  const perms = canEditCurrentView ? ROLE_PERMS.Owner : VIEW_ONLY_PERMS;

  const handleAdd = useCallback((acc) => {
    persist([{ ...acc, listId: selectedListId || acc.listId || null }, ...accounts]);
  }, [accounts, persist, selectedListId]);

  if (loading) {
    return <p style={{ fontFamily: 'monospace', fontSize: 13, color: '#888' }}>Loading accounts…</p>;
  }

  const listSwitcherOptions = isOwner ? lists : lists.filter(l => accessibleListIds?.has(l.id));

  return (
    <>
      {listSwitcherOptions.length > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
          <button onClick={()=>setSelectedListId(null)} style={{
            ...mono, fontSize:11, padding:"5px 12px", borderRadius:20, cursor:"pointer",
            background: !selectedListId ? C.gold : "transparent", color: !selectedListId ? C.bg : C.dim,
            border:`1px solid ${!selectedListId ? C.gold : C.brd}`, fontWeight: !selectedListId ? 700 : 400,
          }}>All accessible</button>
          {listSwitcherOptions.map(l => (
            <button key={l.id} onClick={()=>setSelectedListId(l.id)} style={{
              ...mono, fontSize:11, padding:"5px 12px", borderRadius:20, cursor:"pointer",
              background: selectedListId===l.id ? C.gold : "transparent", color: selectedListId===l.id ? C.bg : C.dim,
              border:`1px solid ${selectedListId===l.id ? C.gold : C.brd}`, fontWeight: selectedListId===l.id ? 700 : 400,
            }}>{l.name}</button>
          ))}
        </div>
      )}
      {!canEditCurrentView && !isOwner && (
        <p style={{ ...mono, fontSize:11, color:C.dim, margin:"0 0 14px" }}>
          View-only — you don't have edit access to every list shown here. Switch to a single list you can edit to make changes.
        </p>
      )}
      <AccountsPage
        accounts={visibleAccounts}
        onSave={canEditCurrentView ? persist : undefined}
        onAddAccount={canEditCurrentView ? handleAdd : undefined}
        onRemoveAccount={canEditCurrentView ? (id => persist(accounts.filter(a => a.id !== id))) : undefined}
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
