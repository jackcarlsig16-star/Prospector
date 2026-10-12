import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { C, mono } from '../constants/colors';
import { getAccountsForBusiness } from '../utils/db';
import { ui } from '../ui/kitTheme';
import { KIT_MAX_WIDTH, KIT_RADIUS } from '../ui/tokens';
import ScoutCommandBar from './ScoutCommandBar';

// scout-global-persistent-v1 — Scout mounted once, persistently, above every
// page's content (App.js),
// instead of five separate embedded copies (former sites: HomePage,
// BdrCommandCenter, ManagerCommandCenter, BusinessCommandCenterTab,
// BusinessSearchTab). Two distinct scopes:
//  - Not on a business-detail page: whatever the caller already queries as
//    "my territory" (Home/BDR/Manager's existing accounts, unchanged) - no
//    business concept applies here, so no pill row.
//  - On a business-detail page: a pill per business + "All businesses",
//    defaulting to the active business (or "All businesses" if the user has
//    already confirmed that as their standing preference). "All businesses"
//    is the union of each business's own accounts (getAccountsForBusiness
//    per business) - it does NOT include Territory; that's a deliberately
//    separate pool (see territory-business-scope-fix-v1) and reconciling the
//    two is out of scope for this phase.

const TRANSITION = 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease';

function Pill({ label, accent, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      ...mono, fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      background: active ? `${accent}22` : 'transparent',
      border: `1px solid ${active ? accent : C.brd}`,
      color: active ? C.txt : C.mut,
      fontWeight: active ? 600 : 400,
      transition: TRANSITION,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
      {label}
    </button>
  );
}

function PillRow({ businesses, activeBusiness, selectedPillId, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
      {businesses.map(b => (
        <Pill key={b.id} label={b.name} accent={b.color || C.gold}
          active={selectedPillId === b.id} onClick={() => onSelect(b.id)} />
      ))}
      <Pill label="All businesses" accent={C.gold}
        active={selectedPillId === 'all'} onClick={() => onSelect('all')} />
      {activeBusiness && (
        <span style={{ ...mono, fontSize: 9, color: C.dim, marginLeft: 2 }}>
          {selectedPillId === 'all' ? `· across ${businesses.length} businesses` : ''}
        </span>
      )}
    </div>
  );
}

