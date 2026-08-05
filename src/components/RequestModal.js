import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { MODELS } from '../config/models';

function buildSfdcUrl(sfdc) {
  if (!sfdc) return '';
  if (sfdc.startsWith('http')) return sfdc;
  if (/^006[A-Za-z0-9]+/.test(sfdc)) return `https://your-org.lightning.force.com/lightning/r/Opportunity/${sfdc}/view`;
  if (/^001[A-Za-z0-9]+/.test(sfdc)) return `https://your-org.lightning.force.com/lightning/r/Account/${sfdc}/view`;
  return sfdc;
}

function extractSfdcId(sfdc) {
  if (!sfdc) return '';
  const m = sfdc.match(/006[A-Za-z0-9]{12,18}/) || sfdc.match(/001[A-Za-z0-9]{12,18}/);
  return m ? m[0] : (sfdc.startsWith('http') ? '' : sfdc);
}

const SE_FIELDS = [
  { key: 'sales_engineer',      label: "Who's your Sales Engineer?",             source: null,                                                                                     required: true  },
  { key: 'client_name',         label: 'Client Name',                             source: acc => acc.name,                                                                          required: true  },
  { key: 'website',             label: 'Website',                                 source: acc => acc.web || '',                                                                     required: true  },
  { key: 'call_date',           label: 'When is the call?',                       source: null,                                                                                     required: true  },
  { key: 'sfdc_link',           label: 'Salesforce Opportunity',                  source: acc => buildSfdcUrl(acc.sfdc) || '',                                                      required: false },
  { key: 'sfdc_id',             label: 'Salesforce Opportunity ID',               source: acc => extractSfdcId(acc.sfdc),                                                           required: false },
  { key: 'engagement_type',     label: 'Engagement Type',                         source: () => 'Demo',                                                                             required: true  },
  { key: 'products',            label: 'Products',                                source: acc => (acc.prods || []).join(', '),                                                      required: true  },
  { key: 'customer_objective',  label: 'Customer Objective',                      source: acc => acc.medpicc?.identify_pain?.slice(0, 300) || '',                                   required: true  },
  { key: 'agenda',              label: 'Agenda',                                  source: null,                                          generated: true,                           required: false },
  { key: 'prospect_questions',  label: 'Prospect Questions (optional)',            source: acc => (acc.calls?.[0]?.openQuestions || []).slice(0, 5).join('\n') || '',               required: false },
  { key: 'additional_notes',    label: 'Additional Notes (optional)',              source: null,                                                                                     required: false },
];

const CREDIT_FIELDS = [
  { key: 'credit_specialist',   label: 'Who is your Credit Specialist?',          source: null,                                                                                     required: true  },
  { key: 'company_name',        label: 'Company Name',                             source: acc => acc.name,                                                                          required: true  },
  { key: 'website',             label: 'Website',                                  source: acc => acc.web || '',                                                                     required: true  },
  { key: 'sfdc_link',           label: 'Salesforce Opportunity',                   source: acc => buildSfdcUrl(acc.sfdc) || '',                                                      required: false },
  { key: 'sfdc_id',             label: 'SFDC Opportunity ID',                      source: acc => extractSfdcId(acc.sfdc),                                                           required: false },
  { key: 'gong_links',          label: 'Gong links / Call history',                source: acc => (acc.calls || []).slice(0, 3).map(c => `Call ${c.date}: ${(c.summary || '').slice(0, 100)}`).filter(s => s.length > 10).join('\n') || '', required: false },
  { key: 'expected_acv',        label: 'Expected ACV',                             source: acc => acc.acvOverride ? `$${acc.acvOverride.toLocaleString()}` : '',                    required: true  },
  { key: 'customer_objective',  label: 'Customer Objective',            source: acc => acc.medpicc?.identify_pain?.slice(0, 300) || '',                                   required: true  },
  { key: 'call_date',           label: 'When is the call?',                        source: null,                                                                                     required: true  },
  { key: 'how_to_support',      label: 'How can the Credit Team best support you?',source: null,                                          generated: true,                           required: true  },
  { key: 'prospect_questions',  label: 'Prospect Questions (optional)',             source: acc => (acc.calls?.[0]?.openQuestions || []).slice(0, 5).join('\n') || '',               required: false },
  { key: 'additional_notes',    label: 'Additional Notes (optional)',               source: null,                                                                                     required: false },
];

const GENERATE_PROMPTS = {
  agenda: acc => `Write a 3-4 item call agenda for an SE demo with ${acc.name}.
Products: ${(acc.prods || []).join(', ')}
Customer objective: ${acc.medpicc?.identify_pain || 'unknown'}
Last call summary: ${(acc.calls?.[0]?.summary || '').slice(0, 200)}
Format: numbered list, each item one line. No preamble.`,

  how_to_support: acc => `Write 2-3 sentences explaining how the Credit Team can support this deal.
Company: ${acc.name}
Expected ACV: ${acc.acvOverride ? '$' + acc.acvOverride.toLocaleString() : 'unknown'}
Customer objective: ${acc.medpicc?.identify_pain || 'unknown'}
Products: ${(acc.prods || []).join(', ')}
Deal stage: ${acc.stage || 'unknown'}
Be specific about what credit expertise is needed. No preamble.`,
};

