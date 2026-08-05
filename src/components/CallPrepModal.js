// CallPrepModal — consolidated call prep surface.
// Replaces: MeetingBriefModal, AccountCardExpandedPanels prep tab, and two
// claude.ai deep-link buttons. One modal, one prompt, one canonical output.
//
// Provenance-tagged context blocks let Claude weight sources by reliability
// (CONFIRMED from calls/email vs WEB inferred vs AE-PROVIDED). Web research
// is opt-in via server-side web_search tool (max_uses=3).
//
// Response parsing: content[] contains server_tool_use + web_search_tool_result
// + text blocks when tools are on. ALWAYS use filter(b=>b.type==='text') to
// extract final text — index-0 would return the tool-use block.
//
// Extensibility: new sources (Glean, SFDC, Gong transcripts) drop into
// DATA_SOURCES as new rows with their own provenance tag. Prompt assembly
// loops the registry — no other changes needed.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { C, mono } from '../constants/colors';
import { MODELS } from '../config/models';
import { MEDPICC_FIELDS } from '../utils/dealIntel';
import { inferRisks, parseBullets } from '../utils/prepIntel';
import { COMPANY_EMAIL_DOMAIN } from '../constants/appConfig';
import { inferCloseProbability } from '../utils/scoringEngine';
import { getStagedAccount, setStagedAccount } from '../utils/storage';
import { getValidGmailToken } from '../utils/getValidGmailToken';
import { buildAccountEmailQuery } from '../utils/accountEmailQuery';

// ─── Deterministic helpers (numbers from JS, never AI) ─────────────────────
const getPricingForPrompt = (id) => {
  if (!id) return {};
  let intel = null, session = null;
  try { intel   = JSON.parse(localStorage.getItem('prospector_pricing_intel') || '{}')[id] || null; } catch {}
  try { session = JSON.parse(localStorage.getItem('prospector_pricing_files')  || '{}')[id] || null; } catch {}
  const out = {};
  const m1  = intel?.m1  || (session?.monthlyUsers?.[0]  > 0 ? session.monthlyUsers[0]  : null);
  const m12 = intel?.m12 || (session?.monthlyUsers?.[11] > 0 ? session.monthlyUsers[11] : null);
  if (m1)  out['Volume Mo. 1']  = `${Number(m1).toLocaleString()} users`;
  if (m12) out['Volume Mo. 12'] = `${Number(m12).toLocaleString()} users`;
  if (session?.startUsers > 0) out['Current users'] = Number(session.startUsers).toLocaleString();
  if (intel?.convRate > 0)           out['Conv. rate']     = `${intel.convRate}%`;
  if (intel?.annualValuePerUser > 0) out['Rev / user']     = `$${Number(intel.annualValuePerUser).toLocaleString()} / yr`;
  if (session?.commitFee > 0)        out['Commit fee']     = `$${Number(session.commitFee).toLocaleString()}`;
  if (session?.pfTier && session.pfTier !== 'none') out['Platform fee tier'] = session.pfTier;
  if (session?.isPartner)            out['Deal type']      = 'Partner / Reseller';
  return out;
};

