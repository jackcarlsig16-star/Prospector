// hkos-gmail-connect-v1 (G8 composer) - what the composer may do, pure and Jest-tested.
export const KIND_OPTIONS = [['cold', 'Cold pitch'], ['bump', 'Bump'], ['final', 'Final nudge'], ['reply', 'Reply']];
export const kindsAvailable = touches => { const hasSent = (touches || []).some(t => t.state === 'sent' && t.channel === 'email'); return KIND_OPTIONS.filter(([k]) => k === 'cold' || hasSent).map(([k]) => k); };
export const subjectFor = (format, brandName) => String(format || 'HumanKind x [Brand] - [descriptor]').replace('[Brand]', brandName || '').replace(' - [descriptor]', ' - ').replace('[descriptor]', '');
export const contactWithEmail = contacts => (contacts || []).find(c => c.is_primary && c.email) || (contacts || []).find(c => c.email) || null;
// Save is open only after a lint pass with no rejects, on the text that was linted, with a recipient.
export function canSave({ linted, problems, lintedText, currentText, hasRecipient }) {
  if (!hasRecipient) return { ok: false, why: 'No contact with an email yet. Add one under Contacts.' };
  if (!linted) return { ok: false, why: 'Run lint first.' };
  if (lintedText !== currentText) return { ok: false, why: 'The text changed since the last lint. Run lint again.' };
  const rejects = (problems || []).filter(p => p.level !== 'warn');
  if (rejects.length) return { ok: false, why: `${rejects.length} rule${rejects.length === 1 ? '' : 's'} to fix first.` };
  return { ok: true, why: null };
}
