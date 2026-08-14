import { useState, useEffect, useCallback, useMemo } from 'react';
import { ROLE_PERMS } from '../constants/appConfig';
import { C, mono } from '../constants/colors';
import { getAccountsForBusiness, saveAccountsForBusiness, getListsForBusiness, getMembersForBusiness, getPermissionsForMembers, getAccountListMapForBusiness, linkAccountToLists, getInfluencerDetails } from '../utils/db';
import AccountsPage from './AccountsPage';
import DealSummaryModal from './AccountCardPricingSummary';
import CsvImportModal from './CsvImportModal';
import InfluencerAddModal from './InfluencerAddModal';

// Every capability false - a member with only view access on the lists in
// scope gets a real read-only UI, not just a role label (business-lists-and-permissions-v1).
// This is app-level enforcement only, same posture as every other permission
// check in this app - RLS on `accounts` is permissive, so a member could still
// write directly via the anon key; real enforcement lands with Supabase Auth.
const VIEW_ONLY_PERMS = { canUpload:false, canStealth:false, canReassay:false, canRemove:false, canEditStage:false, canAdmin:false, canFlagRemoval:false, canClaim:false };

const UNLISTED = '__unlisted__';

// Business-scoped accounts - independent list per business, no SFDC sync or
// compliance workflow (those are Plaid-specific, out of scope until
// generalize-legacy-functions-v1). A brand-new business starts with zero
// accounts; nothing seeds or copies data across businesses.
export default function BusinessAccountsTab({ business, userEmail, projects=[] }) {
  const [accounts, setAccounts] = useState([]);
  const [lists, setLists] = useState([]);
  const [accountListMap, setAccountListMap] = useState({}); // accountId -> [listId, ...]
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [dealSummaryAccId, setDealSummaryAccId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [influencerAddOpen, setInfluencerAddOpen] = useState(false);
  // Default 'all' (mixed) rather than business-only - matches this app's
  // general default of not hiding data ("All accessible" is the default
  // list filter too). Business-only-by-default was the alternative
  // considered (influencer-accounts-v1, Phase 4).
  const [segment, setSegment] = useState('all'); // 'all' | 'business' | 'influencer'
  const [selectedListId, setSelectedListId] = useState(null); // null = all accessible; UNLISTED = zero-list accounts
  const [accessibleListIds, setAccessibleListIds] = useState(null); // null = owner, no restriction
  const [editableListIds, setEditableListIds] = useState(null);

  const isOwner = (business.owner_email || '').toLowerCase() === (userEmail || '').toLowerCase();

  // silent=true skips the loading flag - used when refreshing in the
  // background (e.g. after CSV import or influencer add) while a success
  // modal is still open. The whole render tree below is gated behind
  // `!loading`, including any open modal - setting loading=true while a
  // modal is showing its own success/done state would unmount it out from
  // under the user, wiping that state, even though the underlying write
  // already succeeded. Confirmed live, not hypothetical (influencer-accounts-v1).
  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return Promise.all([
      getAccountsForBusiness(business.id),
      getListsForBusiness(business.id),
      getAccountListMapForBusiness(business.id),
      isOwner ? Promise.resolve(null) : getMembersForBusiness(business.id),
    ]).then(async ([accs, listRows, listMap, memberRows]) => {
      const influencerIds = accs.filter(a => a.accountKind === 'influencer').map(a => a.id);
      const detailMap = influencerIds.length ? await getInfluencerDetails(influencerIds) : {};
      setAccounts(accs.map(a => detailMap[a.id] ? { ...a, influencerDetail: detailMap[a.id] } : a));
      setLists(listRows);
      setAccountListMap(listMap);
      if (!isOwner) {
        const me = (memberRows || []).find(m => m.email.toLowerCase() === (userEmail || '').toLowerCase());
        const perms = me ? await getPermissionsForMembers([me.id]) : [];
        setAccessibleListIds(new Set(perms.filter(p => p.can_view).map(p => p.list_id)));
        setEditableListIds(new Set(perms.filter(p => p.can_edit).map(p => p.list_id)));
      }
      setLoading(false);
    });
  }, [business.id, isOwner, userEmail]);

  useEffect(() => { let cancelled = false; reload().catch(()=>{}); return () => { cancelled = true; }; }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const listIdsFor = useCallback(acc => accountListMap[acc.id] || [], [accountListMap]);

  // Union rule (accounts-lists-and-activity-model-v1, Phase 4): a member can
  // edit an account if they have edit access on ANY list it belongs to, not
  // just the currently-selected one - checked across all its account_lists
  // rows, not a single list.
  const canEditAccount = useCallback(acc => {
    if (isOwner) return true;
    if (!editableListIds) return false;
    return listIdsFor(acc).some(id => editableListIds.has(id));
  }, [isOwner, editableListIds, listIdsFor]);

  // persist merges by id into the FULL business account set rather than
  // replacing it outright - AccountsPage's internal edit flows (e.g.
  // handleAccountUpdate) call onSave with whatever `accounts` prop they were
  // given, which is visibleAccounts (list-filtered). Replacing wholesale
  // would silently delete every account outside the current filter via
  // saveAccountsForBusiness's delete-not-in-set behavior - a real bug found
  // while wiring this up, not a hypothetical. Also enforces per-account
  // union edit access as a second layer, since AccountsPage can't gate
  // individual rows without a much larger rewrite (flagged trade-off, not
  // silent - a member may see an edit control on a row they can't actually
  // change; the write itself is still correctly rejected here).
  const persist = useCallback((next) => {
    setAccounts(prevFull => {
      const byId = new Map(prevFull.map(a => [a.id, a]));
      next.forEach(a => { if (canEditAccount(a)) byId.set(a.id, a); });
      const merged = [...byId.values()];
      saveAccountsForBusiness(business.id, userEmail, merged);
      return merged;
    });
  }, [business.id, userEmail, canEditAccount]);

  const removeAccount = useCallback(id => {
    const acc = accounts.find(a => a.id === id);
    if (acc && !canEditAccount(acc)) return;
    const filtered = accounts.filter(a => a.id !== id);
    setAccounts(filtered);
    saveAccountsForBusiness(business.id, userEmail, filtered);
  }, [accounts, business.id, userEmail, canEditAccount]);

  const handleAdd = useCallback((acc) => {
    setAccounts(prev => [acc, ...prev]);
    saveAccountsForBusiness(business.id, userEmail, [acc, ...accounts]);
    const targetListId = selectedListId && selectedListId !== UNLISTED ? selectedListId : null;
    if (targetListId) {
      linkAccountToLists(String(acc.id), [targetListId]).then(() => {
        setAccountListMap(prev => ({ ...prev, [acc.id]: [...(prev[acc.id]||[]), targetListId] }));
      });
    }
  }, [accounts, business.id, userEmail, selectedListId]);

  // Owner sees everything, unfiltered by list access. A member only ever sees
  // accounts on lists they've been granted at least view on - unlisted
  // accounts (zero lists) are owner-only, since there's no list a member
  // could have been granted access to.
  const visibleAccounts = useMemo(() => {
    let list = accounts;
    if (!isOwner && accessibleListIds) list = list.filter(a => listIdsFor(a).some(id => accessibleListIds.has(id)));
    if (selectedListId === UNLISTED) list = list.filter(a => listIdsFor(a).length === 0);
    else if (selectedListId) list = list.filter(a => listIdsFor(a).includes(selectedListId));
    if (segment !== 'all') list = list.filter(a => (a.accountKind || 'business') === segment);
    return list;
  }, [accounts, isOwner, accessibleListIds, selectedListId, listIdsFor, segment]);

  // Whether to surface edit controls at all for the current filter - real
  // per-account enforcement happens in persist()/removeAccount() above
  // regardless of this. Owner: always. Member: true if they have edit
  // access to at least one list touching the current view.
  const canEditCurrentView = isOwner || (editableListIds && (
    selectedListId && selectedListId !== UNLISTED ? editableListIds.has(selectedListId)
      : visibleAccounts.some(a => canEditAccount(a))
  ));

  const perms = canEditCurrentView ? ROLE_PERMS.Owner : VIEW_ONLY_PERMS;

  // project-list-linking-v1 — a list tab whose list_id matches a project's
  // list_id makes the "add account to this list" action an intentional
  // "add to project X", not a coincidence of the two sharing an id.
  const projectByListId = useMemo(() => {
    const map = {};
    projects.forEach(p => { if (p.list_id) map[p.list_id] = p; });
    return map;
  }, [projects]);

  if (loading) {
    return <p style={{ fontFamily: 'monospace', fontSize: 13, color: '#888' }}>Loading accounts…</p>;
  }

  const listSwitcherOptions = isOwner ? lists : lists.filter(l => accessibleListIds?.has(l.id));
  const unlistedCount = isOwner ? accounts.filter(a => listIdsFor(a).length === 0).length : 0;

  return (
    <>
      {(listSwitcherOptions.length > 0 || unlistedCount > 0) && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
          <button onClick={()=>setSelectedListId(null)} style={{
            ...mono, fontSize:11, padding:"5px 12px", borderRadius:20, cursor:"pointer",
            background: !selectedListId ? C.gold : "transparent", color: !selectedListId ? C.bg : C.dim,
            border:`1px solid ${!selectedListId ? C.gold : C.brd}`, fontWeight: !selectedListId ? 700 : 400,
          }}>All accessible</button>
          {listSwitcherOptions.map(l => {
            const proj = projectByListId[l.id];
            // project-guidance-and-creation-flow-v1 - the auto-created list is
            // named after its project (project-list-linking-v1), so "· Name"
            // read as "Name · Name" for every project-linked list. A leading
            // marker plus the name once (falling back to "· ProjectName" only
            // when a list has since been renamed away from its project's name)
            // carries the same info without the echo.
            const sameName = proj && proj.name === l.name;
            return (
              <button key={l.id} onClick={()=>setSelectedListId(l.id)} title={proj ? `Project: ${proj.name}` : undefined} style={{
                ...mono, fontSize:11, padding:"5px 12px", borderRadius:20, cursor:"pointer",
                background: selectedListId===l.id ? C.gold : "transparent", color: selectedListId===l.id ? C.bg : C.dim,
                border:`1px solid ${selectedListId===l.id ? (proj ? proj.color||C.gold : C.gold) : (proj ? `${proj.color||C.gold}88` : C.brd)}`, fontWeight: selectedListId===l.id ? 700 : 400,
              }}>
                {proj && <span style={{ marginRight:4 }}>▣</span>}
                {sameName ? proj.name : l.name}
                {proj && !sameName && <span style={{ opacity:0.75 }}> · {proj.name}</span>}
              </button>
            );
          })}
          {isOwner && unlistedCount > 0 && (
            <button onClick={()=>setSelectedListId(UNLISTED)} style={{
              ...mono, fontSize:11, padding:"5px 12px", borderRadius:20, cursor:"pointer",
              background: selectedListId===UNLISTED ? C.gold : "transparent", color: selectedListId===UNLISTED ? C.bg : C.dim,
              border:`1px solid ${selectedListId===UNLISTED ? C.gold : C.brd}`, fontWeight: selectedListId===UNLISTED ? 700 : 400,
            }}>Unlisted ({unlistedCount})</button>
          )}
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        {[['all','All'],['business','Business'],['influencer','Influencer']].map(([id,label]) => (
          <button key={id} onClick={()=>setSegment(id)} style={{
            ...mono, fontSize:11, padding:"5px 12px", borderRadius:20, cursor:"pointer",
            background: segment===id ? C.blue : "transparent", color: segment===id ? C.bg : C.dim,
            border:`1px solid ${segment===id ? C.blue : C.brd}`, fontWeight: segment===id ? 700 : 400,
          }}>{label}</button>
        ))}
      </div>
      {!canEditCurrentView && !isOwner && (
        <p style={{ ...mono, fontSize:11, color:C.dim, margin:"0 0 14px" }}>
          View-only — you don't have edit access to any list shown here.
        </p>
      )}
      {canEditCurrentView && (
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          <button onClick={()=>setImportOpen(true)} style={{ ...mono, fontSize:11, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" }}>
            ↑ Import CSV
          </button>
          <button onClick={()=>setInfluencerAddOpen(true)} style={{ ...mono, fontSize:11, padding:"5px 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" }}>
            + Add Influencer(s)
          </button>
        </div>
      )}
      {importOpen && (
        <CsvImportModal business={business} userEmail={userEmail} onClose={()=>setImportOpen(false)}
          onImported={()=>reload(true)} />
      )}
      {influencerAddOpen && (
        <InfluencerAddModal business={business} userEmail={userEmail} lists={lists} onClose={()=>setInfluencerAddOpen(false)}
          onAdded={()=>reload(true)} />
      )}
      <AccountsPage
        accounts={visibleAccounts}
        onSave={canEditCurrentView ? persist : undefined}
        onAddAccount={canEditCurrentView ? handleAdd : undefined}
        onRemoveAccount={canEditCurrentView ? removeAccount : undefined}
        perms={perms}
        activeRole="Owner"
        activeUser={{ name: userEmail, email: userEmail, role: 'Owner' }}
        onOpenDealSummary={id => setDealSummaryAccId(id)}
        onCreateTask={task => setTasks(ts => [task, ...ts])}
        onUpdateTask={(id, patch) => setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t))}
        tasks={tasks}
        business={business}
        projects={projects}
        accountListMap={accountListMap}
        onAccountLinkedToProject={(accountId, listId) => setAccountListMap(prev => ({ ...prev, [accountId]: [...(prev[accountId] || []), listId] }))}
        onInfluencerUpdated={()=>reload(true)}
      />
      {dealSummaryAccId && (
        <DealSummaryModal accId={dealSummaryAccId} accounts={accounts} onClose={() => setDealSummaryAccId(null)} />
      )}
    </>
  );
}
