import { useState, useEffect, useCallback } from 'react';
import { goalsApi } from './goals/goalsApi';
import { updateOpportunity } from './pipelineApi';
import CompanyPanel from './goals/CompanyPanel';
import { companyRowFor } from './peopleModel';
import { TOP_CAP } from '../../constants/pipelineBoard';

// sales-ia-v2 P5 - "Open company" from a People row: the P4 company panel on
// the Pipeline row behind the person's company (the linked opportunity, else
// the record with that name). The board loads on first open and reloads after
// every write, like Pipeline > Companies. No row = a toast, nothing to show.
export default function PeopleCompanyPanel({ businessId, person, canEdit, members, meId, onToast, onClose, onOpenFull }) {
  const [rows, setRows] = useState(null);
  const [key, setKey] = useState(null);
  const load = useCallback(() => goalsApi.pipelineBoard(businessId, true), [businessId]);

  useEffect(() => {
    let live = true;
    load().then(r => { if (live) setRows(r); }).catch(e => { if (live) { onToast({ text: e.message }); onClose(); } });
    return () => { live = false; };
  }, [load, onToast, onClose]);
  useEffect(() => {
    if (!rows) return;
    const row = companyRowFor(person, rows);
    if (!row) { onToast({ text: `${person.company} isn't in the Pipeline yet - add it from Pipeline › Companies.` }); onClose(); return; }
    setKey(k => k || `${row.type}-${row.id}`);
  }, [rows, person, onToast, onClose]);

  const row = key && rows ? rows.find(r => `${r.type}-${r.id}` === key) || null : null;
  const reload = useCallback(() => load().then(setRows).catch(e => onToast({ text: e.message })), [load, onToast]);
  if (!row) return null;
  const star = async () => {
    if (!row.top && rows.filter(r => r.top).length >= TOP_CAP) throw new Error(`Top is full (${TOP_CAP}): unstar one first.`);
    if (row.type === 'partner') await goalsApi.partnerSignal(businessId, row.id, { type: 'hot', hot: !row.top });
    else await updateOpportunity(businessId, row.id, { is_top: !row.top });
    setRows(rs => rs.map(x => (x.id === row.id ? { ...x, top: !row.top } : x)));
  };
  return (
    <CompanyPanel businessId={businessId} row={row} canEdit={canEdit} members={members} meId={meId}
      onStar={star} onPatch={patch => setRows(rs => rs.map(x => (`${x.type}-${x.id}` === key ? { ...x, ...patch } : x)))} onChanged={reload} onToast={onToast}
      onConvert={async created => { await reload(); setKey(`${created.type}-${created.id}`); }} onClose={onClose} onOpenFull={() => onOpenFull(row)} />
  );
}
