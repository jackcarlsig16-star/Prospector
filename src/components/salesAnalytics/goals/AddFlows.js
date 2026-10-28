import { useState, useEffect } from 'react';
import { goalsApi } from './goalsApi';
import { createOpportunity } from '../pipelineApi';
import SidePanel from '../SidePanel';
import OpportunityPanel from '../OpportunityPanel';
import AddPartnerForm from './partners/AddPartnerForm';
import AddTargetForm from './AddTargetForm';
import AddPersonForm from './AddPersonForm';

// one-plus-button-v1 P2 - the four Add flows behind AddMenu, one component so the header "+" and Pipeline's "+ Add ▾"
// open the SAME forms: Employer = the opportunity panel (create), Partner = the Add partner form (dupe check),
// Target = AddTargetForm, Person = AddPersonForm (no email / phone). adding: 'employer' | 'partner' | 'target' |
// 'person' | null. onAdded(record, { section, text, already }) - record { type, id, name } (id null for a parked person).
// companies for the Person typeahead: given by Pipeline (its board rows), else fetched once from the board.
export default function AddFlows({ businessId, members = [], adding, onClose, onAdded, companies = null }) {
  const [fetched, setFetched] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (adding !== 'person' || companies || fetched) return undefined;
    let live = true;
    goalsApi.pipelineBoard(businessId, true).then(rows => { if (live) setFetched(rows.filter(r => ['partner', 'employer', 'target'].includes(r.type)).map(r => ({ type: r.type, id: r.id, name: r.name }))); }).catch(() => { if (live) setFetched([]); });
    return () => { live = false; };
  }, [adding, companies, fetched, businessId]);
  useEffect(() => { if (!adding) setError(''); }, [adding]);
  if (!adding) return null;
  if (adding === 'employer') {
    return (
      <OpportunityPanel businessId={businessId} opportunity={null} saving={saving} error={error} members={members} onClose={onClose}
        onSave={async payload => {
          setSaving(true); setError('');
          try {
            const { reused, opportunity } = await createOpportunity(businessId, payload);
            onAdded({ type: 'employer', id: opportunity.id, name: opportunity.organization }, { already: !!reused, text: reused ? `${opportunity.organization} is already in the pipeline - no new row added.` : `${opportunity.organization} added to the pipeline` });
          } catch (e) { setError(e.message); } finally { setSaving(false); }
        }} />
    );
  }
  if (adding === 'partner') {
    return (
      <SidePanel label="Add partner" width={620} onClose={onClose}>
        <AddPartnerForm members={members} onCreate={async body => { const goal = await goalsApi.createPartner(businessId, body); onAdded({ type: 'partner', id: goal.id, name: goal.name }, { text: `${goal.name} added as a partner` }); }}
          onDupeCheck={params => goalsApi.partnerDupeCheck(businessId, params)} onDone={onClose} onCancel={onClose}
          onOpenPartner={id => onAdded({ type: 'partner', id, name: null }, { already: true })} />
      </SidePanel>
    );
  }
  if (adding === 'target') {
    return (
      <SidePanel label="Add target" width={520} onClose={onClose}>
        <AddTargetForm businessId={businessId} onCancel={onClose}
          onAdded={r => onAdded(r.created || r.already, { already: !!r.already, text: r.already ? `${r.already.name} is already in Prospector - opened it` : `${r.created.name} added as a target` })} />
      </SidePanel>
    );
  }
  return (
    <SidePanel label="Add person" width={520} onClose={onClose}>
      <AddPersonForm businessId={businessId} companies={companies || fetched || []} onCancel={onClose}
        onAdded={r => onAdded(r.company, { section: 'people', text: r.company.id ? `${r.person.name} added to ${r.company.name}` : `${r.person.name} filed under "${r.company.name}" with no record yet - find them in People search` })} />
    </SidePanel>
  );
}
