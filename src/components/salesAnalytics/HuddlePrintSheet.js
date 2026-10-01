import { SA, SA_TYPE } from './theme';

// Print-only. Reuses SalesAnalyticsTab's PRINT_STYLES: only
// #sales-analytics-print-area is visible in print, and the Overview (which
// owns that id on its view) isn't mounted while the huddle is, so the id
// stays unique. SA tokens flip to the light palette under @media print.
const cell = { padding: '6px 8px', borderBottom: `1px solid ${SA.border}`, textAlign: 'left', verticalAlign: 'top', fontSize: 11 };

export default function HuddlePrintSheet({ dateLabel, prospects, ownerLabels, nextActionLabels, today }) {
  const owners = ['jack', 'cyrus', 'unassigned'].filter(o => prospects.some(p => p.owner === o));
  return (
    <div id="sales-analytics-print-area" className="print-only" style={{ color: SA.text }}>
      <h1 style={{ ...SA_TYPE.pageTitle, fontSize: 22, margin: '0 0 4px' }}>Daily Huddle · {dateLabel}</h1>
      <p style={{ fontSize: 12, color: SA.muted, margin: '0 0 16px' }}>{prospects.length} prospects · assignments by owner, hottest first</p>
      {owners.map(owner => {
        const mine = prospects.filter(p => p.owner === owner).sort((a, b) => b.score - a.score);
        return (
          <section key={owner} style={{ marginBottom: 18 }}>
            <h2 style={{ ...SA_TYPE.cardTitle, fontSize: 15, margin: '0 0 6px' }}>{ownerLabels[owner]} · {mine.length}</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Name', 'Company', 'Status', 'Heat', 'Next action', 'Due', 'Notes'].map(h => <th key={h} style={{ ...cell, ...SA_TYPE.label, color: SA.muted }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {mine.map(p => (
                  <tr key={p.contact_id}>
                    <td style={cell}>{p.name || 'Unknown contact'}{p.title ? <div style={{ color: SA.muted }}>{p.title}</div> : null}</td>
                    <td style={cell}>{p.company || '—'}{p.in_pipeline ? <div style={{ color: SA.good }}>In pipeline</div> : null}</td>
                    <td style={cell}>{p.status}</td>
                    <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{p.score}</td>
                    <td style={cell}>{nextActionLabels[p.next_action] || '—'}</td>
                    <td style={{ ...cell, color: p.next_action_due && p.next_action_due <= today ? SA.bad : SA.text }}>{p.next_action_due || '—'}</td>
                    <td style={{ ...cell, maxWidth: 260 }}>{p.notes || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
