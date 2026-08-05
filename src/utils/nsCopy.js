// Shared helpers for the "Copy SFDC Update / NS" prompt
import { getValidGmailToken } from './getValidGmailToken';

export async function fetchSentEmailsForAccount(accName) {
  const token = await getValidGmailToken();
  if (!token || !accName) return [];
  try {
    const q = encodeURIComponent(`in:sent "${accName}" newer_than:30d`);
    const listRes = await fetch(`/proxy/gmail/messages?q=${q}&maxResults=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) return [];
    const listData = await listRes.json();
    if (!listData.messages?.length) return [];
    const msgs = await Promise.all(
      listData.messages.slice(0, 3).map(async ({ id }) => {
        const r = await fetch(`/proxy/gmail/message/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return r.json();
      })
    );
    return msgs.filter(m => m?.id).map(m => {
      const headers = m.payload?.headers || [];
      const getH = n => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
      const dateStr = getH('Date');
      const subject = getH('Subject');
      const snippet = (m.snippet || '').slice(0, 150);
      const dateFmt = dateStr
        ? (() => { const d = new Date(dateStr); return `${d.getMonth()+1}/${d.getDate()}`; })()
        : '?';
      return `[${dateFmt}] "${subject}" — ${snippet}`;
    });
  } catch { return []; }
}

export function buildNsPrompt({ acc, tasks, activeUser, sentEmails, todayFmt, todayISO, twoWeeksOut }) {
  const nsGetText  = ns => typeof ns === 'string' ? ns : (ns?.text || '');
  const nsGetDue   = ns => typeof ns === 'object' ? ns?.dueDate : null;
  const nsGetOwner = ns => typeof ns === 'object' ? ns?.owner : null;

  const sortedCalls = [...(acc.calls || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentCall  = sortedCalls[0];
  const contact     = recentCall?.contact?.name || '';

  const recentNS = (recentCall?.nextSteps || []).map(ns => {
    const owner = nsGetOwner(ns); const due = nsGetDue(ns);
    return `${owner ? owner + ': ' : ''}${nsGetText(ns)}${due ? ' (due ' + due + ')' : ''}`;
  }).join('; ');

  const committedActions = (recentCall?.committedActions || [])
    .map(a => typeof a === 'string' ? a : a?.text || '')
    .filter(Boolean).join('; ');

  const accTasks    = (tasks || []).filter(t => t.accId === acc.id && t.status !== 'Done');
  const futureTasks = accTasks.filter(t => !t.dueDate || t.dueDate >= todayISO);
  const futureNS    = (recentCall?.nextSteps || []).filter(ns => { const d = nsGetDue(ns); return !d || d >= todayISO; });
  const tasksText   = accTasks.slice(0, 6).map(t => `${t.title}${t.dueDate ? ' (due ' + t.dueDate + ')' : ''}`).join('; ');
  const futureItemsText = [
    ...futureNS.map(ns => `${nsGetText(ns)}${nsGetDue(ns) ? ' (due ' + nsGetDue(ns) + ')' : ''}`),
    ...futureTasks.slice(0, 4).map(t => `${t.title}${t.dueDate ? ' (due ' + t.dueDate + ')' : ''}`),
  ].join('; ');

  const aeFullName  = activeUser?.name || 'AE';
  const aeFirst     = aeFullName.split(' ')[0];
  const aeInitials  = aeFullName.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'AE';
  const sentText    = sentEmails.length ? sentEmails.join('\n') : '(none found)';

  return {
    aeInitials,
    prompt: `You are writing a Salesforce next steps update for AE ${aeInitials} (${aeFullName}).
TODAY IS ${todayFmt}. The main update line MUST start with exactly "${todayFmt}".

Account: ${acc.name}${contact ? ' | Contact: ' + contact : ''}${acc.vert ? ' | Vertical: ' + acc.vert : ''}

RECENT SENT EMAILS from ${aeFullName} — use to determine what is already done:
${sentText}

Most recent call next steps:
${recentNS || '(none)'}

Committed actions from last call:
${committedActions || '(none)'}

Upcoming tasks / future next steps:
${futureItemsText || '(none — use ~2 weeks from today as NS date)'}

Open action items:
${tasksText || '(none)'}

PERSPECTIVE RULES — critical:
- ${aeFullName} is the AE. Write about them in third person.
- If an action appears in sent emails → it is DONE: use "sent", "shared", "introduced", "followed up" — NEVER "will send"
- For pending prospect actions → use "awaiting [first name] to..."
- Never say "${aeFirst} will..." for something already done
- NS line: forward-looking only, one sentence, 10 words or less, include a future date if one exists in context

Output EXACTLY these two lines and nothing else:
${todayFmt} - ${aeInitials} - Next steps: [2-3 sentences — current situation, completed AE actions in past tense, pending prospect actions as "awaiting [name] to...". Reference people by first name. Dense but readable.]
NS - [future M/D, must be on or after ${todayFmt}, default ${twoWeeksOut} if none] - [one sentence, ≤10 words, e.g. "awaiting Nathan's feedback, scheduling commercial call."]

Format rules: M/D with no leading zero, no year. Two lines only. NS date must be future, never past.`,
  };
}
