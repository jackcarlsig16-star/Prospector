import React, { useState } from 'react';
import Button from '../../ui/Button';
import { Chip } from '../brands/BrandsScreen';
import { hkPost } from '../hkApi';
import { BrandPanel } from './ThreadPane';
import { fmtDate, KIND_LABEL, FIT_LABEL, FIT_TONE, NEXT_LABEL, CHICAGO_LABEL, usd } from './inboxPrefs';

// hkos-inbox-v2 L4 / L5 - the card at the top of the reader. Brands, the team and ignored senders keep v1's panel; a
// person who is not a brand gets name + domain, any saved intel for the domain, and Analyze / Track as brand / Ignore;
// bulk mail gets one muted line. Analyze is one click = one Claude call (the server refuses without the click flag); a
// domain researched in the last 30 days comes back as the saved card with a prompt before spending again. The cost
// shown is the one the server observed, never a guess.
export function IntelBody({ intel }) {
  const c = intel.company || {}, e = intel.email || {}, f = intel.fit || {};
  return (
    <div className="hk-intel" data-hk-intel>
      <p className="hk-intel__company"><strong data-hk-intel-company>{c.name || 'Unknown company'}</strong>{c.what_they_do ? ` · ${c.what_they_do}` : ''}</p>
      <div className="hk-brand__chips">
        {c.category && <Chip tone="lilac">{c.category}</Chip>}
        <Chip tone={c.chicago_presence === 'yes' ? 'green' : 'grey'}>{CHICAGO_LABEL[c.chicago_presence] || CHICAGO_LABEL.unknown}</Chip>
        {c.size_hint && <Chip tone="grey">{c.size_hint}</Chip>}
        {c.hq_city && <Chip tone="grey">{c.hq_city}</Chip>}
      </div>
      <p className="hk-meta" data-hk-intel-kind>{KIND_LABEL[e.kind] || 'Other'}{e.urgency === 'high' ? ' · urgent' : ''}{e.summary ? `: ${e.summary}` : ''}</p>
      <p className="hk-intel__fit"><Chip tone={FIT_TONE[f.sponsor_fit] || 'grey'}><span data-hk-intel-fit>{FIT_LABEL[f.sponsor_fit] || 'Fit unknown'}</span></Chip>{f.why ? <span className="hk-meta"> {f.why}</span> : null}</p>
      {f.challenge_idea && <p className="hk-note">Idea: {f.challenge_idea}</p>}
      <p className="hk-intel__next"><span className="hk-meta">Next:</span> <strong data-hk-intel-next>{NEXT_LABEL[intel.next_step] || 'No action'}</strong>{intel.reason ? <span className="hk-meta"> · {intel.reason}</span> : null}</p>
    </div>
  );
}

export default function IntelCard({ businessId, thread, members, canEdit, busy, onOpenBrand, onStatus, onLink, onTrack, onIgnore, onUnignore, onAnalyzed }) {
  const [run, setRun] = useState({ state: 'idle' });
  const { chip, sender } = thread;
  if (thread.brand || chip.kind === 'team' || (chip.kind === 'not_tracked' && chip.reason === 'ignored')) {
    return <BrandPanel thread={thread} members={members} canEdit={canEdit} busy={busy} onOpenBrand={onOpenBrand} onStatus={onStatus} onLink={onLink} onTrack={onTrack} onIgnore={onIgnore} onUnignore={onUnignore} />;
  }
  if (chip.kind === 'not_tracked') {
    return (
      <div className="hk-inbox__panel hk-inbox__panel--muted" data-hk-brand-panel="bulk">
        <p className="hk-meta">Marketing / automated mail{sender.domain ? ` from ${sender.domain}` : ''}.</p>
        {canEdit && sender.domain && <div className="hk-inbox__panel-actions"><Button size="sm" variant="tertiary" disabled={busy} onClick={onIgnore} data-hk-ignore-sender>Ignore sender</Button></div>}
      </div>
    );
  }
  const saved = thread.intel;
  const analyze = async confirm => {
    setRun({ state: 'running' });
    try {
      const r = await hkPost(businessId, `/inbox/threads/${thread.thread_id}/analyze`, { click: true, ...(confirm ? { confirm: true } : {}) });
      setRun(r.needs_confirm ? { state: 'confirm', cost: r.cost_usd, at: r.researched_at } : { state: 'done', cost: r.cost_usd });
      onAnalyzed({ intel: r.intel, cost_usd: r.cost_usd, researched_at: r.researched_at, prefill: r.prefill });
    } catch (e) { setRun({ state: 'error', message: e.message }); }
  };
  const cost = run.state === 'done' ? run.cost : saved?.cost_usd;
  return (
    <div className="hk-inbox__panel" data-hk-brand-panel="untracked" aria-label={`About ${sender.name}`}>
      <h2 className="hk-inbox__panel-title">{saved?.intel?.company?.name || sender.name}</h2>
      <p className="hk-meta">
        {sender.name}{sender.domain ? ' · ' : ''}{sender.domain && <a className="hk-link" href={`https://${sender.domain}`} target="_blank" rel="noopener noreferrer" data-hk-sender-site>{sender.domain}</a>}
        {thread.relayed ? ' · via your group' : ''}
      </p>
      {saved ? <IntelBody intel={saved.intel} /> : <p className="hk-meta" data-hk-unknown-company>Unknown company. Analyze looks it up.</p>}
      {saved && <p className="hk-meta" data-hk-intel-when>Researched {fmtDate(saved.researched_at)}{saved.cost_usd != null ? ` · ${usd(saved.cost_usd)}` : ''}</p>}
      {run.state === 'confirm' && (
        <p className="hk-banner hk-banner--mustard" role="status" data-hk-analyze-confirm>
          <span className="hk-banner__title">Researched {fmtDate(run.at)}. This is the saved card.</span>{' '}
          Analyze again{run.cost != null ? ` for about ${usd(run.cost)}` : ''}?{' '}
          {canEdit && <button type="button" className="hk-btn hk-link" onClick={() => analyze(true)} data-hk-analyze-again>Analyze again</button>}
        </p>
      )}
      {run.state === 'error' && <p className="hk-error" role="alert" data-hk-analyze-error>{run.message}</p>}
      {canEdit && (
        <div className="hk-inbox__panel-actions">
          {sender.domain && (
            <Button size="sm" variant={saved ? 'secondary' : 'primary'} disabled={busy || run.state === 'running'} onClick={() => analyze(false)} data-hk-analyze>
              {run.state === 'running' ? 'Analyzing…' : saved ? `Analyze again${cost != null ? ` · ${usd(cost)}` : ''}` : 'Analyze'}
            </Button>
          )}
          <Button size="sm" variant={saved ? 'primary' : 'secondary'} disabled={busy} onClick={onTrack} data-hk-track-brand>Track as brand</Button>
          {sender.domain && <Button size="sm" variant="tertiary" disabled={busy} onClick={onIgnore} data-hk-ignore-sender>Ignore sender</Button>}
        </div>
      )}
    </div>
  );
}
