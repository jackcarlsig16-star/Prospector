import { SA } from '../theme';
import { Section, Row, Evidence } from './IntakeSections';
import { md } from './TaskRow';

// intake-insights-v1 I3 - the Intake review's "From these notes" section, after the others: Track (what / why / example
// / where, "Already tracked: <field>" or "Not tracked yet"), Optimize (text / why) and Channel links ("Upside Chicago
// office → referred → Acme (Oct 12)", matched ends marked, "Already recorded"). Keep = the row's box (defaults from the
// server: an already-tracked item starts unticked). Kept items save with the rest on Accept, inside the same undo;
// nothing here writes a company, source, owner or stage. Rows don't fade when unticked: already-tracked items start
// unticked and faded text there fell under 4.5:1 - the box alone carries the state.
const small = color => ({ fontSize: 12, color: color || SA.muted, overflowWrap: 'anywhere' });
const RELATION = { referred: 'referred', introduced: 'introduced', owns: 'owns', co_sells: 'co-sells with', reports_to: 'reports to', works_with: 'works with', other: '·' };
const KIND = { partner: 'partner', office: 'office', person: 'person', company: 'company' };
const End = ({ end }) => (
  <span title={end.match ? `In Prospector: ${end.match.name}` : `${KIND[end.kind]} - not matched to a record`} style={{ fontWeight: 500, color: SA.text }}>
    {end.name}{end.match ? <span style={{ color: SA.good }} aria-label="matched"> ✓</span> : null}
  </span>
);
export const linkLine = l => `${l.from.name} → ${RELATION[l.relation] || l.relation} → ${l.to.name}${l.date ? ` (${md(l.date)})` : ''}`;

export default function IntakeInsights({ insights, set }) {
  const { track = [], optimize = [], channel_links = [] } = insights;
  const n = track.length + optimize.length + channel_links.length;
  const toggle = (k, i) => () => set(k)(i)({ keep: !insights[k][i].keep });
  return (
    <Section title="From these notes" count={n}>
      {track.length > 0 && <li data-insight-group="track" style={{ ...small(SA.soft), paddingTop: 8 }}>Track · {track.length}</li>}
      {track.map((t, i) => (
        <Row key={`t${i}`} on={t.keep} label={`Keep: ${t.what}`} onToggle={toggle('track', i)} fade={false}>
          <span style={{ fontWeight: 500, color: SA.text }}>{t.what}</span>
          {t.why && <span style={small(SA.soft)}>{t.why}</span>}
          <span style={small()}>{t.where ? `${t.where} · ` : ''}{t.already_field ? `Already tracked: ${t.already_field}` : 'Not tracked yet'}</span>
          {t.example && <span style={small()}>e.g. {t.example}</span>}
          <Evidence text={t.evidence} />
        </Row>
      ))}
      {optimize.length > 0 && <li data-insight-group="optimize" style={{ ...small(SA.soft), paddingTop: 8 }}>Optimize · {optimize.length}</li>}
      {optimize.map((o, i) => (
        <Row key={`o${i}`} on={o.keep} label={`Keep: ${o.text}`} onToggle={toggle('optimize', i)} fade={false}>
          <span style={{ fontWeight: 500, color: SA.text }}>{o.text}</span>
          {o.why && <span style={small(SA.soft)}>{o.why}</span>}
          <Evidence text={o.evidence} />
        </Row>
      ))}
      {channel_links.length > 0 && <li data-insight-group="links" style={{ ...small(SA.soft), paddingTop: 8 }}>Channel links · {channel_links.length}</li>}
      {channel_links.map((l, i) => (
        <Row key={`l${i}`} on={l.keep} label={`Keep: ${linkLine(l)}`} onToggle={toggle('channel_links', i)} fade={false}>
          <span data-channel-link style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <End end={l.from} />{' '}<span style={small()}>→ {RELATION[l.relation] || l.relation} →</span>{' '}<End end={l.to} />{l.date && <>{' '}<span style={small()}>({md(l.date)})</span></>}
          </span>
          {l.already_recorded && <span style={small(SA.good)}>Already recorded on the company</span>}
          <Evidence text={l.evidence} />
        </Row>
      ))}
    </Section>
  );
}
