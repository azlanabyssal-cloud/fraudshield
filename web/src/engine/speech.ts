/* Spoken replies that cannot hang, for browsers whose speech engine does.
   Chrome (desktop and Android) has long-standing faults in speechSynthesis: an utterance that nothing refers to can be garbage-collected before its
   `end` event fires (the engine then never reports back and the queue is stuck), a long utterance or a long queue can silently stall the engine, and
   speak() straight after cancel() can be dropped. Handing the browser a paragraph, or several lines at once, relies on exactly the parts that break.
   So the queue is held here and the engine only ever gets one short chunk at a time:
     - text is cleaned for the ear (no emoji names, no spelled-out web addresses) and cut into sentences, long sentences at commas and then spaces;
     - one chunk is spoken, and the next is handed over only when `end` (or `error`) arrives;
     - the current utterance is kept in a variable, so it cannot be collected before it ends;
     - a watchdog per chunk (its expected length plus a margin) cancels a chunk that never reports back and moves on, so a stall costs seconds, not the session;
     - an engine found "speaking" with nothing of ours playing is cancelled before we start.
   pause()/resume() on a timer is deliberately not used: it keeps a long utterance alive on desktop Chrome, but Android Chrome does not implement pause
   (it behaves as cancel), so the trick would stop speech there. Chunks of a sentence never reach the length at which the desktop fault appears.
   Pure functions (cleanForSpeech, chunk) are tested in Node; createSpeaker takes the browser objects as arguments so it is tested with fakes. */

/** The parts of the browser's speech engine this uses. */
export interface Synth { speak(u: Utterance): void; cancel(): void; speaking?: boolean; pending?: boolean }
export interface Utterance { voice?: unknown; lang?: string; rate: number; pitch: number; onend: (() => void) | null; onerror: (() => void) | null }
export interface Voice { lang: string }
export interface SpeakerEnv {
  synth: Synth;
  Utterance: new (text: string) => Utterance;
  /** The voice to use, or null for none (then nothing is spoken: a network voice would send the text away). Leave out to take the engine's default. */
  pickVoice?: () => Voice | null;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  rate?: number;
}
export interface Speaker {
  say(text: unknown): number;
  stop(): void;
  whenIdle(fn: () => void): void;
  readonly busy: boolean;
  readonly pending: number;
  readonly current: Utterance | null;
}

const MAX_CHUNK = 160;          // characters; about 10 seconds at a natural pace, far below the length at which engines stall
const WATCHDOG_MARGIN_MS = 2500;
const MS_PER_CHAR = 90;         // a deliberately slow estimate (Hindi and a rate under 1 run slower than English): a late watchdog is harmless, an early one cuts speech
const PICTOGRAPH = /\p{Extended_Pictographic}/gu, JOINERS = /\uFE0F|\u200D|\u20E3/g;

// What the ear should get: no emoji (engines read their names aloud), no spelled-out URLs, no bullets, one space between words.
function cleanForSpeech(text: unknown): string {
  return String(text == null ? '' : text)
    .replace(/https?:\/\/\S+|www\.\S+/gi, 'a link')
    .replace(PICTOGRAPH, ' ').replace(JOINERS, '')
    .replace(/[•·▪►→←↑↓]/g, ' ')
    .replace(/["“”]/g, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/(?:\.\s*){2,}/g, '. ')
    .trim();
}

// Sentences end at . ! ? or the Hindi danda followed by a space or the end: "cybercrime.gov.in" and "1.5 lakh" are not cut. A sentence over
// `max` is cut at its last comma or semicolon before the limit, else at its last space, else at the limit. Nothing is dropped or reordered
// (tests/speech.test.js checks that on thousands of random texts).
function sentences(clean: string): string[] {
  const out: string[] = []; let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '.' || c === '!' || c === '?' || c === '।') {
      let j = i; while (j + 1 < clean.length && '.!?।'.includes(clean[j + 1] ?? '')) j++;   // "?!" and "..." stay together
      if (j + 1 >= clean.length || /\s/.test(clean[j + 1] ?? '')) { out.push(clean.slice(start, j + 1)); start = j + 1; }
      i = j;
    }
  }
  if (start < clean.length) out.push(clean.slice(start));
  return out;   // written as a loop, not a regex: it must keep every character, and (no lookbehind) it must run in older Safari
}

