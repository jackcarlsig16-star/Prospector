import { useState, useEffect, useCallback } from 'react';
import { fetchOpportunities } from '../pipelineApi';
import PipelineTable from '../PipelineTable';
import { cardStyle, labelStyle, h2Style, subStyle, ErrorNote } from './goalsUi';

// master-pipeline-import-v1 - the employer side of the pipeline
// (sales_opportunities, org_type employer | membership) inside Goals, where
// a goals_sales workspace keeps the Overview pipeline widgets hidden.
export const isEmployer = o => o.org_type === 'employer' || o.org_type === 'membership';

export default function EmployersView({ businessId, canEdit }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    fetchOpportunities(businessId).then(all => { setRows(all.filter(isEmployer)); setError(''); }).catch(e => setError(e.message));
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  return (
    <section style={cardStyle} aria-labelledby="h-employers">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
        <span style={labelStyle}>Employer pipeline · all owners</span>
        <h2 style={h2Style} id="h-employers">{rows ? `${rows.length} employer${rows.length === 1 ? '' : 's'}` : 'Employers'}</h2>
        <span style={subStyle}>Employers and membership orgs. The pill shows who owns the account across HomeLover and Upside; T1–T4 is the joint plan’s priority tier.</span>
      </div>
      {error && <ErrorNote message={error} />}
      {rows && <PipelineTable businessId={businessId} opportunities={rows} onPipelineChanged={load} canEdit={canEdit} widgetId="goals_employers" />}
    </section>
  );
}
