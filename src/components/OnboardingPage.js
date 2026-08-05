import React, { useState, useEffect } from 'react';
import { mono } from '../constants/colors';
import { normalizeRoleForForm } from '../utils/invites';
import { registerUser, isAutoApproved } from '../utils/db';
import { OWNER_EMAILS } from '../constants/appConfig';
import { resolveUserId } from '../utils/userIdentity';
import { AESetupPanel, saveManagerConfig } from './ManagerCommandCenter';

const STATE_KEY = 'prospector_onboarding_state';
const NEON = '#39FF14';
const CYN  = '#00F5FF';
const AMB  = '#FFB800';
const RED  = '#FF4444';

function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
}
function saveState(patch) {
  try {
    const prev = loadState();
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {}
}
function clearState() { try { localStorage.removeItem(STATE_KEY); } catch {} }

const ROLES = [
  { id: 'AE',      label: 'AE',      desc: 'Account Executive' },
  { id: 'BDR',     label: 'BDR',     desc: 'Business Development' },
  { id: 'Manager', label: 'Manager', desc: 'Team Lead' },
  { id: 'Admin',   label: 'Admin',   desc: 'Workspace owner' },
];

const Card = ({ children, accent = NEON }) => (
  <div style={{
    background: '#050f05',
    border: `1px solid ${accent}33`,
    boxShadow: `0 0 32px ${accent}11`,
    borderRadius: 12,
    padding: '36px 40px',
    width: 480,
    maxWidth: '94vw',
  }}>{children}</div>
);

const NeonBtn = ({ children, onClick, disabled, color = NEON, full = true, style = {} }) => (
  <button onClick={onClick} disabled={disabled} style={{
    ...mono,
    width: full ? '100%' : 'auto',
    fontSize: 13,
    fontWeight: 600,
    padding: '12px 22px',
    background: disabled ? 'transparent' : `${color}14`,
    border: `1px solid ${disabled ? '#1a3a1a' : color}`,
    color: disabled ? '#5a6a5a' : color,
    borderRadius: 6,
    cursor: disabled ? 'default' : 'pointer',
    letterSpacing: '0.06em',
    textShadow: disabled ? 'none' : `0 0 6px ${color}66`,
    transition: 'all 0.15s',
    ...style,
  }}>{children}</button>
);

const GhostLink = ({ children, onClick }) => (
  <button onClick={onClick} style={{
    ...mono, fontSize: 11, background: 'none', border: 'none',
    color: '#5a6a5a', cursor: 'pointer', textDecoration: 'underline',
    padding: '6px 0',
  }}>{children}</button>
);

// Case-insensitive trimmed diff. Empty values are treated as "no conflict".
function valuesDiffer(sfdcVal, typedVal) {
  const s = (sfdcVal || '').toLowerCase().trim();
  const t = (typedVal || '').toLowerCase().trim();
  if (!s) return false;
  if (!t) return false;
  return s !== t;
}

export default function OnboardingPage({ onComplete }) {
  // Pre-fill from SFDC OAuth landing (App.js writes these on the redirect return)
  const sfdcName    = localStorage.getItem('sfdc_user_name')  || '';
  const sfdcEmail   = localStorage.getItem('sfdc_user_email') || '';
  const sfdcCompany = localStorage.getItem('sfdc_company')    || '';

  const persisted = loadState();
  const pendingRole = (() => {
    try { const r = localStorage.getItem('prospector_pending_role'); return r ? normalizeRoleForForm(r) : null; } catch { return null; }
  })();
  const roleLocked = !!pendingRole;

  // Decide initial step based on persisted state + SFDC return signals
  const initialStep = (() => {
    if (persisted.step === 'post_sfdc') {
      const showConfirm = valuesDiffer(sfdcName, persisted.typedName)
                       || valuesDiffer(sfdcEmail, persisted.typedEmail);
      return showConfirm ? 'sfdc_confirm' : 'gmail';
    }
    if (persisted.step === 'gmail') return 'gmail';
    if (persisted.step === 'sfdc_connect') return 'sfdc_connect';
    return 'identity_form';
  })();

  const [step, setStep] = useState(initialStep);

  const [form, setForm] = useState({
    name:    persisted.typedName  || sfdcName  || '',
    email:   persisted.typedEmail || sfdcEmail || '',
    company: sfdcCompany || persisted.typedCompany || '',
    role:    pendingRole || persisted.role || 'AE',
  });

  const [managerCfg, setManagerCfg] = useState({ managerId: null, aes: [] });

  // Live-poll connection status so the chip strip + success banners stay accurate
  // without depending on which step we're on or when re-renders happen.
  const [sfdcConn, setSfdcConn] = useState(() => !!localStorage.getItem('sfdc_access_token'));
  const [gmailConn, setGmailConn] = useState(() => !!localStorage.getItem('gmail_access_token'));
  useEffect(() => {
    const check = () => {
      setSfdcConn(!!localStorage.getItem('sfdc_access_token'));
      setGmailConn(!!localStorage.getItem('gmail_access_token'));
    };
    const t = setInterval(check, 500);
    return () => clearInterval(t);
  }, []);

  // Confirmation pulled from SFDC — auto-accept after 2s on sfdc_confirm step
  useEffect(() => {
    if (step !== 'sfdc_confirm') return;
    const t = setTimeout(() => {
      setForm(f => ({
        ...f,
        name:    sfdcName    || f.name,
        email:   sfdcEmail   || f.email,
        company: sfdcCompany || f.company,
      }));
      saveState({ step: 'gmail' });
      setStep('gmail');
    }, 2000);
    return () => clearTimeout(t);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const goConnectSfdc = () => {
    saveState({
      step: 'sfdc_connect',
      flow: 'onboarding',
      role: form.role,
      typedName:    form.name.trim(),
      typedEmail:   form.email.trim(),
      typedCompany: form.company.trim(),
    });
    // Pass identity in OAuth state so callback can pre-associate the token
    const state = btoa(JSON.stringify({
      flow: 'onboarding',
      role: form.role,
      email: form.email.trim(),
      name: form.name.trim(),
    }));
    window.location.href = `/api/sfdc/auth?state=${encodeURIComponent(state)}`;
  };

  const goConnectGmail = () => {
    saveState({ step: 'gmail' });
    window.location.href = '/api/gmail/auth';
  };

  const skipSfdc = () => {
    saveState({ step: 'gmail', role: form.role });
    setStep('gmail');
  };

  const acceptSfdcConfirm = () => {
    setForm(f => ({
      ...f,
      name:    sfdcName    || f.name,
      email:   sfdcEmail   || f.email,
      company: sfdcCompany || f.company,
    }));
    saveState({ step: 'gmail' });
    setStep('gmail');
  };

  const submitIdentityForm = () => {
    if (!form.name.trim() || !form.email.trim()) return;
    saveState({
      step: 'sfdc_connect',
      role: form.role,
      typedName:    form.name.trim(),
      typedEmail:   form.email.trim(),
    });
    setStep('sfdc_connect');
  };

  const skipGmail = () => advanceFromGmail();
  const advanceFromGmail = () => {
    if (form.role === 'Manager') {
      saveState({ step: 'manager_team' });
      setStep('manager_team');
    } else {
      finish();
    }
  };

  const finish = () => {
    const userShape = {
      name:    form.name.trim(),
      email:   form.email.trim(),
      company: form.company.trim(),
      role:    form.role,
    };

    // Demo guard — if localStorage already holds an Owner identity and the
    // demo run used a different email, restore the original Owner instead of
    // clobbering it. The ?onboarding=1 query param nulls in-memory user but
    // leaves localStorage intact, so we can inspect the prior value here.
    let existing = null;
    try { existing = JSON.parse(localStorage.getItem('prospector_user') || 'null'); } catch {}
    const existingIsOwner = existing?.email && OWNER_EMAILS.includes(String(existing.email).toLowerCase());
    const enteredIsOwner = userShape.email && OWNER_EMAILS.includes(userShape.email.toLowerCase());
    if (existingIsOwner && !enteredIsOwner) {
      clearState();
      onComplete(existing);
      return;
    }

    // Stamp a stable id so downstream code (acc.byId, acc.aeId, frontier
    // attribution, voice profile keys) doesn't end up with user.id === undefined.
    const user = { id: resolveUserId(userShape), ...userShape };

    localStorage.setItem('prospector_user', JSON.stringify(user));
    try { localStorage.removeItem('prospector_pending_role'); } catch {}
    if (user.role === 'Manager') {
      saveManagerConfig({ ...managerCfg, managerId: user.email });
    }
    clearState();
    onComplete(user);

    // Approval check + Supabase upsert run in background so the UI advances
    // immediately even if Supabase is slow/unreachable.
    const userId = user.id;
    if (userId) {
      (async () => {
        let approved = false;
        try { approved = await isAutoApproved(user.email); } catch {}
        try { await registerUser({ id: userId, name: user.name, email: user.email, role: user.role, status: approved ? 'approved' : 'pending' }); } catch {}
      })();
    }
  };

  const setField = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  // ── Layout shell ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#020602', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, filter: `drop-shadow(0 0 8px ${NEON})` }}>⛏</span>
          <span style={{ ...mono, fontSize: 14, fontWeight: 700, color: NEON, letterSpacing: '0.32em', textShadow: `0 0 8px ${NEON}88` }}>PROSPECTOR</span>
        </div>

        {/* Persistent connection chip strip — gives the user constant feedback
            about which OAuths have completed regardless of which step is showing. */}
        <div style={{ display: 'flex', gap: 8 }}>
          <ConnectionChip label="Salesforce" connected={sfdcConn}/>
          <ConnectionChip label="Gmail"      connected={gmailConn}/>
        </div>

        {/* ── Step 1: identity_form — required name + email + role before SFDC ── */}
        {step === 'identity_form' && (
          <Card>
            <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: NEON, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Step 1 of {form.role === 'Manager' ? 4 : 3}</p>
            <h2 style={{ ...mono, margin: '0 0 10px', fontSize: 18, fontWeight: 700, color: '#cfe8d4' }}>WHO ARE YOU</h2>
            <p style={{ ...mono, margin: '0 0 18px', fontSize: 11, color: '#8a9a8a', lineHeight: 1.7 }}>
              Quick basics. We'll pre-fill from Salesforce once you connect.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
              <Input label="Name *"  value={form.name}  onChange={setField('name')}  placeholder="Your full name"/>
              <Input label="Email *" value={form.email} onChange={setField('email')} placeholder="you@example.com"/>
            </div>
            <p style={{ ...mono, margin: '0 0 8px', fontSize: 10, color: '#5a6a5a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Role</p>
            <RolePicker form={form} setForm={setForm} locked={roleLocked}/>
            <div style={{ marginTop: 20 }}>
              <NeonBtn onClick={submitIdentityForm} disabled={!form.name.trim() || !form.email.trim()} color={NEON}>
                CONTINUE →
              </NeonBtn>
            </div>
          </Card>
        )}

        {/* ── Step 2: sfdc_connect — Connect Salesforce (OAuth carries email/name) ── */}
        {step === 'sfdc_connect' && (
          <Card>
            <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: NEON, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Step 2 of {form.role === 'Manager' ? 4 : 3}</p>
            <h2 style={{ ...mono, margin: '0 0 10px', fontSize: 18, fontWeight: 700, color: '#cfe8d4' }}>CONNECT YOUR TERRITORY</h2>
            <p style={{ ...mono, margin: '0 0 22px', fontSize: 12, color: '#8a9a8a', lineHeight: 1.7 }}>
              Hi {form.name.split(' ')[0] || 'there'} — link Salesforce to load your accounts. We'll pre-match this OAuth session to your Prospector profile so account ownership lines up immediately.
            </p>
            {sfdcConn ? (
              <>
                <div style={{ padding: '10px 14px', background: `${NEON}10`, border: `1px solid ${NEON}55`, borderRadius: 6, textAlign: 'center', marginBottom: 14 }}>
                  <p style={{ ...mono, margin: 0, fontSize: 12, color: NEON, letterSpacing: '0.06em', fontWeight: 600, textShadow: `0 0 6px ${NEON}66` }}>
                    ✓ SALESFORCE CONNECTED
                  </p>
                </div>
                <NeonBtn onClick={skipSfdc} color={NEON}>CONTINUE →</NeonBtn>
              </>
            ) : (
              <>
                <NeonBtn onClick={goConnectSfdc} color={NEON}>⛏ CONNECT SALESFORCE →</NeonBtn>
                <p style={{ ...mono, margin: '14px 0 0', fontSize: 10, color: '#5a6a5a', textAlign: 'center' }}>
                  You'll be redirected to Salesforce to authorize. Takes ~30 seconds.
                </p>
                <div style={{ textAlign: 'center', marginTop: 18 }}>
                  <GhostLink onClick={skipSfdc}>Skip for later</GhostLink>
                </div>
              </>
            )}
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <GhostLink onClick={() => { saveState({ step: 'identity_form' }); setStep('identity_form'); }}>← Edit identity</GhostLink>
            </div>
          </Card>
        )}

        {/* ── Step 2.5: sfdc_confirm — only shown when SFDC values differ from typed ── */}
        {step === 'sfdc_confirm' && (
          <Card>
            <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: NEON, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Step 2 of {form.role === 'Manager' ? 4 : 3}</p>
            <h2 style={{ ...mono, margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#cfe8d4' }}>✓ SALESFORCE CONNECTED</h2>
            <p style={{ ...mono, margin: '0 0 14px', fontSize: 12, color: '#8a9a8a', lineHeight: 1.7 }}>
              We found your Salesforce account: <span style={{ color: '#cfe8d4' }}>{sfdcName || form.name}</span>
              {sfdcEmail ? <> · <span style={{ color: '#cfe8d4' }}>{sfdcEmail}</span></> : null} — using this.
            </p>
            <div style={{ background: '#0a1a0f', border: `1px solid ${NEON}33`, borderRadius: 7, padding: '12px 14px', marginBottom: 16 }}>
              <Row label="NAME"    value={sfdcName    || form.name    || '—'}/>
              <Row label="EMAIL"   value={sfdcEmail   || form.email   || '—'}/>
              <Row label="COMPANY" value={sfdcCompany || form.company || '—'}/>
            </div>
            <p style={{ ...mono, margin: '0 0 14px', fontSize: 10, color: '#5a6a5a', textAlign: 'center' }}>
              Auto-continuing in 2s…
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <GhostLink onClick={() => { saveState({ step: 'gmail' }); setStep('gmail'); }}>Keep what I typed</GhostLink>
              <div style={{ flex: 1 }}/>
              <NeonBtn onClick={acceptSfdcConfirm} color={NEON} full={false}>USE SALESFORCE →</NeonBtn>
            </div>
          </Card>
        )}

        {/* ── Step 3: gmail ── */}
        {step === 'gmail' && (
          <Card accent={CYN}>
            <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: CYN, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Step 3 of {form.role === 'Manager' ? 4 : 3}</p>
            <h2 style={{ ...mono, margin: '0 0 10px', fontSize: 18, fontWeight: 700, color: '#cfe8d4' }}>ONE MORE CONNECTION</h2>

            {/* SFDC success acknowledgment — only when arriving here after a fresh SFDC connect */}
            {sfdcConn && persisted.step === 'post_sfdc' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 16, background: `${NEON}10`, border: `1px solid ${NEON}55`, borderRadius: 6 }}>
                <span style={{ color: NEON, fontSize: 12, textShadow: `0 0 6px ${NEON}88` }}>✓</span>
                <span style={{ ...mono, fontSize: 11, color: NEON, letterSpacing: '0.06em', fontWeight: 600 }}>SALESFORCE CONNECTED</span>
                <span style={{ ...mono, fontSize: 10, color: '#8a9a8a', flex: 1 }}>— accounts loading in background</span>
              </div>
            )}

            <p style={{ ...mono, margin: '0 0 20px', fontSize: 12, color: '#8a9a8a', lineHeight: 1.7 }}>
              Link your Google account to enable:
            </p>
            <ul style={{ ...mono, listStyle: 'none', padding: 0, margin: '0 0 24px', fontSize: 12, color: '#8a9a8a', lineHeight: 2 }}>
              <li>· Morning Brief</li>
              <li>· Calendar Intelligence</li>
              <li>· Email context for Scout</li>
            </ul>

            {gmailConn ? (
              <>
                <div style={{ padding: '10px 14px', background: `${NEON}10`, border: `1px solid ${NEON}55`, borderRadius: 6, textAlign: 'center', marginBottom: 14 }}>
                  <p style={{ ...mono, margin: 0, fontSize: 12, color: NEON, letterSpacing: '0.06em', fontWeight: 600, textShadow: `0 0 6px ${NEON}66` }}>
                    ✓ GOOGLE CONNECTED
                  </p>
                </div>
                <NeonBtn onClick={advanceFromGmail} color={NEON}>CONTINUE →</NeonBtn>
              </>
            ) : (
              <>
                <NeonBtn onClick={goConnectGmail} color={CYN}>📧 CONNECT GOOGLE →</NeonBtn>
                <div style={{ textAlign: 'center', marginTop: 14 }}>
                  <GhostLink onClick={skipGmail}>Skip for later</GhostLink>
                </div>
              </>
            )}
          </Card>
        )}

        {/* ── Step 4: manager_team ── */}
        {step === 'manager_team' && (
          <Card>
            <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: NEON, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Step 4 of 4</p>
            <h2 style={{ ...mono, margin: '0 0 10px', fontSize: 18, fontWeight: 700, color: '#cfe8d4' }}>YOUR TEAM</h2>
            <p style={{ ...mono, margin: '0 0 16px', fontSize: 12, color: '#8a9a8a', lineHeight: 1.6 }}>Add each AE on your team. You can always edit this later.</p>
            <AESetupPanel managerConfig={managerCfg} onSave={setManagerCfg} compact/>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <GhostLink onClick={() => setStep('gmail')}>← Back</GhostLink>
              <div style={{ flex: 1 }}/>
              <NeonBtn onClick={finish} color={NEON} full={false}>ENTER PROSPECTOR →</NeonBtn>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ConnectionChip({ label, connected }) {
  const color = connected ? NEON : '#5a6a5a';
  return (
    <span style={{
      ...mono, fontSize: 9, padding: '2px 9px',
      background: connected ? `${color}14` : 'transparent',
      border: `1px solid ${color}55`,
      color, borderRadius: 10,
      letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
      textShadow: connected ? `0 0 6px ${color}66` : 'none',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <span>{connected ? '✓' : '○'}</span>
      <span>{label}</span>
    </span>
  );
}

function Row({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '5px 0', gap: 12 }}>
      <span style={{ ...mono, fontSize: 9, color: '#5a6a5a', letterSpacing: '0.1em', width: 70 }}>{label}</span>
      {onChange ? (
        <input value={value === '—' ? '' : value} onChange={onChange}
          style={{ ...mono, flex: 1, fontSize: 13, color: '#cfe8d4', background: 'transparent', border: 'none', outline: 'none', padding: 0 }}/>
      ) : (
        <span style={{ ...mono, fontSize: 13, color: '#cfe8d4' }}>{value}</span>
      )}
    </div>
  );
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <div>
      <p style={{ ...mono, margin: '0 0 4px', fontSize: 10, color: '#5a6a5a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</p>
      <input value={value} onChange={onChange} placeholder={placeholder}
        style={{ ...mono, width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 11px', background: '#0a1a0f', border: `1px solid ${NEON}33`, borderRadius: 4, color: '#cfe8d4', outline: 'none', caretColor: NEON }}/>
    </div>
  );
}

function RolePicker({ form, setForm, locked }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {ROLES.map(r => {
        const active = form.role === r.id;
        const isAdmin = r.id === 'Admin';
        const accent = isAdmin ? AMB : (active ? NEON : '#1a3a1a');
        return (
          <button key={r.id} onClick={() => !locked && setForm(f => ({ ...f, role: r.id }))}
            disabled={locked}
            style={{
              ...mono, fontSize: 11, padding: '8px 6px', borderRadius: 5,
              background: active ? `${accent}14` : 'transparent',
              border: `1px solid ${active ? accent : '#1a3a1a'}`,
              color: active ? accent : '#5a6a5a',
              cursor: locked ? 'default' : 'pointer',
              letterSpacing: '0.06em',
              opacity: locked && !active ? 0.4 : 1,
              textAlign: 'center',
              transition: 'all 0.12s',
            }}>
            <div style={{ fontWeight: 600 }}>{r.label}</div>
            <div style={{ fontSize: 9, color: active ? accent : '#3a4a3a', marginTop: 2 }}>{r.desc}</div>
          </button>
        );
      })}
      {form.role === 'Admin' && (
        <p style={{ gridColumn: '1 / -1', ...mono, margin: '8px 0 0', fontSize: 10, color: AMB, textAlign: 'center', letterSpacing: '0.06em' }}>
          ⚠ Admin access requires manual approval
        </p>
      )}
    </div>
  );
}
