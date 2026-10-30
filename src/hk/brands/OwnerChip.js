import React from 'react';
import { Avatar } from '../HkMarks';

// grow-owner-chip F1 - one owner display for every brand surface. A member owner shows avatar + first name; a sheet
// owner (owner_hint, set by the import for a founder with no Grow account yet) shows as stored text, never mapped to a
// user; only a brand with neither is "Unclaimed".
export const sheetOwnerLabel = hint => { const h = String(hint).trim(); return `Sheet: ${h[0].toUpperCase()}${h.slice(1)} · not in Grow yet`; };

export default function OwnerChip({ owner, hint, size = 22, chip = false }) {
  if (owner) return <span className={chip ? 'hk-chip hk-chip--grey' : 'hk-owner'} data-hk-owner="member"><Avatar name={owner.first_name} index={owner.palette_index || 1} size={size} />{chip ? ' ' : null}{owner.first_name}</span>;
  if (hint && String(hint).trim()) return <span className={chip ? 'hk-chip hk-chip--grey' : 'hk-meta'} data-hk-owner="sheet">{sheetOwnerLabel(hint)}</span>;
  return <span className={chip ? 'hk-chip hk-chip--grey' : 'hk-meta'} data-hk-owner="none">Unclaimed</span>;
}