function ConfirmAllStrip({ onCancel, onConfirm }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, padding: '6px 10px',
      background: `${C.gold}14`, border: `1px solid ${C.gold}44`, borderRadius: 6,
    }}>
      <span style={{ ...mono, fontSize: 11, color: C.txt, flex: 1 }}>
        Search across all businesses? This includes accounts from every business you manage.
      </span>
      <button onClick={onCancel} style={{ ...mono, fontSize: 10, padding: '3px 9px', background: 'transparent', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
      <button onClick={onConfirm} style={{ ...mono, fontSize: 10, padding: '3px 9px', background: `${C.gold}22`, border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Confirm</button>
    </div>
  );
}

// compact: rendered inside the workspace header row (shell-facelift-v1 Stage 2) - the pill row becomes a
// strip that drops under the input, and Scout's own dropdowns start below that strip.
export default function PersistentScout({
  plain = false, compact = false, isBusinessContext, activeBusiness, businesses = [], territoryAccounts = [],
  activeUser, aeMap = {}, allBusinessesConfirmed, onConfirmAllBusinesses,
  onNav, onCreateTask,
}) {
  const [selectedPillId, setSelectedPillId] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [scoutOpen, setScoutOpen] = useState(false);
  const [bizAccounts, setBizAccounts] = useState([]);
  const [bizLoading, setBizLoading] = useState(false);

  const outerRef = useRef(null);
  const stripRef = useRef(null);
  const cacheRef = useRef(new Map());
  const fetchSeq = useRef(0);
  const [stripHeight, setStripHeight] = useState(0);

  // Default selection: the active business, unless the user has already
  // confirmed "All businesses" as their standing preference - then that
  // stays the default even when navigating between businesses.
  useEffect(() => {
    setPendingConfirm(false);
    if (!isBusinessContext) { setSelectedPillId(null); return; }
    setSelectedPillId(allBusinessesConfirmed ? 'all' : activeBusiness.id);
  }, [isBusinessContext, activeBusiness?.id, allBusinessesConfirmed]);

  useEffect(() => {
    if (!isBusinessContext || !selectedPillId) return;
    const seq = ++fetchSeq.current;
    const ids = selectedPillId === 'all' ? businesses.map(b => b.id) : [selectedPillId];

    setBizLoading(true);
    Promise.all(ids.map(async id => {
      if (cacheRef.current.has(id)) return cacheRef.current.get(id);
      const accs = await getAccountsForBusiness(id);
      cacheRef.current.set(id, accs);
      return accs;
    })).then(results => {
      if (fetchSeq.current !== seq) return;
      setBizAccounts(results.flat());
      setBizLoading(false);
    });
  }, [isBusinessContext, selectedPillId, businesses]);

  // Closing is owned entirely here (not by ScoutCommandBar's internal
  // focus state) so that clicking a pill - which sits outside
  // ScoutCommandBar's own wrapper - never collapses the pill row itself.
  useEffect(() => {
    if (!scoutOpen) return;
    const onMouseDown = (e) => {
      if (outerRef.current && !outerRef.current.contains(e.target)) setScoutOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setScoutOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [scoutOpen]);

  const handleOpenChange = useCallback((v) => { if (v) setScoutOpen(true); }, []);

  const handleSelectPill = (id) => {
    if (id === 'all' && !allBusinessesConfirmed) { setPendingConfirm(true); return; }
    setPendingConfirm(false);
    setSelectedPillId(id);
  };

  const handleConfirmAll = () => {
    onConfirmAllBusinesses?.();
    setPendingConfirm(false);
    setSelectedPillId('all');
  };

  const showPills = isBusinessContext && scoutOpen;
  const scoutAccounts = isBusinessContext ? bizAccounts : territoryAccounts;

  useLayoutEffect(() => {
    setStripHeight(compact && showPills && stripRef.current ? stripRef.current.offsetHeight + 4 : 0);
  });

  const pills = pendingConfirm
    ? <ConfirmAllStrip onCancel={() => setPendingConfirm(false)} onConfirm={handleConfirmAll} />
    : <PillRow businesses={businesses} activeBusiness={activeBusiness} selectedPillId={selectedPillId} onSelect={handleSelectPill} />;
  const loadingLine = isBusinessContext && bizLoading && (
    <p style={{ ...mono, fontSize: 10, color: C.dim, margin: '4px 2px 0' }}>
      Loading {selectedPillId === 'all' ? 'all businesses’' : 'business'} accounts…
    </p>
  );

  if (compact) {
    return (
      <div ref={outerRef} style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', flex: '1 1 auto', minWidth: 0 }}>
        {showPills && (
          <div ref={stripRef} data-scout-pills style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 401, width: 'min(560px, calc(100vw - 48px))', boxSizing: 'border-box', background: ui.surface, border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.control, padding: '8px 8px 2px' }}>
            {pills}
            {loadingLine}
          </div>
        )}
        <ScoutCommandBar
          compact
          dropTop={stripHeight}
          accounts={scoutAccounts}
          onNav={onNav}
          onCreateTask={onCreateTask}
          activeUser={activeUser}
          aeMap={aeMap}
          onOpenChange={handleOpenChange}
        />
      </div>
    );
  }

  return (
    <div ref={outerRef} style={plain ? { maxWidth: KIT_MAX_WIDTH, margin: '0 auto', minWidth: 0 } : { marginBottom: 10 }}>
      {showPills && pills}
      <ScoutCommandBar
        plain={plain}
        accounts={scoutAccounts}
        onNav={onNav}
        onCreateTask={onCreateTask}
        activeUser={activeUser}
        aeMap={aeMap}
        onOpenChange={handleOpenChange}
      />
      {loadingLine}
    </div>
  );
}
