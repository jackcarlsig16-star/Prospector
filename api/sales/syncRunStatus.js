// A run row still 'running' this long after it started never finished (the
// process died mid-run, e.g. a deploy or Render sleep). It's reported as
// failed everywhere and never counts toward Sync now's cooldown or daily cap.
export const STUCK_RUN_MINUTES = 30;
export const STUCK_TEXT = `stuck - no finish after ${STUCK_RUN_MINUTES} min, treated as failed`;

export const isStuck = (run, now = Date.now()) => run.status === 'running' && now - Date.parse(run.started_at) > STUCK_RUN_MINUTES * 60e3;

export const asReported = (run, now = Date.now()) => (isStuck(run, now) ? { ...run, status: 'error', error_text: STUCK_TEXT, stuck: true } : run);

// Runs that died without doing anything - left out of the manual limits.
export const isDeadRun = (run, now = Date.now()) => isStuck(run, now) || (run.status === 'error' && ['stale lock', STUCK_TEXT].includes(run.error_text));