function chunk(text: unknown, max?: number): string[] {
  const limit = max !== undefined && max > 20 ? max : MAX_CHUNK, out: string[] = [];
  for (let s of sentences(cleanForSpeech(text))) {
    s = s.trim();
    while (s.length > limit) {
      const head = s.slice(0, limit);
      let cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf('—'), head.lastIndexOf(':'));
      if (cut < limit * 0.4) cut = head.lastIndexOf(' ');
      if (cut < 1) cut = limit - 1;
      out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
    }
    if (/[\p{L}\p{N}]/u.test(s)) out.push(s);   // a chunk of only punctuation says nothing
  }
  return out;
}

// env: { synth, Utterance, pickVoice() -> voice|null, setTimeout, clearTimeout, rate }
function createSpeaker(env: SpeakerEnv): Speaker {
  const synth = env.synth, setT = env.setTimeout || ((fn: () => void, ms: number): unknown => setTimeout(fn, ms)), clearT = env.clearTimeout || ((id: unknown): void => { clearTimeout(id as ReturnType<typeof setTimeout>); }), rate = env.rate || 0.95;
  const queue: string[] = [], idleWaiters: (() => void)[] = [];
  let current: Utterance | null = null, watchdog: unknown = null, generation = 0, afterCancel: boolean | null = null;   // `current` is a strong reference on purpose: see the header

  const busy = (): boolean => current !== null || queue.length > 0;
  function settleIfIdle(): void { if (!busy()) { const w = idleWaiters.splice(0); w.forEach(f => { try { f(); } catch (e) { /* a listener's failure must not stop the others */ } }); } }

  function next(): void {
    clearT(watchdog); watchdog = null; current = null;
    const part = queue.shift();
    if (part === undefined) { settleIfIdle(); return; }
    const voice = env.pickVoice ? env.pickVoice() : null;
    if (env.pickVoice && !voice) { queue.length = 0; settleIfIdle(); return; }   // no on-device voice: stay silent rather than send text to a network voice
    const u = new env.Utterance(part), mine = generation;
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = rate; u.pitch = 1;
    const done = (): void => { if (mine === generation && current === u) next(); };
    u.onend = done; u.onerror = done;
    current = u;
    watchdog = setT(() => { if (mine === generation && current === u) { try { synth.cancel(); } catch (e) { /* engine already gone */ } afterCancel = true; next(); } }, part.length * MS_PER_CHAR / rate + WATCHDOG_MARGIN_MS);
    if (afterCancel) { afterCancel = null; setT(() => { if (current === u) synth.speak(u); }, 40); }   // speak() right after cancel() can be dropped
    else synth.speak(u);
  }

  return {
    // Adds text to the end of what is being said. Returns the number of chunks queued (0 when there was nothing to say).
    say(text: unknown): number {
      const parts = chunk(text, MAX_CHUNK); if (!parts.length) return 0;
      const wasBusy = busy();
      queue.push(...parts);
      if (!wasBusy) {
        if (synth.speaking || synth.pending) { try { synth.cancel(); } catch (e) { /* ignore */ } afterCancel = true; }   // an engine still "speaking" with nothing of ours playing is stuck
        next();
      }
      return parts.length;
    },
    stop(): void { generation++; queue.length = 0; clearT(watchdog); watchdog = null; current = null; try { synth.cancel(); } catch (e) { /* ignore */ } settleIfIdle(); },
    // Calls back once everything queued so far has been spoken (immediately if nothing is playing). Used to open the microphone only when the bot has finished.
    whenIdle(fn: () => void): void { if (!busy()) fn(); else idleWaiters.push(fn); },
    get busy() { return busy(); },
    get pending() { return queue.length; },
    get current() { return current; }
  };
}

export { MAX_CHUNK, cleanForSpeech, chunk, createSpeaker };
