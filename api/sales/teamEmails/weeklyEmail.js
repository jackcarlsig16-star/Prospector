import { LAYERS } from '../../../src/constants/explorerLayers.js';
import { ORIGIN, esc, DARK, SANS, MONO, dlink, darkShell, dataTable } from './format.js';
import { SETTINGS_URL, FOOTER_WORDS } from './visitorEmail.js';

// weekly-funnel-v1 W7 - the Friday weekly funnel email, pure over GET goals/weekly's body (the registry route: every
// number here is that route's digit - nothing is computed but the sign of its delta and a bar's height). The rows in
// their four groups as tables: Metric with a 12-week strip · Last week · This week · Change · Goal. The strip is bar
// cells in a table (% widths, a pixel height each, this week's bar hollow, a week with no number a hairline) - no SVG,
// no image, no external CSS. The pace rule is stated once, under the title. A LinkedIn row says who typed it and when,
// or "not entered". The text part carries the same rows in aligned columns. Names are first names only; no address.
// email-by-member-v1 M5: when the body carries member rows (goals/weekly?member=all), one "By member" table under
// Outbound - last week against the week before, the route's own weekly digits per member.
export const SCORECARD_URL = `${ORIGIN}/?tab=dashboard&view=scorecard`;
export const GROUP_HUE = { Outbound: LAYERS.sent.color, Site: LAYERS.visitors.color, Pipeline: LAYERS.first_touched.color, LinkedIn: LAYERS.reply_rate.color };
const STRIP_PX = 18;
const HEADS = ['Metric · 12 weeks', 'Last week', 'This week', 'Change', 'Goal'], WIDTHS = [31, 15, 18, 21, 15];
const BLOCKS = '▁▂▃▄▅▆▇█';

