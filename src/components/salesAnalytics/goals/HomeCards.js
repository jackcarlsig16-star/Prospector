import { useState, useEffect } from 'react';
import useMediaQuery from '../../../utils/useMediaQuery';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { cardStyle, numStyle, fmt, ErrorNote } from './goalsUi';
import { STAGE_ORDER } from '../pipelineStages';
import { EMPLOYER_STAGE_COLORS, PARTNER_STATUS_GROUPS } from '../../../constants/homeCards';

// dashboard-v3 Stage 5 (H) - Home's three small cards over GET goals/dashboard (every digit the route's; this file
// draws): Employers by stage and Partners by status as 120 px conic-gradient donuts (no chart library), the total
// centred, a legend with counts - a slice that is 0 is not drawn, its stage goes to the footnote - the partners'
// owner legend in member colors, and We owe · they owe: open to-dos per owner as bars, waiting-on rows, covered lives
// against the goal. Map → opens Pipeline › Map, Actions → the Actions tab. Reads only.
const card = { ...cardStyle, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 };
const PARTNER_COLOR = Object.fromEntries(PARTNER_STATUS_GROUPS.map(g => [g.id, g.color]));

// Slices with a count and the empty ones for the footnote. Employers read biggest first (the mockup's order); partners
// keep their status order, so the legend reads as the pipeline.
export function splitSlices(rows, colorOf, { byCount = true } = {}) {
  const drawn = rows.filter(r => r.count > 0).map(r => ({ ...r, color: colorOf(r.id) }));
  if (byCount) drawn.sort((a, b) => b.count - a.count);
  return { drawn, empty: rows.filter(r => !r.count) };
}
export function donutGradient(drawn) {
  const total = drawn.reduce((n, s) => n + s.count, 0);
  if (!total) return null;
  let at = 0;
  const stops = drawn.map(s => { const to = at + (s.count / total) * 100; const stop = `${s.color} ${at.toFixed(2)}% ${to.toFixed(2)}%`; at = to; return stop; });
  return `conic-gradient(${stops.join(', ')})`;
}

function Donut({ id, drawn, total, word }) {
  const gradient = donutGradient(drawn);
  return (
    <div role="img" aria-label={`${fmt(total)} ${word}: ${drawn.map(s => `${s.label} ${fmt(s.count)}`).join(', ') || 'none yet'}`} data-donut={id} data-total={total} data-gradient={gradient ? drawn.length : 0}
      style={{ width: 120, height: 120, borderRadius: 999, flex: '0 0 120px', display: 'grid', placeItems: 'center', background: gradient || SA.track }}>
      <div style={{ width: 86, height: 86, borderRadius: 999, background: SA.surface, display: 'grid', placeItems: 'center', textAlign: 'center', lineHeight: 1.1 }}>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: 22, fontWeight: 600, color: SA.text, ...numStyle }}>{fmt(total)}</span>
          <span style={{ fontSize: 10, color: SA.soft }}>{word}</span>
        </span>
      </div>
    </div>
  );
}
function Legend({ id, rows }) {
  return (
    <ul data-legend={id} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
      {rows.map(r => (
        <li key={r.id} data-legend-row={r.id} data-count={r.count} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, minWidth: 0 }}>
          <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: r.color, flex: 'none' }} />
          <span style={{ color: SA.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <b style={{ marginLeft: 'auto', color: SA.text, fontWeight: 500, ...numStyle }}>{fmt(r.count)}</b>
        </li>
      ))}
    </ul>
  );
}
function Head({ title, sub, link, onLink }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>{title}</h2>
      <span style={{ fontSize: 12, color: SA.soft, whiteSpace: 'nowrap' }}>{sub}{sub && link ? ' · ' : ''}{link && <button type="button" className="ui-link" onClick={onLink}>{link} →</button>}</span>
    </div>
  );
}
const empties = rows => rows.map(r => r.label).join(' · ');

