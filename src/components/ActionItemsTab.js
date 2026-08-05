import React, { useState, useRef, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { extractFromHandwrittenNotes, getGleanPrompt } from '../utils/dealIntel';
import { daysSinceIso } from '../utils/dates';
import { MODELS } from '../config/models';

// ── AI section maps ───────────────────────────────────────────────────────────
const CAT_COLOR = {
  'Discovery':       C.blue,
  'Champion':        '#a78bfa',
  'Risk/Compliance': C.red,
  'Commercial':      C.green,
  'Close':           C.gold,
  'Re-engage':       C.orange,
};

const HEALTH_COLOR = {
  on_track:    C.green,
  close_ready: C.green,
  at_risk:     C.gold,
  stalled:     C.red,
};

const HEALTH_LABEL = {
  on_track:    'On Track',
  close_ready: 'Close Ready',
  at_risk:     'At Risk',
  stalled:     'Stalled',
};

const GAP_LABEL = {
  discovery:       'Discovery',
  champion:        'Champion',
  risk_compliance: 'Risk / Compliance',
  commercial:      'Commercial',
  close:           'Close',
  none:            'None',
};

// ── Context builder ───────────────────────────────────────────────────────────
function buildActionContext(acc, allTasks) {
  let compliance = null;
  let pricing = null;
  try { compliance = (JSON.parse(localStorage.getItem('prospector_compliance') || '{}'))[acc.id] || null; } catch {}
  try { pricing = (JSON.parse(localStorage.getItem('prospector_pricing_files') || '{}'))[acc.id] || null; } catch {}

  const openTasks = (allTasks || []).filter(t => t.accId === acc.id && t.status === 'Open');
  const calls = [...(acc.calls || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const daysInStage = daysSinceIso(acc.activeDealAt);
  const med = acc.medpicc || {};

  const complianceSection = compliance
    ? `Type: ${compliance.type}
  Production Request: ${compliance.steps?.find(s => s.id === 'prod_request')?.status || 'Not Started'}
  Security Questionnaire: ${compliance.steps?.find(s => s.id === 'security_q')?.status || 'Not Started'}`
    : 'No compliance record — treat all steps as Not Started';

  const pricingSection = pricing
    ? `Quote exists: yes | Products: ${pricing.products?.map(p => p.name).join(', ') || 'none'}`
    : 'No quote created yet';

  return `DEAL STATE:
  Stage: ${acc.stage || 'unknown'}
  Tier: ${acc.tier || 'unknown'}
  Days in stage: ${daysInStage != null ? daysInStage + 'd' : 'unknown'}
  Products: ${acc.prods?.join(', ') || 'none identified'}
  Vertical: ${acc.vert || 'unknown'}

MEDPICC:
  Metrics: ${med.metrics || 'not captured'}
  Economic Buyer: ${med.economic_buyer || 'not identified'}
  Decision Criteria: ${med.decision_criteria || 'not captured'}
  Decision Process: ${med.decision_process || 'not captured'}
  Identify Pain: ${med.identify_pain || 'not captured'}
  Champion: ${med.champion || 'not identified'}
  Competition: ${med.competition || 'unknown'}

DISCOVERY EVIDENCE (from call history):
  ${calls.slice(0, 5).map(c => `- ${c.date}: ${(c.summary || '').slice(0, 150)}`).join('\n  ') || 'no calls logged'}

COMPLIANCE TRACK:
  ${complianceSection}

PRICING / QUOTE:
  ${pricingSection}

OPEN TASKS ALREADY ASSIGNED:
  ${openTasks.map(t => `- ${t.title} (${t.category || 'general'})`).join('\n  ') || 'none'}`;
}

// ── Prompt ────────────────────────────────────────────────────────────────────
const INSTRUCTIONS = `You are the action items engine for an AE sales tool.

Your job is to identify the 3-5 most important next actions for this deal based on what is actually missing — not generic sales advice.

SALES PROCESS — use this to identify gaps:

DISCOVERY GATES (must be confirmed before advancing):
- Pain stated explicitly by prospect (not inferred)
- Impact dollarized or quantified
- Timeline stated
- Buying process clarified (who decides, how, by when)
- Technical owner / developer identified
- Economic buyer identified (not just whoever you're talking to)
- Champion confirmed (someone actively driving internally)

RISK / COMPLIANCE GATES (must start early — not at close):
- Production Request submitted (encourage as early as possible)
- Security questionnaire sent / completed
- Risk team tagged after PR submission
- RFI responses chased if Risk issued one
- Risk approval confirmed before contract execution

COMMERCIAL GATES:
- Pricing discussed and validated
- Quote built
- Order form generated
- Legal workflow launched
- Legal / redlines resolved

CLOSE GATES:
- Risk approved for exact products/use case
- MSA + Order Form executed
- Production enablement requested

RULES:
- Only recommend actions that are genuinely missing or incomplete based on the evidence provided
- Do not recommend actions already in the open tasks list
- Prioritize risk/compliance actions if the deal is past early discovery and compliance has not started
- If discovery gates are missing, prioritize those over commercial actions
- Use specific action language (e.g. "tag Risk team", "submit Production Request", "build quote", "loop in SE for technical session")
- Never invent evidence — if pain, EB, or champion are not stated, treat them as missing
- For stalled deals (no activity in 14+ days): include one re-engagement action using direct language ("Ask: is this project still a priority?")
- Owner: AE = action the AE takes | Prospect = action customer takes | Internal = internal-team action

Return ONLY valid JSON. No preamble, no markdown.

{
  "deal_health": "on_track|at_risk|stalled|close_ready",
  "primary_gap": "discovery|champion|risk_compliance|commercial|close|none",
  "actions": [
    {
      "title": "",
      "detail": "",
      "category": "Discovery|Champion|Risk/Compliance|Commercial|Close|Re-engage",
      "owner": "AE|Prospect|Internal",
      "priority": "high|medium|low",
      "why": ""
    }
  ],
  "stall_detected": false,
  "stall_reason": ""
}`;

// ── Main component ────────────────────────────────────────────────────────────
export default function ActionItemsTab({ tasks = [], accounts = [], onCreateTask, onUpdateTask, activeUser, account = null }) {
  // AI state
  const [selectedAccId, setSelectedAccId] = useState(account?.id || null);
  const [dealActions, setDealActions] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);

  // Sync when account prop changes (e.g. user opens different card in AccountsPage)
  useEffect(() => {
    if (account?.id && account.id !== selectedAccId) {
      setSelectedAccId(account.id);
      setDealActions(null);
      setGenError(null);
    }
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAcc = account || accounts.find(a => a.id === selectedAccId) || null;
  const showResults = dealActions && dealActions.accId === selectedAcc?.id;
  const healthColor = showResults ? (HEALTH_COLOR[dealActions.deal_health] || C.gold) : C.gold;

  // Existing state
  const [expandedTaskIds, setExpandedTaskIds] = useState(new Set());
  const [gleanState, setGleanState] = useState({});
  const [taskOwnerFilter, setTaskOwnerFilter] = useState('All');
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesImage, setNotesImage] = useState(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState(null);
  const [notesTranscribed, setNotesTranscribed] = useState('');
  const [notesItems, setNotesItems] = useState([]);
  const [notesEdited, setNotesEdited] = useState([]);
  const [notesSelected, setNotesSelected] = useState(new Set());
  const [notesPushed, setNotesPushed] = useState(false);
  const notesFileRef = useRef(null);

  // Sorted task lists
  const today = new Date().toISOString().split('T')[0];
  const actionItems = tasks.filter(t => t.source === 'committed_action');
  const overdueActionItems = actionItems.filter(t => t.status !== 'Done' && t.status !== 'Stale' && t.dueDate && t.dueDate < today);
  const openActionItems = actionItems.filter(t => t.status !== 'Done' && t.status !== 'Stale' && !overdueActionItems.find(x => x.id === t.id));
  const doneActionItems = actionItems.filter(t => t.status === 'Done');
  const sortedActionItems = [
    ...overdueActionItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    ...openActionItems.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')),
    ...doneActionItems.sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || '')),
  ];

  // ── AI generation ─────────────────────────────────────────────────────────────
  const callAPI = async (messages) => {
    const res = await fetch('/proxy/anthropic/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELS.FAST, max_tokens: 1500, messages }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || '';
  };

  const generateActions = async () => {
    if (!selectedAcc) return;
    setGenerating(true);
    setGenError(null);
    try {
      const ctx = buildActionContext(selectedAcc, tasks);
      const prompt = `ACCOUNT: ${selectedAcc.name}\n\n${ctx}\n\n${INSTRUCTIONS}`;
      const messages = [{ role: 'user', content: prompt }];
      let text = await callAPI(messages);
      let parsed;
      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('no json');
        parsed = JSON.parse(match[0]);
      } catch {
        const retryText = await callAPI([
          ...messages,
          { role: 'assistant', content: text },
          { role: 'user', content: 'Your previous response was not valid JSON. Return only the JSON object, no other text.' },
        ]);
        const m2 = retryText.match(/\{[\s\S]*\}/);
        if (!m2) throw new Error('No JSON returned');
        parsed = JSON.parse(m2[0]);
      }
      if (!parsed.deal_health) throw new Error('Invalid response shape');
      setDealActions({ ...parsed, generatedAt: new Date().toISOString(), accId: selectedAcc.id });
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // ── Existing helpers ──────────────────────────────────────────────────────────
  const setGleanTask = (id, patch) => setGleanState(s => ({ ...s, [id]: { ...(s[id] || {}), ...patch } }));

  const getGleanQuery = (t) => {
    const vert  = t.accVert || 'fintech';
    const uc    = (t.accUcs||[])[0] || 'their use case';
    const stage = t.accStage || 'early stage';
    const prods = (t.accProds||[]).join(', ') || 'our APIs';
    const name  = t.accName || 'this account';
    switch (t.category) {
      case 'Production Request':  return `production request process ${vert}`;
      case 'Payment Partners':    return `payment partners ${uc} ${vert}`;
      case 'Pricing':             return `pricing model ${vert} ${stage}`;
      case 'Security Review':     return `security questionnaire review process`;
      case 'Partner Access':      return `partner portal access setup`;
      case 'Follow-up Call':      return `${name} account open discovery questions`;
      case 'VC Recommendations':  return `investors VCs ${vert} ${stage}`;
      case 'Technical Review':    return `${prods} integration requirements ${vert}`;
      default:                    return `${name} ${t.title}`;
    }
  };

  const needsPeople = (cat) => cat === 'Security Review' || cat === 'Technical Review';

  const buildDeliverablePrompt = (t, results, people) => {
    const vert  = t.accVert || 'fintech';
    const name  = t.accName || 'this account';
    const prods = (t.accProds||[]).join(', ') || 'our APIs';
    const uc    = (t.accUcs||[])[0] || 'their use case';
    const snippets = results.slice(0,4).map((r,i)=>`[${i+1}] ${r.title}\n${r.snippet||''}`).join('\n\n');
    const peopleText = people.length ? '\nSolutions Engineers:\n' + people.map(p=>`- ${p.name}${p.title?` (${p.title})`:''}${p.email?` — ${p.email}`:''}`).join('\n') : '';
    const instruction = {
      'Production Request':  `Write a 2-sentence internal Chatter post requesting production access assessment for ${name} (${vert}, ${uc}). Include what they do and what API they need.`,
      'Payment Partners':    `List exactly 3 payment partners from the Glean results most relevant for ${uc} in ${vert}. For each: name, one-sentence why relevant, one-line action item.`,
      'Pricing':             `Summarize 3 key pricing benchmarks or data points for ${vert} deals at ${t.accStage||'this stage'}. Be specific with numbers if found in results.`,
      'Security Review':     `Draft a 2-sentence Slack/email to the SE to loop them into the security review for ${name} (${vert}). Mention what the prospect does and that they've requested a security questionnaire.`,
      'Partner Access':      `List the exact steps to set up partner portal access for ${name}. Pull contacts or links from Glean results if present.`,
      'Follow-up Call':      `Write a 3-bullet agenda for the next call with ${name}. Focus on open discovery gaps and what needs to be resolved this meeting.`,
      'VC Recommendations':  `List 3–5 specific VC firms active in ${vert} at ${t.accStage||'this stage'} that we have relationships with. For each: firm name and one-sentence why they fit.`,
      'Technical Review':    `Draft a 2-sentence Slack/email to the SE to kick off integration scoping for ${name} (${vert}, using ${prods}). Include the prospect's use case.`,
    }[t.category] || `Based on the Glean results, give me the single most actionable next step for "${t.title}" with ${name}. Be direct and specific.`;

    return `You are an AE. Task: "${t.title}" for ${name} (${vert}${uc ? ', '+uc : ''}).

Glean results:
${snippets || '(no results found)'}
${peopleText}

${instruction}

No preamble. Output only the deliverable itself.`;
  };

  const doGlean = async (t) => {
    const id = t.id;
    setGleanTask(id, { loading: true, error: null, results: [], peopleResults: [], deliverable: '', copied: false });
    try {
      const gleanQuery = getGleanQuery(t);
      const [searchRaw, peopleRaw] = await Promise.all([
        fetch('/api/glean', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query: gleanQuery }) }),
        needsPeople(t.category)
          ? fetch('/api/glean/people', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query: `solutions engineer ${t.accVert||''}` }) })
          : Promise.resolve(null),
      ]);
      const searchRes = await searchRaw.json();
      if (searchRes.error) throw new Error(`Glean: ${searchRes.error}`);
      const peopleRes = peopleRaw ? await peopleRaw.json() : { people: [] };
      const results = searchRes.results || [];
      const people  = peopleRes.people  || [];
      if (results.length === 0 && people.length === 0) {
        setGleanTask(id, { loading: false, error: 'nothing_found' });
        return;
      }
      const claudeRaw = await fetch('/proxy/anthropic/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:MODELS.REASONING, max_tokens:500, messages:[{ role:'user', content: buildDeliverablePrompt(t, results, people) }] }),
      });
      const claudeRes = await claudeRaw.json();
      if (claudeRes.error) throw new Error(`Claude: ${claudeRes.error}`);
      const deliverable = claudeRes.content?.[0]?.text || '';
      setGleanTask(id, { loading: false, results, peopleResults: people, deliverable, error: null });
    } catch (err) {
      setGleanTask(id, { loading: false, error: err.message });
    }
  };

  const renderRow = (t) => {
    const isDone    = t.status === 'Done';
    const isOverdue = !isDone && t.dueDate && t.dueDate < today;
    const ownerC    = t.owner === 'AE' ? C.red : C.blue;
    const isExp     = expandedTaskIds.has(t.id);
    const gs        = gleanState[t.id] || {};
    return (
      <div key={t.id} style={{ border:`1px solid ${isDone?C.brd:isOverdue?`${ownerC}55`:`${ownerC}33`}`, borderRadius:7, background:isDone?'transparent':C.card, opacity:isDone?0.5:1, transition:'all 0.15s', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', cursor:'pointer' }}
          onClick={() => setExpandedTaskIds(s => { const n=new Set(s); n.has(t.id)?n.delete(t.id):n.add(t.id); return n; })}>
          <button onClick={e=>{ e.stopPropagation(); onUpdateTask&&onUpdateTask(t.id,{status:isDone?'Open':'Done'}); }}
            style={{ width:16, height:16, borderRadius:3, border:`1.5px solid ${isDone?C.green:ownerC}`, background:isDone?`${C.green}22`:`${ownerC}14`, flexShrink:0, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>
            {isDone && <span style={{ color:C.green, fontSize:10, lineHeight:1 }}>✓</span>}
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:0, fontSize:12, color:isDone?C.mut:C.txt, textDecoration:isDone?'line-through':'none', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</p>
          </div>
          {t.category && t.category !== 'Freeform' && (
            <span style={{ ...mono, fontSize:9, padding:'1px 5px', background:`${ownerC}14`, border:`1px solid ${ownerC}33`, color:ownerC, borderRadius:3, flexShrink:0, textTransform:'uppercase', letterSpacing:'0.05em' }}>{t.category}</span>
          )}
          <span style={{ ...mono, fontSize:10, color:ownerC, flexShrink:0, fontWeight:600 }}>{t.owner==='AE'?'You':'Them'}</span>
          {t.dueDate && <span style={{ ...mono, fontSize:10, color:isOverdue?C.red:C.mut, flexShrink:0 }}>{isOverdue?'⚠ ':''}{t.dueDate}</span>}
          <span style={{ ...mono, fontSize:9, color:C.dim, flexShrink:0 }}>{isExp?'▲':'▼'}</span>
        </div>
        {isExp && (
          <div style={{ padding:'0 12px 12px', borderTop:`1px solid ${C.brd}` }}>
            {t.rawAction && t.rawAction !== t.title && (
              <p style={{ ...mono, margin:'8px 0 6px', fontSize:10, color:C.dim }}>Heard: "{t.rawAction}"</p>
            )}
            <div style={{ display:'flex', gap:7, marginTop:10, flexWrap:'wrap', alignItems:'center' }}>
              {!gs.deliverable && (
                <button onClick={e=>{ e.stopPropagation(); if (!gs.loading) doGlean(t); }}
                  disabled={gs.loading}
                  style={{ ...mono, fontSize:11, padding:'3px 10px', background: gs.loading?`${C.blue}08`:`${C.blue}18`, border:`1px solid ${C.blue}44`, color: gs.loading?C.dim:C.blue, borderRadius:4, cursor: gs.loading?'default':'pointer', transition:'all 0.15s', display:'flex', alignItems:'center', gap:5 }}>
                  {gs.loading ? <><span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', border:`1.5px solid ${C.blue}`, borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}></span> Working...</> : 'Do it →'}
                </button>
              )}
              {!isDone && <button onClick={e=>{ e.stopPropagation(); onUpdateTask&&onUpdateTask(t.id,{status:'Done'}); }}
                style={{ ...mono, fontSize:11, padding:'3px 9px', background:`${C.green}10`, border:`1px solid ${C.green}33`, color:C.green, borderRadius:4, cursor:'pointer' }}>Mark done</button>}
            </div>
            {gs.error === 'nothing_found' && (
              <p style={{ ...mono, margin:'10px 0 0', fontSize:11, color:C.dim }}>Nothing found in Glean — <a href={`${process.env.REACT_APP_GLEAN_BASE_URL || "https://glean.example.com"}/search?q=${encodeURIComponent(getGleanQuery(t))}`} target="_blank" rel="noreferrer" style={{ color:C.blue }}>search manually →</a></p>
            )}
            {gs.error && gs.error !== 'nothing_found' && (
              <p style={{ ...mono, margin:'10px 0 0', fontSize:11, color:C.red }}>Glean error: {gs.error}</p>
            )}
            {gs.deliverable && (
              <div style={{ marginTop:12, padding:'10px 12px', background:'#080808', border:`1px solid ${C.brd}`, borderRadius:6 }}>
                <p style={{ ...mono, margin:'0 0 10px', fontSize:12, color:'#c8c8c0', lineHeight:1.7, whiteSpace:'pre-wrap' }}>{gs.deliverable}</p>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <button onClick={e=>{ e.stopPropagation(); navigator.clipboard.writeText(gs.deliverable).catch(()=>{}); setGleanTask(t.id,{copied:true}); setTimeout(()=>setGleanTask(t.id,{copied:false}),1400); if (!isDone) onUpdateTask&&onUpdateTask(t.id,{status:'Done'}); }}
                    style={{ ...mono, fontSize:11, padding:'3px 9px', background: gs.copied?`${C.green}18`:`${C.blue}18`, border:`1px solid ${gs.copied?C.green:C.blue}55`, color: gs.copied?C.green:C.blue, borderRadius:4, cursor:'pointer', transition:'all 0.15s' }}>
                    {gs.copied ? '✓ Copied' : '⎘ Copy'}
                  </button>
                  <button onClick={e=>{ e.stopPropagation(); doGlean(t); }}
                    style={{ ...mono, fontSize:11, padding:'3px 9px', background:'transparent', border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:'pointer' }}>
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const normN = n => (n||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
  const matchAccount = (writtenName) => {
    const wn = normN(writtenName);
    return accounts.find(a => normN(a.name) === wn)
      || accounts.find(a => normN(a.name).startsWith(wn) || wn.startsWith(normN(a.name)))
      || null;
  };

  const SUPPORTED_MIMES = ['image/jpeg','image/png','image/gif','image/webp'];
  const handleNotesImage = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setNotesItems([]); setNotesEdited([]); setNotesSelected(new Set()); setNotesPushed(false); setNotesError(null); setNotesTranscribed('');
    const previewUrl = URL.createObjectURL(file);
    const mime = file.type;
    if (SUPPORTED_MIMES.includes(mime)) {
      const reader = new FileReader();
      reader.onload = (e) => setNotesImage({ b64: e.target.result.split(',')[1], mime, previewUrl });
      reader.readAsDataURL(file);
    } else {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        setNotesImage({ b64: jpegDataUrl.split(',')[1], mime: 'image/jpeg', previewUrl });
      };
      img.onerror = () => setNotesError('Could not read this image format. Open it in Photos and export as JPEG, or take a screenshot.');
      img.src = previewUrl;
    }
  };

  const runExtract = async () => {
    if (!notesImage) return;
    setNotesLoading(true); setNotesError(null); setNotesItems([]); setNotesEdited([]); setNotesPushed(false); setNotesTranscribed('');
    try {
      const result = await extractFromHandwrittenNotes(notesImage.b64, notesImage.mime, accounts);
      const items = result.items || [];
      setNotesTranscribed(result.transcribed || '');
      setNotesItems(items);
      setNotesEdited(items.map(a => a.suggestedAction || a.action));
      setNotesSelected(new Set(items.map((_, i) => i)));
    } catch (e) { setNotesError(e.message); }
    setNotesLoading(false);
  };

  const notesGroupMap = {};
  notesItems.forEach((item, i) => {
    const key = item.accName || 'Unknown';
    if (!notesGroupMap[key]) notesGroupMap[key] = { writtenName: key, matched: matchAccount(key), indices: [] };
    notesGroupMap[key].indices.push(i);
  });
  const notesGroups = Object.values(notesGroupMap);

  const allOpen = sortedActionItems.filter(t => t.status !== 'Done' && t.status !== 'Stale');
  const doneItems = sortedActionItems.filter(t => t.status === 'Done');
  const openItems = taskOwnerFilter === 'All' ? allOpen
    : taskOwnerFilter === 'You' ? allOpen.filter(t => t.owner === 'AE')
    : allOpen.filter(t => t.owner !== 'AE');

  const groupMap = {};
  openItems.forEach(t => {
    const key = t.accId || t.accName || 'unknown';
    if (!groupMap[key]) groupMap[key] = { accId: t.accId, accName: t.accName || '—', tasks: [] };
    groupMap[key].tasks.push(t);
  });
  const groups = Object.values(groupMap).sort((a, b) => {
    const aHasAE        = a.tasks.some(t => t.owner === 'AE');
    const bHasAE        = b.tasks.some(t => t.owner === 'AE');
    if (aHasAE !== bHasAE) return aHasAE ? -1 : 1;
    const aHasOverdueAE = a.tasks.some(t => t.owner === 'AE' && t.dueDate && t.dueDate <= today);
    const bHasOverdueAE = b.tasks.some(t => t.owner === 'AE' && t.dueDate && t.dueDate <= today);
    if (aHasOverdueAE !== bHasOverdueAE) return aHasOverdueAE ? -1 : 1;
    return (a.accName||'').localeCompare(b.accName||'');
  });

  const sortGroupTasks = (ts) => {
    const score = t => {
      const overdue  = t.dueDate && t.dueDate < today;
      const dueToday = t.dueDate === today;
      if (t.owner === 'AE' && overdue)   return 0;
      if (t.owner === 'AE' && dueToday)  return 1;
      if (t.owner === 'AE')              return 2;
      if (overdue)                       return 3;
      if (dueToday)                      return 4;
      return 5;
    };
    return [...ts].sort((a, b) => score(a) - score(b) || (a.dueDate||'zzzz').localeCompare(b.dueDate||'zzzz'));
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* ── AI Next Actions section ── */}
      <div style={{ border:`1px solid ${showResults && dealActions.stall_detected ? C.red+'44' : '#1a1a1a'}`, borderRadius:9, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px' }}>
          <span style={{ ...mono, fontSize:12, fontWeight:600, color:C.txt, textTransform:'uppercase', letterSpacing:'0.07em' }}>⊟ Next Actions</span>
          {!account && (
            <select
              value={selectedAccId || ''}
              onChange={e => { setSelectedAccId(e.target.value || null); setDealActions(null); setGenError(null); }}
              style={{ ...mono, fontSize:11, background:'#111', border:`1px solid ${C.brd}`, color:selectedAcc?C.txt:C.dim, borderRadius:4, padding:'2px 6px', flex:1, maxWidth:220, outline:'none' }}>
              <option value=''>Select account…</option>
              {[...accounts].sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          {account && (
            <span style={{ ...mono, fontSize:11, color:C.txt }}>{account.name}</span>
          )}
          {showResults && (
            <span style={{ ...mono, fontSize:10, padding:'1px 6px', borderRadius:3, background:healthColor+'18', border:`1px solid ${healthColor}44`, color:healthColor }}>
              {HEALTH_LABEL[dealActions.deal_health] || dealActions.deal_health}
            </span>
          )}
          {showResults && dealActions.primary_gap && dealActions.primary_gap !== 'none' && (
            <span style={{ ...mono, fontSize:10, color:'#555' }}>
              Gap: {GAP_LABEL[dealActions.primary_gap] || dealActions.primary_gap}
            </span>
          )}
          <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
            {showResults && (
              <span style={{ ...mono, fontSize:10, color:'#3a3a3a' }}>
                {new Date(dealActions.generatedAt).toLocaleDateString('en-US', { month:'short', day:'numeric' })}
              </span>
            )}
            <button onClick={generateActions} disabled={generating || !selectedAcc}
              style={{ ...mono, fontSize:11, padding:'3px 10px', background: generating||!selectedAcc ? 'transparent' : `${C.gold}14`, border:`1px solid ${generating||!selectedAcc ? '#333' : C.goldBdr}`, color: generating||!selectedAcc ? '#555' : C.gold, borderRadius:4, cursor: generating||!selectedAcc ? 'default' : 'pointer', transition:'all 0.15s' }}>
              {generating ? '…generating' : showResults ? '↺ Regenerate' : '✦ Generate'}
            </button>
          </div>
        </div>

        {genError && <div style={{ ...mono, fontSize:11, color:C.red, padding:'0 14px 10px' }}>Error: {genError}</div>}

        {showResults && (
          <div style={{ padding:'0 14px 14px', borderTop:`1px solid #1a1a1a` }}>
            {dealActions.stall_detected && (
              <div style={{ ...mono, fontSize:11, color:C.red, padding:'6px 10px', background:`${C.red}0a`, border:`1px solid ${C.red}22`, borderRadius:4, margin:'10px 0' }}>
                ⚠ Stall detected{dealActions.stall_reason ? ` — ${dealActions.stall_reason}` : ''}
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:10 }}>
              {(dealActions.actions || []).map((a, i) => {
                const catColor = CAT_COLOR[a.category] || '#888';
                const priColor = a.priority === 'high' ? C.red : a.priority === 'medium' ? C.gold : '#555';
                const dueDate = (() => { const d = new Date(); d.setDate(d.getDate()+2); return d.toISOString().split('T')[0]; })();
                return (
                  <div key={i} style={{ border:`1px solid #1a1a1a`, borderRadius:7, padding:'10px 12px', background:C.card }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:7, marginBottom: a.detail ? 6 : 0 }}>
                      <span style={{ ...mono, fontSize:8, color:priColor, marginTop:4, flexShrink:0 }}>●</span>
                      <p style={{ ...mono, margin:0, fontSize:12, fontWeight:600, color:C.txt, flex:1 }}>{a.title}</p>
                      <span style={{ ...mono, fontSize:9, padding:'1px 5px', borderRadius:3, background:catColor+'18', border:`1px solid ${catColor}33`, color:catColor, flexShrink:0, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                        {a.category}
                      </span>
                      <span style={{ ...mono, fontSize:9, padding:'1px 5px', borderRadius:3, background:'transparent', border:`1px solid #2a2a2a`, color:'#666', flexShrink:0 }}>
                        {a.owner}
                      </span>
                    </div>
                    {a.detail && <p style={{ ...mono, margin:'0 0 4px 15px', fontSize:11, color:'#888', lineHeight:1.5 }}>{a.detail}</p>}
                    {a.why && <p style={{ ...mono, margin:'0 0 8px 15px', fontSize:10, color:'#555', lineHeight:1.4 }}>Why: {a.why}</p>}
                    <div style={{ marginLeft:15 }}>
                      <button onClick={() => onCreateTask && onCreateTask({
                        id: Date.now()+i, title: a.title,
                        type: 'Committed Action', priority: a.priority === 'high' ? 'High' : 'Medium',
                        accId: selectedAcc.id, accName: selectedAcc.name,
                        accVert: selectedAcc.vert, accUcs: selectedAcc.ucs, accProds: selectedAcc.prods, accStage: selectedAcc.stage,
                        assignee: a.owner === 'AE' ? (activeUser?.name || 'AE') : selectedAcc.name,
                        status: 'Open', dueDate: dueDate,
                        createdAt: new Date().toISOString().split('T')[0],
                        source: 'action_items', owner: a.owner === 'AE' ? 'AE' : 'Prospect',
                        category: a.category, rawAction: a.title,
                      })}
                        style={{ ...mono, fontSize:10, padding:'2px 8px', background:`${C.green}10`, border:`1px solid ${C.green}33`, color:C.green, borderRadius:4, cursor:'pointer' }}>
                        + Add to Queue
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Handwritten notes upload ── */}
      <div style={{ border:`1px solid ${notesOpen?C.blue+'44':C.brd}`, borderRadius:9, overflow:'hidden', transition:'border-color 0.15s' }}>
        <button onClick={()=>{ setNotesOpen(o=>!o); }} style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'transparent', border:'none', cursor:'pointer', textAlign:'left' }}>
          <span style={{ fontSize:14 }}>📷</span>
          <span style={{ ...mono, fontSize:12, color:C.txt, fontWeight:500 }}>Add from handwritten notes</span>
          <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:'auto' }}>{notesOpen?'▲':'▼'}</span>
        </button>
        {notesOpen && (
          <div style={{ padding:'0 14px 16px', borderTop:`1px solid ${C.brd}` }}>
            <div
              onDragOver={e=>e.preventDefault()}
              onDrop={e=>{ e.preventDefault(); handleNotesImage(e.dataTransfer.files[0]); }}
              onClick={()=>notesFileRef.current?.click()}
              style={{ border:`2px dashed ${notesImage?C.blue+'66':C.brd}`, borderRadius:8, padding:'18px 12px', textAlign:'center', cursor:'pointer', background:notesImage?`${C.blue}06`:C.sur, transition:'all 0.15s', marginTop:12, marginBottom:12 }}>
              <input ref={notesFileRef} type='file' accept='image/*' style={{ display:'none' }} onChange={e=>handleNotesImage(e.target.files[0])} />
              {notesImage ? (
                <div>
                  <img src={notesImage.previewUrl} alt='notes preview' style={{ maxWidth:'100%', maxHeight:240, borderRadius:6, marginBottom:8, objectFit:'contain' }}/>
                  <p style={{ ...mono, margin:0, fontSize:10, color:C.blue }}>Click or drop to replace</p>
                </div>
              ) : (
                <>
                  <p style={{ ...mono, margin:'0 0 4px', fontSize:13, color:C.mut }}>Drop a photo of your notes</p>
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Format: [] Account Name -- task · jpg, png, heic</p>
                </>
              )}
            </div>
            <button onClick={runExtract} disabled={!notesImage||notesLoading}
              style={{ width:'100%', padding:'9px 0', background:!notesImage?'transparent':`${C.blue}18`, border:`1px solid ${!notesImage?C.brd:C.blue+'55'}`, color:!notesImage?C.dim:C.blue, borderRadius:7, cursor:(!notesImage||notesLoading)?'default':'pointer', fontSize:13, fontWeight:500, transition:'all 0.2s' }}>
              {notesLoading ? 'Reading notes…' : 'Extract Tasks →'}
            </button>
            {notesError && <p style={{ ...mono, margin:'8px 0 0', fontSize:11, color:C.red }}>{notesError}</p>}
            {notesTranscribed && (
              <div style={{ margin:'12px 0 0', padding:'8px 12px', background:C.sur, border:`1px solid ${C.brd}`, borderRadius:6 }}>
                <p style={{ ...mono, margin:'0 0 4px', fontSize:9, color:C.dim, textTransform:'uppercase', letterSpacing:'0.07em' }}>Transcribed</p>
                <p style={{ ...mono, margin:0, fontSize:11, color:C.mut, whiteSpace:'pre-wrap', lineHeight:1.6 }}>{notesTranscribed}</p>
              </div>
            )}
            {notesGroups.length > 0 && (
              <div style={{ marginTop:14 }}>
                <p style={{ ...mono, margin:'0 0 10px', fontSize:10, color:C.dim, textTransform:'uppercase', letterSpacing:'0.07em' }}>Extracted — edit before adding</p>
                {notesGroups.map(g => (
                  <div key={g.writtenName} style={{ marginBottom:14 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6 }}>
                      <p style={{ ...mono, margin:0, fontSize:11, fontWeight:700, color:g.matched?C.txt:C.orange }}>{g.matched ? g.matched.name : g.writtenName}</p>
                      {!g.matched && <span style={{ ...mono, fontSize:9, color:C.orange }}>⚠ no match in accounts</span>}
                      {g.matched && g.matched.name.toLowerCase() !== g.writtenName.toLowerCase() && (
                        <span style={{ ...mono, fontSize:9, color:C.dim }}>matched from "{g.writtenName}"</span>
                      )}
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                      {g.indices.map(i => {
                        const a = notesItems[i];
                        const checked = notesSelected.has(i);
                        const ownerC = a.owner === 'AE' ? C.red : C.blue;
                        return (
                          <div key={i} style={{ border:`1px solid ${checked?ownerC+'55':C.brd}`, borderRadius:7, background:checked?`${ownerC}07`:'transparent', transition:'all 0.15s' }}>
                            <div onClick={()=>setNotesSelected(s=>{ const n=new Set(s); n.has(i)?n.delete(i):n.add(i); return n; })}
                              style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', cursor:'pointer' }}>
                              <div style={{ width:14, height:14, borderRadius:3, border:`1.5px solid ${checked?ownerC:C.brd}`, background:checked?`${ownerC}22`:'transparent', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                {checked && <span style={{ color:ownerC, fontSize:9, lineHeight:1 }}>✓</span>}
                              </div>
                              {a.category && a.category !== 'Freeform' && (
                                <span style={{ ...mono, fontSize:9, padding:'1px 5px', background:`${ownerC}14`, border:`1px solid ${ownerC}33`, color:ownerC, borderRadius:3, flexShrink:0, textTransform:'uppercase', letterSpacing:'0.05em' }}>{a.category}</span>
                              )}
                              <span style={{ ...mono, fontSize:10, color:ownerC, flexShrink:0, fontWeight:600 }}>{a.owner==='AE'?'You':'Them'}</span>
                              {a.dueDate && <span style={{ ...mono, fontSize:10, color:C.mut, flexShrink:0, marginLeft:'auto' }}>{a.dueDate}</span>}
                            </div>
                            <div style={{ padding:'0 10px 8px' }}>
                              <input value={notesEdited[i] ?? (a.suggestedAction||a.action)} onChange={e=>setNotesEdited(prev=>{ const n=[...prev]; n[i]=e.target.value; return n; })}
                                onClick={e=>e.stopPropagation()}
                                style={{ width:'100%', fontSize:12, color:C.txt, background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, padding:'4px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
                              {a.action && a.suggestedAction && a.action !== a.suggestedAction && (
                                <p style={{ ...mono, margin:'3px 0 0', fontSize:10, color:C.dim }}>Heard: "{a.action}"</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button disabled={notesSelected.size===0||notesPushed} onClick={()=>{
                  const td = new Date().toISOString().split('T')[0];
                  notesItems.forEach((a, i) => {
                    if (!notesSelected.has(i)) return;
                    const matched = matchAccount(a.accName);
                    const title = (notesEdited[i] ?? (a.suggestedAction||a.action)) || a.action;
                    const due = a.dueDate || (() => { const d=new Date(); d.setDate(d.getDate()+2); return d.toISOString().split('T')[0]; })();
                    onCreateTask && onCreateTask({
                      id: Date.now()+i, title, type:'Committed Action', priority:'High',
                      accId: matched?.id||null, accName: matched?.name||a.accName||'',
                      accVert: matched?.vert, accUcs: matched?.ucs, accProds: matched?.prods, accStage: matched?.stage,
                      assignee: a.owner==='AE'?(activeUser?.name||'AE'):matched?.name||a.accName||'',
                      status:'Open', dueDate:due, createdAt:td,
                      source:'committed_action', owner:a.owner,
                      category:a.category||'Freeform', rawAction:a.action,
                      gleanPrompt: getGleanPrompt(a.category, matched),
                    });
                  });
                  setNotesPushed(true);
                }}
                  style={{ width:'100%', padding:'9px 0', background:notesPushed?`${C.green}18`:`${C.gold}18`, border:`1px solid ${notesPushed?C.green:C.goldBdr}`, color:notesPushed?C.green:C.gold, borderRadius:7, cursor:notesSelected.size===0||notesPushed?'default':'pointer', fontSize:13, fontWeight:500, transition:'all 0.2s' }}>
                  {notesPushed ? `✓ ${notesSelected.size} added to Task Queue` : `Add ${notesSelected.size} to Task Queue →`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Owner filter bar ── */}
      <div style={{ display:'flex', gap:3, marginBottom:12, background:'#0a0a0a', border:`1px solid ${C.brd}`, borderRadius:6, padding:3, alignSelf:'flex-start', width:'fit-content' }}>
        {['All','You','Them'].map(f => {
          const active = taskOwnerFilter === f;
          const col = f === 'You' ? C.red : f === 'Them' ? C.blue : C.txt;
          return (
            <button key={f} onClick={() => setTaskOwnerFilter(f)}
              style={{ ...mono, fontSize:11, padding:'3px 12px', borderRadius:4, border:'none', background: active ? (f==='You'?`${C.red}18`:f==='Them'?`${C.blue}18`:C.card) : 'transparent', color: active ? col : C.dim, cursor:'pointer', fontWeight: active?600:400, transition:'all 0.15s' }}>
              {f}
            </button>
          );
        })}
      </div>

      {groups.length === 0 && doneItems.length === 0 && (
        <div style={{ padding:'32px 0', textAlign:'center', color:C.mut, fontSize:13 }}>No committed actions yet. They appear here after you log a debrief and add items to the queue.</div>
      )}
      {groups.length === 0 && doneItems.length > 0 && taskOwnerFilter !== 'All' && (
        <div style={{ padding:'16px 0', textAlign:'center', color:C.dim, fontSize:12 }}>No open {taskOwnerFilter === 'You' ? 'your' : 'prospect'} tasks.</div>
      )}

      {/* ── Open tasks grouped by account ── */}
      {groups.map(g => {
        const sorted = sortGroupTasks(g.tasks);
        const hasOverdueAE = sorted.some(t => t.owner==='AE' && t.dueDate && t.dueDate < today);
        const openAECount  = sorted.filter(t => t.owner==='AE').length;
        return (
          <div key={g.accId||g.accName}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
              <p style={{ ...mono, margin:0, fontSize:11, fontWeight:700, color:C.txt }}>{g.accName}</p>
              <span style={{ ...mono, fontSize:10, color:C.dim }}>{sorted.length} open</span>
              {hasOverdueAE && <span style={{ ...mono, fontSize:9, color:C.red, background:`${C.red}14`, border:`1px solid ${C.red}33`, borderRadius:3, padding:'1px 5px' }}>OVERDUE</span>}
              <span style={{ ...mono, fontSize:9, color:C.red, marginLeft:'auto' }}>{openAECount} yours</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
              {sorted.map(renderRow)}
            </div>
          </div>
        );
      })}

      {/* ── Done — collapsed ── */}
      {doneItems.length > 0 && (
        <div style={{ marginTop:4, borderTop:`1px solid ${C.brd}`, paddingTop:12 }}>
          <button onClick={()=>setExpandedTaskIds(s=>{ const n=new Set(s); const key='__done__'; n.has(key)?n.delete(key):n.add(key); return n; })}
            style={{ ...mono, fontSize:9, fontWeight:700, color:C.dim, textTransform:'uppercase', letterSpacing:'0.1em', background:'none', border:'none', cursor:'pointer', padding:0, marginBottom:8 }}>
            Done ({doneItems.length}) {expandedTaskIds.has('__done__')?'▲':'▼'}
          </button>
          {expandedTaskIds.has('__done__') && (() => {
            const doneGroups = {};
            doneItems.forEach(t => {
              const key = t.accId||t.accName||'unknown';
              if (!doneGroups[key]) doneGroups[key] = { accName: t.accName||'—', tasks:[] };
              doneGroups[key].tasks.push(t);
            });
            return Object.values(doneGroups).map(g => (
              <div key={g.accName} style={{ marginBottom:10 }}>
                <p style={{ ...mono, margin:'0 0 4px', fontSize:10, fontWeight:700, color:C.dim }}>{g.accName}</p>
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>{g.tasks.map(renderRow)}</div>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
