import { forecastBuckets } from './PipelineForecast';
import { STAGE_ENUM, STAGE_LABELS, DEFAULT_PROBABILITY, compareStages } from './pipelineStages';

test('side lanes have labels and probability 0, and sit off the linear path', () => {
  expect(STAGE_LABELS.nurture).toBe('Nurture');
  expect(STAGE_LABELS.on_hold).toBe('On hold');
  for (const s of ['nurture', 'on_hold']) {
    expect(STAGE_ENUM).toContain(s);
    expect(DEFAULT_PROBABILITY[s]).toBe(0);
    expect(compareStages('target', s)).toBeNull();
  }
});

test('forecast leaves side lanes out of count, covered lives and weighted totals, even with a hand-typed probability', () => {
  const opps = [
    { id: 1, stage: 'meeting', expected_close: '2026-10-20', covered_lives: 100, est_value: 1000, probability: null },
    { id: 2, stage: 'nurture', expected_close: '2026-10-20', covered_lives: 400, est_value: 4000, probability: 0.5 },
    { id: 3, stage: 'on_hold', expected_close: '2026-10-21', covered_lives: 400, est_value: 4000, probability: null },
    { id: 4, stage: 'lost', expected_close: '2026-10-22', covered_lives: 400, est_value: 4000, probability: 0.9 },
  ];
  const [first] = forecastBuckets(opps, '2026-10-15');
  expect(first.rows.map(o => o.id)).toEqual([1]);
  expect(first.totals).toEqual({ count: 1, coveredLives: 100, weightedLives: 20, weightedValue: 200 });
});
