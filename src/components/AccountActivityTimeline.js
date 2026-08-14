import { C, mono } from '../constants/colors';

const STAMP_RE = /^\[([^·]+)·\s*([^\]]+)\]\s*([\s\S]*)$/;

// No dedicated activity-log component existed anywhere in this codebase to
// reuse (influencer-card-v2, Phase 0 finding) - recordAccountActivity()
// (accounts-lists-and-activity-model-v1) has always just appended stamped
// "[type · date] note" strings into accounts.data.handoffNotes, and the
// only place that ever rendered it was AccountCardRawEdit's raw textarea.
// This parses that same field into a real chronological list - a small,
// genuinely reusable primitive, not influencer-specific despite being built
// for InfluencerCard's detail view first.
function parseEntries(handoffNotes) {
  if (!handoffNotes) return [];
  return handoffNotes.split('\n\n').filter(Boolean).reverse().map((block, i) => {
    const m = block.match(STAMP_RE);
    if (m) return { key: i, type: m[1].trim(), date: m[2].trim(), note: m[3].trim() };
    return { key: i, type: null, date: null, note: block.trim() };
  });
}

export default function AccountActivityTimeline({ acc }) {
  const entries = parseEntries(acc?.data?.handoffNotes ?? acc?.handoffNotes);
  if (!entries.length) {
    return <p style={{ ...mono, fontSize:11, color:C.dim, margin:0 }}>No activity logged yet.</p>;
  }
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {entries.map(e => (
        <div key={e.key} style={{ borderLeft:`2px solid ${C.brdM}`, paddingLeft:10 }}>
          {e.type && (
            <p style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 2px" }}>
              {e.type.replace(/_/g, ' ')}{e.date ? ` · ${e.date}` : ''}
            </p>
          )}
          <p style={{ ...mono, fontSize:12, color:C.txt, margin:0, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{e.note}</p>
        </div>
      ))}
    </div>
  );
}
