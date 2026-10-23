import FilterSelect from '../../../ui/FilterSelect';

// company-workflow-v1 W3 - who owns a company being created: a Member (Viewers can't own work). value '' = me (the
// server makes whoever creates it the owner when none is picked).
export default function OwnerPicker({ members, value, onChange, disabled }) {
  return (
    <FilterSelect label="Owner" value={value || ''} disabled={disabled} onChange={v => onChange(v || null)}
      options={[{ value: '', label: 'Me' }, ...members.filter(m => m.role !== 'viewer').map(m => ({ value: m.user_id, label: m.name.split(' ')[0] }))]} />
  );
}
