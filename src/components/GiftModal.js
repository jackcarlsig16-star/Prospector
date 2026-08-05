import React, { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { MODELS } from '../config/models';
import WinReasonPanel from './WinReasonPanel';
import { loadWinReason } from '../utils/winReasons';

const KRAKEN_URL = "https://www.tervis.com/nhl-seattle-kraken-all-over-24oz-tumbler-1452861.html";

function buildIntelText(acc) {
  const parts = [];
  (acc.calls || []).forEach(c => {
    if (c.summary) parts.push(c.summary);
    if (c.notes) parts.push(c.notes);
    (c.painPoints || []).forEach(p => parts.push(typeof p === 'string' ? p : p?.topic || ''));
    (c.nextSteps || []).forEach(ns => parts.push(typeof ns === 'string' ? ns : ns?.text || ''));
  });
  if (acc.medpicc) Object.values(acc.medpicc).forEach(v => { if (v) parts.push(v); });
  if (acc.notes) parts.push(acc.notes);
  return parts.filter(Boolean).join(' ');
}

function getInitialAddress(acc) {
  if (acc.gift?.address) return acc.gift.address;
  if (acc.shippingAddress) return acc.shippingAddress;
  try {
    const pi = JSON.parse(localStorage.getItem("prospector_pricing_intel") || "{}");
    const d = pi[acc.id];
    if (d?.shippingAddress) return d.shippingAddress;
  } catch {}
  return '';
}

export default function GiftModal({ acc, onClose, onUpdate, userName }) {
  const contact = acc.personas?.[0]?.name || '';
  const prods = (acc.prods || []).join(', ') || 'our product';
  const isSent = acc.gift?.status === 'sent';

  const [address, setAddress] = useState(getInitialAddress(acc));
  const [emailDraft, setEmailDraft] = useState(acc.gift?.email || '');
  const [emailLoading, setEmailLoading] = useState(!acc.gift?.email);
  const [emailCopied, setEmailCopied] = useState(false);
  const [signal, setSignal] = useState(acc.gift?.signal !== undefined ? acc.gift.signal : undefined);
  const [signalLoading, setSignalLoading] = useState(acc.gift?.signal === undefined);

  // Detect personal signal from intel text
  useEffect(() => {
    if (acc.gift?.signal !== undefined) return;
    const text = buildIntelText(acc);
    if (!text.trim()) { setSignalLoading(false); return; }
    (async () => {
      try {
        const r = await fetch('/proxy/anthropic/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODELS.FAST,
            max_tokens: 80,
            messages: [{ role: 'user', content: `From these account notes, extract ONE personal signal (favorite sports team, sport, hobby, or city) if explicitly mentioned. Reply with JSON only: {"name": "Michigan football", "searchTerm": "Michigan football gift"} or {"name": null} if nothing found.\n\nNotes: ${text.slice(0, 1500)}` }]
          })
        });
        const d = await r.json();
        const txt = d.content?.[0]?.text || '';
        const match = txt.match(/\{[^}]+\}/);
        if (match) {
          const obj = JSON.parse(match[0]);
          setSignal(obj.name ? obj : null);
        } else { setSignal(null); }
      } catch { setSignal(null); }
      setSignalLoading(false);
    })();
  }, []); // eslint-disable-line

  // Generate congratulatory email
  useEffect(() => {
    if (acc.gift?.email) return;
    setEmailLoading(true);
    (async () => {
      try {
        const r = await fetch('/proxy/anthropic/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODELS.FAST,
            max_tokens: 220,
            messages: [{ role: 'user', content: `Write a warm 3-4 sentence congratulations email from ${userName || 'AE'} to ${contact || 'the team'} at ${acc.name}. Celebrate closing the deal. Mention what they are building with ${prods}. Say a small gift is on its way as a token of appreciation. Warm but brief — subject line first, then email body. No placeholder brackets.` }]
          })
        });
        const d = await r.json();
        setEmailDraft(d.content?.[0]?.text || '');
      } catch { setEmailDraft(''); }
      setEmailLoading(false);
    })();
  }, []); // eslint-disable-line

  const shoppingUrl = signal?.searchTerm
    ? `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(signal.searchTerm)}`
    : KRAKEN_URL;

  const save = (status) => {
    onUpdate && onUpdate({
      ...acc,
      gift: {
        status,
        address,
        email: emailDraft,
        signal: signal ?? null,
        ...(status === 'sent'
          ? { sentAt: new Date().toISOString(), contact }
          : { savedAt: new Date().toISOString() })
      }
    });
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.76)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, maxHeight: '90vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.gold}55`, borderRadius: 12, padding: '22px 24px', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <p style={{ ...mono, margin: '0 0 4px', fontSize: 11, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>🎉 Closed Won — {acc.name}</p>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.txt, lineHeight: 1.3 }}>
              🎁 Send a gift to {contact || 'your contact'} at {acc.name}?
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        {isSent && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: `${C.green}14`, border: `1px solid ${C.green}44`, borderRadius: 7 }}>
            <p style={{ ...mono, margin: 0, fontSize: 12, color: C.green }}>✓ Gift marked as sent{acc.gift.sentAt ? ` on ${new Date(acc.gift.sentAt).toLocaleDateString()}` : ''}
              {acc.gift.contact ? ` to ${acc.gift.contact}` : ''}</p>
          </div>
        )}

        {/* Address */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Is this address correct?</p>
          <textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Enter shipping address."
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '8px 10px', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 6, color: C.txt, outline: 'none', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Gift recommendation */}
        <div style={{ marginBottom: 16, padding: '10px 12px', background: `${C.gold}0a`, border: `1px solid ${C.gold}33`, borderRadius: 7 }}>
          <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Gift Recommendation</p>
          {signalLoading ? (
            <p style={{ ...mono, fontSize: 12, color: C.dim, margin: 0 }}>Scanning notes for personal signals…</p>
          ) : signal?.name ? (
            <p style={{ margin: 0, fontSize: 13, color: C.txt, lineHeight: 1.6 }}>
              Based on your notes, {contact || 'they'} mentioned <strong style={{ color: C.gold }}>{signal.name}</strong> — consider a related gift.{' '}
              <a href={shoppingUrl} target="_blank" rel="noreferrer" style={{ color: C.blue, textDecoration: 'none' }}>Browse {signal.name} gifts →</a>
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: C.txt, lineHeight: 1.6 }}>
              No personal signals found — default: Seattle Kraken tumbler.{' '}
              <a href={KRAKEN_URL} target="_blank" rel="noreferrer" style={{ color: C.blue, textDecoration: 'none' }}>View gift →</a>
            </p>
          )}
        </div>

        {/* Email draft */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <p style={{ ...mono, margin: 0, fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Congrats Email Draft</p>
            {emailLoading && <span style={{ ...mono, fontSize: 11, color: C.purple }}>generating…</span>}
            {!emailLoading && emailDraft && (
              <button
                onClick={() => { navigator.clipboard.writeText(emailDraft); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000); }}
                style={{ ...mono, fontSize: 10, padding: '1px 8px', background: emailCopied ? `${C.green}18` : 'transparent', border: `1px solid ${emailCopied ? C.green : C.brd}`, color: emailCopied ? C.green : C.mut, borderRadius: 3, cursor: 'pointer', marginLeft: 'auto' }}
              >{emailCopied ? '✓ Copied' : '📋 Copy'}</button>
            )}
          </div>
          {emailLoading ? (
            <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 6 }}>
              <span style={{ ...mono, fontSize: 12, color: C.purple }}>⬡ generating…</span>
            </div>
          ) : (
            <textarea
              value={emailDraft}
              onChange={e => setEmailDraft(e.target.value)}
              rows={6}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '8px 10px', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 6, color: C.txt, outline: 'none', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6 }}
            />
          )}
        </div>

        {/* Win Reason — 4th parallel Claude call, fires alongside gift content */}
        <WinReasonPanel acc={acc} initial={loadWinReason(acc.id)} embedded />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => save('pending')} style={{ flex: 1, ...mono, fontSize: 12, padding: '9px 0', background: 'transparent', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 6, cursor: 'pointer' }}>Save for later →</button>
          <button onClick={() => save('sent')} style={{ flex: 1, ...mono, fontSize: 12, padding: '9px 0', background: `${C.green}14`, border: `1px solid ${C.green}44`, color: C.green, borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Mark as sent ✓</button>
        </div>
      </div>
    </div>
  );
}
