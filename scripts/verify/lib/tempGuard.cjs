// Temp-data guard for scripts/verify live checks. A check that dies mid-run
// (perl's `alarm` cap sends SIGALRM, Ctrl-C sends SIGINT, a throw outside the
// try) skips its own finally - this runs the teardown anyway, exactly once,
// then exits. Adopted 2026-10-15 after a temp workspace was seen on prod.
//
//   const cleanup = tempGuard(removeTemp, { capMs: 240000 });
//   ...
//   try { ...setup + checks... } catch (e) { ... } finally { await cleanup(); }
//
// cleanup() is safe to call more than once: every call shares one run.
// capMs is the script's own hard cap (keep it under any outer perl alarm).
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGALRM', 'SIGHUP'];

module.exports = function tempGuard(teardown, { capMs } = {}) {
  let run = null;
  const cleanup = () => (run ||= Promise.resolve().then(teardown).catch(e => console.log(`teardown error: ${e.message}`)));
  let bailing = false;
  const bail = (why, code) => {
    if (bailing) return;
    bailing = true;
    console.log(`ABORT (${why}) - tearing down temp data`);
    cleanup().then(() => { console.log('teardown after abort: done'); process.exit(code); });
  };
  for (const sig of SIGNALS) process.on(sig, () => bail(sig, 2));
  process.on('uncaughtException', e => bail(`uncaught: ${e.message}`, 2));
  process.on('unhandledRejection', e => bail(`unhandled rejection: ${e?.message || e}`, 2));
  if (capMs) setTimeout(() => bail(`${Math.round(capMs / 60000)} min cap`, 2), capMs).unref();
  return cleanup;
};