async function generateField(fieldKey, acc) {
  const prompt = GENERATE_PROMPTS[fieldKey]?.(acc);
  if (!prompt) return '';
  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

function formatOutput(type, fields, values) {
  const nameKey = type === 'se' ? 'client_name' : 'company_name';
  const header = `${type === 'se' ? 'SE REQUEST' : 'CREDIT REQUEST'} — ${values[nameKey] || 'Unknown'}`;
  const divider = '━'.repeat(Math.max(header.length, 32));
  const lines = [header, divider];
  for (const f of fields) {
    const val = (values[f.key] || '').trim();
    if (!val && !f.required) continue;
    const display = val || '[not provided]';
    if (display.includes('\n')) {
      lines.push(`${f.label}:`);
      lines.push(display);
    } else {
      lines.push(`${f.label}: ${display}`);
    }
  }
  return lines.join('\n');
}

export default function RequestModal({ type, account, isOpen, onClose }) {
  const fields = type === 'se' ? SE_FIELDS : CREDIT_FIELDS;
  const [values, setValues]       = useState({});
  const [generating, setGenerating] = useState(new Set());
  const [copied, setCopied]       = useState(false);

  useEffect(() => {
    if (!isOpen || !account) return;
    const initial = {};
    for (const f of fields) {
      initial[f.key] = f.source ? (f.source(account) || '') : '';
    }
    setValues(initial);
    setCopied(false);

    const genFields = fields.filter(f => f.generated);
    if (!genFields.length) return;
    setGenerating(new Set(genFields.map(f => f.key)));
    genFields.forEach(async f => {
      try {
        const text = await generateField(f.key, account);
        setValues(v => ({ ...v, [f.key]: text }));
      } catch (e) {
        console.error('[RequestModal]', e);
      } finally {
        setGenerating(g => { const n = new Set(g); n.delete(f.key); return n; });
      }
    });
  }, [isOpen, account, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegenerate = async fieldKey => {
    setGenerating(g => new Set([...g, fieldKey]));
    try {
      const text = await generateField(fieldKey, account);
      setValues(v => ({ ...v, [fieldKey]: text }));
    } catch (e) {
      console.error('[RequestModal]', e);
    } finally {
      setGenerating(g => { const n = new Set(g); n.delete(fieldKey); return n; });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(formatOutput(type, fields, values)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isOpen || !account) return null;

  const accent = type === 'se' ? C.blue : C.purple;
  const title  = type === 'se' ? '⚙ SE Request' : '💳 Credit Request';

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: '#000a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: '#0c1117', border: `1px solid ${accent}44`, borderRadius: 10,
        boxShadow: `0 24px 64px #000c, 0 0 0 1px ${accent}18`,
      }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 10, borderRadius: '10px 10px 0 0', background: `${accent}0a` }}>
          <span style={{ ...mono, fontSize: 11, color: accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
          <span style={{ ...mono, fontSize: 11, color: C.txt, flex: 1 }}>{account.name}</span>
          <button onClick={onClose} style={{ fontSize: 16, color: C.dim, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
        </div>

        {/* Fields */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map(f => {
            const val = values[f.key] ?? '';
            const isEmpty = !val.trim();
            const isGen = f.generated;
            const isGenerating = generating.has(f.key);
            const rowCount = isGen ? 4 : val.includes('\n') ? Math.min(val.split('\n').length + 1, 5) : 1;
            return (
              <div key={f.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <label style={{ ...mono, fontSize: 10, color: isEmpty && f.required ? C.red : C.mut }}>
                    {f.label}{f.required ? ' *' : ''}
                  </label>
                  {isGen && (
                    <button onClick={() => handleRegenerate(f.key)} disabled={isGenerating}
                      style={{ ...mono, fontSize: 9, color: accent, background: 'transparent', border: `1px solid ${accent}44`, borderRadius: 3, padding: '1px 6px', cursor: 'pointer', opacity: isGenerating ? 0.5 : 1, marginLeft: 'auto' }}>
                      {isGenerating ? '…' : '↺ Regenerate'}
                    </button>
                  )}
                </div>
                <textarea
                  value={isGenerating ? 'Generating…' : val}
                  onChange={e => !isGenerating && setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  readOnly={isGenerating}
                  placeholder={f.required ? '[Required — fill in]' : ''}
                  rows={rowCount}
                  style={{
                    ...mono, fontSize: 11, width: '100%', boxSizing: 'border-box',
                    background: '#080c12', border: `1px solid ${isEmpty && f.required ? C.red + '66' : C.brd}`,
                    color: isEmpty && f.required && !isGenerating ? C.red : C.txt, borderRadius: 5,
                    padding: '6px 8px', resize: 'vertical', outline: 'none',
                    fontStyle: isGenerating ? 'italic' : 'normal',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${C.brd}`, display: 'flex', gap: 8 }}>
          <button onClick={handleCopy} style={{
            ...mono, flex: 1, fontSize: 11, fontWeight: 700, padding: '8px 0',
            background: copied ? `${C.green}18` : `${accent}18`,
            border: `1px solid ${copied ? C.green + '55' : accent + '55'}`,
            color: copied ? C.green : accent, borderRadius: 6, cursor: 'pointer',
          }}>
            {copied ? '✓ Copied!' : '⎘ Copy to Clipboard'}
          </button>
          <button onClick={onClose} style={{
            ...mono, fontSize: 11, padding: '8px 14px',
            background: 'transparent', border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 6, cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
