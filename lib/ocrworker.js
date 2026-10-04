/* One text-reading engine, started once and kept hot while it is being used.
   Tesseract.recognize() is a convenience wrapper: every call starts a Web Worker, compiles the WebAssembly core, unpacks the language data,
   reads one picture, and tears it all down again. Someone who sends three screenshots of a chat pays that start-up three times, on a phone,
   with the battery. This keeps one worker instead:
     - it is created on first use (or by warm(), called as the picture picker opens, so the start-up overlaps with choosing the picture);
     - pictures are read one at a time through it (a second request waits, it does not start a second engine);
     - it is terminated when it has been idle for a while, when the chat is closed or the page is hidden (release()), and straight away if a
       read ever fails, so a worker that ran out of memory is never reused: the next picture gets a fresh one;
     - release() waits for a read in progress rather than killing it.
   The browser objects are passed in, so this is tested in Node with fakes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldOcr = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const LSTM_ONLY = 1;   // Tesseract's engine mode 1, the one the vendored core files implement

// env: { load() -> Promise<Tesseract>, options: { workerPath, corePath, langPath }, langs, idleMs, setTimeout, clearTimeout }
function createOcr(env) {
  const setT = env.setTimeout || setTimeout, clearT = env.clearTimeout || clearTimeout, idleMs = env.idleMs == null ? 120000 : env.idleMs;
  let workerP = null, idleTimer = null, progress = null, chain = Promise.resolve(), started = 0;

  const logger = m => { if (progress) { try { progress(m); } catch (e) { /* a progress callback must never break a read */ } } };   // one logger for the worker's life; who listens changes per picture

  function ensure() {
    if (!workerP) {
      started++;
      workerP = env.load().then(T => T.createWorker(env.langs || 'eng', LSTM_ONLY, { ...env.options, logger })).catch(err => { workerP = null; throw err; });
    }
    return workerP;
  }
  const arm = () => { clearT(idleTimer); if (idleMs > 0) idleTimer = setT(() => { release(); }, idleMs); };

  async function terminateNow() {
    clearT(idleTimer); idleTimer = null;
    const p = workerP; workerP = null;
    if (!p) return;
    try { const w = await p; await w.terminate(); } catch (e) { /* it never started, or is already gone */ }
  }
  // Ends the engine once any read in progress has finished.
  function release() { const done = chain.then(terminateNow); chain = done.catch(() => {}); return done; }

  return {
    // Reads one picture. Reads are queued, so only one is ever in the engine. onProgress receives the engine's own progress messages.
    recognize(image, onProgress) {
      const run = chain.then(async () => {
        clearT(idleTimer); progress = onProgress || null;
        try { const w = await ensure(); const result = await w.recognize(image); arm(); return result; }
        catch (err) { await terminateNow(); throw err; }   // never reuse an engine that failed
        finally { progress = null; }
      });
      chain = run.catch(() => {});
      return run;
    },
    // Starts the engine in the background so the first picture does not wait for it; it idles out if no picture comes.
    warm() { ensure().then(arm, () => {}); },
    release,
    get hot() { return workerP !== null; },
    get starts() { return started; }
  };
}

return { LSTM_ONLY, createOcr };
}));
