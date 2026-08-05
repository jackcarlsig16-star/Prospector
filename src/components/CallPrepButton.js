import React from 'react';
import { C, mono } from '../constants/colors';

// Single source of truth for the Call Prep trigger. Iridescent gradient
// border = the app's "intelligent action" signal. Identical on calendar
// events and account cards; props differ, appearance does not.
//
// The two hex accents (#8b5cf6 violet, #22d3ee cyan) are confined to this
// one border — vivid by intent. Do not adopt them elsewhere; if other AI
// actions want the same cue, extract the gradientBorder style here.
export default function CallPrepButton({ onClick, disabled = false, size = 'md' }) {
  const pad = size === 'sm' ? '4px 10px' : '5px 13px';
  const fs  = size === 'sm' ? 10 : 11;

  const gradientBorder = {
    background:
      `linear-gradient(${C.card}, ${C.card}) padding-box, ` +
      `linear-gradient(135deg, ${C.gold}, #8b5cf6, #22d3ee) border-box`,
    border: '1px solid transparent',
  };
  const disabledStyle = {
    background: 'transparent',
    border: `1px solid ${C.brd}`,
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...mono, fontSize: fs, padding: pad, borderRadius: 5,
        color: disabled ? C.dim : C.gold,
        fontWeight: disabled ? 400 : 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        whiteSpace: 'nowrap',
        ...(disabled ? disabledStyle : gradientBorder),
      }}>
      ✦ Call Prep
    </button>
  );
}
