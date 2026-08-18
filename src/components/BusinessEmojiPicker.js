import { useState } from 'react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { C, mono } from '../constants/colors';

// business-emoji-manual-picker-v1 - replaces the AI-picked emoji
// (mis-tagged Kopi Kita as 🫘 instead of ☕). Manual choice, zero ongoing
// compute cost, zero future mis-tag risk. UI-only interaction, no model
// call - the save is a plain field write (api/businesses/emoji-save.js).
export default function BusinessEmojiPicker({ businessId, emoji, onSaved, onClose }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pick = async (emojiData) => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/emoji`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: emojiData.emoji }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data.profile);
      onClose();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', borderRadius: 8, overflow: 'hidden' }}
    >
      <EmojiPicker
        onEmojiClick={pick}
        theme={Theme.DARK}
        autoFocusSearch
        width={300}
        height={360}
        previewConfig={{ showPreview: false }}
      />
      {saving && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ ...mono, fontSize: 12, color: C.gold }}>Saving…</span>
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: C.card, borderTop: `1px solid ${C.red}`, padding: '6px 10px' }}>
          <span style={{ ...mono, fontSize: 11, color: C.red }}>⚠ {error}</span>
        </div>
      )}
    </div>
  );
}
