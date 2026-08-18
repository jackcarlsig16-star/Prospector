import { computePricing } from './pricing';
import { inferDealStage } from './scoringEngine';

const QUARTER_MONTHS = { Q1:[0,1,2], Q2:[3,4,5], Q3:[6,7,8], Q4:[9,10,11] };

export const getCurrentQuarter = () => {
  const month = new Date().getMonth();
  return Object.entries(QUARTER_MONTHS).find(([, months]) => months.includes(month))[0];
};

export const getACV = (acc) => {
  if (acc.acvOverride != null) return acc.acvOverride;
  try {
    const pFile = JSON.parse(localStorage.getItem("prospector_pricing_files") || "{}")[acc.id];
    if (pFile) {
      const pricing = computePricing(pFile);
      return pricing?.annualTotal ?? null;
    }
  } catch {}
  return null;
};

export const getForecastSummary = (accounts, winsLog, prefs) => {
  const currentQ = getCurrentQuarter();
  const quota = (prefs?.quota || {})[currentQ] || 0;

  const qtdWins = (winsLog || []).filter(w => {
    if (!w.closedAt) return false;
    const month = new Date(w.closedAt).getMonth();
    return QUARTER_MONTHS[currentQ].includes(month);
  });

  const closedWonQTD = qtdWins.reduce((s, w) => {
    if (w.acv != null) return s + w.acv;
    try {
      const pFile = JSON.parse(localStorage.getItem("prospector_pricing_files") || "{}")[w.accountId];
      if (pFile) {
        const pricing = computePricing(pFile);
        return s + (pricing?.annualTotal || 0);
      }
    } catch {}
    return s;
  }, 0);

  // account-taxonomy-and-creation-upgrade-v1 Stage 4 - forward pipeline
  // forecast, not historical revenue (closedWonQTD above reads winsLog, not
  // accounts.stage, so it's already unaffected either way). Defensive
  // relationship_type guard: no real account can currently be both
  // "Active Deal" staged and a converted Client/Partner/Competitor at once
  // (conversion only fires on the Closed Won transition, which also changes
  // stage away from "Active Deal"), but a future manual relationship_type
  // editor could produce that combination - a non-prospect account
  // shouldn't count toward prospect pipeline forecast regardless.
  const weightedForecast = (accounts || [])
    .filter(a => a.stage === "Active Deal" && (a.relationshipType || "Prospect/Lead") === "Prospect/Lead")
    .reduce((s, a) => {
      const acv = getACV(a);
      const prob = a.closeProbability ?? null;
      return acv != null && prob != null ? s + acv * (prob / 100) : s;
    }, 0);

  return {
    quota,
    closedWonQTD,
    weightedForecast,
    gap: Math.max(0, quota - closedWonQTD),
    currentQ,
  };
};

export const defaultClosePct = (rank, total, dealStage) => {
  const position = rank / total;
  let pct;
  if      (position <= 0.15) pct = 90;
  else if (position <= 0.30) pct = 75;
  else if (position <= 0.50) pct = 60;
  else if (position <= 0.70) pct = 40;
  else if (position <= 0.85) pct = 25;
  else                        pct = 10;

  if (dealStage === "contract_execution" || dealStage === "negotiation") pct = Math.max(pct, 60);
  if (dealStage === "qualify" || dealStage === "discovery")              pct = Math.min(pct, 40);

  return pct;
};

const STAGE_WEEKS = {
  qualify: 12,
  discovery: 10,
  evaluation: 8,
  mutual_alignment: 6,
  negotiation: 4,
  contract_execution: 2,
  closed_won: 0,
};

export function getQuarterStart(q) {
  const year = new Date().getFullYear();
  const months = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 };
  return new Date(year, months[q], 1);
}

export function getQuarterEnd(q) {
  const year = new Date().getFullYear();
  const months = { Q1: 2, Q2: 5, Q3: 8, Q4: 11 };
  const lastDay = new Date(year, months[q] + 1, 0).getDate();
  return new Date(year, months[q], lastDay);
}

export function isCurrentQuarter(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const q = getCurrentQuarter();
  const start = getQuarterStart(q);
  const end = getQuarterEnd(q);
  end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}

export const projectedCloseDate = (acc) => {
  const stage = acc.dealStage || inferDealStage(acc);
  const weeksRemaining = STAGE_WEEKS[stage] ?? 8;
  const d = new Date();
  d.setDate(d.getDate() + weeksRemaining * 7);
  return d;
};
