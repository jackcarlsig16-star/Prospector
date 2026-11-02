import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '../HkMarks';
import { hkGet, hkPost, hkPatch, hkFetch } from '../hkApi';
import { useBrandCommands } from '../brands/QuickCommands';
import { useSheetConfirm } from '../brands/sheetConfirm';
import { Expand } from '../inbox/SendRow';
import { gmailThreadUrl } from '../inbox/inboxPrefs';
import { SignalsLine } from '../signals/SignalsPanel';

// grow-today-workflow-v1 Stage 2 - "Your day" to the mockup: the signed-in member's ordered checklist from GET today/day
// (the owner toggle never applies). Header line, progress card, then the steps in order (1 Answer replies · 3 Send
// follow-ups · 4 Send Instagram DMs · 5 Send today's pitches), each with its color bar, n left, minutes and why; a step
// finished today collapses to its done line (tap to reopen). When nothing is left: "You're done for today" + Want more.
// Right rail: Coming up. Every one-click action has Undo; nothing here sends; Gmail links only for your own mail.
const LABEL = { interested: ['Interested', 'green'], pricing: ['Pricing', 'orange'], referral: ['Referral', 'blue'], question: ['Question', 'mustard'], decline: ['Decline', 'grey'], auto_reply: ['Auto reply', 'grey'], prefers_email: ['Prefers email', 'grey'], new_thread: ['New thread', 'grey'], other: ['Reply', 'grey'] };
const STAGE = { interested: 'Interested', scheduling: 'Scheduling', confirmed: 'Confirmed', discussing: 'In discussion', other: 'Waiting on you' };
const REASON = { lint: 'The draft failed the outreach rules', no_contact: 'No contact with an email yet', reconnect: 'Reconnect Gmail to draft it', no_thread: 'No earlier sent email on this brand', gmail: 'Gmail did not accept the draft', no_mailbox: 'Link a HumanKind Gmail on Connections first', blocked: 'Blocked' };
const KIND = { bump: 'Bump', final: 'Final' };
const FIT = { strong: ['Strong fit', 'green'], possible: ['Possible fit', 'mustard'], weak: ['Weak fit', 'grey'] };
const UNDO_MS = 8000;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ago = d => (d == null ? '' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).toLowerCase();
const fmtDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
const shortDay = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const checkLine = dc => (!dc ? 'daily check has not run yet' : dc.today ? `daily check ran ${fmtTime(dc.at)}` : `daily check last ran ${fmtDay(dc.at)}`);
export const dayLine = day => `your day has ${plural(day.total, 'thing')}, about ${day.steps.reduce((n, s) => n + (s.left + s.done.n) * s.minutes_each, 0)} minutes`;
export const igUrl = (handle, name) => (handle ? `https://ig.me/m/${encodeURIComponent(handle.replace(/^@/, ''))}` : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(name)}`);
export const wantLine = w => (w.key === 'research' ? `Research ${plural(w.n, 'brand')}${w.usd != null ? ` (≈ $${w.usd.toFixed(2)})` : ''}` : w.key === 'needs_email' ? `${w.n === 1 ? '1 brand needs' : `${w.n} brands need`} an email` : `${w.n === 1 ? `1 brand on ${w.hint}'s sheet list has` : `${w.n} brands on ${w.hint}'s sheet list have`} emails. Take one`);
const COMING = { followup_due: c => `Follow-up due · ${c.brand_name}`, sponsor_month: c => `${c.brand_name} sponsor month starts`, deal_month: c => `${c.brand_name} · ${STAGE[c.deal_stage] || 'deal'} month` };

const Tile = ({ name, icon }) => <span className="hk-tile-sm hk-day__tile" aria-hidden="true">{icon ? <Icon name={icon} size={15} /> : name.trim()[0].toUpperCase()}</span>;
const Label = ({ tone, children }) => <span className={`hk-label hk-label--${tone}`}>{children}</span>;

export default function TodayScreen({ businessId, shell, compact, gmail, canEdit = true, greeting, syncing, onSync, onOpenBrand, onOpenReply, onGo, onOpenConnections, onCounts }) {
  const [day, setDay] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [toggled, setToggled] = useState({});
  const [expanded, setExpanded] = useState(null);
  const me = shell?.me, others = (shell?.members || []).filter(m => m.signed_up && m.user_id !== me?.user_id);
  const ownEmail = gmail?.mailbox?.linked ? gmail.mailbox.email : null;
  const sheet = useSheetConfirm();
  const load = useCallback(async () => {
    try {
      const [d, j] = await Promise.all([hkGet(businessId, '/today/day'), hkGet(businessId, '/jobs/today', { owner: 'me' }).catch(() => null)]);
      setDay(d); setJobs(j); setError(''); onCounts?.(d.badge);
    } catch (e) { setError(e.message); }
  }, [businessId, onCounts]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), UNDO_MS); return () => clearTimeout(t); }, [toast]);
  const cmd = useBrandCommands({ businessId, onChanged: load, setError });
  const act = async (key, fn) => { setBusy(key); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const undoable = (key, line, doIt, undo) => act(key, async () => { const r = await doIt(); setToast({ line, undo: undo ? () => undo(r) : null }); });
  const runUndo = () => { const fn = toast.undo; setToast(null); act('undo', fn); };
  const copy = async (text, line) => { try { await navigator.clipboard.writeText(text); setToast({ line: line || `Copied ${text}.`, undo: null }); } catch { setError(`Copy failed. The text is: ${text}`); } };

  if (!day) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading your day…</p>;
  const reconnect = (jobs?.mailboxes || []).filter(m => m.state === 'needs_reconnect' && m.user_id === me?.user_id);
  const isOpen = s => (s.key in toggled ? toggled[s.key] : !s.collapsed);
  const flip = s => setToggled(t => ({ ...t, [s.key]: !isOpen(s) }));
  const p = day.progress;

  const replyRow = r => {
    const [word, tone] = LABEL[r.label] || LABEL.other;
    const url = r.gmail_thread_id && ownEmail ? gmailThreadUrl(ownEmail, r.gmail_thread_id) : null;
    return (
      <div key={r.reply_id} className="hk-day__item" data-hk-day-item={`reply:${r.reply_id}`}>
        <Tile name={r.brand_name} />
        <div className="hk-day__body">
          <div className="hk-day__name"><button type="button" className="hk-btn hk-day__brand" onClick={() => onOpenBrand(r.brand_id)}>{r.brand_name}</button><Label tone={tone}>{word}</Label>{r.urgent && <Label tone="orange">Hot</Label>}</div>
          <p className="hk-day__meta">{r.summary ? `“${r.summary}”` : 'No summary yet.'} · {ago(r.age_days)}</p>
          {r.label === 'pricing' && <p className="hk-day__meta hk-day__warn">Do not quote pricing in the reply.</p>}
        </div>
        <span className="hk-day__acts">
          {url ? <a className="hk-btn hk-primary" href={url} target="_blank" rel="noopener noreferrer" data-hk-open-reply><Icon name="replies" size={15} /> Open reply</a>
            : <button type="button" className="hk-btn hk-primary" onClick={() => onOpenReply(r.reply_id)} data-hk-open-reply><Icon name="replies" size={15} /> Open reply</button>}
          {r.referral_name && canEdit
            ? <button type="button" className="hk-btn hk-chipbtn" onClick={() => onOpenBrand(r.brand_id)} data-hk-add-referral><Icon name="plus" size={15} /> Add {r.referral_name.split(' ')[0]} as contact</button>
            : <button type="button" className="hk-btn hk-chipbtn" onClick={() => copy(r.command, `Copied ${r.command}. Paste into Claude.`)} data-hk-copy-reply><Icon name="copy" size={15} /> Copy reply command</button>}
          {canEdit && <button type="button" className="hk-btn hk-link hk-day__quiet" disabled={!!busy} onClick={() => undoable(`h:${r.reply_id}`, `${r.brand_name}: marked handled.`, () => hkPatch(businessId, `/replies/${r.reply_id}`, { handled: true }), () => hkPatch(businessId, `/replies/${r.reply_id}`, { handled: false }))} data-hk-mark-handled>Mark handled</button>}
        </span>
      </div>
    );
  };
  const threadRow = t => (
    <div key={t.thread_id} className="hk-day__item" data-hk-day-item={`thread:${t.thread_id}`}>
      <Tile name={t.brand_name} />
      <div className="hk-day__body">
        <div className="hk-day__name"><button type="button" className="hk-btn hk-day__brand" onClick={() => onOpenBrand(t.brand_id)}>{t.brand_name}</button><Label tone="orange">Waiting on you</Label>{t.deal_stage && t.deal_stage !== 'other' && <Label tone="mustard">{STAGE[t.deal_stage]}{t.deal_month ? ` · ${shortDay(`${t.deal_month}-01`).split(' ')[0]}` : ''}</Label>}</div>
        <p className="hk-day__meta">{t.summary || 'They wrote last.'} · {ago(t.age_days)} · clears when Gmail sees your reply</p>
      </div>
      <span className="hk-day__acts">
        {ownEmail && <a className="hk-btn hk-primary" href={gmailThreadUrl(ownEmail, t.gmail_thread_id)} target="_blank" rel="noopener noreferrer" data-hk-open-thread><Icon name="replies" size={15} /> Open in Gmail</a>}
        <button type="button" className="hk-btn hk-chipbtn" onClick={() => copy(`hk reply ${t.brand_name}`, `Copied hk reply ${t.brand_name}. Paste into Claude.`)}><Icon name="copy" size={15} /> Copy reply command</button>
      </span>
    </div>
  );
  const followRow = f => (f.kind === 'draft' ? (
    <div key={f.touch_id} className="hk-day__item" data-hk-day-item={`draft:${f.touch_id}`}>
      <Tile name={f.brand_name} />
      <div className="hk-day__body">
        <div className="hk-day__name"><button type="button" className="hk-btn hk-day__brand" onClick={() => onOpenBrand(f.brand_id)}>{f.brand_name}</button><Label tone="green">{KIND[f.touch_kind]}</Label></div>
        <p className="hk-day__meta">Drafted in your Gmail {ago(f.age_days)}{f.subject ? ` · ${f.subject}` : ''}</p>
      </div>
      <span className="hk-day__acts">
        {ownEmail && f.gmail_message_id ? <a className="hk-btn hk-primary" href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(ownEmail)}#drafts/${encodeURIComponent(f.gmail_message_id)}`} target="_blank" rel="noopener noreferrer" data-hk-open-draft><Icon name="mail" size={15} /> Open in Gmail</a> : <span className="hk-meta">In your Gmail drafts</span>}
        {canEdit && <button type="button" className="hk-btn hk-link hk-day__quiet" disabled={!!busy} onClick={() => setToast({ line: `Skip ${f.brand_name}'s ${KIND[f.touch_kind].toLowerCase()}? The draft is deleted from your Gmail. This can't be undone.`, confirm: () => act(`s:${f.touch_id}`, async () => { await hkFetch(businessId, `/drafts/${f.touch_id}`, { method: 'DELETE' }); await hkPost(businessId, '/jobs/skip-touch', { brand_id: f.brand_id }); }) })} data-hk-skip-draft>Skip this touch</button>}
      </span>
    </div>
  ) : (
    <div key={`it:${f.brand_id}`} className="hk-day__item" data-hk-day-item={`draft_it:${f.brand_id}`}>
      <Tile name={f.brand_name} />
      <div className="hk-day__body">
        <div className="hk-day__name"><button type="button" className="hk-btn hk-day__brand" onClick={() => onOpenBrand(f.brand_id)}>{f.brand_name}</button><Label tone="mustard">{KIND[f.touch_kind] || 'Follow-up'} due · no draft</Label></div>
        <p className="hk-day__meta">{REASON[f.reason] || 'The daily check could not draft it'}</p>
      </div>
      <span className="hk-day__acts">
        {canEdit && <button type="button" className="hk-btn hk-primary" disabled={!!busy} onClick={() => act(`d:${f.brand_id}`, async () => { const r = await hkPost(businessId, '/jobs/retry-draft', { brand_id: f.brand_id }); setToast({ line: r.drafted ? `Draft written for ${f.brand_name}. It's in your Gmail drafts.` : `Still no draft for ${f.brand_name}: ${REASON[r.reason] || r.reason}.`, undo: null }); })} data-hk-draft-it><Icon name="pencil" size={15} /> Draft it</button>}
        {canEdit && <button type="button" className="hk-btn hk-link hk-day__quiet" disabled={!!busy} onClick={() => undoable(`s:${f.brand_id}`, `${f.brand_name}: follow-up skipped.`, () => hkPost(businessId, '/jobs/skip-touch', { brand_id: f.brand_id }), r => hkPost(businessId, '/jobs/skip-touch', { brand_id: f.brand_id, undo: true, was_due: r.was_due }))} data-hk-skip-touch>Skip this touch</button>}
      </span>
    </div>
  ));
  const dmRow = d => (
    <div key={d.touch_id} className="hk-day__item" data-hk-day-item={`dm:${d.touch_id}`}>
      <Tile name={d.brand_name} icon="person" />
      <div className="hk-day__body">
        <div className="hk-day__name"><button type="button" className="hk-btn hk-day__brand" onClick={() => onOpenBrand(d.brand_id)}>{d.brand_name}</button><Label tone="lilac">DM text</Label></div>
        <p className="hk-day__meta">{d.instagram_handle ? `@${d.instagram_handle.replace(/^@/, '')} · ` : ''}written {ago(d.age_days)} · “{d.text.slice(0, 90)}{d.text.length > 90 ? '…' : ''}”</p>
      </div>
      <span className="hk-day__acts">
        <button type="button" className="hk-btn hk-chipbtn" onClick={() => copy(d.text, `${d.brand_name}'s DM text copied.`)} data-hk-copy-dm><Icon name="copy" size={15} /> Copy text</button>
        <a className="hk-btn hk-primary" href={igUrl(d.instagram_handle, d.brand_name)} target="_blank" rel="noopener noreferrer" data-hk-open-dm><Icon name="link" size={15} /> {d.instagram_handle ? 'Open DM' : 'Open Instagram'}</a>
        {canEdit && <button type="button" className="hk-btn hk-link hk-day__quiet" disabled={!!busy} onClick={() => undoable(`m:${d.touch_id}`, `${d.brand_name}: DM marked sent.`, () => hkPost(businessId, `/drafts/${d.touch_id}/dm-sent`, {}), r => hkPost(businessId, `/drafts/${d.touch_id}/dm-sent`, { undo: true, prev_last_touch_at: r.prev_last_touch_at }))} data-hk-dm-sent>Mark sent</button>}
      </span>
    </div>
  );
  const pitchRow = c => {
    const fit = FIT[c.fit];
    const meta = [c.industry, c.market, c.contact_role && `contact: ${c.contact_role}`, c.idea && `idea: ${c.idea}`].filter(Boolean).join(' · ');
    return (
      <div key={c.brand_id} className="hk-day__pitch" data-hk-day-item={`pitch:${c.brand_id}`}>
        <div className="hk-day__item">
          <Tile name={c.brand_name} />
          <div className="hk-day__body">
            <div className="hk-day__name"><button type="button" className="hk-btn hk-day__brand" onClick={() => onOpenBrand(c.brand_id)}>{c.brand_name}</button>{c.targeted && <span className="hk-label hk-label--target"><Icon name="target" size={12} /> Target</span>}{fit && <Label tone={fit[1]}>{fit[0]}</Label>}</div>
            {meta && <p className="hk-day__meta">{meta}</p>}
          </div>
          <span className="hk-day__acts">
            {canEdit && <button type="button" className="hk-btn hk-primary" disabled={!!cmd.busy || !!busy} onClick={() => cmd.act('pitch', c.card)} data-hk-pitch><Icon name="bolt" size={15} /> Pitch</button>}
            {canEdit && <button type="button" className="hk-btn hk-qc" aria-label={`Not today: ${c.brand_name}`} title="Not today (back tomorrow)" disabled={!!busy} onClick={() => undoable(`n:${c.brand_id}`, `${c.brand_name} is off today's list. It's back tomorrow.`, () => hkPost(businessId, '/today/not-today', { brand_id: c.brand_id, on: true }), () => hkPost(businessId, '/today/not-today', { brand_id: c.brand_id, on: false }))} data-hk-not-today><Icon name="clock" size={16} /></button>}
            <button type="button" className="hk-btn hk-qc hk-day__chev" aria-expanded={expanded === c.brand_id} aria-label={expanded === c.brand_id ? `Collapse ${c.brand_name}` : `Expand ${c.brand_name}`} onClick={() => setExpanded(x => (x === c.brand_id ? null : c.brand_id))} data-hk-pitch-expand><Icon name="chevron" size={16} /></button>
          </span>
        </div>
        {expanded === c.brand_id && <Expand c={c.card} canEdit={canEdit} businessId={businessId} onAct={cmd.act} onOpenBrand={onOpenBrand} onChanged={load} setNote={setError} />}
      </div>
    );
  };
  const pitchAll = s => act('pitch-all', async () => {
    let r = await hkPost(businessId, '/today/pitch-all', { brand_ids: s.pitch_all.brand_ids });
    const ask = r.refused.filter(x => x.needs_confirm);
    if (ask.length) {
      const names = [...new Set(ask.map(x => x.sheet_owner).filter(Boolean))];
      if (await sheet.confirm(`The sheet lists ${ask.length === 1 ? 'one of these' : `${ask.length} of these`} as ${names.map(n => `${n}'s`).join(' or ') || "a teammate's"}. Take ${ask.length === 1 ? 'it' : 'them'} anyway?`)) {
        const again = await hkPost(businessId, '/today/pitch-all', { brand_ids: ask.map(x => x.brand_id), confirm_sheet_owner: true });
        r = { done: [...r.done, ...again.done], refused: [...r.refused.filter(x => !x.needs_confirm), ...again.refused], command: [r.command, again.command].filter(Boolean).join(', ').replace(/, hk pitch /, ', ') || null };
      }
    }
    let copied = false;
    if (r.command) { try { await navigator.clipboard.writeText(r.command); copied = true; } catch { copied = false; } }
    const items = r.done.map(x => ({ brand_id: x.brand_id, claimed: x.claimed, expect_updated_at: x.updated_at }));
    setToast({ line: `${r.done.length ? `Pitched ${r.done.length}.` : 'Nothing pitched.'}${r.command ? (copied ? ` Copied ${r.command}. Paste into Claude.` : ` Copy failed - the command is ${r.command}`) : ''}${r.refused.length ? ` Not pitched: ${r.refused.map(x => x.error).join('; ')}.` : ''}`, undo: items.length ? () => hkPost(businessId, '/today/pitch-all', { undo: true, items }) : null });
  });

  const STEP = {
    replies: s => s.items.map(i => (i.kind === 'reply' ? replyRow(i) : threadRow(i))),
    followups: s => s.items.map(followRow),
    dms: s => s.items.map(dmRow),
    pitches: s => s.items.map(pitchRow),
  };
  const sub = s => (s.key === 'pitches' ? `Your goal is ${s.goal} a day. ${s.ready ? `${s.ready} ${s.ready === 1 ? 'is' : 'are'} ready now` : 'None ready right now'}${s.more_in_briefing ? `; Briefing has ${s.more_in_briefing} more` : ''}.` : s.why);
  const steps = day.steps.map(s => (isOpen(s) ? (
    <section key={s.key} className={`hk-day__step hk-day__step--${s.key}`} aria-label={s.title} data-hk-step={s.key}>
      <header className="hk-day__head">
        <span className="hk-day__num" aria-hidden="true">{s.n}</span>
        <div className="hk-day__titles">
          <h2 className="hk-day__title">{s.title} {s.left > 0 && <span className="hk-day__left">{s.left} left</span>}{s.left > 0 && <span className="hk-day__min"> · about {s.minutes} min</span>}</h2>
          <p className="hk-day__why">{sub(s)}</p>
          {s.done.line && <p className="hk-day__meta hk-day__doneline">Done today: {s.done.line}</p>}
        </div>
        <button type="button" className="hk-btn hk-qc hk-day__fold" aria-expanded="true" aria-label={`Fold ${s.title}`} onClick={() => flip(s)}><Icon name="chevron" size={16} /></button>
      </header>
      <div className="hk-day__items">{STEP[s.key](s)}</div>
      {s.key === 'pitches' && (s.items.length > 0 || s.more_in_briefing > 0) && (
        <div className="hk-day__foot" data-hk-pitch-foot>
          <Icon name="bolt" size={15} />
          <span className="hk-day__meta">Pitch claims it and copies the Claude command · paste in Claude · send from Gmail. Grow ticks it off when Gmail sees the send.</span>
          {canEdit && s.pitch_all && <button type="button" className="hk-btn hk-chipbtn" disabled={!!busy} onClick={() => pitchAll(s)} data-hk-pitch-all><Icon name="copy" size={15} /> {s.items.length === 2 ? 'Pitch both' : `Pitch all ${s.items.length}`}</button>}
          {s.more_in_briefing > 0 && <button type="button" className="hk-btn hk-chipbtn hk-day__more" onClick={() => onGo('inbox')} data-hk-more-briefing><Icon name="chevron" size={15} /> Find {s.more_in_briefing} more in Briefing</button>}
        </div>
      )}
    </section>
  ) : (
    <button key={s.key} type="button" className="hk-btn hk-day__step hk-day__step--done" aria-expanded="false" onClick={() => flip(s)} data-hk-step-done={s.key}>
      <span className="hk-day__check" aria-hidden="true"><Icon name="check" size={16} /></span>
      <span className="hk-day__title hk-day__title--done">{s.title}</span>
      <span className="hk-day__meta">{s.done.line || (s.left ? `${s.left} left` : '')}</span>
      <span className="hk-spacer" />
      <Icon name="chevron" size={16} />
    </button>
  )));
  const done = day.all_done && (
    <section className="hk-day__step hk-day__alldone" aria-label="You're done for today" data-hk-all-done>
      <h2 className="hk-day__title">{day.done ? "You're done for today" : 'Nothing is waiting on you right now'}</h2>
      {day.done > 0 && <p className="hk-day__meta">{day.steps.filter(s => s.done.line).map(s => `${s.title}: ${s.done.line}`).join(' · ')}</p>}
      {day.want_more.length > 0 ? (
        <>
          <h3 className="hk-kicker">Want more?</h3>
          <ul className="hk-day__want">{day.want_more.map(w => (
            <li key={`${w.key}:${w.hint || ''}`}><button type="button" className="hk-btn hk-link" onClick={() => onGo(w.to.startsWith('brands') ? 'brands' : 'inbox')} data-hk-want={w.key}>{wantLine(w)}</button></li>))}</ul>
        </>
      ) : <p className="hk-day__meta">Briefing has nothing ready to research or email. <button type="button" className="hk-btn hk-link" onClick={() => copy('hk batch 15', 'Copied hk batch 15. Paste into Claude to find new brands.')} data-hk-find-brands>Find new brands</button></p>}
    </section>
  );
  const rail = day.coming_up.length > 0 && (
    <aside className="hk-day__rail" aria-label="Coming up">
      <section className="hk-rcard" data-hk-coming-up>
        <h2 className="hk-rcard__title">Coming up</h2>
        <div className="hk-day__coming">{day.coming_up.map(c => (
          <button key={`${c.kind}:${c.brand_id}:${c.date}`} type="button" className="hk-btn hk-day__cu" onClick={() => onOpenBrand(c.brand_id)}>
            <span className="hk-day__cudate">{shortDay(c.date)}</span><span>{COMING[c.kind](c)}</span>
          </button>))}</div>
      </section>
    </aside>
  );
  return (
    <div className="hk-today hk-day" data-hk-today>
      <header className="hk-day__top">
        <div>
          <h1 className="hk-head__title">{greeting.title}</h1>
          <p className="hk-head__line" data-hk-day-line>{greeting.date} · {dayLine(day)} · {checkLine(day.daily_check)}</p>
        </div>
        <span className="hk-spacer" />
        <span className="hk-day__whose">Showing <strong>your</strong> day{others.length ? ` · ${others.map(m => m.first_name).join(' and ')}'s ${others.length === 1 ? 'is' : 'are'} separate` : ''}</span>
        {ownEmail && <button type="button" className="hk-btn hk-chipbtn" disabled={syncing} onClick={async () => { await onSync(); await load(); }} data-hk-sync-now><Icon name="flow" size={15} /> {syncing ? 'Syncing…' : 'Sync Gmail now'}</button>}
      </header>
      {jobs?.stats_stale && <div className="hk-banner hk-banner--mustard" data-hk-stats-strip><div className="hk-banner__text"><span className="hk-banner__title">Stats need a fresh confirmation</span><span className="hk-banner__line">Drafts quote the member and completion counts from Settings. Confirm them so the numbers stay true.</span></div><div className="hk-banner__actions"><button type="button" className="hk-btn hk-chipbtn" onClick={() => onGo('settings', 'pitch')} data-hk-confirm-stats-link>Confirm stats</button></div></div>}
      {reconnect.length > 0 && <div className="hk-banner hk-banner--orange" role="alert" data-hk-reconnect-banner><div className="hk-banner__text"><span className="hk-banner__title">Reconnect your Gmail</span><span className="hk-banner__line">Follow-ups for your brands wait until the mailbox is reconnected.</span></div><div className="hk-banner__actions"><button type="button" className="hk-btn hk-chipbtn" onClick={onOpenConnections}>Connections</button></div></div>}
      {error && <p className="hk-error" role="alert">{error}</p>}
      <section className="hk-day__progress" aria-label="Progress" data-hk-progress>
        <div className="hk-day__ptop">
          <span className="hk-day__pdone">{day.done} of {day.total} done</span>
          <span className="hk-day__meta">{day.left ? `about ${day.minutes_left} minutes left` : 'nothing left'}</span>
          <span className="hk-spacer" />
          <span className="hk-day__stat">Sent today <strong>{p.sent_today}</strong></span>
          <span className="hk-day__stat">Pitched <strong>{p.pitched}/{p.pitch_goal}</strong></span>
          <span className="hk-day__stat">Replies answered <strong>{p.replies_answered}/{p.replies_total}</strong></span>
        </div>
        <div className="hk-day__bar" role="progressbar" aria-label="Done today" aria-valuemin={0} aria-valuemax={day.total || 1} aria-valuenow={day.done}><span style={{ width: `${day.total ? Math.round((day.done / day.total) * 100) : 100}%` }} /></div>
      </section>
      <div className={`hk-day__grid${rail ? '' : ' hk-day__grid--solo'}${compact ? ' hk-day__grid--phone' : ''}`}>
        <div className="hk-day__steps">{steps}{done}</div>
        {rail}
      </div>
      <SignalsLine businessId={businessId} onGo={onGo} />
      {jobs?.digest?.data_warnings ? <p className="hk-meta hk-today__foot"><button type="button" className="hk-btn hk-link" onClick={() => onGo('review')} data-hk-warnings-link>{plural(jobs.digest.data_warnings, 'data warning')}</button></p> : null}
      {sheet.node}
      {cmd.node}
      {toast && (
        <div className="hk-toast" role="status" data-hk-toast>
          <span>{toast.line}</span>
          {toast.confirm && <button type="button" className="hk-btn hk-link" disabled={!!busy} onClick={() => { const fn = toast.confirm; setToast(null); fn(); }} data-hk-toast-confirm>Skip it</button>}
          {toast.confirm && <button type="button" className="hk-btn hk-link" onClick={() => setToast(null)}>Keep it</button>}
          {toast.undo && <button type="button" className="hk-btn hk-link" disabled={!!busy} onClick={runUndo} data-hk-toast-undo>Undo</button>}
        </div>
      )}
    </div>
  );
}
