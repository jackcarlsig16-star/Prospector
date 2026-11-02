import React, { useEffect, useState } from 'react';
import { hkGet } from '../hkApi';
import { monthWords, usd } from './dealWords';

// grow-sponsor-deals-v1 S4 - Brands › Views › Sponsor money: the last 3 months + this month + next 3 from GET /deals/money.
// Confirmed and in discussion are always separate (no probabilities). A month with no amounts shows counts and "—".
// A cell opens the brand list below filtered to that month + state (Paid / Unpaid add the Paid filter).
const COLS = [
  ['confirmed_usd', 'Confirmed', m => ({ month: [`${m}:confirmed`] })],
  ['paid_usd', 'Paid', m => ({ month: [`${m}:confirmed`], paid: ['paid'] })],
  ['unpaid_usd', 'Unpaid confirmed', m => ({ month: [`${m}:confirmed`], paid: ['unpaid'] })],
  ['discussing_usd', 'In discussion', m => ({ month: [`${m}:discussing`] })],
  ['confirmed', 'Confirmed brands', m => ({ month: [`${m}:confirmed`] })],
  ['discussing', 'In discussion brands', m => ({ month: [`${m}:discussing`] })],
  ['declined', 'Declined', m => ({ month: [`${m}:declined`] })],
];

export default function SponsorMoney({ businessId, onPick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; hkGet(businessId, '/deals/money').then(d => live && setData(d), e => live && setError(e.message)); return () => { live = false; }; }, [businessId]);
  if (error) return <p className="hk-error" role="alert">{error}</p>;
  if (!data) return <p className="hk-meta">Loading sponsor money…</p>;
  const t = data.totals;
  return (
    <section className="hk-bcard hk-money" aria-label="Sponsor money" data-hk-money>
      <div className="hk-tablescroll">
        <table className="hk-table hk-money__table">
          <caption className="ui-sr-only">Sponsor money by month</caption>
          <thead><tr><th scope="col">Month</th>{COLS.map(([k, l]) => <th key={k} scope="col" className="hk-money__num">{l}</th>)}</tr></thead>
          <tbody>
            {data.months.map(r => (
              <tr key={r.month} className={r.month === data.this_month ? 'hk-money__now' : undefined} data-hk-money-month={r.month}>
                <th scope="row">{monthWords(r.month)}{r.month === data.this_month && <span className="hk-meta"> · this month</span>}</th>
                {COLS.map(([k, l, f]) => {
                  const v = r[k], money = k.endsWith('_usd'), n = money ? null : v;
                  const words = money ? usd(v) : String(v);
                  const empty = money ? v == null || v === 0 : !v;
                  return (
                    <td key={k} className="hk-money__num">
                      {empty ? <span className="hk-meta">{words}</span>
                        : <button type="button" className="hk-btn hk-link" aria-label={`${l}, ${monthWords(r.month)}: ${words}${n != null ? ' brands' : ''}`} onClick={() => onPick(f(r.month))} data-hk-money-cell={`${r.month}:${k}`}>{words}</button>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hk-money__line" data-hk-money-if-all>
        {t.if_all_close_usd == null
          ? 'No amounts on these months yet.'
          : <>If everything in discussion closes: <strong>{usd(t.if_all_close_usd)}</strong> across these {data.months.length} months ({usd(t.confirmed_usd)} confirmed + {usd(t.discussing_usd)} in discussion).</>}
      </p>
      <p className="hk-meta">Amounts come from the sheet and the Deal cards. New months default to {data.default_monthly_usd == null ? 'no amount' : usd(data.default_monthly_usd)} (Settings › Pitch).</p>
    </section>
  );
}