const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = r => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const val = (m, v) => (m.unit === 'rate' ? pct(v) : fmt(v));
const utc = d => new Date(`${d}T12:00:00Z`);
const md = d => utc(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const mdIso = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
// "Nov 16–20", or "Nov 30 – Dec 4" across a month end.
export const rangeOf = (from, to) => (from === to ? md(from) : from.slice(0, 7) === to.slice(0, 7) ? `${md(from)}–${Number(to.slice(8, 10))}` : `${md(from)} – ${md(to)}`);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

// The route's delta against the same point last week: ▲ = moved the good way, ▼ = the bad way, beside the signed amount.
export function changeOf(m) {
  const d = m.this_week.delta;
  if (d == null) return null;
  if (d === 0) return { glyph: '—', text: 'no change', dir: 'flat' };
  const good = (d > 0) === (m.direction === 'up');
  return { glyph: good ? '▲' : '▼', text: `${d > 0 ? '+' : '−'}${m.unit === 'rate' ? `${Math.abs(d * 100).toFixed(1)} pts` : fmt(Math.abs(d))}`, dir: good ? 'good' : 'bad' };
}
const enteredWords = m => {
  const one = (label, e) => (e ? `${label} entered by ${e.by} ${mdIso(e.at)}` : null);
  return [one('last week', m.entered?.last_week), one('this week', m.entered?.this_week)].filter(Boolean).join(' · ') || 'not entered';
};
export const MEMBER_COLS = [['delivered', 'Delivered'], ['human_open_rate', 'Open rate'], ['replies', 'Replies'], ['meetings_set', 'Meetings']];
const MEMBER_WIDTHS = [28, 18, 18, 18, 18];
// A member's last full week and the week before it, from the row's own series.
const weeksOf = m => { const s = m.series; return { last: s[s.length - 2]?.value ?? null, before: s[s.length - 3]?.value ?? null }; };
const maxOf = m => Math.max(0, ...m.series.map(s => s.value ?? 0));

function stripHtml(m, hue) {
  const max = maxOf(m), n = m.series.length, w = Math.floor(100 / n);
  if (!m.series.some(s => s.value != null)) return '';
  const cell = s => {
    const h = s.value == null ? 0 : Math.max(2, Math.round((max ? s.value / max : 0) * STRIP_PX));
    const bar = s.value == null ? `<div style="height:1px;background:${DARK.rule};font-size:0;line-height:0">&nbsp;</div>`
      : s.current ? `<div style="height:${Math.max(1, h - 2)}px;border:1px solid ${hue};font-size:0;line-height:0">&nbsp;</div>`
        : `<div style="height:${h}px;background:${hue};font-size:0;line-height:0">&nbsp;</div>`;
    return `<td width="${w}%" valign="bottom" style="height:${STRIP_PX}px;padding:0 1px;vertical-align:bottom;font-size:0;line-height:0">${bar}</td>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;margin-top:6px"><tr>${m.series.map(cell).join('')}</tr></table>`;
}
const stripText = m => { const max = maxOf(m); return m.series.map(s => (s.value == null ? '·' : BLOCKS[Math.min(7, Math.round((max ? s.value / max : 0) * 7))])).join(''); };

export function buildWeeklyEmail(weekly) {
  const range = rangeOf(weekly.week_start, weekly.today);
  const of = key => weekly.metrics.find(m => m.key === key);
  const open = of('human_open_rate')?.this_week, visited = of('companies_visited')?.this_week.to_date, meetings = of('meetings_set')?.this_week.to_date;
  const headline = [
    open?.to_date != null ? `opens ${pct(open.to_date)}${open.goal != null ? ` (goal ${pct(open.goal)})` : ''}` : null,
    visited != null ? `${plural(visited, 'company', 'companies')} visited` : null,
    meetings != null ? plural(meetings, 'meeting', 'meetings') : null,
  ].filter(Boolean).join(' · ');
  const subject = `Weekly funnel · ${range}${headline ? ` — ${headline}` : ''}`;
  const eyebrow = 'HomeLover · Weekly funnel';
  const title = `Weekly funnel · ${range}`;
  const dayWords = `This week is ${range}, day ${weekly.elapsed.days} of 7.`;
  const rule = `${weekly.wording.pace} ${weekly.wording.week}`;
  const groups = weekly.groups.map(g => [g, weekly.metrics.filter(m => m.group === g)]).filter(([, list]) => list.length);

  const small = t => `<div style="font-size:11.5px;color:${DARK.muted};line-height:1.35;margin-top:2px">${t}</div>`;
  const big = t => `<div style="font:600 13px ${SANS};line-height:1.3;color:${DARK.text};white-space:nowrap">${esc(t)}</div>`;
  const dash = `<span style="color:${DARK.faint}">—</span>`;
  const row = m => {
    const tw = m.this_week, lw = m.last_week, c = changeOf(m), hue = GROUP_HUE[m.group], manual = m.kind === 'manual';
    const under = manual ? enteredWords(m) : m.hint;
    return [
      `<div style="font:600 13px ${SANS};color:${DARK.text};line-height:1.3">${esc(m.name)}</div>${under ? small(esc(under)) : ''}${stripHtml(m, hue)}`,
      `${big(val(m, lw?.value))}${lw?.goal != null ? small(`/ ${esc(val(m, lw.goal))}${lw.hit == null ? '' : ` <span style="color:${lw.hit ? DARK.good : DARK.bad}">${lw.hit ? '✓ met' : '✕ missed'}</span>`}`) : ''}`,
      `${big(val(m, tw.to_date))}${tw.pace != null ? small(`pace ~${esc(fmt(tw.pace))}`) : tw.to_date == null || manual ? '' : small(m.kind === 'stock' ? 'as of today' : 'to date')}`,
      c ? `<div style="font:600 13px ${SANS};line-height:1.3;color:${c.dir === 'good' ? DARK.good : c.dir === 'bad' ? DARK.bad : DARK.muted}">${esc(`${c.glyph} ${c.text}`)}</div>${small(`vs ${esc(val(m, tw.same_point_last_week))}`)}` : dash,
      tw.goal != null ? `${big(val(m, tw.goal))}${tw.progress != null ? small(`${Math.round(tw.progress * 100)}% of goal`) : ''}` : dash,
    ];
  };
  const memberRows = (weekly.rows || []).length > 1 ? weekly.rows : [];
  const memberCell = (r, key) => { const m = r.metrics.find(x => x.key === key), w = weeksOf(m); return { now: val(m, w.last), was: val(m, w.before) }; };
  const memberHtml = memberRows.length ? `<div style="font:600 12px ${SANS};color:${DARK.text};margin-top:22px">By member <span style="font-weight:400;color:${DARK.muted}">· last week vs the week before</span></div>
${dataTable(['Member', ...MEMBER_COLS.map(c => c[1])], MEMBER_WIDTHS, memberRows.map(r => [`<div style="font:600 13px ${SANS};color:${DARK.text};line-height:1.3">${esc(r.name)}</div>`, ...MEMBER_COLS.map(([key]) => { const c = memberCell(r, key); return `${big(c.now)}${small(`vs ${esc(c.was)}`)}`; })]))}` : '';
  const groupHtml = ([g, list]) => `<tr><td style="padding:24px 0 0">
<div style="font:600 11px ${MONO};letter-spacing:.1em;text-transform:uppercase;color:${GROUP_HUE[g]}">${esc(g)}${g === 'LinkedIn' ? `<span style="color:${DARK.faint};letter-spacing:.04em;text-transform:none;font-weight:400"> · typed by a member</span>` : ''}</div>
${dataTable(HEADS, WIDTHS, list.map(row))}${g === 'Outbound' ? memberHtml : ''}</td></tr>`;
  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
${groups.map(groupHtml).join('\n')}
<tr><td style="padding:26px 0 0"><div style="border-top:1px solid ${DARK.rule};padding-top:20px">
<div style="font:12.5px ${SANS};color:${DARK.muted};line-height:1.55">Each strip is the last ${weekly.weeks.length} weeks, oldest first; the outlined bar is this week to date; a hairline is a week with no number. ▲ moved the good way · ▼ the bad way, against the same point last week.</div>
<div style="font:13px ${SANS};margin-top:12px">${dlink(SCORECARD_URL, 'Open the Scorecard →', true)}</div>
<div style="font:12px ${SANS};color:${DARK.faint};margin-top:14px">Sent by Prospector to the HomeLover team · ${dlink(SETTINGS_URL, 'manage recipients')} · Sales › Settings › Team emails</div></div></td></tr>
</table>`;
  const html = darkShell({ eyebrow, title, sub: `${esc(dayWords)} ${esc(rule)} ${dlink(SCORECARD_URL, 'Open the Scorecard →')}`, body });

  const COLS = [28, 14, 22, 16, 18];
  const line = cells => cells.map((c, i) => (i < COLS.length ? String(c).padEnd(COLS[i]) : c)).join(' ').trimEnd();
  const textRow = m => {
    const tw = m.this_week, lw = m.last_week, c = changeOf(m), manual = m.kind === 'manual';
    return [
      line([
        m.name,
        `${val(m, lw?.value)}${lw?.goal != null ? ` / ${val(m, lw.goal)}` : ''}`,
        `${val(m, tw.to_date)}${tw.pace != null ? ` (pace ~${fmt(tw.pace)})` : ''}`,
        c ? `${c.glyph} ${c.text}` : '—',
        tw.goal != null ? `${val(m, tw.goal)}${tw.progress != null ? ` (${Math.round(tw.progress * 100)}%)` : ''}` : '—',
        stripText(m),
      ]),
      ...(manual ? [`  ${enteredWords(m)}`] : []),
    ].join('\n');
  };
  const MCOLS = [22, 20, 20, 20];
  const memberText = memberRows.length ? ['', 'By member · last week (the week before)', ['Member', ...MEMBER_COLS.map(c => c[1])].map((c, i) => (i < MCOLS.length ? c.padEnd(MCOLS[i]) : c)).join(' ').trimEnd(),
    ...memberRows.map(r => [r.name, ...MEMBER_COLS.map(([key]) => { const c = memberCell(r, key); return `${c.now} (${c.was})`; })].map((c, i) => (i < MCOLS.length ? String(c).padEnd(MCOLS[i]) : c)).join(' ').trimEnd())] : [];
  const text = [
    eyebrow.toUpperCase(), title, `${dayWords} ${rule}`, `Open the Scorecard → ${SCORECARD_URL}`,
    ...groups.flatMap(([g, list]) => ['', `${g.toUpperCase()}${g === 'LinkedIn' ? ' · typed by a member' : ''}`, line(['Metric', 'Last week', 'This week', 'Change', 'Goal', `${weekly.weeks.length} weeks`]), ...list.map(textRow), ...(g === 'Outbound' ? memberText : [])]),
    '', `Each strip is the last ${weekly.weeks.length} weeks, oldest first; · is a week with no number. ▲ moved the good way · ▼ the bad way, against the same point last week.`,
    '', '—', FOOTER_WORDS,
  ].join('\n');

  const manual = weekly.metrics.filter(m => m.kind === 'manual');
  return {
    subject, html, text, rows: weekly.metrics.length, groups: groups.length, member_rows: memberRows.length,
    strips: weekly.metrics.filter(m => m.series.some(s => s.value != null)).length,
    goals: weekly.metrics.filter(m => m.this_week.goal != null).length,
    entered: manual.filter(m => m.entered?.last_week || m.entered?.this_week).length, not_entered: manual.filter(m => !m.entered?.last_week && !m.entered?.this_week).length,
  };
}