// ─── Component ──────────────────────────────────────────────────────────────
export default function CallPrepModal({ acc, ev, tasks = [], onUpdate, onClose }) {
  const mode = acc ? (ev ? 'event+account' : 'account') : (ev ? 'event-cold' : 'cold');
  const isCold = !acc;

  const stagedKey = ev?.id ? String(ev.id) : null;
  const stagedExisting = stagedKey ? (getStagedAccount(stagedKey) || {}) : {};

  // ── Data source registry — each row has provenance for the prompt ──
  // Each: { id, label, glyph, provenance, defaultOn, available(), build() }
  const buildSources = (researchText) => [
    {
      id: 'web',
      label: '🌐 Web research',
      sublabel: 'adds ~5s · public sources',
      provenance: 'WEB (public, verify before relying)',
      defaultOn: isCold,
      available: true,
      isWeb: true,
    },
    {
      id: 'account',
      label: 'Account overview',
      sublabel: 'name, stage, vertical, business model',
      provenance: 'PROSPECTOR (account fields)',
      defaultOn: true,
      available: !!acc,
      build: () => acc && [
        `Name: ${acc.name}`,
        acc.stage  ? `Stage: ${acc.stage}` : null,
        acc.vert   ? `Vertical: ${acc.vert}` : null,
        acc.web    ? `Website: ${acc.web}` : null,
      ].filter(Boolean).join('\n'),
    },
    {
      id: 'assay',
      label: 'Assay signals',
      sublabel: 'AI-analyzed business model, fit, products',
      provenance: 'PROSPECTOR (AI-analyzed from public sources)',
      defaultOn: true,
      available: !!(acc?.bm || acc?.pf || acc?.prods?.length),
      build: () => acc && [
        acc.bm     ? `Business model: ${acc.bm}` : null,
        acc.pf     ? `product fit: ${acc.pf}` : null,
        acc.ucs?.length ? `Use cases: ${acc.ucs.join(', ')}` : null,
        acc.prods?.length ? `Recommended products: ${acc.prods.join(', ')}` : null,
        acc.sigs?.length ? `Signals: ${acc.sigs.join('; ')}` : null,
        acc.dis    ? `Disqualifier: ${acc.dis}` : null,
      ].filter(Boolean).join('\n'),
    },
    {
      id: 'personas',
      label: 'Contacts / personas',
      sublabel: 'names, titles, angles',
      provenance: 'PROSPECTOR',
      defaultOn: true,
      available: !!acc?.personas?.length,
      build: () => acc && (acc.personas || []).slice(0, 5).map(p =>
        `${p.name || '?'}, ${p.title || '?'}${p.angle ? ` — ${p.angle}` : ''}${p.email ? ` <${p.email}>` : ''}`
      ).join('\n'),
    },
    {
      id: 'calls',
      label: 'Call history',
      sublabel: 'last 5 calls — summaries, pain, next steps',
      provenance: 'CONFIRMED (from logged calls)',
      defaultOn: true,
      available: !!acc?.calls?.length,
      build: () => acc && (acc.calls || []).slice(-5).map((c, i) =>
        `Call ${i + 1} (${c.date || 'unknown date'}): ${c.summary || 'No summary.'}` +
        (c.painPoints?.length ? `\n  Pain: ${c.painPoints.map(p => typeof p === 'string' ? p : p?.topic || '').filter(Boolean).join('; ')}` : '') +
        (c.nextSteps?.length  ? `\n  Next steps: ${c.nextSteps.map(ns => typeof ns === 'string' ? ns : ns?.text || '').filter(Boolean).join('; ')}` : '') +
        (c.productsDiscussed?.length ? `\n  Products discussed: ${c.productsDiscussed.map(p => typeof p === 'string' ? p : p?.product || '').filter(Boolean).join(', ')}` : '')
      ).join('\n\n'),
    },
    {
      id: 'medpicc',
      label: 'MEDPICC',
      sublabel: 'discovery state — known + gaps',
      provenance: 'CONFIRMED (AE-captured discovery)',
      defaultOn: true,
      available: !!acc?.medpicc && Object.values(acc.medpicc).some(v => (v || '').trim().length),
      build: () => {
        if (!acc?.medpicc) return null;
        const known = MEDPICC_FIELDS.filter(f => (acc.medpicc[f.key] || '').trim().length >= 25)
          .map(f => `${f.label}: ${acc.medpicc[f.key]}`).join('\n');
        const gaps = MEDPICC_FIELDS.filter(f => (acc.medpicc[f.key] || '').trim().length < 25)
          .map(f => `${f.label} (${(acc.medpicc[f.key] || '').trim() ? 'partial' : 'missing'})${f.hint ? ` — Ask: ${f.hint}` : ''}`)
          .join('\n');
        return `KNOWN:\n${known || '(none yet)'}\n\nGAPS:\n${gaps}`;
      },
    },
    {
      id: 'pricing',
      label: 'Pricing intel',
      sublabel: 'deal model: volume, fees, tier',
      provenance: 'PROSPECTOR (deal model)',
      defaultOn: true,
      available: acc && Object.keys(getPricingForPrompt(acc.id)).length > 0,
      build: () => {
        if (!acc) return null;
        const fields = getPricingForPrompt(acc.id);
        return Object.entries(fields).map(([k, v]) => `${k} | ${v}`).join('\n');
      },
    },
    {
      id: 'tasks',
      label: 'Open tasks',
      sublabel: 'action items still open on this account',
      provenance: 'PROSPECTOR',
      defaultOn: true,
      available: !!acc && tasks.some(t => (t.account === acc.name || t.accountId === acc.id) && t.status !== 'Done' && t.status !== 'Closed'),
      build: () => acc && tasks
        .filter(t => (t.account === acc.name || t.accountId === acc.id) && t.status !== 'Done' && t.status !== 'Closed')
        .map(t => `- ${t.title || t.text || ''}`)
        .join('\n'),
    },
    {
      id: 'email',
      label: 'Recent emails',
      sublabel: 'last 5 Gmail messages from / to this domain',
      provenance: 'CONFIRMED (Gmail)',
      defaultOn: true,
      available: !!acc?.web,
      asyncFetch: true,
    },
    {
      id: 'research',
      label: 'Research notes',
      sublabel: 'AE-provided context — paste anything not in Prospector',
      provenance: 'AE-PROVIDED (pre-call notes)',
      defaultOn: !!researchText?.trim(),
      available: true,
      isTextarea: true,
    },
  ];

  // ── State ──────────────────────────────────────────────────────────────
  const [researchText, setResearchText] = useState(stagedExisting.context || '');
  const [checked, setChecked] = useState(() => {
    const init = {};
    buildSources(stagedExisting.context || '').forEach(s => { init[s.id] = s.available && s.defaultOn; });
    return init;
  });
  const [phase, setPhase]   = useState('idle'); // idle | loading | researching | done | error
  const [brief, setBrief]   = useState(acc?.meetingPrepData || null);
  const [err, setErr]       = useState(null);
  const [openSections, setOpenSections] = useState({});
  const [copied, setCopied] = useState(false);
  const outputRef = useRef(null);

  const sources = buildSources(researchText);
  const toggleSrc = (id) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleSection = (id) => setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Gmail context fetch (async, only when 'email' is checked) ─────────
  // Scope resolution flows through buildAccountEmailQuery — persona-emails
  // first, then real-company domain, then distinctive name. Free-tier
  // domains (gmail/yahoo/etc.) are NOT used as a domain query, so a
  // founder on @gmail.com no longer floods the AE's inbox.
  const fetchEmailContext = async () => {
    const { q } = buildAccountEmailQuery(acc);
    if (!q) return '';
    try {
      const token = await getValidGmailToken();
      if (!token) return '';
      const msgsRes = await fetch(
        `/proxy/gmail/messages?q=${encodeURIComponent(q)}&maxResults=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const msgsData = await msgsRes.json();
      if (!msgsData.messages?.length) return '';
      const details = await Promise.all(
        msgsData.messages.slice(0, 5).map(m =>
          fetch(`/proxy/gmail/message/${m.id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
        )
      );
      return details.map(d => {
        const hs = d.payload?.headers || [];
        const g = name => hs.find(h => h.name === name)?.value || '';
        return `Subject: ${g('Subject')}\nFrom: ${g('From')}\nDate: ${g('Date')}`;
      }).join('\n---\n');
    } catch { return ''; }
  };

  // ── Prompt assembly ────────────────────────────────────────────────────
  const buildContextBlock = async () => {
    const blocks = [];
    for (const src of sources) {
      if (!checked[src.id] || !src.available) continue;
      if (src.isWeb) continue; // tool, not text
      if (src.isTextarea) {
        const t = researchText?.trim();
        if (!t) continue;
        blocks.push(`[${src.provenance}]\n${t}`);
        continue;
      }
      if (src.asyncFetch && src.id === 'email') {
        const emailCtx = await fetchEmailContext();
        if (emailCtx) blocks.push(`[${src.provenance}]\n${emailCtx}`);
        continue;
      }
      const body = src.build?.();
      if (body && body.trim()) blocks.push(`[${src.provenance}]\n${body}`);
    }

    // Header line (logistics — dim, single line, not a section)
    const headerBits = [];
    if (acc) headerBits.push(`ACCOUNT: ${acc.name}`);
    if (ev?.summary) headerBits.push(`MEETING: ${ev.summary}`);
    if (ev?.start?.dateTime) headerBits.push(`TIME: ${new Date(ev.start.dateTime).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
    const extAtt = (ev?.attendees || []).filter(a => !a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN) && !a.self);
    const contacts = extAtt.map(a => a.displayName || a.email?.split('@')[0]).filter(Boolean).join(', ');
    if (contacts) headerBits.push(`ATTENDEES: ${contacts}`);

    // Close probability (deterministic signal, account mode only)
    const score = acc ? inferCloseProbability(acc) : null;
    if (score) blocks.push(`[PROSPECTOR (scoring engine)]\nClose probability: ${score.probability}% (${score.confidence} confidence)\nSignals: ${score.signals.join(', ') || 'insufficient data'}`);

    return `${headerBits.join(' | ')}\n\n${blocks.join('\n\n')}`;
  };

  // ── Generate ──────────────────────────────────────────────────────────
  const generate = async () => {
    const webOn = checked.web;
    setPhase(webOn ? 'researching' : 'loading');
    setErr(null);

    // Persist research-notes textarea into staged bucket so it survives
    if (stagedKey && researchText?.trim()) {
      setStagedAccount(stagedKey, { ...stagedExisting, context: researchText.trim() });
    }

    const contextBlock = await buildContextBlock();

    const systemPrompt = `You are a senior sales engineer preparing an AE for a call. Produce a sharp, specific, strategic brief — a point of view and a plan, not a logistics summary. The AE knows when the meeting is; lead with strategy.

Each context block is labeled with its provenance. Treat CONFIRMED data as established fact. Treat WEB and inferred data as leads to validate — say so. Never present a guess as confirmed. If a source is absent, work with what you have; do not fabricate.

When call transcripts or BDR briefs are present, ground product and use-case recommendations in what was ACTUALLY said and mark them (confirmed from call). When only public/web info is available, INFER likely products and mark them (inferred — validate). Always distinguish the two.

Return ONLY a JSON object — no markdown wrapper, no preamble. Bullet lines inside string fields start with "- " (hyphen + space), separated by "\\n":

{
  "snapshot":  "1-line who-they-are + deal-stage read",
  "objective": "1 sentence — what a good outcome looks like for THIS call",
  "strategy":  "2-4 lines — our POV and recommended approach; if fast transactional close, say so; if strategic, the multi-thread play",
  "products":  "bullet lines — recommended products + use cases, EACH tagged (confirmed from call) or (inferred — validate)",
  "covered":   "2-4 bullet lines from call log + emails with source + date, OR 'First touch — no prior contact logged.'",
  "agenda":    "3-5 bullet lines, inferred from context + MEDPICC gaps",
  "questions": "3-5 targeted questions drawn from MEDPICC gaps + unknowns, no field-name prefixes",
  "watchout":  "1-2 real risks: legal, missing EB, timeline, champion. 'None flagged.' if nothing meaningful",
  "leaveWith": "1 sentence — minimum acceptable outcome",
  "angles":    "1-3 bullet lines — what a top rep might try to accelerate, or how to keep a strategic deal moving"
}`;

    const body = {
      model: MODELS.STANDARD,
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: contextBlock }],
    };
    if (webOn) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    }

    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);

      // Extract final text from possibly-multi-block content (tools change shape)
      const finalText = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n\n');
      if (!finalText) throw new Error('Empty response');

      const cleaned = finalText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Parse failure — render raw text rather than blanking the modal
        parsed = { raw: cleaned };
      }
      parsed.generatedAt = new Date().toISOString();
      parsed.webResearchUsed = webOn;
      setBrief(parsed);
      setPhase('done');
      setOpenSections({ strategy: true, products: true, questions: true });

      // Persist to acc.meetingPrepData (account mode)
      if (acc && onUpdate) {
        onUpdate({ ...acc, meetingPrepData: parsed });
      }
    } catch (e) {
      console.error('[CallPrepModal] generate error', e);
      setErr(e.message || 'Generation failed');
      setPhase('error');
    }
  };

  // Auto-generate on open if there's no cached brief
  useEffect(() => {
    if (!brief && phase === 'idle') generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Copy as plain text ────────────────────────────────────────────────
  const buildPlainText = () => {
    if (!brief) return '';
    const sections = [];
    const accLine = acc ? acc.name : (ev?.summary || 'Untitled');
    sections.push(`CALL PREP — ${accLine}`);
    if (ev?.start?.dateTime) sections.push(new Date(ev.start.dateTime).toLocaleString());
    sections.push('—'.repeat(40));

    const add = (label, val) => {
      if (!val) return;
      sections.push(label);
      if (typeof val === 'string' && val.includes('\n')) {
        sections.push(val.split('\n').map(l => l.replace(/^[-•*]\s*/, '- ')).join('\n'));
      } else {
        sections.push(val);
      }
      sections.push('');
    };

    if (brief.snapshot)  add('SNAPSHOT',  brief.snapshot);
    if (brief.objective) add('OBJECTIVE', brief.objective);
    if (brief.strategy)  add('STRATEGY',  brief.strategy);
    if (brief.products)  add('PRODUCTS & USE CASES', brief.products);
    if (brief.questions) add('QUESTIONS', brief.questions);
    if (brief.agenda)    add('AGENDA',    brief.agenda);
    if (brief.covered)   add('COVERED',   brief.covered);
    if (brief.watchout && brief.watchout !== 'None flagged.') add('WATCH OUT FOR', brief.watchout);
    if (brief.leaveWith) add('LEAVE WITH', brief.leaveWith);
    if (brief.angles)    add('ANGLES',    brief.angles);
    if (brief.raw)       add('RAW',       brief.raw);

    return sections.join('\n').trim();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(buildPlainText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // ── Render: terminal-style gold/dim ────────────────────────────────────
  const risks = inferRisks(acc, tasks, { red: C.red, orange: C.orange, gold: C.gold });
  const pricingRows = useMemo(() => {
    if (!acc) return [];
    const f = getPricingForPrompt(acc.id);
    return Object.entries(f);
  }, [acc]);

  const HDR = { ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em' };
  const KEY = { ...mono, fontSize: 12, color: C.gold, fontWeight: 600 };
  const TXT = { ...mono, fontSize: 12, color: C.txt, lineHeight: 1.65 };

  const Section = ({ id, title, accent, children, collapsible = true, defaultOpen = false }) => {
    const isOpen = collapsible ? (openSections[id] ?? defaultOpen) : true;
    return (
      <div style={{ marginBottom: 12, border: `1px solid ${accent || C.brd}`, borderRadius: 7, overflow: 'hidden' }}>
        <div onClick={collapsible ? () => toggleSection(id) : undefined}
             style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 14px', background: C.card, cursor: collapsible ? 'pointer' : 'default',
                      borderBottom: isOpen ? `1px solid ${accent || C.brd}44` : 'none' }}>
          <span style={{ ...HDR, color: accent || C.dim }}>▸ {title}</span>
          {collapsible && <span style={{ ...mono, fontSize: 10, color: C.dim }}>{isOpen ? '▲' : '▼'}</span>}
        </div>
        {isOpen && <div style={{ padding: '10px 14px', background: C.sur }}>{children}</div>}
      </div>
    );
  };

  const renderBullets = (str, accent) => {
    const items = parseBullets(str);
    if (items.length === 0) return <span style={TXT}>{str}</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <span style={{ color: accent || C.gold, marginTop: 1, flexShrink: 0 }}>▸</span>
            <span style={TXT}>{line}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div onClick={onClose}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 2000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10,
                    width: 'min(820px, 96vw)', maxHeight: '92vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.brd}`, background: C.card, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...HDR, marginBottom: 4, color: C.gold }}>✦ Call Prep</div>
              <div style={{ ...mono, fontSize: 16, color: C.txt, fontWeight: 700, marginBottom: 3 }}>
                {acc?.name || ev?.summary || 'Untitled prep'}
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim }}>
                {[
                  acc?.stage,
                  ev?.start?.dateTime && new Date(ev.start.dateTime).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
                  (ev?.attendees || []).filter(a => !a.email?.toLowerCase().endsWith('@' + COMPANY_EMAIL_DOMAIN) && !a.self).map(a => a.displayName || a.email?.split('@')[0]).filter(Boolean).join(', '),
                  mode === 'cold' && 'cold prep (no account, no event)',
                  mode === 'event-cold' && 'no Prospector match for this event',
                ].filter(Boolean).join(' · ')}
              </div>
              {(risks.length > 0 || (acc?.prods?.length || 0) > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  {risks.map(r => (
                    <span key={r.label} style={{ ...mono, fontSize: 9, padding: '2px 7px',
                      background: `${r.color}18`, border: `1px solid ${r.color}55`, color: r.color,
                      borderRadius: 3 }}>{r.label}</span>
                  ))}
                  {(acc?.prods || []).slice(0, 5).map(p => (
                    <span key={p} style={{ ...mono, fontSize: 9, padding: '2px 7px',
                      background: `${C.gold}14`, border: `1px solid ${C.gold}33`, color: C.gold,
                      borderRadius: 3 }}>{p}</span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose}
                    style={{ ...mono, fontSize: 13, background: 'transparent', border: 'none',
                             color: C.mut, cursor: 'pointer', padding: '2px 6px' }}>✕</button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Data source registry — collapsible panel */}
          <Section id="sources" title={`Sources — ${sources.filter(s => checked[s.id] && s.available).length}/${sources.filter(s => s.available).length} selected`} accent={C.dim} collapsible={true} defaultOpen={phase === 'idle'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {sources.filter(s => s.available).map(src => (
                <div key={src.id} onClick={() => toggleSrc(src.id)}
                     style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px',
                              borderRadius: 5, cursor: 'pointer',
                              border: `1px solid ${checked[src.id] ? C.goldBdr : C.brd}`,
                              background: checked[src.id] ? `${C.gold}0D` : 'transparent' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, marginTop: 2, flexShrink: 0,
                                border: `1.5px solid ${checked[src.id] ? C.gold : C.brd}`,
                                background: checked[src.id] ? C.gold : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {checked[src.id] && <span style={{ fontSize: 8, color: '#000', fontWeight: 700 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...mono, fontSize: 11, color: C.txt, fontWeight: 600 }}>{src.label}</div>
                    <div style={{ ...mono, fontSize: 9, color: C.dim, marginTop: 1 }}>{src.sublabel}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Research notes textarea, inline */}
            {checked.research && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={researchText}
                  onChange={e => setResearchText(e.target.value)}
                  placeholder="Paste pre-call research, email threads, prospect data, anything not in Prospector..."
                  rows={4}
                  style={{ ...mono, width: '100%', fontSize: 11, padding: '8px 11px',
                           background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 5,
                           color: C.txt, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            )}
          </Section>

          {/* Phase: loading / researching */}
          {(phase === 'loading' || phase === 'researching') && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid ${C.brd}`,
                            borderTopColor: C.gold, margin: '0 auto 12px',
                            animation: 'cpm-spin 0.8s linear infinite' }} />
              <p style={{ ...mono, margin: 0, fontSize: 12, color: C.gold }}>
                {phase === 'researching' ? 'Researching the web + assembling brief…' : 'Generating brief…'}
              </p>
              <style>{`@keyframes cpm-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Phase: error */}
          {phase === 'error' && (
            <div style={{ padding: 14, border: `1px solid ${C.red}44`, background: `${C.red}08`, borderRadius: 6 }}>
              <p style={{ ...mono, fontSize: 11, color: C.red, margin: '0 0 8px' }}>Error: {err}</p>
              <button onClick={generate}
                      style={{ ...mono, fontSize: 11, padding: '5px 12px', background: 'transparent',
                               border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 4, cursor: 'pointer' }}>
                ↻ Retry
              </button>
            </div>
          )}

          {/* Phase: done — render the brief */}
          {phase === 'done' && brief && (
            <div ref={outputRef}>
              {brief.snapshot && (
                <div style={{ marginBottom: 14, padding: '10px 14px',
                              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7 }}>
                  <div style={{ ...HDR, marginBottom: 4 }}>▸ Snapshot</div>
                  <span style={TXT}>{brief.snapshot}</span>
                </div>
              )}

              {brief.objective && (
                <div style={{ marginBottom: 14, padding: '12px 16px',
                              background: `${C.gold}0C`, border: `1px solid ${C.gold}44`,
                              borderLeft: `3px solid ${C.gold}`, borderRadius: 6 }}>
                  <div style={{ ...HDR, marginBottom: 5, color: C.gold }}>▸ Objective</div>
                  <span style={{ ...TXT, color: C.txt }}>{brief.objective}</span>
                </div>
              )}

              {brief.strategy && (
                <Section id="strategy" title="Strategy" accent={C.gold} defaultOpen={true}>
                  {renderBullets(brief.strategy, C.gold)}
                </Section>
              )}

              {brief.products && (
                <Section id="products" title="Products & Use Cases" accent={C.gold} defaultOpen={true}>
                  {renderBullets(brief.products, C.gold)}
                </Section>
              )}

              {brief.questions && (
                <Section id="questions" title="Questions That Move the Deal" accent={C.purple} defaultOpen={true}>
                  {renderBullets(brief.questions, C.purple)}
                </Section>
              )}

              {brief.agenda && (
                <Section id="agenda" title="Agenda" accent={C.blue}>
                  {renderBullets(brief.agenda, C.blue)}
                </Section>
              )}

              {brief.covered && brief.covered.toLowerCase() !== 'first touch — no prior contact logged.' && (
                <Section id="covered" title="What's Been Covered" accent={C.blue}>
                  {renderBullets(brief.covered, C.blue)}
                </Section>
              )}

              {brief.watchout && brief.watchout !== 'None flagged.' && (
                <Section id="watchout" title="Watch Out For" accent={C.red}>
                  {renderBullets(brief.watchout, C.red)}
                </Section>
              )}

              {brief.leaveWith && (
                <div style={{ marginTop: 10, marginBottom: 10, padding: '10px 14px',
                              background: `${C.green}08`, border: `1px solid ${C.green}33`,
                              borderLeft: `3px solid ${C.green}`, borderRadius: 6 }}>
                  <div style={{ ...HDR, marginBottom: 4, color: C.green }}>▸ Leave With</div>
                  <span style={{ ...TXT }}>{brief.leaveWith}</span>
                </div>
              )}

              {brief.angles && (
                <Section id="angles" title="Angles to Push" accent={C.orange}>
                  {renderBullets(brief.angles, C.orange)}
                </Section>
              )}

              {brief.raw && (
                <Section id="raw" title="Raw Response (parse failed)" accent={C.red} defaultOpen={true}>
                  <pre style={{ ...mono, fontSize: 11, color: C.txt, whiteSpace: 'pre-wrap', margin: 0 }}>{brief.raw}</pre>
                </Section>
              )}

              {/* MEDPICC dot-matrix — bottom, deterministic from acc.medpicc */}
              {acc && acc.medpicc && (
                <Section id="medpiccGrid" title="MEDPICC State" accent={C.mut}>
                  {MEDPICC_FIELDS.map((f, i) => {
                    const val = (acc.medpicc[f.key] || '').trim();
                    const status = !val ? 'missing' : val.length < 25 ? 'partial' : 'filled';
                    const dotC = status === 'filled' ? C.green : status === 'partial' ? C.orange : C.brd;
                    return (
                      <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '130px 12px 1fr',
                                                gap: 8, alignItems: 'flex-start', padding: '6px 0',
                                                borderBottom: i < MEDPICC_FIELDS.length - 1 ? `1px solid ${C.brd}33` : 'none',
                                                opacity: status === 'missing' ? 0.5 : 1 }}>
                        <span style={{ ...mono, fontSize: 10, color: C.mut, paddingTop: 1 }}>{f.label}</span>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotC, marginTop: 4, flexShrink: 0 }} />
                        <div>
                          {val && <p style={{ ...mono, margin: 0, fontSize: 11, color: C.txt, lineHeight: 1.45 }}>{val}</p>}
                          {status !== 'filled' && f.hint && (
                            <p style={{ ...mono, margin: val ? '2px 0 0' : 0, fontSize: 10, color: C.orange, fontStyle: 'italic' }}>{f.hint}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Section>
              )}

              {/* Deal Snapshot — deterministic from pricing files */}
              {pricingRows.length > 0 && (
                <Section id="snapshot" title="Deal Snapshot" accent={C.mut}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {pricingRows.map(([k, v], i) => (
                        <tr key={k} style={{ background: i % 2 === 0 ? `${C.brd}0A` : 'transparent' }}>
                          <td style={{ padding: '5px 8px', ...mono, fontSize: 10, color: C.mut, width: '45%' }}>{k}</td>
                          <td style={{ padding: '5px 8px', ...mono, fontSize: 10, color: C.green, fontWeight: 600, textAlign: 'right' }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}

              {brief.webResearchUsed && (
                <div style={{ ...mono, fontSize: 9, color: C.dim, marginTop: 8, fontStyle: 'italic' }}>
                  🌐 Web research used. Verify any public facts before relying on them.
                </div>
              )}
              {brief.generatedAt && (
                <div style={{ ...mono, fontSize: 9, color: C.dim, marginTop: 4 }}>
                  Generated {new Date(brief.generatedAt).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.brd}`, background: C.card,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, flexShrink: 0 }}>
          <div style={{ ...mono, fontSize: 9, color: C.dim }}>
            {checked.web ? '🌐 web research ON · ~8s' : 'internal sources only · ~3s'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {brief && phase === 'done' && (
              <button onClick={handleCopy}
                      style={{ ...mono, fontSize: 11, padding: '5px 12px',
                               background: copied ? `${C.green}22` : 'transparent',
                               border: `1px solid ${copied ? C.green : C.brd}`,
                               color: copied ? C.green : C.mut, borderRadius: 5, cursor: 'pointer' }}>
                {copied ? '✓ Copied' : '⎘ Copy as text'}
              </button>
            )}
            <button onClick={generate}
                    disabled={phase === 'loading' || phase === 'researching'}
                    style={{ ...mono, fontSize: 11, padding: '5px 12px',
                             background: phase === 'loading' || phase === 'researching' ? 'transparent' : `${C.gold}18`,
                             border: `1px solid ${phase === 'loading' || phase === 'researching' ? C.brd : C.goldBdr}`,
                             color: phase === 'loading' || phase === 'researching' ? C.dim : C.gold,
                             fontWeight: 600, borderRadius: 5,
                             cursor: phase === 'loading' || phase === 'researching' ? 'not-allowed' : 'pointer' }}>
              {brief ? '↻ Regenerate' : '✦ Generate'}
            </button>
            <button onClick={onClose}
                    style={{ ...mono, fontSize: 11, padding: '5px 12px',
                             background: 'transparent', border: `1px solid ${C.brd}`,
                             color: C.mut, borderRadius: 5, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
