import { useCallback, useEffect, useRef, useState } from 'react';
import { createSpeaker } from '../../engine/speech';
import type { Speaker, Synth, Utterance, Voice } from '../../engine/speech';

/** The window as a browser without speech would have it: both parts may be missing. */
interface SpeechWindow { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance }
const speechWindow = (): SpeechWindow => window as unknown as SpeechWindow;

/** Only on-device voices. A network voice (such as Chrome's "Google ..." voices) sends the reply text to a server to be turned into speech, which breaks the privacy promise.
    If the device has no local voice, spoken replies are simply unavailable. */
export function pickLocalVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const local = voices.filter(v => v.localService);
  for (const name of ['Rishi', 'Veena', 'Microsoft Ravi - English (India)', 'Microsoft Heera - English (India)']) { const v = local.find(x => x.name === name); if (v) return v; }
  return local.find(v => v.lang === 'en-IN') ?? local.find(v => v.lang.startsWith('en')) ?? null;
}

/** Spoken replies, off until the person switches them on. The queue is held in JavaScript and the engine gets one short chunk at a time (lib/speech.ts explains why). */
export function useSpeaker() {
  const w = speechWindow();
  const supported = typeof w.speechSynthesis !== 'undefined' && typeof w.SpeechSynthesisUtterance === 'function';
  const [on, setOn] = useState(false);
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const speaker = useRef<Speaker | null>(null);

  useEffect(() => {
    const synth = speechWindow().speechSynthesis;
    if (!synth) return undefined;
    const load = (): void => { const v = synth.getVoices(); if (v.length) voices.current = v; };
    load(); synth.onvoiceschanged = load;
    const stop = (): void => { speaker.current?.stop(); };
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); synth.onvoiceschanged = null; speaker.current?.stop(); };
  }, []);

  const get = useCallback((): Speaker | null => {
    if (speaker.current) return speaker.current;
    const sw = speechWindow();
    if (!sw.speechSynthesis || !sw.SpeechSynthesisUtterance) return null;
    speaker.current = createSpeaker({ synth: sw.speechSynthesis as unknown as Synth, Utterance: sw.SpeechSynthesisUtterance as unknown as new (t: string) => Utterance,
      pickVoice: (): Voice | null => pickLocalVoice(voices.current), rate: 0.95 });
    return speaker.current;
  }, []);

  const toggle = useCallback(() => { setOn(v => { if (v) speaker.current?.stop(); return !v; }); }, []);
  const say = useCallback((text: string): void => { get()?.say(text); }, [get]);
  /** Calls back when everything queued has been spoken (at once if nothing is playing): the microphone opens only after the assistant has finished. */
  const whenIdle = useCallback((fn: () => void): void => { const s = speaker.current; if (s) s.whenIdle(fn); else fn(); }, []);
  const busy = useCallback((): boolean => speaker.current?.busy ?? false, []);
  return { supported, on, toggle, say, whenIdle, busy };
}
