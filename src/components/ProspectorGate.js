import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  isValidCode, redeemInvite,
  checkMasterCode, getMasterCodeHash, generateMasterCode, setMasterCode,
} from "../utils/invites";

const GATE_KEY    = "prospector_gate_unlocked";
const ATTEMPT_KEY = "prospector_gate_attempts";
// Code length is variable (PREFIX-SUFFIX); input is capped via slice in handleChange.
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000;

// ── helpers ──────────────────────────────────────────────────────────────────

const legacyCodes = () =>
  (process.env.REACT_APP_INVITE_CODES || "")
    .split(",").map(c => c.trim().toUpperCase()).filter(Boolean);

const isUnlocked = () => {
  try { return localStorage.getItem(GATE_KEY) === "true"; } catch { return false; }
};

const loadAttempts = () => {
  try { return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || "{}"); } catch { return {}; }
};
const saveAttempts = data => {
  try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(data)); } catch {}
};
const clearAttempts = () => {
  try { localStorage.removeItem(ATTEMPT_KEY); } catch {}
};

const getLockState = () => {
  const a   = loadAttempts();
  const now = Date.now();
  if (a.lockedUntil && now < a.lockedUntil)
    return { locked: true, lockedUntil: a.lockedUntil, count: a.count || MAX_ATTEMPTS };
  if (a.lockedUntil && now >= a.lockedUntil) {
    clearAttempts();
    return { locked: false, count: 0 };
  }
  return { locked: false, count: a.count || 0 };
};

// ── SVG ───────────────────────────────────────────────────────────────────────

