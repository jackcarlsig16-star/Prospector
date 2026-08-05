export const FORECAST_CATS = ['Commit', 'Best Case', 'Pipeline', 'Omit'];

export const SFDC_FC_MAP = { 'Most Likely': 'Best Case', 'most likely': 'Best Case', 'Upside': 'Best Case' };

export const getEffectiveForecastCat = (prob, manual) => {
  if (manual) {
    const norm = SFDC_FC_MAP[manual] || manual;
    if (FORECAST_CATS.includes(norm)) return norm;
  }
  if (prob >= 90) return 'Commit';
  if (prob >= 40) return 'Best Case';
  return 'Pipeline';
};
