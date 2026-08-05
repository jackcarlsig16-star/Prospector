import { useState } from 'react';
import { C, mono } from '../constants/colors';

const SECTIONS = [
  {
    label: 'Account Badges',
    items: [
      { sig: '🐷', name: 'Bank Connect Signal',      desc: 'Site copy mentions "connect bank", "link your bank", "pay by bank", or similar — strong Auth / Balance / Identity prospect.' },
      { sig: '📦', name: 'Distribution Multiplier', desc: 'Platform, B2B2C, or marketplace model — usage multiplies downstream to their end users. Auto-promoted to Gold.' },
      { sig: '✅', name: 'Established',              desc: 'Active customer base or traction signals detected — not pre-revenue. Reduces timing risk.' },
      { sig: '🎲', name: 'Gaming Track',             desc: 'Gaming compliance flag is active. Triggers gaming-specific questionnaire and compliance review path.' },
      { sig: '⚡', name: 'Active Deal',              desc: 'Account is in the Active Deal stage — compliance mini-bar visible, deal stage tracking enabled.' },
      { sig: '$',  name: 'Pricing Saved',            desc: 'A pricing sheet exists for this account. Click the card\'s $ Pricing button to view it.' },
      { sig: 'NBA', name: 'NBA Handoff',             desc: 'Inbound handoff from a BDR or Disco Coach — notes and intel are pre-loaded from the handoff record.' },
      { sig: '⬟',  name: 'Stealth',                 desc: 'Account was identified via stealth research (job listings, investor data). Not yet publicly announced.' },
      { sig: '◌',  name: 'Missing Data',             desc: 'Account is missing key fields (website, vertical, or SFDC link). Score may be incomplete.' },
      { sig: '★',  name: 'Favorited',               desc: 'Manually starred by you. Appears in the Favorites filter.' },
    ],
  },
  {
    label: 'Staleness',
    items: [
      { sig: 'Xd at risk', name: 'At Risk',  desc: 'No activity logged in 21+ days. Score penalised. Should be touched this week.', color: '#e05555' },
      { sig: 'Xd warn',    name: 'Warning',  desc: 'No activity in 14-20 days. Getting stale — reach out soon.', color: C.orange },
    ],
  },
  {
    label: 'Tier',
    items: [
      { sig: '⭑',  name: 'Gold',   desc: 'Highest-priority prospect — strong product fit, high score, or distribution multiplier detected.',     color: C.gold   },
      { sig: '◈',  name: 'Silver', desc: 'Solid prospect — moderate fit and engagement potential.',                                              color: '#94A3B8' },
      { sig: '◇',  name: 'Tin',    desc: 'Lower priority — weak signals or thin context. Still possible, lower effort.',                         color: C.tin    },
      { sig: '✕',  name: 'Slag',   desc: 'Not a fit — disqualified by the assay engine or manually removed. Hidden from main territory view.',  color: C.dim    },
    ],
  },
  {
    label: 'Urgency',
    items: [
      { sig: '🔴', name: 'Hot',       desc: 'Reach out today — high-priority signal or deal momentum.' },
      { sig: '🟠', name: 'Warm',      desc: 'Touch this week.' },
      { sig: '🟡', name: 'Follow Up', desc: 'Within the next two weeks.' },
      { sig: '⚪', name: 'Low',       desc: 'When you get to it — no immediate time pressure.' },
    ],
  },
  {
    label: 'Source',
    items: [
      { sig: '↘',  name: 'Inbound',  desc: 'Company reached out first — inbound lead.' },
      { sig: '🤝', name: 'Referral', desc: 'Referred by a customer, partner, or colleague.' },
      { sig: '⬡',  name: 'Partner',  desc: 'Sourced through a partner or channel.' },
      { sig: '◎',  name: '6sense',   desc: 'Identified via 6sense intent data.' },
      { sig: '☁',  name: 'SFDC',     desc: 'Imported from Salesforce.' },
      { sig: '○',  name: 'Cold',     desc: 'Standard outbound prospect — no icon shown.' },
    ],
  },
  {
    label: 'Business Model',
    items: [
      { sig: '📦', name: 'Platform',    desc: 'Serves other businesses — usage scales to their end-user base.' },
      { sig: '🔗', name: 'B2B2C',       desc: 'Business-to-business-to-consumer model with downstream distribution.' },
      { sig: '⇄',  name: 'Marketplace', desc: 'Two-sided marketplace — both sides may need us.' },
      { sig: '⬡',  name: 'Embedded',    desc: 'Embeds financial services into a non-finance product.' },
      { sig: '→',  name: 'Direct',      desc: 'Direct-to-consumer — single-sided relationship.' },
    ],
  },
];

function LegendModal({ onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000bb', zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: '#07101a', border: `1px solid ${C.brd}`, borderRadius: 12,
        width: '100%', maxWidth: 620, maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 20px 60px #00000088' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 12px',
          borderBottom: `1px solid ${C.brd}`, position: 'sticky', top: 0, background: '#07101a', zIndex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.txt, flex: 1 }}>Signal Legend</span>
          <span style={{ ...mono, fontSize: 10, color: C.dim, flex: 1 }}>What each badge and icon means on account cards</span>
          <button onClick={onClose}
            style={{ ...mono, fontSize: 16, color: C.dim, background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', marginLeft: 8 }}>✕</button>
        </div>

        {/* Sections */}
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {SECTIONS.map(section => (
            <div key={section.label}>
              <p style={{ ...mono, margin: '0 0 8px', fontSize: 9, color: C.dim,
                textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                {section.label}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {section.items.map(item => (
                  <div key={item.sig} style={{ display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '7px 10px', background: C.card, border: `1px solid ${C.brd}22`,
                    borderRadius: 6 }}>
                    <span style={{ fontSize: 14, minWidth: 32, textAlign: 'center',
                      flexShrink: 0, color: item.color || C.txt, fontWeight: 700,
                      fontFamily: 'monospace', paddingTop: 1 }}>
                      {item.sig}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span style={{ ...mono, fontSize: 11, fontWeight: 600,
                        color: item.color || C.txt }}>{item.name}</span>
                      <span style={{ fontSize: 11, color: C.mut, marginLeft: 8,
                        lineHeight: 1.55 }}>— {item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '10px 20px 16px', borderTop: `1px solid ${C.brd}` }}>
          <p style={{ ...mono, margin: 0, fontSize: 10, color: C.dim }}>
            Badges are set by the assay engine on scrape, or manually via the account card.
            Hover any badge on a card for a quick tooltip.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SignalLegendButton({ style }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Signal legend — what each badge means"
        style={{ ...mono, fontSize: 11, padding: '4px 9px', background: 'transparent',
          border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 5,
          cursor: 'pointer', lineHeight: 1, ...style }}>
        ?
      </button>
      {open && <LegendModal onClose={() => setOpen(false)} />}
    </>
  );
}

export default SignalLegendButton;
