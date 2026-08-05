import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { patchUser } from '../utils/db';

const WIZARD_STEP_KEY = 'prospector_wizard_step';

const OVERLAY = {
  position: 'fixed', inset: 0, background: '#000000cc', zIndex: 900,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
};
const CARD = {
  background: '#07101a', border: `1px solid ${C.brd}`, borderRadius: 14,
  width: '100%', maxWidth: 520, boxShadow: '0 24px 80px #00000099',
  overflow: 'hidden',
};
const STEP_DOT = (active, done) => ({
  width: 8, height: 8, borderRadius: '50%',
  background: done ? C.green : active ? C.blue : C.brd,
  transition: 'background 0.2s',
});
const BTN_PRIMARY = {
  ...mono, fontSize: 13, fontWeight: 700, padding: '10px 24px',
  background: C.blue, border: 'none', color: '#fff', borderRadius: 7,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const BTN_GHOST = {
  ...mono, fontSize: 12, padding: '9px 18px',
  background: 'transparent', border: `1px solid ${C.brd}`,
  color: C.dim, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
};

function StepDots({ step }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {[1, 2, 3].map(n => (
        <div key={n} style={STEP_DOT(step === n, step > n)} />
      ))}
    </div>
  );
}

// ── Step 1: Connect ────────────────────────────────────────────────────────────
function Step1Connect({ user, onNav, onSkip }) {
  const sfdcConnected = !!localStorage.getItem('sfdc_access_token');

  const handleSfdc = () => {
    // Persist wizard step so we resume at step 2 after OAuth redirect
    localStorage.setItem(WIZARD_STEP_KEY, '2');
    window.location.href = '/api/sfdc/auth';
  };

  return (
    <div style={{ padding: '28px 32px 24px' }}>
      <p style={{ ...mono, fontSize: 10, color: C.dim, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Step 1 of 3</p>
      <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: C.txt }}>Connect your territory</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
        Connect Salesforce to pull in your accounts automatically, or upload a CSV to get started immediately.
      </p>

      {/* SFDC option */}
      <div style={{ background: C.card, border: `1px solid ${sfdcConnected ? C.green + '44' : C.brd}`, borderRadius: 10, padding: '16px 18px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>☁</span>
          <div style={{ flex: 1 }}>
            <p style={{ ...mono, margin: 0, fontSize: 12, fontWeight: 700, color: C.txt }}>Salesforce</p>
            <p style={{ ...mono, margin: '2px 0 0', fontSize: 10, color: C.dim }}>Pulls My Accounts + Dormant accounts automatically</p>
          </div>
          {sfdcConnected && <span style={{ ...mono, fontSize: 10, color: C.green }}>● Connected</span>}
        </div>
        <button onClick={handleSfdc} style={{ ...BTN_PRIMARY, width: '100%', background: sfdcConnected ? C.green : C.blue }}>
          {sfdcConnected ? '✓ Reconnect Salesforce' : 'Connect Salesforce via OAuth →'}
        </button>
        <p style={{ ...mono, margin: '8px 0 0', fontSize: 10, color: C.dim }}>
          You'll be redirected to Salesforce to authorize. Takes ~30 seconds.
        </p>
      </div>

      {/* CSV option */}
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>📄</span>
          <div style={{ flex: 1 }}>
            <p style={{ ...mono, margin: 0, fontSize: 12, fontWeight: 700, color: C.txt }}>Upload a CSV</p>
            <p style={{ ...mono, margin: '2px 0 0', fontSize: 10, color: C.dim }}>Export your accounts from any CRM and import here</p>
          </div>
        </div>
        <button onClick={() => { localStorage.setItem(WIZARD_STEP_KEY, 'upload'); onNav('admin'); }}
          style={{ ...BTN_GHOST, width: '100%' }}>
          Go to Uploads →
        </button>
      </div>

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <button onClick={onSkip} style={{ ...mono, fontSize: 11, background: 'none', border: 'none', color: C.dim, cursor: 'pointer', textDecoration: 'underline' }}>
          Skip setup for now
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Confirm accounts ───────────────────────────────────────────────────
function Step2Confirm({ accounts, onNext, onBack }) {
  const preview = accounts.slice(0, 5);

  return (
    <div style={{ padding: '28px 32px 24px' }}>
      <p style={{ ...mono, fontSize: 10, color: C.dim, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Step 2 of 3</p>
      <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: C.txt }}>
        {accounts.length === 0 ? 'No accounts found yet' : `We found ${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
        {accounts.length === 0
          ? 'Accounts are still loading — this can take up to 30 seconds after connecting Salesforce.'
          : 'Quick sanity check — do these look like your territory?'}
      </p>

      {preview.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
          {preview.map((acc, i) => (
            <div key={acc.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: i < preview.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
              <span style={{ fontSize: 14 }}>{acc.tier === 'Gold' ? '⭑' : acc.tier === 'Silver' ? '◈' : '◇'}</span>
              <span style={{ fontSize: 13, color: C.txt, flex: 1 }}>{acc.name}</span>
              <span style={{ ...mono, fontSize: 10, color: C.dim }}>{acc.vert || acc.state || ''}</span>
            </div>
          ))}
          {accounts.length > 5 && (
            <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.brd}22` }}>
              <span style={{ ...mono, fontSize: 10, color: C.dim }}>+ {accounts.length - 5} more accounts</span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onBack} style={BTN_GHOST}>← Wrong accounts</button>
        <button onClick={onNext} disabled={accounts.length === 0}
          style={{ ...BTN_PRIMARY, flex: 1, opacity: accounts.length === 0 ? 0.4 : 1 }}>
          {accounts.length === 0 ? 'Waiting for accounts…' : 'Looks good →'}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Run assay ──────────────────────────────────────────────────────────
function Step3Assay({ accounts, onComplete }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);

  const runAssay = async () => {
    setRunning(true);
    const total = accounts.length;
    let completed = 0;

    for (const acc of accounts) {
      if (!acc.web) { completed++; setProgress(Math.round((completed / total) * 100)); continue; }
      try {
        const r = await fetch('/api/assay/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: acc.web, name: acc.name, vert: acc.vert || '' }),
          signal: AbortSignal.timeout(20000),
        });
        if (r.ok) {
          const result = await r.json();
          if (result.score) {
            acc.score = result.score;
            acc.tier = result.tier;
            acc.sigs = result.signals || acc.sigs;
          }
        }
      } catch { /* continue on failure */ }
      completed++;
      setProgress(Math.round((completed / total) * 100));
    }
    setRunning(false);
    setDone(true);
  };

  if (done) {
    return (
      <div style={{ padding: '28px 32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⛏️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: C.txt }}>Your territory is ready</h2>
        <p style={{ margin: '0 0 28px', fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
          Accounts have been scored and tiered. Time to prospect.
        </p>
        <button onClick={onComplete} style={{ ...BTN_PRIMARY, padding: '12px 32px', fontSize: 14 }}>
          Open Territory →
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px 24px' }}>
      <p style={{ ...mono, fontSize: 10, color: C.dim, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Step 3 of 3</p>
      <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: C.txt }}>Score your territory</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
        Prospector will score and tier your {accounts.length} accounts using AI — checks each company's website for product fit signals. Takes a few minutes.
      </p>

      {running ? (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ ...mono, fontSize: 11, color: C.mut }}>Analyzing accounts…</span>
            <span style={{ ...mono, fontSize: 11, color: C.txt }}>{progress}%</span>
          </div>
          <div style={{ height: 6, background: C.brd, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: C.gold, borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
          <p style={{ ...mono, margin: '10px 0 0', fontSize: 10, color: C.dim }}>
            You can close this and come back — assay runs in the background.
          </p>
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '14px 18px', marginBottom: 24 }}>
          <p style={{ ...mono, margin: 0, fontSize: 11, color: C.mut, lineHeight: 1.6 }}>
            The assay engine scrapes each account's website and scores fit on Auth, Balance, Transactions, and Identity signals. Gold accounts surface to the top.
          </p>
        </div>
      )}

      {!running && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onComplete} style={BTN_GHOST}>Skip for now</button>
          <button onClick={runAssay} style={{ ...BTN_PRIMARY, flex: 1 }}>
            Run Assay on {accounts.length} accounts →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Wizard ────────────────────────────────────────────────────────────────
export default function SetupWizard({ user, accounts, onNav, onComplete, onSaveAccounts }) {
  const [step, setStep] = useState(() => {
    const saved = localStorage.getItem(WIZARD_STEP_KEY);
    if (saved === '2') return 2;
    if (saved === '3') return 3;
    return 1;
  });

  // Clear the persisted step once we've consumed it
  useEffect(() => {
    const saved = localStorage.getItem(WIZARD_STEP_KEY);
    if (saved === '2' || saved === '3') {
      localStorage.removeItem(WIZARD_STEP_KEY);
    }
  }, []);

  const handleComplete = async () => {
    if (user?.id) {
      await patchUser(user.id, { onboarded: true });
    }
    // Save onboarded flag locally too
    try {
      const u = JSON.parse(localStorage.getItem('prospector_user') || '{}');
      localStorage.setItem('prospector_user', JSON.stringify({ ...u, onboarded: true }));
    } catch {}
    localStorage.removeItem(WIZARD_STEP_KEY);
    onComplete();
  };

  const handleSkip = async () => {
    // Mark a soft-skip: banner will show, but wizard won't reappear
    try {
      const u = JSON.parse(localStorage.getItem('prospector_user') || '{}');
      localStorage.setItem('prospector_user', JSON.stringify({ ...u, wizardSkipped: true }));
    } catch {}
    localStorage.removeItem(WIZARD_STEP_KEY);
    onComplete();
  };

  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.brd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>⛏️</span>
            <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.txt }}>Welcome to Prospector</span>
          </div>
          <StepDots step={step} />
        </div>

        {step === 1 && <Step1Connect user={user} onNav={onNav} onSkip={handleSkip} />}
        {step === 2 && <Step2Confirm accounts={accounts} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <Step3Assay accounts={accounts} onComplete={handleComplete} onSaveAccounts={onSaveAccounts} />}
      </div>
    </div>
  );
}

export function SetupBanner({ onDismiss }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: `${C.blue}0d`, border: `1px solid ${C.blue}33`, borderRadius: 7, marginBottom: 12 }}>
      <span style={{ fontSize: 16 }}>⛏️</span>
      <span style={{ ...mono, fontSize: 12, color: C.txt, flex: 1 }}>Connect Salesforce to pull in your territory automatically — takes ~30 seconds.</span>
      <button onClick={() => { window.location.href = '/api/sfdc/auth'; }} style={{ ...mono, fontSize: 11, padding: '4px 12px', background: `${C.blue}22`, border: `1px solid ${C.blue}55`, color: C.blue, borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        Connect Salesforce →
      </button>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
    </div>
  );
}

export function StaleSfdcBanner({ onDismiss }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: `${C.gold}0d`, border: `1px solid ${C.gold}33`, borderRadius: 7, marginBottom: 12 }}>
      <span style={{ fontSize: 16 }}>⚠️</span>
      <span style={{ ...mono, fontSize: 12, color: C.txt, flex: 1 }}>SFDC data may be stale — reconnect to refresh your territory. Takes ~30 seconds.</span>
      <button onClick={() => { window.location.href = '/api/sfdc/auth'; }} style={{ ...mono, fontSize: 11, padding: '4px 12px', background: `${C.gold}18`, border: `1px solid ${C.gold}55`, color: C.gold, borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        Reconnect SFDC →
      </button>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
    </div>
  );
}