const PickaxeSVG = () => (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8 44 L28 24 M28 24 C28 24 32 14 42 10 C46 8 44 12 42 14 C46 10 50 10 48 14 C50 12 50 16 46 18 C48 14 42 18 38 22 L28 24Z"
      stroke="#D4A96A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"
    />
    <line x1="8" y1="44" x2="22" y2="30" stroke="#D4A96A" strokeWidth="2.8" strokeLinecap="round"/>
    <path d="M42 10 C46 7 50 8 48 13" stroke="#D4A96A" strokeWidth="2" strokeLinecap="round" fill="none"/>
    <path d="M48 13 C51 10 52 14 48 17" stroke="#D4A96A" strokeWidth="2" strokeLinecap="round" fill="none"/>
    <path d="M48 17 C50 14 46 19 42 20" stroke="#D4A96A" strokeWidth="2" strokeLinecap="round" fill="none"/>
    <path d="M10 46 L6 50 M8 44 L4 48" stroke="#8C7A5A" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

// ── Lockout screen ────────────────────────────────────────────────────────────

function LockoutScreen({ lockedUntil, onExpired }) {
  const [remaining, setRemaining] = useState(Math.max(0, lockedUntil - Date.now()));

  useEffect(() => {
    const tick = setInterval(() => {
      const r = Math.max(0, lockedUntil - Date.now());
      setRemaining(r);
      if (r === 0) { clearInterval(tick); clearAttempts(); onExpired(); }
    }, 500);
    return () => clearInterval(tick);
  }, [lockedUntil, onExpired]);

  const totalSec = Math.ceil(remaining / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
      <div style={{ fontSize:28, marginBottom:16, filter:"drop-shadow(0 0 12px #F0606066)" }}>🔒</div>
      <div style={{ fontSize:14, fontWeight:700, color:"#F06060", letterSpacing:"0.08em", marginBottom:8 }}>
        ACCESS SUSPENDED
      </div>
      <div style={{ fontSize:12, color:"#8C7060", letterSpacing:"0.04em", marginBottom:28, textAlign:"center", maxWidth:280, lineHeight:1.6 }}>
        Too many failed attempts.<br/>Try again in
      </div>
      <div style={{ fontSize:36, fontWeight:700, color:"#F06060", letterSpacing:"0.15em", fontFamily:"'Courier New', Courier, monospace", textShadow:"0 0 20px #F0606066", marginBottom:28 }}>
        {mins}:{String(secs).padStart(2,"0")}
      </div>
      <div style={{ fontSize:11, color:"#3A2820", letterSpacing:"0.04em" }}>
        Contact your rep if you need immediate access
      </div>
    </div>
  );
}

// ── Master code first-time banner ─────────────────────────────────────────────

function MasterCodeBanner({ code, onDismiss, onCopy, copied }) {
  return (
    <div style={{
      position:"fixed", top:0, left:0, right:0, zIndex:99998,
      background:"linear-gradient(90deg, #1a0f00 0%, #2a1800 50%, #1a0f00 100%)",
      borderBottom:"1px solid #D4A96A55",
      padding:"12px 20px",
      display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
    }}>
      <span style={{ fontSize:16 }}>⛏</span>
      <div style={{ flex:1, minWidth:200 }}>
        <span style={{ fontFamily:"'Courier New',monospace", fontSize:12, color:"#D4A96A", fontWeight:700, letterSpacing:"0.06em" }}>
          MASTER CODE —{" "}
        </span>
        <span style={{ fontFamily:"'Courier New',monospace", fontSize:15, color:"#F5EDD6", fontWeight:700, letterSpacing:"0.2em" }}>
          {code}
        </span>
        <span style={{ fontFamily:"'Courier New',monospace", fontSize:11, color:"#8C7A5A", marginLeft:12 }}>
          Save this somewhere safe. It won't be shown again.
        </span>
      </div>
      <button
        onClick={onCopy}
        style={{ fontFamily:"'Courier New',monospace", fontSize:11, padding:"4px 12px", background:"transparent", border:"1px solid #D4A96A55", color: copied ? "#5EB46E" : "#D4A96A", borderRadius:4, cursor:"pointer", flexShrink:0 }}>
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <button
        onClick={onDismiss}
        style={{ fontFamily:"'Courier New',monospace", fontSize:11, padding:"4px 14px", background:"#D4A96A22", border:"1px solid #D4A96A66", color:"#D4A96A", borderRadius:4, cursor:"pointer", flexShrink:0, fontWeight:700 }}>
        I've saved it →
      </button>
    </div>
  );
}

// ── Main gate ─────────────────────────────────────────────────────────────────

export default function ProspectorGate({ children }) {
  const [unlocked,    setUnlocked]    = useState(isUnlocked);
  const [lockState,   setLockState]   = useState(getLockState);
  // Code input — flexible length, split on display but typed as one string
  const [input,       setInput]       = useState("");
  const [status,      setStatus]      = useState("idle"); // idle | checking | wrong | granted
  const [errorMsg,    setErrorMsg]    = useState("");
  const [fadeOut,     setFadeOut]     = useState(false);
  // Master code banner
  const [masterBannerCode, setMasterBannerCode] = useState(null);
  const [bannerCopied,     setBannerCopied]     = useState(false);
  const inputRef = useRef(null);

  // ── Terminal typewriter intro ────────────────────────────────────────────
  const INTRO_FULL = "PROSPECTOR\n─────────────────────────────\nTHE FUTURE OF MINING.\nWHERE PRECIOUS METALS MEET INTELLIGENCE.\n\nENTER INVITE CODE TO BEGIN";
  const [introText, setIntroText] = useState("");
  const [introDone, setIntroDone] = useState(() => {
    try { return sessionStorage.getItem("prospector_intro_played") === "1"; } catch { return false; }
  });
  const [outroText, setOutroText] = useState("");
  const [outroMode, setOutroMode] = useState(null); // null | 'success' | 'invalid'

  useEffect(() => {
    if (introDone) { setIntroText(INTRO_FULL); return; }
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (i >= INTRO_FULL.length) {
        setIntroDone(true);
        try { sessionStorage.setItem("prospector_intro_played", "1"); } catch {}
        return;
      }
      i++;
      setIntroText(INTRO_FULL.slice(0, i));
      setTimeout(tick, 40);
    };
    tick();
    return () => { cancelled = true; };
  }, [introDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any key during intro = skip to end
  useEffect(() => {
    if (introDone) return;
    const onKey = () => setIntroDone(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [introDone]);

  // Outro typewriter (success/invalid messages)
  useEffect(() => {
    if (!outroMode) { setOutroText(""); return; }
    const msg = outroMode === "success"
      ? "CODE ACCEPTED. WELCOME, MINER."
      : "INVALID CODE. TRY AGAIN.";
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (i >= msg.length) return;
      i++;
      setOutroText(msg.slice(0, i));
      setTimeout(tick, 40);
    };
    tick();
    return () => { cancelled = true; };
  }, [outroMode]);

  // Drive outro from status transitions
  useEffect(() => {
    if (status === "granted" && outroMode !== "success") setOutroMode("success");
    if (status === "wrong"   && outroMode !== "invalid") setOutroMode("invalid");
    if (status === "idle"    && outroMode) { setOutroMode(null); }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!unlocked && !lockState.locked) inputRef.current?.focus();
  }, [unlocked, lockState.locked]);

  // On unlock, check if master code needs to be set — show banner if not
  useEffect(() => {
    if (unlocked && !getMasterCodeHash()) {
      const code = generateMasterCode();
      setMasterBannerCode(code);
    }
  }, [unlocked]);

  const refreshLock = useCallback(() => setLockState(getLockState()), []);

  // Fire-and-forget access log POST to server (captures real IP + UA server-side)
  const logAccess = useCallback((event, codePartial) => {
    try {
      fetch('/api/access-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, code_partial: codePartial || null }),
      }).then(r => r.json()).then(d => console.log('[access-log]', event, d)).catch(e => console.warn('[access-log] POST failed', e));
    } catch {}
  }, []);

  // Log unauthenticated app hit once per browser session
  useEffect(() => {
    if (unlocked) return;
    const SESSION_KEY = 'prospector_access_attempt_logged';
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');
    logAccess('attempt', null);
  }, [unlocked, logAccess]);

  // Log returning user session (already unlocked via localStorage) once per browser session
  useEffect(() => {
    if (!unlocked) return;
    const SESSION_KEY = 'prospector_session_logged';
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');
    logAccess('session', null);
  }, [unlocked, logAccess]);

  const attempt = useCallback((raw) => {
    const upper = raw.trim().toUpperCase();
    if (!upper) return;
    setStatus("checking");

    setTimeout(() => {
      const grantAccess = () => {
        if (!localStorage.getItem("prospector_user_id")) {
          try { localStorage.setItem("prospector_user_id", crypto.randomUUID()); } catch {}
        }
        clearAttempts();
        setStatus("granted");
        setErrorMsg("Access Granted ⛏️");
        try { localStorage.setItem(GATE_KEY, "true"); } catch {}
        // Wait for the success typewriter (~1200ms type + 800ms pause) before fading out.
        setTimeout(() => { setFadeOut(true); setTimeout(() => setUnlocked(true), 600); }, 2000);
      };

      // ── 1. Per-invite code ──────────────────────────────────────────────
      const invite = isValidCode(upper);
      if (invite) {
        redeemInvite(upper, "");
        try { localStorage.setItem("prospector_pending_role", invite.role); } catch {}
        // Seed email + stable UUID from invite if not already set
        try {
          const inviteEmail = invite.email?.toLowerCase() || null;
          if (inviteEmail && !localStorage.getItem("prospector_user_email")) {
            localStorage.setItem("prospector_user_email", inviteEmail);
          }
          if (!localStorage.getItem("prospector_user_id")) {
            localStorage.setItem("prospector_user_id", crypto.randomUUID());
          }
        } catch {}
        logAccess('success', upper.slice(0, upper.indexOf('-') + 1) + '****');
        grantAccess(); return;
      }

      // ── 2. Master code ──────────────────────────────────────────────────
      if (checkMasterCode(upper)) { logAccess('success', 'MASTER'); grantAccess(); return; }

      // ── 3. Legacy env-var codes ─────────────────────────────────────────
      if (legacyCodes().includes(upper)) { logAccess('success', upper.slice(0, 4) + '-****'); grantAccess(); return; }

      // ── 4. Wrong ────────────────────────────────────────────────────────
      const prev     = loadAttempts();
      const newCount = (prev.count || 0) + 1;

      if (newCount >= MAX_ATTEMPTS) {
        const lockedUntil = Date.now() + LOCKOUT_MS;
        saveAttempts({ count: newCount, lockedUntil });
        setStatus("idle");
        setInput("");
        setLockState({ locked: true, lockedUntil, count: newCount });
      } else {
        saveAttempts({ count: newCount });
        const remaining = MAX_ATTEMPTS - newCount;
        setErrorMsg(remaining === 1
          ? "1 attempt remaining before lockout"
          : `Invalid code — ${remaining} attempts remaining`);
        setStatus("wrong");
        setTimeout(() => { setStatus("idle"); setInput(""); inputRef.current?.focus(); }, 1200);
      }
    }, 1000);
  }, []);

  const handleKeyDown = (e) => {
    if (status === "checking" || status === "granted") return;
    if (e.key === "Enter") {
      const val = input.trim();
      if (val.length >= 4) attempt(val);
    }
  };

  const handleChange = (e) => {
    if (status === "checking" || status === "granted") return;
    const val = e.target.value
      .replace(/[^a-zA-Z0-9\-]/g, "")
      .toUpperCase()
      .slice(0, 20);
    setInput(val);
  };

  const handlePaste = (e) => {
    if (status === "checking" || status === "granted") return;
    e.preventDefault();
    const pasted = e.clipboardData.getData("text")
      .replace(/[^a-zA-Z0-9\-]/g, "")
      .toUpperCase()
      .slice(0, 12);
    setInput(pasted);
    if (pasted.length >= 4) setTimeout(() => attempt(pasted), 50);
  };

  // ── Unlocked state ─────────────────────────────────────────────────────────
  // /join/:code visitors are members joining a specific business, not Jack -
  // they never see the invite-code screen, onboarding, or approval gate
  // (business-lists-and-permissions-v1). App.js handles the code itself.
  // hasMemberSession (not just isJoinLink) matters because App.js replaces
  // the URL back to "/" right after joining - this component's own intro
  // typewriter effect re-renders it independently every ~40ms regardless of
  // unlocked/bypass state, so isJoinLink alone would flip false on the very
  // next tick and this would render the lock screen over an active member
  // session (confirmed live: the pickaxe screen replaced MemberShell).
  const isJoinLink = (() => { try { return window.location.pathname.startsWith('/join/'); } catch { return false; } })();
  const hasMemberSession = (() => { try { return !!localStorage.getItem('prospector_member'); } catch { return false; } })();
  if (unlocked || isJoinLink || hasMemberSession) {
    return (
      <>
        {unlocked && masterBannerCode && (
          <MasterCodeBanner
            code={masterBannerCode}
            copied={bannerCopied}
            onCopy={() => {
              navigator.clipboard.writeText(masterBannerCode).catch(() => {});
              setBannerCopied(true);
              setTimeout(() => setBannerCopied(false), 1500);
            }}
            onDismiss={() => {
              setMasterCode(masterBannerCode);
              setMasterBannerCode(null);
            }}
          />
        )}
        {children}
      </>
    );
  }

  // ── Gate screen ────────────────────────────────────────────────────────────
  const isWrong       = status === "wrong";
  const isGranted     = status === "granted";
  const isChecking    = status === "checking";
  const isLastWarning = !lockState.locked && lockState.count === MAX_ATTEMPTS - 1;

  return (
    <div style={{
      position:"fixed", inset:0, background:"#050f05",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      fontFamily:"'Courier New', Courier, monospace",
      opacity: fadeOut ? 0 : 1,
      transition: fadeOut ? "opacity 0.6s ease" : "none",
      zIndex: 99999,
    }}>
      <style>{`
        @keyframes pickaxeSpin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
        @keyframes mineCursor { 0%,49% { opacity:1;} 50%,100% { opacity:0;} }
        .mine-spin { animation: pickaxeSpin 1.5s linear infinite; display: inline-block; transform-style: preserve-3d; }
        @keyframes goldPulse {
          0%, 100% { filter: drop-shadow(0 0 8px #D4A96A88); }
          50%       { filter: drop-shadow(0 0 22px #D4A96Acc) drop-shadow(0 0 40px #D4A96A44); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15%  { transform: translateX(-8px); }
          30%  { transform: translateX(8px); }
          45%  { transform: translateX(-6px); }
          60%  { transform: translateX(6px); }
          75%  { transform: translateX(-3px); }
          90%  { transform: translateX(3px); }
        }
        @keyframes greenFlash {
          0%   { box-shadow: 0 0 0px #5EB46E00; }
          40%  { box-shadow: 0 0 30px #5EB46E66; }
          100% { box-shadow: 0 0 8px #5EB46E22; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        .gate-pickax     { animation: goldPulse 2.4s ease-in-out infinite; }
        .gate-shake      { animation: shake 0.5s ease; }
        .gate-flash      { animation: greenFlash 0.8s ease forwards; }
        .gate-checking   { animation: pulse 0.9s ease-in-out infinite; }
        .gate-input {
          width: 260px;
          height: 48px;
          background: #050f05;
          border: 1.5px solid #1a3a1a;
          border-radius: 6px;
          color: #cfe8d4;
          font-size: 18px;
          font-family: 'Courier New', Courier, monospace;
          font-weight: 700;
          text-align: center;
          letter-spacing: 0.14em;
          outline: none;
          caret-color: #39FF14;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .gate-input:focus   { border-color: #39FF14; box-shadow: 0 0 0 2px #39FF1422, 0 0 18px #39FF1433; }
        .gate-input.wrong   { border-color: #FF4444 !important; box-shadow: 0 0 0 2px #FF444433 !important; }
        .gate-input.warn    { border-color: #FFB800 !important; box-shadow: 0 0 0 2px #FFB80022 !important; }
        .gate-input.granted { border-color: #39FF14 !important; box-shadow: 0 0 16px #39FF1466 !important; }
        .gate-input:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>

      {/* Spinning pickaxe */}
      <div style={{ marginBottom:24, fontSize:56, filter:"drop-shadow(0 0 14px #39FF14) drop-shadow(0 0 28px #39FF1488)" }}>
        <span className="mine-spin">⛏</span>
      </div>

      {/* Typewriter intro */}
      <pre style={{
        margin:"0 0 28px",
        fontFamily:"'Courier New', Courier, monospace",
        fontSize:13,
        lineHeight:1.7,
        color:"#39FF14",
        textShadow:"0 0 6px #39FF1455",
        whiteSpace:"pre",
        textAlign:"center",
        minHeight:160,
        letterSpacing:"0.08em",
      }}>
        {introText}
        {!introDone && <span style={{ color:"#39FF14", animation:"mineCursor 1s steps(2) infinite" }}>▊</span>}
      </pre>

      {/* Lockout OR input — input is hidden until intro typewriter completes */}
      {lockState.locked ? (
        <LockoutScreen lockedUntil={lockState.lockedUntil} onExpired={refreshLock} />
      ) : introDone ? (
        <>
          <div
            className={isWrong ? "gate-shake" : isGranted ? "gate-flash" : isChecking ? "gate-checking" : ""}
            style={{ marginBottom:14, display:"flex", alignItems:"center", gap:8 }}
          >
            <span style={{ color:"#39FF14", fontSize:18, fontFamily:"'Courier New', Courier, monospace" }}>{`>`}</span>
            <input
              ref={inputRef}
              className={`gate-input${isWrong ? " wrong" : isGranted ? " granted" : isLastWarning ? " warn" : ""}`}
              type="text"
              placeholder="GOLD-0000"
              value={input}
              disabled={isChecking || isGranted}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* Submit hint */}
          {input.length >= 4 && !isChecking && !isGranted && (
            <div style={{ marginBottom:6 }}>
              <button
                onClick={() => attempt(input)}
                style={{ fontFamily:"inherit", fontSize:12, padding:"6px 18px", background:"#39FF1418", border:"1px solid #39FF1455", color:"#39FF14", borderRadius:5, cursor:"pointer", letterSpacing:"0.06em", textShadow:"0 0 6px #39FF1466" }}>
                ENTER →
              </button>
            </div>
          )}

          {/* Status — typewriter outro for granted/wrong, static for others */}
          <div style={{
            minHeight:20, fontSize:13, letterSpacing:"0.08em", fontWeight:700,
            color: isGranted  ? "#39FF14"
                 : isChecking ? "#5a6a5a"
                 : isWrong    ? "#FF4444"
                 : lockState.count === MAX_ATTEMPTS - 1 ? "#FFB800"
                 : "transparent",
            textShadow: isGranted ? "0 0 8px #39FF1466" : isWrong ? "0 0 8px #FF444466" : "none",
            transition:"color 0.2s",
            fontFamily:"'Courier New', Courier, monospace",
          }}>
            {(isGranted || isWrong) ? outroText
              : isChecking ? "VERIFYING…"
              : lockState.count === MAX_ATTEMPTS - 1 ? "1 ATTEMPT REMAINING BEFORE LOCKOUT"
              : "·"}
          </div>
        </>
      ) : null}

      {/* Bottom hint */}
      <div style={{ position:"absolute", bottom:28, fontSize:10, color:"#1a3a1a", letterSpacing:"0.08em", fontFamily:"'Courier New', Courier, monospace" }}>
        CONTACT YOUR REP FOR ACCESS
      </div>
    </div>
  );
}
