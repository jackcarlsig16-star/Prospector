import { getCachedTopContact, getCachedAlternateContacts } from './hunter';

export function getDefaultOutbound(acc = {}) {
  return {
    sourceAccountId: acc.id || null,
    addedFromOutboundClickAt: new Date().toISOString(),
    topContact: getCachedTopContact(acc.web) || null,
    alternateContacts: getCachedAlternateContacts(acc.web) || [],
    cadence: {
      state: 'cold',
      sequenceId: null,
      currentStepIdx: 0,
      steps: [],
      lastReplyAt: null,
      replyClassification: null,
    },
    manualTriggers: [],
    notes: '',
    promotedAt: null,
    promotedBy: null,
  };
}

export function migrateOutboundEntry(entry) {
  if (entry.outbound) return entry;
  return { ...entry, outbound: getDefaultOutbound({ id: entry.id, web: entry.web }) };
}

// Match the frontier entry to an account either by stored sourceAccountId or
// by name (fallback for legacy entries migrated without an id).
function findSourceAccount(entry, accounts = []) {
  const sid = entry.outbound?.sourceAccountId;
  if (sid) {
    const byId = accounts.find(a => a.id === sid);
    if (byId) return byId;
  }
  return accounts.find(a => (a.name || '').toLowerCase() === (entry.name || '').toLowerCase()) || null;
}

export function promoteToAE(frontierEntry, { accounts = [], setAccounts, setFrontier, onCreateTask, activeUser } = {}) {
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const due = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const src = findSourceAccount(frontierEntry, accounts);
  const targetId = src?.id || null;

  if (targetId && setAccounts) {
    setAccounts(prev => prev.map(a => a.id === targetId
      ? { ...a, stage: 'Engaged', last: today, lastIntelAt: now }
      : a));
  }

  if (setFrontier) {
    setFrontier(prev => prev.map(f => f.id === frontierEntry.id
      ? { ...f, outbound: { ...f.outbound, cadence: { ...f.outbound?.cadence, state: 'booked' }, promotedAt: now, promotedBy: activeUser?.id || null } }
      : f));
  }

  onCreateTask?.({
    id: Date.now(),
    title: `Discovery call with ${frontierEntry.outbound?.topContact?.firstName
      ? `${frontierEntry.outbound.topContact.firstName} ${frontierEntry.outbound.topContact.lastName || ''}`.trim()
      : frontierEntry.name}`,
    accId: targetId,
    accName: frontierEntry.name,
    type: 'Discovery',
    priority: 'High',
    dueDate: due,
    status: 'Open',
    source: 'outbound_promotion',
    createdAt: now,
    by: activeUser?.name || null,
    byId: activeUser?.id || null,
  });
}

// Color for the left edge dot + active accents on the OutboundCard.
export const CADENCE_C = {
  cold:          '#555566',
  in_sequence:   '#00F5FF',
  reply_waiting: '#FFB800',
  replied:       '#FFD700',
  booked:        '#39FF14',
  stalled:       '#FF4444',
  paused:        '#7A7A7A',
};

export const CADENCE_LABEL = {
  cold:          'Cold',
  in_sequence:   'In sequence',
  reply_waiting: 'Reply waiting',
  replied:       'Replied',
  booked:        'Booked',
  stalled:       'Stalled',
  paused:        'Paused',
};

// Bucket key for FrontierPage stacks — order matters for display:
// reply_waiting (NEEDS REPLY) → in_sequence-due (TOUCH TODAY) → in_sequence (IN SEQUENCE) → cold (COLD).
export function bucketFor(entry) {
  const c = entry.outbound?.cadence || {};
  const state = c.state || 'cold';
  if (state === 'reply_waiting') return 'reply';
  if (state === 'booked') return 'booked';
  if (state === 'in_sequence') {
    const next = (c.steps || []).find(s => !s.sentAt);
    const planned = next?.plannedAt || null;
    if (planned && planned <= new Date().toISOString().slice(0, 10)) return 'today';
    return 'sequence';
  }
  if (state === 'cold') return 'cold';
  return 'sequence';
}
