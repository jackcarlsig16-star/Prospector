import { mono } from '../../constants/colors';
import { CARD, RADIUS } from './tokens';

// generation-modal-advanced-inputs-v1 — the inputs the engine already
// composes with (CONTEXT_PROVIDERS, generation-engine-consolidation-v1),
// made visible/reviewable instead of resolving silently. Read-only for
// Account Intel and Company Intel (editing those belongs on the account
// card / Business Intel & Strategy page, not here) - Voice is a real
// functional override.
//
// generation-modal-project-promotion-and-visual-pass-v1 Change 1 - Project
// moved out of here into EmailModal.js's default (non-Advanced) view. It
// was core interaction (a real one-off assignment with real side effects,
// per Bug 1/2 of that spec), not optional/secondary complexity - this
// panel is genuinely reference/secondary material now: Account Intel,
// Voice, Company Intel.

const secLbl = (color) => ({ ...mono, fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' });
const offText = { ...mono, fontSize: 11, color: CARD.textSubtle, fontStyle: 'italic', margin: 0 };
const body = { ...mono, fontSize: 11, color: CARD.textSecondary, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' };

function Section({ children }) {
  return <div style={{ marginBottom: 20 }}>{children}</div>;
}

export default function AdvancedGenerationPanel({
  accountIntelText,
  voiceProfile, voiceEnabled, onToggleVoice,
  businessProfileSummary, loadingBusinessProfile, businessName,
}) {
  return (
    <div style={{ width: 320, flexShrink: 0 }}>

      {/* ── ACCOUNT INTEL — read-only, real content ── */}
      <Section>
        <span style={secLbl(CARD.textSecondary)}>◆ Account Intel</span>
        {accountIntelText ? (
          <div style={{ background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.md, padding: '10px 12px', maxHeight: 140, overflowY: 'auto' }}>
            <p style={body}>{accountIntelText}</p>
          </div>
        ) : (
          <p style={offText}>No stored context for this account yet</p>
        )}
      </Section>

      {/* ── VOICE — real toggle, not display-only text ── */}
      <Section>
        <span style={secLbl(CARD.textSecondary)}>◈ Voice</span>
        {voiceProfile ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.md, padding: '10px 12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ ...mono, fontSize: 11, color: CARD.textPrimary, margin: '0 0 3px', fontWeight: 600 }}>
                {(voiceProfile.keyTraits || []).slice(0, 3).join(', ') || voiceProfile.tone || 'trained voice'}
              </p>
              <p style={{ ...mono, fontSize: 10, color: CARD.textMuted, margin: 0 }}>
                Tone: {voiceProfile.tone || '—'} · {voiceProfile.avgSentenceLength || '—'} sentences
              </p>
            </div>
            <button onClick={onToggleVoice} title={voiceEnabled ? 'Voice is on — click to generate without it' : 'Voice is off — click to use it'}
              style={{ ...mono, fontSize: 10, padding: '4px 10px', flexShrink: 0, borderRadius: RADIUS.sm, cursor: 'pointer',
                background: voiceEnabled ? `${CARD.textPrimary}12` : 'transparent',
                border: `1px solid ${voiceEnabled ? CARD.borderStrong : CARD.border}`,
                color: voiceEnabled ? CARD.textPrimary : CARD.textMuted }}>
              {voiceEnabled ? '✓ On' : 'Off'}
            </button>
          </div>
        ) : (
          <p style={offText}>No trained voice yet — using generic voice rules</p>
        )}
      </Section>

      {/* ── COMPANY INTEL — read-only reference, editing lives elsewhere ── */}
      <Section>
        <span style={secLbl(CARD.textSecondary)}>◎ Company Intel</span>
        {loadingBusinessProfile ? (
          <p style={offText}>Loading…</p>
        ) : businessProfileSummary?.assay_criteria || businessProfileSummary?.outreach_rules ? (
          <div style={{ background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.md, padding: '10px 12px' }}>
            {businessProfileSummary?.assay_criteria?.fit_signals && (
              <p style={{ ...body, marginBottom: 6 }}><span style={{ color: CARD.textMuted }}>Fit signals: </span>{businessProfileSummary.assay_criteria.fit_signals}</p>
            )}
            {businessProfileSummary?.outreach_rules?.tone && (
              <p style={{ ...body, marginBottom: businessProfileSummary?.outreach_rules?.key_points ? 6 : 0 }}><span style={{ color: CARD.textMuted }}>Tone: </span>{businessProfileSummary.outreach_rules.tone}</p>
            )}
            {businessProfileSummary?.outreach_rules?.key_points && (
              <p style={{ ...body, margin: 0 }}><span style={{ color: CARD.textMuted }}>Key points: </span>{businessProfileSummary.outreach_rules.key_points}</p>
            )}
          </div>
        ) : (
          <p style={offText}>No business-level criteria generated yet{businessName ? ` for ${businessName}` : ''}</p>
        )}
      </Section>
    </div>
  );
}