export default function HomeCards({ businessId, owner, lookup, onOpenMap, onOpenActions }) {
  const stacked = useMediaQuery('(max-width: 899px)');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setData(null); setError('');
    goalsApi.homeCards(businessId, { owner }).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [businessId, owner]);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <div data-home-cards="loading" style={{ color: SA.muted, fontSize: 13 }}>Loading…</div>;

  const employers = splitSlices(data.employers.by_stage, id => EMPLOYER_STAGE_COLORS[id]);
  const partners = splitSlices(data.partners.by_status, id => PARTNER_COLOR[id], { byCount: false });
  const owners = data.partners.by_owner.map(r => ({ ...r, ...lookup(r.owner_user_id) }));
  const owe = data.todos.per_owner.map(r => ({ ...r, ...lookup(r.owner_user_id) })).sort((a, b) => b.open - a.open);
  const maxOpen = Math.max(1, ...owe.map(r => r.open));
  const { waiting, lives } = data;
  const emptyMain = employers.empty.filter(s => STAGE_ORDER.includes(s.id));
  return (
    <div data-home-cards={data.today} style={{ display: 'grid', gridTemplateColumns: stacked ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))', gap: 16, minWidth: 0 }}>
      <section aria-labelledby="h-employers" style={card}>
        <Head title="Employers" sub="by stage" link="Map" onLink={onOpenMap} />
        {/* The h2 carries the id so the section is a named region for the suite and the screen reader. */}
        <span id="h-employers" hidden>Employers by stage</span>
        {employers.drawn.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Donut id="employers" drawn={employers.drawn} total={data.employers.total} word="employers" />
            <Legend id="employers" rows={employers.drawn} />
          </div>
        ) : <span style={{ fontSize: 13, color: SA.muted }}>No employers in the pipeline yet.</span>}
        {emptyMain.length > 0 && <span data-zero-stages style={{ fontSize: 11, color: SA.faint }}>{empties(emptyMain)}: 0 — not drawn until one lands.</span>}
      </section>
      <section aria-labelledby="h-partners" style={card}>
        <Head title="Partners" sub="by status · owner below" />
        <span id="h-partners" hidden>Partners by status</span>
        {partners.drawn.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Donut id="partners" drawn={partners.drawn} total={data.partners.total} word="partners" />
            <Legend id="partners" rows={partners.drawn} />
          </div>
        ) : <span style={{ fontSize: 13, color: SA.muted }}>No partners yet.</span>}
        {partners.empty.length > 0 && <span data-zero-statuses style={{ fontSize: 11, color: SA.faint }}>{empties(partners.empty)}: 0</span>}
        {owners.length > 0 && (
          <div data-owner-legend style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: SA.soft }}>
            {owners.map(o => (
              <span key={o.owner_user_id || 'unassigned'} data-owner={o.owner_user_id || 'unassigned'} data-count={o.count} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: o.color, display: 'inline-block' }} />{o.first} <b style={{ fontWeight: 500, color: SA.text, ...numStyle }}>{fmt(o.count)}</b>
              </span>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="h-owe" style={card}>
        <Head title="We owe · they owe" link="Actions" onLink={onOpenActions} />
        <span id="h-owe" hidden>We owe, they owe</span>
        {owe.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {owe.map(r => (
              <div key={r.owner_user_id || 'unassigned'} data-owe-row={r.owner_user_id || 'unassigned'} data-open={r.open} data-overdue={r.overdue} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <span style={{ color: SA.soft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.first}</span>
                <span aria-hidden="true" style={{ display: 'block', height: 4, borderRadius: 999, background: SA.track, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.round((r.open / maxOpen) * 100)}%`, background: r.color, borderRadius: 999 }} />
                </span>
                <span style={{ color: SA.text, fontWeight: 500, whiteSpace: 'nowrap', ...numStyle }}>{fmt(r.open)}{r.overdue > 0 && <span style={{ color: SA.faint, fontWeight: 400 }}> {fmt(r.overdue)} overdue</span>}</span>
              </div>
            ))}
          </div>
        ) : <span style={{ fontSize: 13, color: SA.muted }}>No open to-dos.</span>}
        <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 4 }}>
          <span data-waiting={waiting.open}><span style={{ fontSize: 22, fontWeight: 600, color: SA.text, ...numStyle }}>{fmt(waiting.open)}</span> <span style={{ fontSize: 12, color: SA.soft }}>waiting on them</span></span>
          <span data-waiting-overdue={waiting.overdue}><span style={{ fontSize: 22, fontWeight: 600, color: waiting.overdue ? SA.bad : SA.good, ...numStyle }}>{fmt(waiting.overdue)}</span> <span style={{ fontSize: 12, color: SA.soft }}>overdue</span></span>
          <span data-lives={lives.value ?? ''}><span style={{ fontSize: 22, fontWeight: 600, color: SA.text, ...numStyle }}>{fmt(lives.value)}</span> <span style={{ fontSize: 12, color: SA.soft }}>lives{lives.goal ? ` · ${Math.round(((lives.value || 0) / lives.goal) * 100)}% of ${fmt(lives.goal)}` : ' · no goal set'}</span></span>
        </div>
      </section>
    </div>
  );
}
